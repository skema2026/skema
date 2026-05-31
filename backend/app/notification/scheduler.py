"""
알림 스케줄러.

job 함수들은 APScheduler BackgroundScheduler 에서 주기적으로 호출된다.
각 함수는 독립적인 DB 세션을 열고 닫는다.

jobs:
  job_weekly_report    — 매주 월요일 08:00   주간 수행률 / 미완료 / 이번주 일정
  job_daily_motivation — 매일 09:00          동기부여 메시지
  job_reminders        — 30분마다            일정 시작 전 / 미완료 재촉
  job_exam_alert       — 매일 08:00          D-7 / D-3 / D-1 / D-day 시험 알림
  job_comparison       — 매주 월요일 08:00   사용자 평균 대비 비교 (기본 OFF)
"""
from __future__ import annotations

import logging
import random
from datetime import date, datetime, timedelta

from app.core.time_utils import time_to_minutes

logger = logging.getLogger(__name__)

_MOTIVATIONS = [
    ("오늘도 한 걸음씩!", "작은 실천이 쌓여 큰 변화가 됩니다. 오늘 계획을 지금 시작하세요."),
    ("꾸준함이 실력입니다", "매일 조금씩이라도 공부한 사람이 결국 이깁니다."),
    ("집중 시간을 지켜보세요", "딥워크 25분 + 휴식 5분. 오늘 포모도로 3세트 도전해보세요!"),
    ("목표를 떠올려 보세요", "지금 하는 노력이 왜 중요한지 한 번 더 생각해보세요."),
    ("미루지 말고 지금!", "나중에 하면 더 힘들어집니다. 지금 5분만 시작해보세요."),
    ("완벽함보다 완료", "100%가 아니어도 괜찮습니다. 일단 끝내는 것이 중요합니다."),
    ("어제보다 나은 오늘", "어제의 나보다 1%만 더 성장하면 됩니다. 할 수 있어요!"),
    ("계획이 있는 하루", "오늘의 계획을 확인하고 우선순위를 정해보세요."),
]


def _get_db():
    from app.db.database import SessionLocal
    import app.auth.models       # noqa: F401
    import app.schedule.models   # noqa: F401
    import app.share.models      # noqa: F401
    import app.ai_chat.models    # noqa: F401
    import app.notification.models  # noqa: F401
    return SessionLocal()


def _get_prefs(db, user_id: int) -> dict:
    """사용자 notification_prefs JSON 반환. 파싱 실패 시 빈 dict."""
    import json
    from app.auth.models import UserProfile
    profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    if not profile or not profile.notification_prefs:
        return {}
    try:
        return json.loads(profile.notification_prefs)
    except Exception:
        return {}


def _is_notif_enabled(db, user_id: int, ntype: str) -> bool:
    """사용자의 알림 타입 수신 여부 확인."""
    prefs = _get_prefs(db, user_id)
    # reminder_start / reminder_incomplete: 구 reminder 키로 폴백
    if ntype in ("reminder_start", "reminder_incomplete") and ntype not in prefs:
        return prefs.get("reminder", True)
    default = False if ntype == "comparison" else True
    return bool(prefs.get(ntype, default))


def _get_reminder_minutes(db, user_id: int) -> int:
    """사용자가 설정한 리마인더 시간(분). 기본 30분."""
    prefs = _get_prefs(db, user_id)
    val = prefs.get("reminder_minutes", 30)
    if isinstance(val, int) and val in (5, 10, 15, 30, 60):
        return val
    return 30


def _push(db, user_id: int, ntype: str, title: str, body: str, related_id: int | None = None, send_push: bool = True):
    """알림 1건 저장.
    중복 방지 기준:
      - related_id 있음 → (type, related_id, 오늘) — 같은 일정에 하루 1번
      - related_id 없음 → (type, title, 오늘) — 동기부여·리포트 등
    """
    from app.notification.models import Notification
    from app.notification.service import send_push_to_user
    from zoneinfo import ZoneInfo

    if not _is_notif_enabled(db, user_id, ntype):
        return

    # Seoul 자정 → UTC 변환 (DB는 UTC 저장)
    kst_midnight = datetime.now(ZoneInfo("Asia/Seoul")).replace(hour=0, minute=0, second=0, microsecond=0)
    today_start = kst_midnight.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)

    q = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.type == ntype,
        Notification.created_at >= today_start,
    )
    if related_id is not None:
        q = q.filter(Notification.related_schedule_id == related_id)
    else:
        q = q.filter(Notification.title == title)

    if q.first():
        return

    notif = Notification(
        user_id=user_id,
        type=ntype,
        title=title,
        body=body,
        related_schedule_id=related_id,
    )
    db.add(notif)
    db.flush()
    if send_push:
        send_push_to_user(db, user_id, title, body, url="/dashboard", ntype=ntype)


