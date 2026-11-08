"""그룹 밖 비공개 기록은 본인만 볼 수 있다 (11/7 리뷰 #1)."""
import pytest
from fastapi import HTTPException

from app.auth.router import get_user_public_profile
from app.studylog.models import StudyLog
from app.studylog.router import toggle_reaction
from app.studylog.schemas import ReactionToggleRequest


def _log(db, user_id, caption, public):
    log = StudyLog(user_id=user_id, caption=caption, is_public=public)
    db.add(log)
    db.commit()
    return log


def test_public_profile_hides_private_logs(db, user, other):
    _log(db, user.id, "비공개", public=False)
    _log(db, user.id, "공개", public=True)
    res = get_user_public_profile(user.id, db=db, current_user=other)
    assert [l["caption"] for l in res["logs"]] == ["공개"]


def test_cannot_react_to_others_private_log(db, user, other):
    log = _log(db, user.id, "비공개", public=False)
    with pytest.raises(HTTPException) as e:
        toggle_reaction(log.id, ReactionToggleRequest(emoji="👍"), db=db, current_user=other)
    assert e.value.status_code == 404


def test_owner_and_public_reactions_still_work(db, user, other):
    private = _log(db, user.id, "비공개", public=False)
    public = _log(db, user.id, "공개", public=True)
    toggle_reaction(private.id, ReactionToggleRequest(emoji="👍"), db=db, current_user=user)
    toggle_reaction(public.id, ReactionToggleRequest(emoji="👍"), db=db, current_user=other)
