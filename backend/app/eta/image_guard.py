"""시간표 이미지 업로드 검사 (11/7).

- 브라우저가 보낸 Content-Type 대신 파일 앞부분(매직 바이트)으로 형식을 정한다.
- 이미지를 풀기(decode) 전에 헤더에서 가로·세로를 읽어 너무 큰 이미지를 거른다.
  20MB짜리 PNG도 수만×수만 픽셀로 풀릴 수 있어서(압축 폭탄) OpenCV가 메모리를 다 쓸 수 있다.
"""
from __future__ import annotations

import struct

# 휴대폰 스크린샷(약 1290×2796)·긴 캡처(1080×10000)는 넉넉히 통과하는 값
MAX_SIDE = 12_000
MAX_PIXELS = 40_000_000


class BadImage(ValueError):
    pass


def sniff_type(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


def _jpeg_size(data: bytes) -> tuple[int, int]:
    i = 2
    n = len(data)
    while i + 9 < n:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:  # 길이 없는 마커
            i += 2
            continue
        if marker == 0xFF:
            i += 1
            continue
        seg_len = struct.unpack(">H", data[i + 2:i + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):  # SOFn
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        i += 2 + seg_len
    raise BadImage("JPEG 크기를 읽을 수 없습니다.")


def _webp_size(data: bytes) -> tuple[int, int]:
    chunk = data[12:16]
    if chunk == b"VP8X" and len(data) >= 30:
        w = int.from_bytes(data[24:27], "little") + 1
        h = int.from_bytes(data[27:30], "little") + 1
        return w, h
    if chunk == b"VP8L" and len(data) >= 25:
        b = data[21:25]
        w = 1 + (((b[1] & 0x3F) << 8) | b[0])
        h = 1 + (((b[3] & 0x0F) << 10) | (b[2] << 2) | ((b[1] & 0xC0) >> 6))
        return w, h
    if chunk == b"VP8 " and len(data) >= 30:
        w, h = struct.unpack("<HH", data[26:30])
        return w & 0x3FFF, h & 0x3FFF
    raise BadImage("WEBP 크기를 읽을 수 없습니다.")


def image_size(data: bytes, kind: str) -> tuple[int, int]:
    if kind == "image/png":
        if len(data) < 24 or data[12:16] != b"IHDR":
            raise BadImage("PNG 헤더가 올바르지 않습니다.")
        return struct.unpack(">II", data[16:24])
    if kind == "image/gif":
        if len(data) < 10:
            raise BadImage("GIF 헤더가 올바르지 않습니다.")
        return struct.unpack("<HH", data[6:10])
    if kind == "image/jpeg":
        return _jpeg_size(data)
    if kind == "image/webp":
        return _webp_size(data)
    raise BadImage("지원하지 않는 이미지 형식입니다.")


def check_image(data: bytes) -> str:
    """형식을 확인하고 크기가 허용 범위면 실제 Content-Type 을 돌려준다. 아니면 BadImage."""
    kind = sniff_type(data)
    if kind is None:
        raise BadImage("이미지 파일(PNG·JPG·WEBP·GIF)만 올릴 수 있습니다.")
    w, h = image_size(data, kind)
    if w <= 0 or h <= 0:
        raise BadImage("이미지 크기가 올바르지 않습니다.")
    if w > MAX_SIDE or h > MAX_SIDE or w * h > MAX_PIXELS:
        raise BadImage(f"이미지가 너무 큽니다 ({w}×{h}). 화면 캡처 크기로 올려주세요.")
    return kind
