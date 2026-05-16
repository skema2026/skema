from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import repository as auth_repo
from app.auth.models import User
from app.core.security import get_current_admin_user, get_db


class LoginLogUserResponse(BaseModel):
    id: int
    username: str | None = None
    email: str

    model_config = {"from_attributes": True}


class LoginLogResponse(BaseModel):
    id: int
    user_id: int | None = None
    login_identifier: str
    login_method: str
    success: bool
    failure_reason: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    created_at: datetime
    user: LoginLogUserResponse | None = None

    model_config = {"from_attributes": True}


class AdminUserResponse(BaseModel):
    id: int
    username: str | None = None
    email: str
    is_active: bool | None = True
    social_provider: str | None = None
    social_id: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/login-logs", response_model=list[LoginLogResponse])
def list_login_logs(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin_user),
):
    return auth_repo.list_login_logs(db, limit=limit, offset=offset)


@router.get("/users", response_model=list[AdminUserResponse])
def list_users(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin_user),
):
    return auth_repo.list_users(db, limit=limit, offset=offset)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin_user),
):
    if user_id == current_admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="현재 로그인한 관리자 계정은 삭제할 수 없습니다.",
        )

    user = auth_repo.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="회원을 찾을 수 없습니다.")

    auth_repo.delete_user(db, user)
