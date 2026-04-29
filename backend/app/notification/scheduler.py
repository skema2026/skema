"""
알림 스케줄러.

job 함수들은 APScheduler BackgroundScheduler 에서 주기적으로 호출된다.
각 함수는 독립적인 DB 세션을 열고 닫는다.

jobs:
  job_weekly_report    — 매주 월요일 08:00   주간 수행률 / 미완료 / 다음주 일정
  job_daily_motivation — 매일 09:00          동기부여 메시지
  job_reminders        — 30분마다            일정 시작 30분 전 / 미완료 재촉
  job_comparison       — 매주 수요일 10:00   사용자 평균 대비 비교
"""
from __future__ import annotations

import logging
import random
from datetime import date, datetime, timedelta

logger = logging.getLogger(__name__)

# ── 동기부여 메시지 풀 ─────────────────────────────────────────────────────────

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

_COMPARISON_TEMPLATES = [
    ("이번 주 수행률 비교", "이번 주 {user_pct}% 달성! 전체 사용자 평균({avg_pct}%)보다 {diff} {emoji}."),
    ("주간 달성 현황", "수행률 {user_pct}% — 상위 {rank}%에 해당합니다. {msg}"),
]


def _get_db():
    from app.db.database import SessionLocal
    return SessionLocal()


def _push(db, user_id: int, ntype: str, title: str, body: str, related_id: int | None = None):
    """알림 1건 저장. 중복(같은 날 같은 type+title) 방지."""
    from app.notification.models import Notification
    from sqlalchemy import func

    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    exists = (
        db.query(Notification)
        .filter(
            Notification.user_id == user_id,
            Notification.type == ntype,
            Notification.title == title,
            Notification.created_at >= today_start,
        )
        .first()
    )
    if exists:
        return
    notif = Notification(
        user_id=user_id,
        type=ntype,
        title=title,
        body=body,
        related_schedule_id=related_id,
    )
    db.add(notif)


# ── Job 1: 주간 리포트 (매주 월요일 08:00) ────────────────────────────────────

