from datetime import datetime
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from app.db.database import Base


class Post(Base):
    __tablename__ = "posts"

    id         = Column(Integer, primary_key=True, index=True)
    author_id  = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    content    = Column(Text, nullable=False)
    image_url  = Column(String(512), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    author = relationship("User")
    likes  = relationship("PostLike", back_populates="post", cascade="all, delete-orphan")


class PostLike(Base):
    __tablename__ = "post_likes"

    id      = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    post = relationship("Post", back_populates="likes")

    __table_args__ = (
        UniqueConstraint("post_id", "user_id", name="uq_post_like"),
    )
