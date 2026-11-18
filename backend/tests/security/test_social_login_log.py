"""소셜 로그인도 관리자 로그인 로그(login_logs)에 남는지 (11/19)."""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.auth import service
from app.auth.models import LoginLog, User
from app.core.security import get_db
from app.main import app


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_db, None)


def _callback(cookie_state="st", state="st", **params):
    c = TestClient(app, cookies={"oauth_state_kakao": cookie_state} if cookie_state else None)
    return c.get(
        "/auth/kakao/callback",
        params={"code": "c", "state": state, **params},
        headers={"user-agent": "pytest-agent"},
        follow_redirects=False,
    )


def test_social_login_success_is_logged(db, client):
    u = User(email="kakao@skema.dev", username="k1", is_active=True)
    db.add(u)
    db.commit()
    with patch.object(service, "exchange_oauth_code", return_value=("k-1", "kakao@skema.dev", "K", None, None, True)), \
         patch.object(service, "get_or_create_social_user", return_value=u):
        res = _callback()
    assert "/login#token=" in res.headers["location"]
    log = db.query(LoginLog).one()
    assert log.success is True
    assert log.login_method == "kakao"
    assert log.user_id == u.id
    assert log.login_identifier == "kakao@skema.dev"
    assert log.user_agent == "pytest-agent"


def test_social_email_conflict_is_logged_as_failure(db, client):
    with patch.object(service, "exchange_oauth_code", return_value=("k-3", "dup@skema.dev", "K", None, None, True)), \
         patch.object(service, "get_or_create_social_user", side_effect=service.SocialEmailExists()):
        res = _callback()
    assert "error=oauth_email_exists" in res.headers["location"]
    log = db.query(LoginLog).one()
    assert log.success is False
    assert log.failure_reason == "oauth_email_exists"
    assert log.login_identifier == "dup@skema.dev"
    assert log.user_id is None


def test_state_mismatch_is_logged_as_failure(db, client):
    res = _callback(cookie_state="expected", state="other")
    assert "error=oauth_state_invalid" in res.headers["location"]
    log = db.query(LoginLog).one()
    assert log.success is False
    assert log.failure_reason == "oauth_state_invalid"
    assert log.login_method == "kakao"
    assert log.login_identifier == "kakao"


def test_user_cancel_is_logged_as_failure(db, client):
    c = TestClient(app)
    res = c.get("/auth/kakao/callback", params={"error": "access_denied"}, follow_redirects=False)
    assert "error=oauth_denied" in res.headers["location"]
    log = db.query(LoginLog).one()
    assert log.failure_reason == "oauth_denied"
