"""그룹 검색어의 %, _ 는 글자로 취급 (11/7 리뷰 #12)."""
from app.studylog.group_router import search_groups
from app.studylog.models import StudyGroup


def _group(db, name, creator):
    g = StudyGroup(name=name, created_by=creator)
    db.add(g)
    db.commit()
    return g


def test_wildcards_do_not_list_everything(db, user):
    _group(db, "알고리즘 스터디", user.id)
    _group(db, "캡스톤", user.id)
    assert search_groups(q="%", db=db, current_user=user) == []
    assert search_groups(q="_", db=db, current_user=user) == []


def test_normal_search_and_literal_percent(db, user):
    _group(db, "알고리즘 스터디", user.id)
    _group(db, "100% 출석", user.id)
    assert [g.name for g in search_groups(q="알고", db=db, current_user=user)] == ["알고리즘 스터디"]
    assert [g.name for g in search_groups(q="100%", db=db, current_user=user)] == ["100% 출석"]


def test_invite_code_exact_match_still_works(db, user):
    g = _group(db, "캡스톤", user.id)
    assert [x.id for x in search_groups(q=g.invite_code.lower(), db=db, current_user=user)] == [g.id]


def test_slash_in_query_is_literal(db, user):
    _group(db, "AI/ML 스터디", user.id)
    assert [g.name for g in search_groups(q="AI/ML", db=db, current_user=user)] == ["AI/ML 스터디"]


def test_mysql_renders_escape_clause():
    from sqlalchemy.dialects import mysql
    sql = str(StudyGroup.name.ilike("%a/%%", escape="/").compile(dialect=mysql.dialect()))
    assert "ESCAPE '/'" in sql
