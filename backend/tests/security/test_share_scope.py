"""공유 링크는 수업만, 화면에 필요한 칸만 (11/7 리뷰 #7)."""
from fastapi.testclient import TestClient

from app.core.security import get_db
from app.main import app
from app.schedule.models import DayOfWeek, Schedule
from app.share import service
from app.share.schemas import ShareTokenCreate


def _add(db, user_id, title, kind, deleted=False):
    db.add(Schedule(user_id=user_id, course_name=title, recurring_day=DayOfWeek("MON"),
                    start_time="09:00", end_time="10:00", schedule_type=kind,
                    deleted_by_user=deleted, color_code="#123456"))
    db.commit()


def test_shared_view_has_only_classes_and_safe_fields(db, user):
    _add(db, user.id, "자료구조", "class")
    _add(db, user.id, "알바", "personal")
    _add(db, user.id, "📖 공부", "study")
    _add(db, user.id, "지운 수업", "class", deleted=True)
    token = service.create_token(db, user.id, ShareTokenCreate()).token

    app.dependency_overrides[get_db] = lambda: db
    try:
        res = TestClient(app).get(f"/share/{token}")
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert res.status_code == 200
    body = res.json()
    assert [s["title"] for s in body["schedules"]] == ["자료구조"]
    item = body["schedules"][0]
    assert item["color"] == "#123456" and item["recurring_day"] == "MON"
    for hidden in ("user_id", "deleted_by_user", "schedule_source", "linked_exam_id", "original_generated_title"):
        assert hidden not in item
