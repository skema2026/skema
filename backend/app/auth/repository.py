from sqlalchemy.orm import Session

from app.auth.models import LoginLog, User, UserProfile


# ── User ──────────────────────────────────────────────────────────────────────

def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email).first()


def get_user_by_username(db: Session, username: str) -> User | None:
    return db.query(User).filter(User.username == username).first()


def get_user_by_username_or_email(db: Session, identifier: str) -> User | None:
    """username 또는 email 둘 다로 조회 (로그인 시 사용)."""
    users = get_users_by_username_or_email(db, identifier)
    return users[0] if users else None


def get_users_by_username_or_email(db: Session, identifier: str) -> list[User]:
    """로그인 후보 유저 목록. 이메일 형태면 이메일만, 아니면 username만 조회."""
    identifier = identifier.strip()
    if "@" in identifier:
        return db.query(User).filter(User.email == identifier).all()
    return (
        db.query(User)
        .filter(User.username == identifier)
        .order_by(User.id.desc())
        .all()
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
    db: Session,
    email: str,
    provider: str,
    social_id: str,
    hashed_password: str,
    kakao_access_token: str | None = None,
    kakao_refresh_token: str | None = None,
) -> User:
    user = User(
        email=email,
        hashed_password=hashed_password,
        social_provider=provider,
        social_id=social_id,
        kakao_access_token=kakao_access_token,
        kakao_refresh_token=kakao_refresh_token,
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


def update_kakao_tokens(
    db: Session, user: User, access_token: str, refresh_token: str | None
) -> User:
    user.kakao_access_token = access_token
    if refresh_token:
        user.kakao_refresh_token = refresh_token
    db.commit()
    db.refresh(user)
    return user


def create_login_log(
    db: Session,
    *,
    user_id: int | None,
    login_identifier: str,
    login_method: str,
    success: bool,
    failure_reason: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> LoginLog:
    log = LoginLog(
        user_id=user_id,
        login_identifier=login_identifier[:255],
        login_method=login_method,
        success=success,
        failure_reason=failure_reason,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def list_login_logs(db: Session, limit: int = 100, offset: int = 0) -> list[LoginLog]:
    return (
        db.query(LoginLog)
        .outerjoin(User)
        .order_by(LoginLog.created_at.desc(), LoginLog.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def list_users(db: Session, limit: int = 100, offset: int = 0) -> list[User]:
    return (
        db.query(User)
        .order_by(User.created_at.desc(), User.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def deactivate_user(db: Session, user: User) -> User:
    user.is_active = False
    db.commit()
    db.refresh(user)
    return user


def delete_user(db: Session, user: User) -> None:
    db.query(LoginLog).filter(LoginLog.user_id == user.id).update(
        {LoginLog.user_id: None},
        synchronize_session=False,
    )
    db.delete(user)
    db.commit()


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
