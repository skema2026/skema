from sqlalchemy.orm import Session

from app.auth.models import User, UserProfile


# ── User ──────────────────────────────────────────────────────────────────────

def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email).first()


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.query(User).filter(User.username == username).first()


def get_user_by_username_or_email(db: Session, identifier: str) -> User | None:
    """username 또는 email 둘 다로 조회 (로그인 시 사용)."""
    return (
        db.query(User)
        .filter((User.username == identifier) | (User.email == identifier))
        .first()
    )


def get_user_by_social(db: Session, provider: str, social_id: str) -> User | None:
    return db.query(User).filter(
        User.social_provider == provider,
        User.social_id == social_id,
    ).first()


def create_user(db: Session, email: str, hashed_password: str) -> User:
    user = User(email=email, hashed_password=hashed_password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_social_user(
    db: Session, email: str, provider: str, social_id: str, hashed_password: str
) -> User:
    user = User(
        email=email,
        hashed_password=hashed_password,
        social_provider=provider,
        social_id=social_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def link_social(db: Session, user: User, provider: str, social_id: str) -> User:
    user.social_provider = provider
    user.social_id = social_id
    db.commit()
    db.refresh(user)
    return user


def deactivate_user(db: Session, user: User) -> User:
    user.is_active = False
    db.commit()
    db.refresh(user)
    return user


# ── UserProfile ───────────────────────────────────────────────────────────────

def get_profile_by_user_id(db: Session, user_id: int) -> UserProfile | None:
    return db.query(UserProfile).filter(UserProfile.user_id == user_id).first()


def create_profile(db: Session, user_id: int, data: dict) -> UserProfile:
    profile = UserProfile(user_id=user_id, **data)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def update_profile(db: Session, profile: UserProfile, updates: dict) -> UserProfile:
    for field, value in updates.items():
        setattr(profile, field, value)
    db.commit()
    db.refresh(profile)
    return profile