def job_weekly_report():
    from app.auth.models import User
    from app.schedule.models import Schedule

    db = _get_db()
    try:
        users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
        today = date.today()
        last_mon = today - timedelta(days=today.weekday() + 7)
        last_sun = last_mon + timedelta(days=6)
        this_mon = today - timedelta(days=today.weekday())
        this_sun = this_mon + timedelta(days=6)

        for user in users:
            schedules = db.query(Schedule).filter(Schedule.user_id == user.id).all()

            last_week = [s for s in schedules if s.date and last_mon.isoformat() <= s.date <= last_sun.isoformat()]
            recurring = [s for s in schedules if not s.date]
            all_last = last_week + recurring
            pct = round(sum(1 for s in all_last if s.is_completed) / len(all_last) * 100) if all_last else 0

            undone_count = len([s for s in schedules if s.date and s.date < today.isoformat() and not s.is_completed])
            this_week_count = len([
                s for s in schedules
                if (s.date and this_mon.isoformat() <= s.date <= this_sun.isoformat()) or not s.date
            ])

            emoji = "🎉" if pct >= 80 else "👍" if pct >= 50 else "💪"
            body_lines = [
                f"지난주 수행률: {pct}% {emoji}",
                f"미완료 누적: {undone_count}건",
                f"이번주 예정 일정: {this_week_count}건",
            ]
            if undone_count > 0:
                body_lines.append("미완료 일정을 AI 채팅에서 재배치할 수 있습니다.")

            _push(db, user.id, "weekly_report", "주간 리포트", "\n".join(body_lines))

        db.commit()
        logger.info("job_weekly_report: done for %d users", len(users))
    except Exception as e:
        logger.error("job_weekly_report failed: %s", e, exc_info=True)
    finally:
        db.close()


def job_daily_motivation():
    from app.auth.models import User

    db = _get_db()
    try:
        users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
        title, body = random.choice(_MOTIVATIONS)
        for user in users:
            _push(db, user.id, "motivation", title, body)
        db.commit()
        logger.info("job_daily_motivation: done for %d users", len(users))
    except Exception as e:
        logger.error("job_daily_motivation failed: %s", e, exc_info=True)
    finally:
        db.close()


def job_reminders():
    """30분마다: 일정 시작 전 / 종료 후 미완료 알림."""
    from app.auth.models import User
    from app.schedule.models import Schedule

    db = _get_db()
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo("Asia/Seoul"))
        today_str = now.strftime("%Y-%m-%d")
        today_dow = now.weekday()  # 0=Mon, 6=Sun — Schedule.day_of_week와 동일 기준
        now_min = now.hour * 60 + now.minute

        users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
        for user in users:
            reminder_min = _get_reminder_minutes(db, user.id)
            schedules = db.query(Schedule).filter(Schedule.user_id == user.id).all()

            for s in schedules:
                is_today = (s.date == today_str) if s.date else (s.day_of_week == today_dow)
                if not is_today:
                    continue

                start_min = time_to_minutes(s.start_time)
                end_min = time_to_minutes(s.end_time)
                diff = (start_min - now_min) % 1440  # 시작까지 남은 분 (자정 넘김 고려)

                if 0 < diff <= reminder_min and not s.is_completed:
                    _push(
                        db, user.id, "reminder_start",
                        f"곧 시작: {s.title}",
                        f"{diff}분 후 [{s.start_time}~{s.end_time}] 일정이 시작됩니다.",
                        related_id=s.id,
                    )
                elif end_min < now_min and not s.is_completed:
                    _push(
                        db, user.id, "reminder_incomplete",
                        f"미완료: {s.title}",
                        f"[{s.start_time}~{s.end_time}] 일정이 아직 완료되지 않았습니다.",
                        related_id=s.id,
                    )

        db.commit()
        logger.info("job_reminders: processed for %d users at %s", len(users), now.strftime("%H:%M"))
    except Exception as e:
        logger.error("job_reminders failed: %s", e, exc_info=True)
    finally:
        db.close()


