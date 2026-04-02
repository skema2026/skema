from typing import List

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core.config import settings
from app.core.deps import get_current_user, get_db
from app.schedule.schemas import ScheduleResponse
from app.share import service
from app.share.schemas import ShareTokenCreate, ShareTokenResponse

router = APIRouter(tags=["share-tokens"])


@router.get("/share-tokens", response_model=List[ShareTokenResponse])
def list_tokens(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """내 공유 토큰 전체 목록을 반환합니다."""
    tokens = service.list_tokens(db, current_user.id)
    base = str(request.base_url).rstrip("/")
    result = []
    for t in tokens:
        data = ShareTokenResponse.model_validate(t)
        data.share_url = f"{settings.FRONTEND_URL}/share/{t.token}"
        result.append(data)
    return result


@router.post("/share-tokens", response_model=ShareTokenResponse, status_code=status.HTTP_201_CREATED)
def create_token(
    data: ShareTokenCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """새 공유 토큰을 생성합니다. expires_at을 생략하면 영구 유효합니다."""
    token = service.create_token(db, current_user.id, data)
    result = ShareTokenResponse.model_validate(token)
    result.share_url = f"{settings.FRONTEND_URL}/share/{token.token}"
    return result


@router.patch("/share-tokens/{token_id}/deactivate", response_model=ShareTokenResponse)
def deactivate_token(
    token_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """토큰을 비활성화합니다. 삭제 없이 즉시 공유 링크를 무효화합니다."""
    token = service.deactivate_token(db, token_id, current_user.id)
    result = ShareTokenResponse.model_validate(token)
    result.share_url = f"{settings.FRONTEND_URL}/share/{token.token}"
    return result


@router.delete("/share-tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_token(
    token_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """토큰을 영구 삭제합니다."""
    service.delete_token(db, token_id, current_user.id)


# ── 공개 공유 뷰 (인증 불필요) ────────────────────────────────────────────────

@router.get("/share/{token}", response_model=List[ScheduleResponse])
def get_shared_timetable(token: str, db: Session = Depends(get_db)):
    """
    공유 토큰으로 수업 시간표를 공개 조회합니다.
    비활성 또는 만료된 토큰이면 404를 반환합니다.
    """
    return service.get_schedules_by_share_token(db, token)
