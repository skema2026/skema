"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getWeekStart } from "@/components/timetable/Timetable";
import DayView from "./_components/calendar/DayView";
import WeekView from "./_components/calendar/WeekView";
import MonthView from "./_components/calendar/MonthView";
import UpcomingExams from "./_components/DashboardSidebar/UpcomingExams";
import StudyBlockDialog from "./_components/dialogs/StudyBlockDialog";
import DeleteExamDialog from "./_components/dialogs/DeleteExamDialog";
import RescheduleDialog from "./_components/dialogs/RescheduleDialog";
import IssueDialog, { type IssueItem } from "./_components/dialogs/IssueDialog";
import StudyLogModal from "./_components/StudyLogModal";
import { ClassForm } from "@/components/class-form/ClassForm";
import { useSchedules, useToggleComplete } from "@/hooks/useSchedules";
import { useExams } from "@/hooks/useExams";
import { useProfile } from "@/hooks/useProfile";
import { useAuthStore } from "@/store/authStore";
import { useUIStore } from "@/store/uiStore";
import { api } from "@/lib/api";
import { recurringDayToIndex } from "@/lib/recurringDay";
import { scheduleVisibleIn } from "@/lib/scheduleViewScope";
import { getDisplayColor } from "@/lib/scheduleColor";
import { useNotificationPrefs } from "@/hooks/usePushNotifications";
import { useMyGroups } from "@/hooks/useGroups";
import { minutesToTime, timeToMinutes } from "@/lib/utils";
import MaterialIcon from "@/components/common/MaterialIcon";
import {
  ExamSchedule,
  ReschedulePreview,
  Schedule,
  UserProfile,
} from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DashboardHeader,
  DashboardStyles,
  NotificationBanner,
  ShareDialog,
} from "./_components/DashboardChrome";
import { EtaReimportModal } from "./_components/EtaReimportModal";

interface Props {
  initialSchedules: Schedule[];
  initialProfile: UserProfile | null;
}

type TimetableView = "day" | "week" | "month";

const VIEW_LABELS: { key: TimetableView; label: string }[] = [
  { key: "day", label: "하루" },
  { key: "week", label: "주간" },
  { key: "month", label: "월간" },
];

const toLocalDateString = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const LONG_DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  weekday: "long",
});

const getLocalDow = (date: Date) => {
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
};

const formatLongDate = (date: Date) => LONG_DATE_FORMATTER.format(date);

const DEFAULT_WAKE_TIME = "07:00";
const DAY_END_MINUTES = 24 * 60;

const getWakeStartMinutes = (wakeTime?: string) => {
  const minutes = timeToMinutes(wakeTime || DEFAULT_WAKE_TIME);
  if (minutes < 0 || minutes >= DAY_END_MINUTES)
    return timeToMinutes(DEFAULT_WAKE_TIME);
  return minutes;
};

const compareByWakeTime =
  (wakeMinutes: number) => (a: Schedule, b: Schedule) => {
    const aMinutes = timeToMinutes(a.start_time);
    const bMinutes = timeToMinutes(b.start_time);
    const aOrder =
      aMinutes >= wakeMinutes ? aMinutes : aMinutes + DAY_END_MINUTES;
    const bOrder =
      bMinutes >= wakeMinutes ? bMinutes : bMinutes + DAY_END_MINUTES;
    return aOrder - bOrder;
  };

const findFreeWindows = (
  schedules: Schedule[],
  startMinutes: number,
  endMinutes = DAY_END_MINUTES,
  minDuration = 30,
) => {
  const windows: { start: number; end: number }[] = [];
  let cursor = Math.max(0, Math.min(startMinutes, endMinutes));
  const blocks = schedules
    .map((schedule) => ({
      start: Math.max(timeToMinutes(schedule.start_time), startMinutes),
      end: Math.min(timeToMinutes(schedule.end_time), endMinutes),
    }))
    .filter((block) => block.start >= 0 && block.end > block.start)
    .sort((a, b) => a.start - b.start);

  for (const block of blocks) {
    if (block.end <= cursor) continue;
    if (block.start - cursor >= minDuration) {
      windows.push({ start: cursor, end: block.start });
    }
    cursor = Math.max(cursor, block.end);
  }

  if (endMinutes - cursor >= minDuration) {
    windows.push({ start: cursor, end: endMinutes });
  }

  return windows;
};

