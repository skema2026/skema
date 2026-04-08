# utils/image.py
import base64, io, requests
from PIL import Image

def fetch_and_resize(url: str, thumb_size: tuple[int,int]=(128,128)) -> tuple[str,str]:
    """
    URL → bytes → (원본 base64, 썸네일 base64)
    """
    buf = requests.get(url, timeout=30).content

    im_full = Image.open(io.BytesIO(buf))

    # (1) 저장용 ‘원본’ → 512 px 까지 축소 후 WebP
    im_full.thumbnail((512,512), Image.Resampling.LANCZOS)
    full_io = io.BytesIO(); im_full.save(full_io, format="WEBP", quality=90)
    original_b64 = base64.b64encode(full_io.getvalue()).decode()

    # (2) 썸네일 128 px
    im_thumb = im_full.copy()
    im_thumb.thumbnail(thumb_size, Image.Resampling.LANCZOS)
    out = io.BytesIO(); im_thumb.save(out, format="WEBP", quality=80)
    thumb_b64 = base64.b64encode(out.getvalue()).decode()

    return original_b64, thumb_b64
