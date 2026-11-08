"""운영에서 기본 SECRET_KEY로는 서버가 뜨지 않는다 (11/7 리뷰 #8)."""
import pytest
from pydantic import ValidationError

from app.core.config import Settings, _DEFAULT_SECRET


def test_default_secret_rejected_in_production():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, SECRET_KEY=_DEFAULT_SECRET, BACKEND_URL="https://api.example.com")


def test_default_secret_allowed_locally():
    s = Settings(_env_file=None, SECRET_KEY=_DEFAULT_SECRET, BACKEND_URL="http://localhost:8000")
    assert s.SECRET_KEY == _DEFAULT_SECRET


def test_real_secret_ok_in_production():
    Settings(_env_file=None, SECRET_KEY="x" * 48, BACKEND_URL="https://api.example.com")