def job_exam_alert():
    """D-7, D-3, D-1, D-day 시험 알림. 매일 08:00."""
    from app.auth.models import User
    from app.schedule.models import ExamSchedule
    from zoneinfo import ZoneInfo

    db = _get_db()
    try:
        today = datetime.now(ZoneInfo("Asia/Seoul")).date()
        alert_days = {0: "D-day", 1: "D-1", 3: "D-3", 7: "D-7"}
        max_diff = max(alert_days.keys())  # 7

        users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
        for user in users:
            # 오늘 이후 최대 D-7 범위 내 시험만 로드 (과거 시험 제외)
            cutoff = (today + timedelta(days=max_diff)).isoformat()
            exams = db.query(ExamSchedule).filter(
                ExamSchedule.user_id == user.id,
                ExamSchedule.exam_date >= today.isoformat(),
                ExamSchedule.exam_date <= cutoff,
            ).all()

            for exam in exams:
                diff = (exam.exam_date - today).days
                if diff not in alert_days:
                    continue

                if diff == 0:
                    title = f"오늘 시험: {exam.title}"
                    body = f"오늘 시험이 있습니다. {exam.exam_time + ' ' if exam.exam_time else ''}파이팅!"
                else:
                    title = f"시험 {alert_days[diff]}: {exam.title}"
                    body = f"{diff}일 후 시험입니다. 미리 준비하세요!"

                _push(db, user.id, "exam_alert", title, body, related_id=exam.id)

        db.commit()
        logger.info("job_exam_alert: done for %d users on %s", len(users), today)
    except Exception as e:
        logger.error("job_exam_alert failed: %s", e, exc_info=True)
    finally:
        db.close()


def job_comparison():
    """매주 월요일 08:00 사용자 평균 대비 비교. 사용자 2명 이상일 때만 발송."""
    from app.auth.models import User
    from app.schedule.models import Schedule

    db = _get_db()
    try:
        users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
        if len(users) < 2:  # 1명이면 본인이 평균 → 의미 없음
            logger.info("job_comparison: skipped (only %d user)", len(users))
            return

        today = date.today()
        last_mon = today - timedelta(days=today.weekday() + 7)
        last_sun = last_mon + timedelta(days=6)

        user_pcts: dict[int, int] = {}
        for user in users:
            schedules = db.query(Schedule).filter(
                Schedule.user_id == user.id,
                Schedule.date >= last_mon.isoformat(),
                Schedule.date <= last_sun.isoformat(),
            ).all()
            total = len(schedules)
            done = sum(1 for s in schedules if s.is_completed)
            user_pcts[user.id] = round(done / total * 100) if total else 0

        all_pcts = list(user_pcts.values())
        avg_pct = round(sum(all_pcts) / len(all_pcts))
        sorted_pcts = sorted(all_pcts, reverse=True)

        for user in users:
            upct = user_pcts[user.id]
            diff = upct - avg_pct
            if diff > 0:
                diff_str, emoji, msg = f"{diff}%p 높습니다", "🏆", "정말 잘하고 있어요! 이 추세를 유지하세요."
            elif diff < 0:
                diff_str, emoji, msg = f"{abs(diff)}%p 낮습니다", "📈", "조금 더 노력하면 평균을 넘을 수 있습니다!"
            else:
                diff_str, emoji, msg = "같습니다", "✅", "평균과 동일합니다. 조금만 더 올려볼까요?"

            rank_idx = sorted_pcts.index(upct)
            rank_pct = round((rank_idx + 1) / len(sorted_pcts) * 100)
            body = (
                f"지난주 수행률 {upct}% — 전체 평균 {avg_pct}%보다 {diff_str} {emoji}\n"
                f"상위 {rank_pct}%에 해당합니다.\n{msg}"
            )
            _push(db, user.id, "comparison", "주간 달성 비교", body)

        db.commit()
        logger.info("job_comparison: done, avg=%d%% for %d users", avg_pct, len(users))
    except Exception as e:
        logger.error("job_comparison failed: %s", e, exc_info=True)
    finally:
        db.close()


_scheduler = None


def start_scheduler():
    global _scheduler
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger

        _scheduler = BackgroundScheduler(timezone="Asia/Seoul")
        _scheduler.add_job(job_weekly_report,    CronTrigger(day_of_week="mon", hour=8, minute=0))
        _scheduler.add_job(job_comparison,       CronTrigger(day_of_week="mon", hour=8, minute=0))
        _scheduler.add_job(job_exam_alert,       CronTrigger(hour=8, minute=0))
        _scheduler.add_job(job_daily_motivation, CronTrigger(hour=9, minute=0))
        _scheduler.add_job(job_reminders,        CronTrigger(minute="*/30"), misfire_grace_time=60)

        _scheduler.start()
        logger.info("Notification scheduler started")
    except ImportError:
        logger.warning("apscheduler not installed — notification scheduler disabled")
    except Exception as e:
        logger.error("Failed to start notification scheduler: %s", e)


def stop_scheduler():
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Notification scheduler stopped")