const getOverlappingSchedules = (schedules: Schedule[]) => {
  const sorted = schedules
    .map((schedule) => ({
      schedule,
      start: timeToMinutes(schedule.start_time),
      end: timeToMinutes(schedule.end_time),
    }))
    .filter((item) => item.start >= 0 && item.end > item.start)
    .sort((a, b) => a.start - b.start);

  return sorted.filter((item, index) => {
    const previous = sorted[index - 1];
    return previous ? item.start < previous.end : false;
  });
};

const formatDuration = (start: number, end: number) => {
  const minutes = Math.max(0, end - start);
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  if (hours && remain) return `${hours}시간 ${remain}분`;
  if (hours) return `${hours}시간`;
  return `${remain}분`;
};

const formatMinutesDuration = (minutes: number) => {
  const safeMinutes = Math.max(0, minutes);
  const hours = Math.floor(safeMinutes / 60);
  const remain = safeMinutes % 60;
  if (hours && remain) return `${hours}시간 ${remain}분`;
  if (hours) return `${hours}시간`;
  return `${remain}분`;
};

export default function DashboardClient({
  initialSchedules,
  initialProfile,
}: Props) {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { openClassForm, isShareModalOpen, openShareModal, closeShareModal } =
    useUIStore();
  const { data: schedules = [] } = useSchedules(initialSchedules);
  const { data: exams = [] } = useExams();
  const toggleComplete = useToggleComplete();
  const { data: profile } = useProfile(initialProfile ?? undefined);
  const { prefs: notifPrefs } = useNotificationPrefs();

  const [shareToken, setShareToken] = useState<string | null>(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [isEtaReimportOpen, setIsEtaReimportOpen] = useState(false);
  const [notification, setNotification] = useState<Schedule | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [reschedulePreview, setReschedulePreview] =
    useState<ReschedulePreview | null>(null);
  const [timetableView, setTimetableView] = useState<TimetableView>(() => {
    if (typeof window === "undefined") return "week";

    const viewParam = new URLSearchParams(window.location.search).get("view");
    if (viewParam === "day" || viewParam === "week" || viewParam === "month") {
      return viewParam;
    }
    return "week";
  });
  const [dayOffset, setDayOffset] = useState(() => {
    if (typeof window === "undefined") return 0;

    const dateParam = new URLSearchParams(window.location.search).get("date");
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return 0;

    const [year, month, day] = dateParam.split("-").map(Number);
    const target = new Date(year, month - 1, day);

    if (toLocalDateString(target) !== dateParam) return 0;

    const today = new Date();
    const base = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );

    return Math.round((target.getTime() - base.getTime()) / 86400000);
  });
  const [monthOffset, setMonthOffset] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const syncStateFromUrl = useCallback(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const viewParam = url.searchParams.get("view");
    const nextView: TimetableView =
      viewParam === "day" || viewParam === "week" || viewParam === "month"
        ? viewParam
        : "week";
    setTimetableView(nextView);

    const dateParam = url.searchParams.get("date");
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      setDayOffset(0);
      setWeekOffset(0);
      setMonthOffset(0);
      return;
    }

    const [year, month, day] = dateParam.split("-").map(Number);
    const target = new Date(year, month - 1, day);
    if (toLocalDateString(target) !== dateParam) {
      setDayOffset(0);
      setWeekOffset(0);
      setMonthOffset(0);
      return;
    }

    const today = new Date();
    const todayDate = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    setDayOffset(
      Math.round((target.getTime() - todayDate.getTime()) / 86400000),
    );

    const todayWeekStart = getWeekStart(todayDate);
    const targetWeekStart = getWeekStart(target);
    setWeekOffset(
      Math.round(
        (targetWeekStart.getTime() - todayWeekStart.getTime()) /
          (7 * 86400000),
      ),
    );

    const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const targetMonth = new Date(target.getFullYear(), target.getMonth(), 1);
    setMonthOffset(
      (targetMonth.getFullYear() * 12 + targetMonth.getMonth()) -
        (currentMonth.getFullYear() * 12 + currentMonth.getMonth()),
    );
  }, []);

  useEffect(() => {
    syncStateFromUrl();
    const handlePopState = () => syncStateFromUrl();
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [syncStateFromUrl]);

  const [weekScrollDate, setWeekScrollDate] = useState<string | null>(null);
  const [isIssueDialogOpen, setIsIssueDialogOpen] = useState(false);
  const [examForStudyBlocks, setExamForStudyBlocks] = useState<{
    id: number;
    title: string;
    exam_date: string;
  } | null>(null);
  const [examToDelete, setExamToDelete] = useState<ExamSchedule | null>(null);
  const [isRemainingDialogOpen, setIsRemainingDialogOpen] = useState(false);
  const [certSchedule, setCertSchedule] = useState<{
    id: number;
    title: string;
  } | null>(null);
  const { data: myGroups = [] } = useMyGroups();
  const etaScheduleCount = schedules.filter(
    (s) => s.schedule_source === "eta_import",
  ).length;
  const queryClient = useQueryClient();
  const timetableRef = useRef<HTMLDivElement | null>(null);

  // 온보딩 미완료 시 온보딩 페이지로 이동 (SSR에서 처리 안된 경우 fallback)
  useEffect(() => {
    if (profile && !profile.onboarding_completed) {
      router.replace("/onboarding");
    }
  }, [profile, router]);

  // Notification system (서버 prefs 기반 인앱 배너)
  const checkNotifications = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!notifPrefs.reminder_start || !schedules.length) return;
    const notifMinutes = notifPrefs.reminder_minutes ?? 30;
    const now = new Date();
    const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const upcoming = schedules.find((s) => {
      if (s.is_completed) return false;
      if (!scheduleVisibleIn(s, "day")) return false;
      const matchDay = s.date
        ? s.date === todayStr
        : recurringDayToIndex(s.recurring_day) === todayDow;
      if (!matchDay) return false;
      const startMin = timeToMinutes(s.start_time);
      const diff = startMin - nowMin;
      return diff > 0 && diff <= notifMinutes;
    });
    if (upcoming) {
      setNotification(upcoming);
      setTimeout(() => setNotification(null), 8000);
    }
  }, [schedules, notifPrefs.reminder_start, notifPrefs.reminder_minutes]);

  useEffect(() => {
    checkNotifications();
    const interval = setInterval(checkNotifications, 60000);
    return () => clearInterval(interval);
  }, [checkNotifications]);

  // 시험 전날 알림
  useEffect(() => {
    if (!exams.length) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

    const examsTomorrow = exams.filter((e) => e.exam_date === tomorrowStr);
    if (!examsTomorrow.length) return;

    const warnKey = `skema_exam_warn_${tomorrowStr}`;
    if (localStorage.getItem(warnKey)) return;
    localStorage.setItem(warnKey, "1");

    examsTomorrow.forEach((exam) => {
      toast.warning(`내일 "${exam.title}" 시험이 있습니다`, {
        duration: 15000,
      });
    });
  }, [exams]);

  // 오늘 할 일
  const now = new Date();
  const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const weekStart = getWeekStart(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + weekOffset * 7),
  );
  const wakeStartTime = profile?.sleep_end || DEFAULT_WAKE_TIME;
  const wakeStartMinutes = getWakeStartMinutes(wakeStartTime);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // 서버의 get_today_schedules와 동일한 중복 제거:
  // 반복 일정 + 오늘 날짜 일정을 합치되, 같은 title+start_time의 dated 인스턴스가 있으면 반복 일정은 제외
  const todaySpecific = schedules.filter(
    (s) => scheduleVisibleIn(s, "day") && s.date === todayStr,
  );
  const todayRecurring = schedules.filter(
    (s) =>
      scheduleVisibleIn(s, "day") &&
      !s.date &&
      recurringDayToIndex(s.recurring_day) === todayDow,
  );
  const todaySpecificKeys = new Set(
    todaySpecific.map((s) => `${s.title}|${s.start_time}`),
  );
  const todaySchedules = [
    ...todaySpecific,
    ...todayRecurring.filter(
      (s) => !todaySpecificKeys.has(`${s.title}|${s.start_time}`),
    ),
  ].sort(compareByWakeTime(wakeStartMinutes));

  useEffect(() => {
    if (!timetableRef.current || todaySchedules.length === 0) return;

    const firstSchedule = todaySchedules[0];

    const startMinutes = timeToMinutes(firstSchedule.start_time);

    const hourHeight = 64;

    const scrollPosition = (startMinutes / 60) * hourHeight;

    timetableRef.current.scrollTop = Math.max(scrollPosition - 120, 0);
  }, [todaySchedules]);

  const dayDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + dayOffset,
  );
  const monthDate = new Date(
    now.getFullYear(),
    now.getMonth() + monthOffset,
    1,
  );
  const monthLabel = `${monthDate.getFullYear()}년 ${monthDate.getMonth() + 1}월`;

  const getSchedulesForDate = (date: Date, target: TimetableView = "day") => {
    const dateStr = toLocalDateString(date);
    const dow = getLocalDow(date);
    const isVisibleForTarget = (schedule: Schedule) =>
      scheduleVisibleIn(schedule, target) ||
      (target === "week" && schedule.schedule_type === "study");
    const dated = schedules.filter(
      (s) => isVisibleForTarget(s) && s.date === dateStr,
    );
    const recurring = schedules.filter(
      (s) =>
        isVisibleForTarget(s) &&
        !s.date &&
        recurringDayToIndex(s.recurring_day) === dow,
    );
    const datedKeys = new Set(dated.map((s) => `${s.title}|${s.start_time}`));

    return [
      ...dated,
      ...recurring.filter((s) => !datedKeys.has(`${s.title}|${s.start_time}`)),
    ].sort(compareByWakeTime(wakeStartMinutes));
  };

  const daySchedules = getSchedulesForDate(dayDate);
  const weekSchedules = schedules.filter(
    (schedule) =>
      scheduleVisibleIn(schedule, "week") || schedule.schedule_type === "study",
  );
  const weekAgendaDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    const dateStr = toLocalDateString(date);
    return {
      date,
      dateStr,
      schedules: getSchedulesForDate(date, "week"),
      exams: exams.filter((exam) => exam.exam_date === dateStr),
    };
  });
  const dayExams = exams.filter(
    (exam) => exam.exam_date === toLocalDateString(dayDate),
  );
  const dayFreeWindows = findFreeWindows(daySchedules, wakeStartMinutes).slice(
    0,
    4,
  );
  const dayConflictSchedules = getOverlappingSchedules(daySchedules);
  const isSelectedDayToday = toLocalDateString(dayDate) === todayStr;
  const selectedDayPrimarySchedule =
    (isSelectedDayToday
      ? daySchedules.find(
          (s) => !s.is_completed && timeToMinutes(s.start_time) >= nowMin,
        )
      : daySchedules.find((s) => !s.is_completed)) ??
    daySchedules[0] ??
    null;

  // 오늘 수행률
  const todayTotal = todaySchedules.length;
  const todayDone = todaySchedules.filter((s) => s.is_completed).length;
  const todayPct =
    todayTotal > 0 ? Math.round((todayDone / todayTotal) * 100) : null;

  const remainingToday = todaySchedules.filter((s) => !s.is_completed);
  const overdueSchedules = todaySchedules.filter(
    (schedule) =>
      !schedule.is_completed && timeToMinutes(schedule.end_time) < nowMin,
  );
  const todayConflictSchedules = getOverlappingSchedules(todaySchedules);
  const upcomingExams = exams
    .filter((e) => {
      const [y, m, d] = e.exam_date.split("-").map(Number);
      const examDate = new Date(y, m - 1, d);
      examDate.setHours(23, 59, 59, 999);
      return examDate >= now;
    })
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date))
    .slice(0, 3);
  const upcomingExam = upcomingExams[0] ?? null;

  // 사이드바 "다가오는 중요 일정" 카드용 데이터 — 대학생·비대학생 모두 시험만 표시
  const sidebarExams = upcomingExams.slice(0, 5);
  const sidebarOneTimeEvents: typeof schedules = [];

  const getDaysUntil = (date: string) =>
    Math.ceil(
      (new Date(`${date}T00:00:00`).getTime() -
        new Date(`${todayStr}T00:00:00`).getTime()) /
        86400000,
    );
  const formatDday = (days: number) => (days <= 0 ? "D-day" : `D-${days}`);
  const todayLabel = formatLongDate(now);
  const weekEndDate = new Date(weekStart);
  weekEndDate.setDate(weekStart.getDate() + 6);
  const weekLabel = `${weekStart.getMonth() + 1}.${weekStart.getDate()} - ${weekEndDate.getMonth() + 1}.${weekEndDate.getDate()}`;
  const currentViewLabel =
    timetableView === "day"
      ? formatLongDate(dayDate)
      : timetableView === "week"
        ? weekLabel
        : monthLabel;
  // 에타 시간표 업로드는 대학생 전용 기능 → 비대학생에겐 "시간표 인식 필요" 안내를 띄우지 않는다
  const needsTimetableUpload =
    profile?.is_college_student === true &&
    (schedules.length === 0 || etaScheduleCount === 0);
  const examNeedsAttention = upcomingExam
    ? getDaysUntil(upcomingExam.exam_date) <= 7
    : false;
  const issueItems: IssueItem[] = [
    ...(todayConflictSchedules.length
      ? [
          {
            key: "conflicts",
            label: "겹친 일정",
            value: `${todayConflictSchedules.length}개`,
            detail: todayConflictSchedules
              .map(({ schedule }) => schedule.title)
              .join(", "),
            tone: "red",
          },
        ]
      : []),
    ...(overdueSchedules.length
      ? [
          {
            key: "overdue",
            label: "지나간 미완료",
            value: `${overdueSchedules.length}개`,
            detail: overdueSchedules
              .map((schedule) => schedule.title)
              .slice(0, 2)
              .join(", "),
            tone: "amber",
          },
        ]
      : []),
    ...(needsTimetableUpload
      ? [
          {
            key: "eta",
            label: "시간표 인식",
            value: "필요",
            detail: "이미지를 올리면 수업 시간표를 빠르게 채울 수 있습니다",
            tone: "blue",
          },
        ]
      : []),
    ...(examNeedsAttention
      ? [
          {
            key: "exam",
            label: "시험 준비",
            value: formatDday(getDaysUntil(upcomingExam!.exam_date)),
            detail: `${upcomingExam!.title} 준비 시간을 빈 시간에 배치해보세요`,
            tone: "blue",
          },
        ]
      : []),
  ];
  const issueCount = issueItems.length;
  /** 일정이 바뀐 뒤 관련 쿼리 무효화 */
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["schedules"] });
    queryClient.invalidateQueries({ queryKey: ["exams"] });
  };

  /** 다시 짜기 (#11): 미리보기를 받아 확인 창을 띄운다. 적용은 RescheduleDialog에서. */
  const handleReschedule = async () => {
    setIsRegenerating(true);
    try {
      const { data } = await api.post<ReschedulePreview>("/reschedule/preview");
      if (data.summary.target === 0) {
        toast.info("다시 짤 일정이 없어요", {
          style: {
            background: "#EFF6FF",
            border: "1px solid #BFDBFE",
            color: "#1f63d6",
          },
          icon: <MaterialIcon icon="info" size={14} color="#1f63d6" />,
        });
        return;
      }
      setReschedulePreview(data);
    } catch {
      toast.error("다시 짜기 미리보기를 불러오지 못했어요");
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleLogout = () => {
    logout();
    queryClient.clear();
    toast.success("로그아웃 되었습니다");
    window.location.replace("/login");
  };

  const handleShare = async () => {
    openShareModal();
    if (shareToken) return;
    setIsGeneratingShare(true);
    try {
      const { data } = await api.post<{ token: string }>("/share-tokens", {});
      setShareToken(data.token);
    } catch {
      toast.error("공유 링크 생성 중 오류가 발생했습니다");
    } finally {
      setIsGeneratingShare(false);
    }
  };

  const shareUrl = shareToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${shareToken}`
    : "";

  const copyShareUrl = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      toast.success("링크가 복사되었습니다");
    }
  };

  const syncUrlState = (
    date: Date,
    view: TimetableView,
    method: "pushState" | "replaceState" = "replaceState",
  ) => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    url.searchParams.set("date", toLocalDateString(date));
    url.searchParams.set("view", view);

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history[method]({}, "", nextUrl);
  };

  const openDayViewForDate = (date: Date) => {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((date.getTime() - today.getTime()) / 86400000);
    setDayOffset(diff);
    setTimetableView("day");
    syncUrlState(date, "day");
  };

  const moveCalendar = (direction: -1 | 1) => {
    if (timetableView === "day") {
      const nextOffset = dayOffset + direction;
      setDayOffset(nextOffset);
      const nextDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + nextOffset,
      );
      syncUrlState(nextDate, "day");
    }
    if (timetableView === "week") {
      setWeekOffset((offset) => offset + direction);
      const nextDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + dayOffset + direction * 7,
      );
      syncUrlState(nextDate, "week");
    }
    if (timetableView === "month") {
      setMonthOffset((offset) => offset + direction);
      const nextDate = new Date(
        now.getFullYear(),
        now.getMonth() + monthOffset + direction,
        now.getDate(),
      );
      syncUrlState(nextDate, "month");
    }
  };

  const showDayViewForDate = (date: Date) => {
    openDayViewForDate(date);
  };

  const showWeekViewForDate = (date: Date) => {
    const todayWeekStart = getWeekStart(
      new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    );
    const targetWeekStart = getWeekStart(date);
    const diffWeeks = Math.round(
      (targetWeekStart.getTime() - todayWeekStart.getTime()) / (7 * 86400000),
    );
    setWeekOffset(diffWeeks);
    setWeekScrollDate(toLocalDateString(date));
    setTimetableView("week");
    syncUrlState(date, "week");
  };

  const resetCalendar = () => {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    setDayOffset(0);
    setWeekOffset(0);
    setMonthOffset(0);
    setTimetableView("day");
    syncUrlState(today, "day");
  };

  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const monthGridStart = new Date(monthStart);
  monthGridStart.setDate(monthStart.getDate() - getLocalDow(monthStart));
  const monthDays = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(monthGridStart);
    date.setDate(monthGridStart.getDate() + index);
    return date;
  });
  const monthAgendaDays = monthDays.map((date) => {
    const dateStr = toLocalDateString(date);
    return {
      date,
      dateStr,
      schedules: getSchedulesForDate(date, "month"),
      exams: exams.filter((exam) => exam.exam_date === dateStr),
    };
  });
  const currentViewScheduleCount =
    timetableView === "day"
      ? daySchedules.length
      : timetableView === "week"
        ? weekSchedules.length
        : monthDays.reduce((count, date) => {
            if (date.getMonth() !== monthDate.getMonth()) return count;
            return count + getSchedulesForDate(date, "month").length;
          }, 0);

  return (
    <>
      <DashboardStyles />
      <div className="flex h-screen flex-col bg-[#f5f8fd]">
        <NotificationBanner
          notification={notification}
          onOpen={(schedule) => {
            const scheduleDate = schedule.date
              ? new Date(
                  Number(schedule.date.slice(0, 4)),
                  Number(schedule.date.slice(5, 7)) - 1,
                  Number(schedule.date.slice(8, 10)),
                )
              : new Date(now.getFullYear(), now.getMonth(), now.getDate());

            openDayViewForDate(scheduleDate);
            openClassForm(schedule);
            setNotification(null);
          }}
          onDismiss={() => setNotification(null)}
        />

        <DashboardHeader
          user={user}
          todayPct={todayPct}
          todayDone={todayDone}
          todayTotal={todayTotal}
          onShare={handleShare}
          onOpenProfile={() => router.push("/profile")}
          onOpenAdminUsers={() => router.push("/admin/users")}
          onOpenAdminLogs={() => router.push("/admin/login-logs")}
          onLogout={handleLogout}
          onAddSchedule={() => openClassForm()}
          onOpenSetlog={() => router.push("/log")}
          onReschedule={handleReschedule}
          onUploadTimetable={() => setIsEtaReimportOpen(true)}
          isRegenerating={isRegenerating}
        />

        <main className="min-h-0 flex-1 overflow-y-auto bg-[#f5f8fd] p-3 sm:p-6">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3">
            <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="flex min-w-0 flex-col">
                <div className="mb-2 flex flex-wrap items-end justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[13px] text-[#5f6f88]">
                      {todayLabel}
                    </p>
                    <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-[-0.01em] text-[#0f1e3a]">
                      내 시간표
                    </h1>
                    <p className="mt-2 text-[14px] text-[#44536b]">
                      {currentViewLabel} · 일정 {currentViewScheduleCount}개 · 에타 수업 {etaScheduleCount}개
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex rounded-lg bg-[#e6effc] p-1">
                      {VIEW_LABELS.map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => {
                            setTimetableView(key);
                            const baseDate = new Date(
                              now.getFullYear(),
                              now.getMonth(),
                              now.getDate() + dayOffset,
                            );
                            syncUrlState(baseDate, key);
                          }}
                          className={`h-7 rounded-md px-3 text-[13px] transition-colors ${
                            timetableView === key
                              ? "bg-[#2a6fe3] font-medium text-white shadow-[0_1px_2px_rgba(42,111,227,0.25)]"
                              : "text-[#44536b] hover:text-[#1f63d6]"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 bg-white transition-colors hover:bg-[#edf3fc]"
                      onClick={() => moveCalendar(-1)}
                      aria-label="이전"
                    >
                      <MaterialIcon
                        icon="chevron_left"
                        size={18}
                        color="#44536b"
                      />
                    </button>
                    <button
                      className="skema-btn-secondary h-9 px-3 text-[13px]"
                      onClick={resetCalendar}
                    >
                      오늘
                    </button>
                    <button
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 bg-white transition-colors hover:bg-[#edf3fc]"
                      onClick={() => moveCalendar(1)}
                      aria-label="다음"
                    >
                      <MaterialIcon
                        icon="chevron_right"
                        size={18}
                        color="#44536b"
                      />
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex-1 overflow-hidden rounded-xl border border-black/[0.08] bg-white sm:mt-5 sm:min-h-[calc(100vh-200px)]">
                  {timetableView === "week" && (
                    <WeekView
                      days={weekAgendaDays}
                      todayStr={todayStr}
                      weekStart={weekStart}
                      schedules={weekSchedules}
                      exams={exams}
                      timetableRef={timetableRef}
                      onScheduleClick={openClassForm}
                      onExamClick={(exam) =>
                        setExamForStudyBlocks({
                          id: exam.id,
                          title: exam.title,
                          exam_date: exam.exam_date,
                        })
                      }
                      onShowDayView={showDayViewForDate}
                      scrollToDateStr={weekScrollDate}
                      onScrollConsumed={() => setWeekScrollDate(null)}
                    />
                  )}

                  {timetableView === "day" && (
                    <DayView
                      dayDate={dayDate}
                      daySchedules={daySchedules}
                      dayExams={dayExams}
                      upcomingExams={upcomingExams}
                      dayFreeWindows={dayFreeWindows}
                      dayConflictSchedules={dayConflictSchedules}
                      todayStr={todayStr}
                      now={now}
                      wakeStartTime={wakeStartTime}
                      wakeStartMinutes={wakeStartMinutes}
                      profile={profile}
                      remainingToday={remainingToday}
                      getDaysUntil={getDaysUntil}
                      formatLongDate={formatLongDate}
                      toLocalDateString={toLocalDateString}
                      minutesToTime={minutesToTime}
                      timeToMinutes={timeToMinutes}
                      getSchedulesForDate={getSchedulesForDate}
                      exams={exams}
                      showWeekViewForDate={showWeekViewForDate}
                      getDisplayColor={getDisplayColor}
                      formatDuration={formatDuration}
                      formatMinutesDuration={formatMinutesDuration}
                      setExamForStudyBlocks={setExamForStudyBlocks}
                      selectedDayPrimarySchedule={selectedDayPrimarySchedule}
                      openClassForm={openClassForm}
                      isSelectedDayToday={isSelectedDayToday}
                      setIsRemainingDialogOpen={setIsRemainingDialogOpen}
                      issueCount={issueCount}
                      setIsIssueDialogOpen={setIsIssueDialogOpen}
                      issueItems={issueItems}
                      toggleComplete={toggleComplete}
                      setCertSchedule={setCertSchedule}
                      onReschedule={handleReschedule}
                      isRegenerating={isRegenerating}
                    />
                  )}
                  {timetableView === "month" && (
                    <MonthView
                      days={monthAgendaDays}
                      monthDate={monthDate}
                      monthLabel={monthLabel}
                      todayStr={todayStr}
                      wakeStartMinutes={wakeStartMinutes}
                      onDayClick={showDayViewForDate}
                    />
                  )}
                </div>
              </div>

              <aside className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-20 xl:max-h-[calc(100vh-100px)] xl:overflow-y-auto">
                <UpcomingExams
                  exams={sidebarExams}
                  events={sidebarOneTimeEvents}
                  schedules={schedules}
                  getDaysUntil={getDaysUntil}
                  onExamClick={(exam) =>
                    setExamForStudyBlocks({
                      id: exam.id,
                      title: exam.title,
                      exam_date: exam.exam_date,
                    })
                  }
                />
              </aside>
            </section>
          </div>
        </main>
      </div>

      <Dialog
        open={isRemainingDialogOpen}
        onOpenChange={setIsRemainingDialogOpen}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>오늘 남은 일정</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            {remainingToday.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2"
              >
                <span className="truncate text-sm font-semibold text-slate-950 mr-2">
                  {s.title}
                </span>
                <span className="shrink-0 text-xs font-medium text-slate-400">
                  {s.start_time}–{s.end_time}
                </span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <RescheduleDialog
        preview={reschedulePreview}
        onPreviewChange={setReschedulePreview}
        onApplied={invalidateAll}
      />

      <StudyBlockDialog
        exam={examForStudyBlocks}
        onExamChange={setExamForStudyBlocks}
        getDaysUntil={getDaysUntil}
        onGenerated={invalidateAll}
        exams={exams}
        onDeleteExam={setExamToDelete}
      />
      <DeleteExamDialog exam={examToDelete} onExamChange={setExamToDelete} />
      <IssueDialog
        open={isIssueDialogOpen}
        onOpenChange={setIsIssueDialogOpen}
        items={issueItems}
      />

      <ClassForm />

      <StudyLogModal
        schedule={certSchedule}
        groups={myGroups}
        onClose={() => setCertSchedule(null)}
      />

      <EtaReimportModal
        open={isEtaReimportOpen}
        onClose={() => setIsEtaReimportOpen(false)}
        existingEtaCount={etaScheduleCount}
      />

      <ShareDialog
        open={isShareModalOpen}
        onClose={closeShareModal}
        shareUrl={shareUrl}
        isGeneratingShare={isGeneratingShare}
        onCopy={copyShareUrl}
      />
    </>
  );
}