def job_weekly_report():
    from app.auth.models import User
    from app.schedule.models import Schedule

    db = _get_db()
    try:
        users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
        today = date.today()
        # 지난주 월~일
        last_mon = today - timedelta(days=today.weekday() + 7)
        last_sun = last_mon + timedelta(days=6)
        # 다음주 일정 미리보기 (이번주 월~일)
        this_mon = today - timedelta(days=today.weekday())
        this_sun = this_mon + timedelta(days=6)

        for user in users:
            schedules = db.query(Schedule).filter(
                Schedule.user_id == user.id,
                Schedule.deleted_by_user == False,  # noqa: E712
            ).all()

            # 지난주 수행률
            last_week_sch = [
                s for s in schedules
                if s.date and last_mon.isoformat() <= s.date <= last_sun.isoformat()
            ]
            # 반복 일정도 포함 (date=null → 요일 기반, 지난주에 한 번 등장으로 카운트)
            recurring = [s for s in schedules if not s.date]
            all_last = last_week_sch + recurring
            done_last = [s for s in all_last if s.is_completed]
            total_last = len(all_last)
            pct = round(len(done_last) / total_last * 100) if total_last else 0

            # 미완료 일정 (오늘 기준 지난 날짜)
            undone = [
                s for s in schedules
                if s.date and s.date < today.isoformat() and not s.is_completed
            ]
            undone_count = len(undone)

            # 다음주 일정 개수
            next_week_count = len([
                s for s in schedules
                if (s.date and this_mon.isoformat() <= s.date <= this_sun.isoformat())
                or (not s.date)  # 반복 일정은 항상 있음
            ])

            emoji = "🎉" if pct >= 80 else "👍" if pct >= 50 else "💪"
            body_lines = [
                f"지난주 수행률: {pct}% {emoji}",
                f"미완료 누적: {undone_count}건",
                f"이번주 예정 일정: {next_week_count}건",
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


# ── Job 2: 매일 동기부여 메시지 (09:00) ──────────────────────────────────────

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


# ── Job 3: 일정 리마인더 (30분마다) ──────────────────────────────────────────

def job_reminders():
    """
    - 오늘 일정 시작 30분 전 알림
    - 오늘 지난 시간인데 미완료인 일정 재촉
    """
    from app.auth.models import User
    from app.schedule.models import Schedule

    db = _get_db()
    try:
        now = datetime.now()
        today_str = now.strftime("%Y-%m-%d")
        today_dow = now.weekday()  # 0=Mon
        now_min = now.hour * 60 + now.minute
        window_start = (now_min + 20) % 1440   # 20~40분 후 시작하는 일정 (자정 순환 처리)
        window_end = (now_min + 40) % 1440

        users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
        for user in users:
            schedules = db.query(Schedule).filter(
                Schedule.user_id == user.id,
                Schedule.deleted_by_user == False,  # noqa: E712
            ).all()

            for s in schedules:
                # 오늘 일정인지
                is_today = (s.date == today_str) if s.date else (s.day_of_week == today_dow)
                if not is_today:
                    continue

                start_min = _hhmm_to_min(s.start_time)
                end_min = _hhmm_to_min(s.end_time)

                # 시작 전 알림 (20~40분 후 시작, 자정 순환 고려)
                in_window = (
                    window_start <= start_min <= window_end
                    if window_start <= window_end
                    else start_min >= window_start or start_min <= window_end
                )
                if in_window and not s.is_completed:
                    diff = start_min - now_min
                    _push(
                        db, user.id, "reminder",
                        f"곧 시작: {s.title}",
                        f"{diff}분 후 [{s.start_time}~{s.end_time}] 일정이 시작됩니다.",
                        related_id=s.id,
                    )

                # 미완료 재촉 (종료 시간이 지났는데 미완료)
                if end_min < now_min and not s.is_completed:
                    _push(
                        db, user.id, "reminder",
                        f"미완료: {s.title}",
                        f"[{s.start_time}~{s.end_time}] 일정이 아직 완료되지 않았습니다. 확인해보세요.",
                        related_id=s.id,
                    )

        db.commit()
        logger.info("job_reminders: processed for %d users at %s", len(users), now.strftime("%H:%M"))
    except Exception as e:
        logger.error("job_reminders failed: %s", e, exc_info=True)
    finally:
        db.close()


# ── Job 4: 사용자 평균 비교 (매주 수요일 10:00) ───────────────────────────────

def job_comparison():
    from app.auth.models import User
    from app.schedule.models import Schedule

    db = _get_db()
    try:
        users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
        today = date.today()
        last_mon = today - timedelta(days=today.weekday() + 7)
        last_sun = last_mon + timedelta(days=6)

        # 전체 사용자 지난주 수행률 수집
        all_pcts: list[int] = []
        user_pcts: dict[int, int] = {}

        for user in users:
            schedules = db.query(Schedule).filter(
                Schedule.user_id == user.id,
                Schedule.date >= last_mon.isoformat(),
                Schedule.date <= last_sun.isoformat(),
                Schedule.deleted_by_user == False,  # noqa: E712
            ).all()
            total = len(schedules)
            done = sum(1 for s in schedules if s.is_completed)
            pct = round(done / total * 100) if total else 0
            user_pcts[user.id] = pct
            all_pcts.append(pct)

        if not all_pcts:
            return

        avg_pct = round(sum(all_pcts) / len(all_pcts))

        for user in users:
            upct = user_pcts.get(user.id, 0)
            diff = upct - avg_pct
            if diff > 0:
                diff_str = f"{diff}%p 높습니다"
                emoji = "🏆"
                msg = "정말 잘하고 있어요! 이 추세를 유지하세요."
            elif diff < 0:
                diff_str = f"{abs(diff)}%p 낮습니다"
                emoji = "📈"
                msg = "조금 더 노력하면 평균을 넘을 수 있습니다!"
            else:
                diff_str = "같습니다"
                emoji = "✅"
                msg = "평균과 동일합니다. 조금만 더 올려볼까요?"

            sorted_pcts = sorted(all_pcts, reverse=True)
            rank_idx = sorted_pcts.index(upct) if upct in sorted_pcts else len(sorted_pcts) - 1
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


# ── 유틸 ──────────────────────────────────────────────────────────────────────

def _hhmm_to_min(t: str) -> int:
    try:
        h, m = t.split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return 0


# ── 스케줄러 시작/종료 ─────────────────────────────────────────────────────────

_scheduler = None


def start_scheduler():
    global _scheduler
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.triggers.cron import CronTrigger

        _scheduler = BackgroundScheduler(timezone="Asia/Seoul")

        # 매주 월요일 08:00 주간 리포트
        _scheduler.add_job(job_weekly_report, CronTrigger(day_of_week="mon", hour=8, minute=0))
        # 매일 09:00 동기부여
        _scheduler.add_job(job_daily_motivation, CronTrigger(hour=9, minute=0))
        # 30분마다 리마인더
        _scheduler.add_job(job_reminders, CronTrigger(minute="*/30"))
        # 매주 수요일 10:00 비교
        _scheduler.add_job(job_comparison, CronTrigger(day_of_week="wed", hour=10, minute=0))

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
