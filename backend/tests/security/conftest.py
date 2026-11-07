"""보안 회귀 테스트용 픽스처 (11/7). DB는 일정 테스트와 같은 SQLite 메모리를 쓴다."""
import pytest

from app.auth.models import User
from tests.schedule.conftest import db, user  # noqa: F401  같은 픽스처 재사용


@pytest.fixture
def other(db):  # noqa: F811
    u = User(email="other@skema.dev", username="other", is_active=True)
    db.add(u)
    db.commit()
    return u
