"""app.core.storage 단위 테스트 (DB 없이 실행). R2 부분은 moto 로 가짜 S3 를 쓴다."""

import io
from urllib.parse import parse_qs, urlparse

import pytest

from app.core import storage
from app.core.config import Settings, settings

MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 64
MOV = b"\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00qt  " + b"\x00" * 64
WEBM = b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01" + b"\x00" * 64
HTML = b"<html><script>alert(document.domain)</script></html>"


# ── validate_upload ──────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "ctype, name, head, expected",
    [
        ("video/mp4", "a.mp4", MP4, ("mp4", "video/mp4")),
        ("video/webm", "recording.webm", WEBM, ("webm", "video/webm")),
        ("video/webm;codecs=vp9,opus", "recording.webm", WEBM, ("webm", "video/webm")),
        ("video/quicktime", "IMG_1.MOV", MOV, ("mov", "video/quicktime")),
        ("video/x-matroska", "a.mkv", WEBM, ("mkv", "video/x-matroska")),
        ("video/mp4", "blob", MP4, ("mp4", "video/mp4")),  # 확장자 없는 파일명
        ("video/mp4", None, MP4, ("mp4", "video/mp4")),
    ],
)
def test_validate_ok(ctype, name, head, expected):
    assert storage.validate_upload(ctype, name, head) == expected


@pytest.mark.parametrize(
    "ctype, name, head",
    [
        ("video/mp4", "evil.html", HTML),              # HTML 을 영상으로 위조
        ("video/mp4", "a.mp4", HTML),                  # 이름·타입은 맞지만 내용이 HTML
        ("video/mp4", "clip.PhP", MP4),                # 허용 안 된 확장자
        ("video/mp4", "x./../../pwn", MP4),            # 경로 조작 파일명
        ("image/png", "a.png", MP4),                   # 허용 안 된 타입
        ("", "a.mp4", MP4),                            # 타입 없음
        ("video/webm", "a.webm", MP4),                 # 선언은 webm 인데 내용은 mp4
        ("video/mp4", "a.mp4", WEBM),                  # 선언은 mp4 인데 내용은 webm
        ("video/mp4", "a.mp4", b"\x00" * 10),          # 너무 짧아 판별 불가
        ("video/mp4", "a.mp4", b""),
    ],
)
def test_validate_rejects(ctype, name, head):
    with pytest.raises(storage.InvalidVideo):
        storage.validate_upload(ctype, name, head)


# ── 키 ───────────────────────────────────────────────────────────────────────

def test_new_key_shape():
    k = storage.new_key("webm")
    assert k.startswith("studylogs/") and k.endswith(".webm") and k.count("/") == 1


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("studylogs/abc.mp4", "studylogs/abc.mp4"),                 # 새 키
        ("/app/uploads/studylogs/abc.mp4", "studylogs/abc.mp4"),    # 예전 전체 경로(도커)
        ("/Users/x/backend/uploads/studylogs/abc.mp4", "studylogs/abc.mp4"),
        ("C:\\skema\\uploads\\studylogs\\abc.mp4", "studylogs/abc.mp4"),
        ("studylogs/../../etc/passwd", "studylogs/passwd"),         # 경로 탈출 시도
        ("abc.mp4", "studylogs/abc.mp4"),
    ],
)
def test_normalize_key(raw, expected):
    assert storage.normalize_key(raw) == expected


# ── local 모드 ───────────────────────────────────────────────────────────────

@pytest.fixture()
def local_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "STORAGE", "local")
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    return tmp_path


def test_local_save_url_delete(local_storage):
    key = storage.new_key("mp4")
    storage.save(io.BytesIO(MP4), key, "video/mp4")
    assert (local_storage / key).read_bytes() == MP4
    assert storage.video_url(key) == f"/uploads/{key}"
    # 예전 레코드(전체 경로)도 같은 파일을 가리킨다
    old_style = str(local_storage / key)
    assert storage.video_url(old_style) == f"/uploads/{key}"
    storage.delete(old_style)
    assert not (local_storage / key).exists()
    storage.delete(old_style)  # 이미 없어도 에러 없음
    assert storage.video_url(None) is None and storage.video_url("") is None


# ── r2 모드 (moto 로컬 서버) ─────────────────────────────────────────────────
# mock_aws 는 *.amazonaws.com 주소만 가로채므로, R2 처럼 커스텀 endpoint 를 쓰는 코드는
# 실제 HTTP 서버로 뜨는 moto 서버에 붙여서 확인한다.

@pytest.fixture(scope="module")
def moto_endpoint():
    pytest.importorskip("moto")
    pytest.importorskip("flask")
    import socket
    from moto.server import ThreadedMotoServer

    with socket.socket() as sk:
        sk.bind(("127.0.0.1", 0))
        port = sk.getsockname()[1]
    server = ThreadedMotoServer(ip_address="127.0.0.1", port=port, verbose=False)
    server.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.stop()


def test_r2_save_signed_url_delete(moto_endpoint, monkeypatch):
    import boto3

    monkeypatch.setattr(settings, "STORAGE", "r2")
    monkeypatch.setattr(settings, "R2_ENDPOINT_URL", moto_endpoint)
    monkeypatch.setattr(settings, "R2_ACCESS_KEY_ID", "test-id")
    monkeypatch.setattr(settings, "R2_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setattr(settings, "R2_BUCKET", "skema-uploads-dev")
    storage._client.cache_clear()
    try:
        raw = boto3.client(
            "s3", endpoint_url=moto_endpoint, region_name="us-east-1",  # moto 는 region=auto 로 버킷을 못 만든다 (R2 는 auto)
            aws_access_key_id="test-id", aws_secret_access_key="test-secret",
        )
        raw.create_bucket(Bucket="skema-uploads-dev")

        key = storage.new_key("webm")
        storage.save(io.BytesIO(WEBM), key, "video/webm")

        obj = raw.get_object(Bucket="skema-uploads-dev", Key=key)
        assert obj["Body"].read() == WEBM
        assert obj["ContentType"] == "video/webm"

        url = storage.video_url("/app/uploads/" + key)  # 예전 경로 형태로 줘도 같은 키
        u = urlparse(url)
        q = parse_qs(u.query)
        assert url.startswith(f"{moto_endpoint}/skema-uploads-dev/{key}?")
        assert q["X-Amz-Expires"] == ["3600"]
        assert "X-Amz-Signature" in q
        assert u.path.endswith(".webm")  # ? 앞(경로)은 확장자로 끝난다

        storage.delete(key)
        with pytest.raises(raw.exceptions.NoSuchKey):
            raw.get_object(Bucket="skema-uploads-dev", Key=key)
        storage.delete(key)  # 이미 없어도 에러 없음
    finally:
        storage._client.cache_clear()


# ── 설정 검증 ────────────────────────────────────────────────────────────────

def test_settings_default_is_local():
    assert Settings(_env_file=None).STORAGE == "local"


def test_settings_rejects_unknown_storage():
    with pytest.raises(ValueError):
        Settings(_env_file=None, STORAGE="s3")


def test_settings_r2_requires_credentials():
    with pytest.raises(ValueError) as e:
        Settings(_env_file=None, STORAGE="r2")
    assert "R2_BUCKET" in str(e.value)
    ok = Settings(
        _env_file=None, STORAGE=" R2 ",
        R2_ENDPOINT_URL="https://a.r2.cloudflarestorage.com",
        R2_ACCESS_KEY_ID="i", R2_SECRET_ACCESS_KEY="s", R2_BUCKET="b",
    )
    assert ok.STORAGE == "r2"
