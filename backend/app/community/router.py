"""
커뮤니티 피드 API

POST   /posts              — 게시글 작성 (텍스트 + 이미지 선택)
GET    /posts              — 피드 (최신순, offset pagination)
GET    /posts/{id}         — 게시글 상세
DELETE /posts/{id}         — 내 게시글 삭제
POST   /posts/{id}/like    — 좋아요 토글
"""
import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session, joinedload

from app.auth.models import User
from app.core.security import get_current_user, get_db

from .models import Post, PostLike
from .schemas import PostFeed, PostOut

router = APIRouter(prefix="/posts", tags=["community"])

UPLOAD_DIR = "/app/uploads/posts"
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_BYTES = 10 * 1024 * 1024

BACKEND_BASE = "/uploads/posts"


def _ensure_dir():
    os.makedirs(UPLOAD_DIR, exist_ok=True)


def _post_out(post: Post, current_user_id: int) -> PostOut:
    liked = any(l.user_id == current_user_id for l in post.likes)
    return PostOut(
        id=post.id,
        author_id=post.author_id,
        username=post.author.username if post.author else "unknown",
        content=post.content,
        image_url=f"{BACKEND_BASE}/{os.path.basename(post.image_url)}" if post.image_url else None,
        likes_count=len(post.likes),
        liked=liked,
        created_at=post.created_at,
    )


def _load_post(db: Session, post_id: int) -> Post:
    post = (
        db.query(Post)
        .filter(Post.id == post_id)
        .options(joinedload(Post.author), joinedload(Post.likes))
        .first()
    )
    if not post:
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    return post


@router.post("", status_code=201, response_model=PostOut)
async def create_post(
    content: str = Form(...),
    image: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not content.strip():
        raise HTTPException(status_code=400, detail="내용을 입력해주세요.")
    if len(content) > 1000:
        raise HTTPException(status_code=400, detail="내용은 1000자 이하여야 합니다.")

    image_path = None
    if image and image.filename:
        if image.content_type not in ALLOWED_TYPES:
            raise HTTPException(status_code=415, detail="jpeg/png/webp 이미지만 업로드 가능합니다.")
        data = await image.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="파일 크기는 10MB 이하여야 합니다.")
        _ensure_dir()
        ext = image.filename.rsplit(".", 1)[-1] if "." in image.filename else "jpg"
        image_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.{ext}")
        with open(image_path, "wb") as f:
            f.write(data)

    post = Post(author_id=current_user.id, content=content.strip(), image_url=image_path)
    db.add(post)
    db.commit()
    db.refresh(post)
    post.author  # eager load
    post.likes   # eager load
    return _post_out(post, current_user.id)


@router.get("", response_model=PostFeed)
def get_feed(
    offset: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    limit = min(limit, 50)
    q = (
        db.query(Post)
        .options(joinedload(Post.author), joinedload(Post.likes))
        .order_by(Post.created_at.desc())
    )
    total = q.count()
    posts = q.offset(offset).limit(limit).all()
    return PostFeed(
        items=[_post_out(p, current_user.id) for p in posts],
        total=total,
        has_next=(offset + limit) < total,
    )


@router.get("/{post_id}", response_model=PostOut)
def get_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _post_out(_load_post(db, post_id), current_user.id)


@router.delete("/{post_id}", status_code=204)
def delete_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    post = db.query(Post).filter(Post.id == post_id, Post.author_id == current_user.id).first()
    if not post:
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    if post.image_url and os.path.exists(post.image_url):
        os.remove(post.image_url)
    db.delete(post)
    db.commit()


@router.post("/{post_id}/like", response_model=PostOut)
def toggle_like(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    post = _load_post(db, post_id)
    existing = db.query(PostLike).filter(
        PostLike.post_id == post_id,
        PostLike.user_id == current_user.id,
    ).first()

    is_new = existing is None
    if existing:
        db.delete(existing)
    else:
        db.add(PostLike(post_id=post_id, user_id=current_user.id))
    db.commit()

    # 새 좋아요면 작성자에게 알림 (본인 제외)
    if is_new and post.author_id != current_user.id:
        from app.notification.service import send_push_to_user
        from app.notification.scheduler import _is_notif_enabled
        if _is_notif_enabled(db, post.author_id, "log_like"):
            send_push_to_user(
                db, post.author_id,
                title="좋아요",
                body=f"{current_user.username}님이 게시글에 좋아요를 눌렀어요",
                url="/feed",
                ntype="log_like",
            )

    return _post_out(_load_post(db, post_id), current_user.id)
