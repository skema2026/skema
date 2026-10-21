"""
스터디 기록 영상 저장소

STORAGE=local  UPLOAD_DIR 폴더에 저장, 주소는 /uploads/<키> (main.py 가 /uploads 를 공개)
STORAGE=r2     Cloudflare R2 비공개 버킷에 저장, 주소는 호출할 때마다 만드는 서명 주소

DB(StudyLog.photo_path)에는 주소가 아니라 키만 저장한다.  예: studylogs/3f2a...e9.webm
예전 기록은 photo_path 에 전체 경로(/app/uploads/studylogs/xxx.mp4)가 들어 있으므로,
읽을 때는 항상 normalize_key() 를 거친다.
"""

import logging
import os
import shutil
import uuid
from functools import lru_cache
from typing import BinaryIO, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

KEY_PREFIX = "studylogs/"
ALLOWED_EXTS = {"webm", "mp4", "m4v", "mov", "mkv"}

# 클라이언트가 선언한 Content-Type(base) -> 컨테이너 계열
_DECLARED_FAMILY = {
    "video/webm": "ebml",
    "video/x-matroska": "ebml",
    "video/mp4": "mp4",
    "video/quicktime": "mp4",
}
# MP4/MOV 파일은 앞 8바이트의 4~8번째가 첫 박스 이름이다
_MP4_FIRST_BOXES = {b"ftyp", b"moov", b"mdat", b"free", b"wide", b"skip"}
_EBML_MAGIC = b"\x1a\x45\xdf\xa3"

SNIFF_BYTES = 64


class InvalidVideo(ValueError):
    """허용되지 않은 영상 (HTTP 415 로 바꿔서 돌려준다)"""


def validate_upload(content_type: str, filename: Optional[str], head: bytes) -> tuple[str, str]:
    """
    선언한 타입·파일명·파일 앞부분이 모두 영상 컨테이너(webm/mkv/mp4/mov)와 맞는지 확인한다.
    반환: (저장에 쓸 확장자, 저장할 Content-Type)

    클라이언트가 보내는 Content-Type 과 파일명은 얼마든지 속일 수 있으므로
    저장 확장자는 파일명이 아니라 실제 내용에서 정한다.
    """
    base = (content_type or "").split(";")[0].strip().lower()
    declared = _DECLARED_FAMILY.get(base)
    if declared is None:
        raise InvalidVideo("webm/mp4/mov/mkv 영상만 업로드 가능합니다.")

    name = filename or ""
    if "." in name:
        name_ext = name.rsplit(".", 1)[-1].lower()
        if name_ext not in ALLOWED_EXTS:
            raise InvalidVideo("허용되지 않는 파일 확장자입니다.")

    if head[:4] == _EBML_MAGIC:
        kind = "ebml"
    elif len(head) >= 12 and head[4:8] in _MP4_FIRST_BOXES:
        kind = "qt" if (head[4:8] == b"ftyp" and head[8:12] == b"qt  ") else "mp4"
    else:
        raise InvalidVideo("영상 파일이 아닙니다.")

    family = "mp4" if kind in ("qt", "mp4") else "ebml"
    if family != declared:
        raise InvalidVideo("파일 내용이 선언한 영상 형식과 다릅니다.")

    if kind == "ebml":
        return ("mkv", "video/x-matroska") if base == "video/x-matroska" else ("webm", "video/webm")
    if kind == "qt":
        return "mov", "video/quicktime"
    return "mp4", "video/mp4"


def new_key(ext: str) -> str:
    return f"{KEY_PREFIX}{uuid.uuid4().hex}.{ext}"


def normalize_key(photo_path: str) -> str:
    """새 키(studylogs/x.mp4)는 그대로, 예전 전체 경로는 studylogs/<파일이름> 으로 바꾼다."""
    p = photo_path.replace("\\", "/")
    if p.startswith(KEY_PREFIX) and "/" not in p[len(KEY_PREFIX):] and p[len(KEY_PREFIX):] not in ("", ".", ".."):
        return p
    return KEY_PREFIX + os.path.basename(p)


def _local_path(key: str) -> str:
    return os.path.join(settings.UPLOAD_DIR, *key.split("/"))


@lru_cache(maxsize=1)
def _client():
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=settings.R2_ENDPOINT_URL,
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            retries={"max_attempts": 3, "mode": "standard"},
        ),
    )


@lru_cache(maxsize=1)
def _transfer_config():
    # 기본값(동시 10 x 8MB, 메모리 청크 10개)이면 영상 하나에 메모리를 100MB 넘게 쓴다. 상한을 낮춘다.
    from boto3.s3.transfer import TransferConfig

    cfg = TransferConfig(
        multipart_threshold=8 * 1024 * 1024,
        multipart_chunksize=8 * 1024 * 1024,
        max_concurrency=2,
    )
    cfg.max_in_memory_upload_chunks = 2  # s3transfer 속성 (boto3 생성자에는 없음)
    return cfg


def save(fileobj: BinaryIO, key: str, content_type: str) -> None:
    """fileobj 를 key 로 저장한다. 블로킹 호출이므로 async 라우터에서는 스레드풀로 부를 것."""
    fileobj.seek(0)
    if settings.STORAGE == "r2":
        _client().upload_fileobj(
            fileobj,
            settings.R2_BUCKET,
            key,
            ExtraArgs={"ContentType": content_type},
            Config=_transfer_config(),
        )
        return
    path = _local_path(key)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as out:
        shutil.copyfileobj(fileobj, out, 1024 * 1024)


def delete(photo_path: Optional[str]) -> None:
    """저장된 영상을 지운다. 이미 없거나 지우기에 실패해도 호출한 쪽(DB 삭제)은 계속 진행한다."""
    if not photo_path:
        return
    key = normalize_key(photo_path)
    try:
        if settings.STORAGE == "r2":
            _client().delete_object(Bucket=settings.R2_BUCKET, Key=key)
        else:
            os.remove(_local_path(key))
    except FileNotFoundError:
        pass
    except Exception:  # noqa: BLE001
        logger.warning("영상 삭제 실패: %s", key, exc_info=True)


def video_url(photo_path: Optional[str]) -> Optional[str]:
    """
    응답에 넣을 영상 주소.  주소를 만드는 곳은 여기 하나뿐이다.
    local: /uploads/studylogs/<파일>      (프론트가 백엔드 주소를 앞에 붙임)
    r2   : 서명 주소 (https://..., 기본 1시간 뒤 만료)
    """
    if not photo_path:
        return None
    key = normalize_key(photo_path)
    if settings.STORAGE == "r2":
        return _client().generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.R2_BUCKET, "Key": key},
            ExpiresIn=settings.R2_URL_EXPIRES_SECONDS,
        )
    return f"/uploads/{key}"
