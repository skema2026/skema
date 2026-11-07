"""소셜 로그인·계정 보안 (11/7 리뷰 #3, #4, #9)."""
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import service
from app.auth.models import User
from app.auth.schemas import SignupRequest
from app.core.config import settings
from app.main import app

ADMIN = "boss@skema.dev"


@pytest.fixture
def admin_emails(monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_EMAILS", ADMIN)


# ── #3 state ──────────────────────────────────────────────────────────────────

def test_callback_without_state_cookie_is_rejected():
    client = TestClient(app)  # with 없이 → 알림 스케줄러를 띄우지 않음
    res = client.get("/auth/google/callback", params={"code": "c", "state": "s"}, follow_redirects=False)
    assert res.status_code in (302, 307)
    assert "error=oauth_state_invalid" in res.headers["location"]


def test_callback_with_wrong_state_is_rejected():
    client = TestClient(app, cookies={"oauth_state_google": "expected"})
    res = client.get("/auth/google/callback", params={"code": "c", "state": "other"}, follow_redirects=False)
    assert "error=oauth_state_invalid" in res.headers["location"]


def test_token_is_sent_in_fragment_not_query():
    client = TestClient(app, cookies={"oauth_state_google": "st"})
    fake_user = User(id=7, email="a@b.c")
    with patch.object(service, "exchange_oauth_code", return_value=("g1", "a@b.c", "A", None, None, True)), \
         patch.object(service, "get_or_create_social_user", return_value=fake_user):
        res = client.get("/auth/google/callback", params={"code": "c", "state": "st"}, follow_redirects=False)
    loc = res.headers["location"]
    assert "/login#token=" in loc and "?token=" not in loc


# ── #4 계정 선점 ───────────────────────────────────────────────────────────────

def test_social_login_does_not_link_existing_email_account(db, user):
    with pytest.raises(service.SocialEmailExists):
        service.get_or_create_social_user(db, "google", "g-123", user.email, "x", email_verified=True)
    db.refresh(user)
    assert user.social_id is None


def test_new_social_user_still_created(db):
    u = service.get_or_create_social_user(db, "google", "g-9", "new@skema.dev", "새사람", email_verified=True)
    assert u.email == "new@skema.dev" and u.social_id == "g-9"


# ── #4 관리자 이메일 ───────────────────────────────────────────────────────────

def test_cannot_sign_up_with_admin_email(db, admin_emails):
    with pytest.raises(HTTPException) as e:
        service.signup(db, SignupRequest(email=ADMIN, username="evil", password="password1234"))
    assert e.value.status_code == 409


def test_cannot_change_email_to_admin_email(db, user, admin_emails):
    with pytest.raises(HTTPException) as e:
        service.update_user_account(db, user, {"email": ADMIN})
    assert e.value.status_code == 409


def test_unverified_social_email_cannot_claim_admin(db, admin_emails):
    u = service.get_or_create_social_user(db, "naver", "n-1", ADMIN, "evil", email_verified=False)
    assert u.email != ADMIN


def test_verified_social_email_can_be_admin(db, admin_emails):
    u = service.get_or_create_social_user(db, "google", "g-boss", ADMIN, "boss", email_verified=True)
    assert u.email == ADMIN
