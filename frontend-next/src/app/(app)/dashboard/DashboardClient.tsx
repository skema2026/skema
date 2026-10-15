'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getWeekStart } from '@/components/timetable/Timetable';
import DayView from './_components/calendar/DayView';
import WeekView from './_components/calendar/WeekView';
import MonthView from './_components/calendar/MonthView';
import UpcomingExams from './_components/DashboardSidebar/UpcomingExams';
import AiActions from './_components/DashboardSidebar/AiActions';
import FreeTimeDialog from './_components/dialogs/FreeTimeDialog';
import StudyBlockDialog from './_components/dialogs/StudyBlockDialog';
import DeleteExamDialog from './_components/dialogs/DeleteExamDialog';
import IssueDialog, { type IssueItem } from './_components/dialogs/IssueDialog';
import StudyLogModal from './_components/StudyLogModal';
import { ClassForm } from '@/components/class-form/ClassForm';
import { useSchedules, useToggleComplete } from '@/hooks/useSchedules';
import { useExams } from '@/hooks/useExams';
import { useProfile } from '@/hooks/useProfile';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/lib/api';
import { recurringDayToIndex } from '@/lib/recurringDay';
import { scheduleVisibleIn } from '@/lib/scheduleViewScope';
import { getDisplayColor } from '@/lib/scheduleColor';
import { useNotificationPrefs } from '@/hooks/usePushNotifications';
import { useStreak } from '@/hooks/useStudyLogs';
import { useMyGroups } from '@/hooks/useGroups';
import { minutesToTime, timeToMinutes } from '@/lib/utils';
import MaterialIcon from '@/components/common/MaterialIcon';
import { ExamSchedule, Schedule, UserProfile } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DashboardHeader,
  DashboardStyles,
  NotificationBanner,
  ShareDialog,
} from './_components/DashboardChrome';
import { EtaReimportModal } from './_components/EtaReimportModal';
import { FloatingAIChat } from './_components/FloatingAIChat';

interface Props {
  initialSchedules: Schedule[];
  initialProfile: UserProfile | null;
}

type TimetableView = 'day' | 'week' | 'month';

const VIEW_LABELS: { key: TimetableView; label: string }[] = [
  { key: 'day', label: '하루' },
  { key: 'week', label: '주간' },
  { key: 'month', label: '월간' },
];


const toLocalDateString = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const LONG_DATE_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});

const getLocalDow = (date: Date) => {
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
};

const formatLongDate = (date: Date) => LONG_DATE_FORMATTER.format(date);

const DEFAULT_WAKE_TIME = '07:00';
const DAY_END_MINUTES = 24 * 60;


const getWakeStartMinutes = (wakeTime?: string) => {
  const minutes = timeToMinutes(wakeTime || DEFAULT_WAKE_TIME);
  if (minutes < 0 || minutes >= DAY_END_MINUTES) return timeToMinutes(DEFAULT_WAKE_TIME);
  return minutes;
};

const compareByWakeTime = (wakeMinutes: number) => (a: Schedule, b: Schedule) => {
  const aMinutes = timeToMinutes(a.start_time);
  const bMinutes = timeToMinutes(b.start_time);
  const aOrder = aMinutes >= wakeMinutes ? aMinutes : aMinutes + DAY_END_MINUTES;
  const bOrder = bMinutes >= wakeMinutes ? bMinutes : bMinutes + DAY_END_MINUTES;
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

export default function DashboardClient({ initialSchedules, initialProfile }: Props) {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { openClassForm, isShareModalOpen, openShareModal, closeShareModal } = useUIStore();
  const { data: schedules = [] } = useSchedules(initialSchedules);
  const { data: exams = [] } = useExams();
  const toggleComplete = useToggleComplete();
  const { data: profile } = useProfile(initialProfile ?? undefined);
  const { prefs: notifPrefs } = useNotificationPrefs();
  const { data: streak } = useStreak();

  const [shareToken, setShareToken] = useState<string | null>(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [isEtaReimportOpen, setIsEtaReimportOpen] = useState(false);
  const [notification, setNotification] = useState<Schedule | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [aiAction, setAiAction] = useState<string | null>(null);
  const [aiReview, setAiReview] = useState<{ title: string; reply: string } | null>(null);
  const [isAiChatOpen, setIsAiChatOpen] = useState(false);
  const [timetableView, setTimetableView] = useState<TimetableView>('day');
  const [dayOffset, setDayOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekScrollDate, setWeekScrollDate] = useState<string | null>(null);
  const [isIssueDialogOpen, setIsIssueDialogOpen] = useState(false);
  const [examForStudyBlocks, setExamForStudyBlocks] = useState<{ id: number; title: string; exam_date: string } | null>(null);
  const [examToDelete, setExamToDelete] = useState<ExamSchedule | null>(null);
  const [isFreeTimeDialogOpen, setIsFreeTimeDialogOpen] = useState(false);
  const [isRemainingDialogOpen, setIsRemainingDialogOpen] = useState(false);
  const [certSchedule, setCertSchedule] = useState<{ id: number; title: string } | null>(null);
  const { data: myGroups = [] } = useMyGroups();
  const etaScheduleCount = schedules.filter((s) => s.schedule_source === 'eta_import').length;
  const queryClient = useQueryClient();
  const timetableRef = useRef<HTMLDivElement | null>(null);

  // 온보딩 미완료 시 온보딩 페이지로 이동 (SSR에서 처리 안된 경우 fallback)
  useEffect(() => {
    if (profile && !profile.onboarding_completed) {
      router.replace('/onboarding');
    }
  }, [profile, router]);

  // Notification system (서버 prefs 기반 인앱 배너)
  const checkNotifications = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (!notifPrefs.reminder_start || !schedules.length) return;
    const notifMinutes = notifPrefs.reminder_minutes ?? 30;
    const now = new Date();
    const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const upcoming = schedules.find((s) => {
      if (s.is_completed) return false;
      if (!scheduleVisibleIn(s, 'day')) return false;
      const matchDay = s.date ? s.date === todayStr : recurringDayToIndex(s.recurring_day) === todayDow;
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
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    const examsTomorrow = exams.filter(e => e.exam_date === tomorrowStr);
    if (!examsTomorrow.length) return;

    const warnKey = `skema_exam_warn_${tomorrowStr}`;
    if (localStorage.getItem(warnKey)) return;
    localStorage.setItem(warnKey, '1');

    examsTomorrow.forEach(exam => {
      toast.warning(
        `내일 "${exam.title}" 시험이 있습니다`,
        { duration: 15000 },
      );
    });
  }, [exams]);

  // 오늘 할 일
  const now = new Date();
  const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekStart = getWeekStart(new Date(now.getFullYear(), now.getMonth(), now.getDate() + weekOffset * 7));
  const wakeStartTime = profile?.sleep_end || DEFAULT_WAKE_TIME;
  const wakeStartMinutes = getWakeStartMinutes(wakeStartTime);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  // 서버의 get_today_schedules와 동일한 중복 제거:
  // 반복 일정 + 오늘 날짜 일정을 합치되, 같은 title+start_time의 dated 인스턴스가 있으면 반복 일정은 제외
  const todaySpecific = schedules.filter((s) => scheduleVisibleIn(s, 'day') && s.date === todayStr);
  const todayRecurring = schedules.filter((s) => (
    scheduleVisibleIn(s, 'day') && !s.date && recurringDayToIndex(s.recurring_day) === todayDow
  ));
  const todaySpecificKeys = new Set(todaySpecific.map((s) => `${s.title}|${s.start_time}`));
  const todaySchedules = [
    ...todaySpecific,
    ...todayRecurring.filter((s) => !todaySpecificKeys.has(`${s.title}|${s.start_time}`)),
  ].sort(compareByWakeTime(wakeStartMinutes));


useEffect(() => {
  if (!timetableRef.current || todaySchedules.length === 0) return;

  const firstSchedule = todaySchedules[0];

  const startMinutes = timeToMinutes(firstSchedule.start_time);

  const hourHeight = 64;

  const scrollPosition = (startMinutes / 60) * hourHeight;

  timetableRef.current.scrollTop = Math.max(scrollPosition - 120, 0);
}, [todaySchedules]);
  
  const dayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
  const monthDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const monthLabel = `${monthDate.getFullYear()}년 ${monthDate.getMonth() + 1}월`;

  const getSchedulesForDate = (date: Date, target: TimetableView = 'day') => {
    const dateStr = toLocalDateString(date);
    const dow = getLocalDow(date);
    const isVisibleForTarget = (schedule: Schedule) =>
      scheduleVisibleIn(schedule, target) || (target === 'week' && schedule.schedule_type === 'study');
    const dated = schedules.filter((s) => isVisibleForTarget(s) && s.date === dateStr);
    const recurring = schedules.filter((s) => (
      isVisibleForTarget(s) && !s.date && recurringDayToIndex(s.recurring_day) === dow
    ));
    const datedKeys = new Set(dated.map((s) => `${s.title}|${s.start_time}`));

    return [
      ...dated,
      ...recurring.filter((s) => !datedKeys.has(`${s.title}|${s.start_time}`)),
    ].sort(compareByWakeTime(wakeStartMinutes));
  };

  const daySchedules = getSchedulesForDate(dayDate);
  const weekSchedules = schedules.filter((schedule) => scheduleVisibleIn(schedule, 'week') || schedule.schedule_type === 'study');
  const weekAgendaDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    const dateStr = toLocalDateString(date);
    return {
      date,
      dateStr,
      schedules: getSchedulesForDate(date, 'week'),
      exams: exams.filter((exam) => exam.exam_date === dateStr),
    };
  });
  const dayExams = exams.filter((exam) => exam.exam_date === toLocalDateString(dayDate));
  const dayFreeWindows = findFreeWindows(daySchedules, wakeStartMinutes).slice(0, 4);
  const dayConflictSchedules = getOverlappingSchedules(daySchedules);
  const isSelectedDayToday = toLocalDateString(dayDate) === todayStr;
  const selectedDayPrimarySchedule = (
    isSelectedDayToday
      ? daySchedules.find((s) => !s.is_completed && timeToMinutes(s.start_time) >= nowMin)
      : daySchedules.find((s) => !s.is_completed)
  ) ?? daySchedules[0] ?? null;

  // 오늘 수행률
  const todayTotal = todaySchedules.length;
  const todayDone  = todaySchedules.filter((s) => s.is_completed).length;
  const todayPct   = todayTotal > 0 ? Math.round((todayDone / todayTotal) * 100) : null;

  const remainingToday = todaySchedules.filter((s) => !s.is_completed);
  const todayFreeWindows = findFreeWindows(todaySchedules, wakeStartMinutes);
  const todayAvailableMinutes = todayFreeWindows.reduce(
    (sum, window) => sum + Math.max(0, window.end - window.start),
    0,
  );
  const overdueSchedules = todaySchedules.filter((schedule) => (
    !schedule.is_completed && timeToMinutes(schedule.end_time) < nowMin
  ));
  const todayConflictSchedules = getOverlappingSchedules(todaySchedules);
  const upcomingExams = exams
    .filter((e) => {
      const [y, m, d] = e.exam_date.split('-').map(Number);
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
    Math.ceil((new Date(`${date}T00:00:00`).getTime() - new Date(`${todayStr}T00:00:00`).getTime()) / 86400000);
  const formatDday = (days: number) => (days <= 0 ? 'D-day' : `D-${days}`);
  const todayLabel = formatLongDate(now);
  const weekEndDate = new Date(weekStart);
  weekEndDate.setDate(weekStart.getDate() + 6);
  const weekLabel = `${weekStart.getMonth() + 1}.${weekStart.getDate()} - ${weekEndDate.getMonth() + 1}.${weekEndDate.getDate()}`;
  const currentViewLabel =
    timetableView === 'day' ? formatLongDate(dayDate) :
    timetableView === 'week' ? weekLabel :
    monthLabel;
  // 에타 시간표 업로드는 대학생 전용 기능 → 비대학생에겐 "시간표 인식 필요" 안내를 띄우지 않는다
  const needsTimetableUpload = profile?.is_college_student === true && (schedules.length === 0 || etaScheduleCount === 0);
  const examNeedsAttention = upcomingExam ? getDaysUntil(upcomingExam.exam_date) <= 7 : false;
  const issueItems: IssueItem[] = [
    ...(todayConflictSchedules.length
      ? [{
          key: 'conflicts',
          label: '겹친 일정',
          value: `${todayConflictSchedules.length}개`,
          detail: todayConflictSchedules.map(({ schedule }) => schedule.title).join(', '),
          tone: 'red',
        }]
      : []),
    ...(overdueSchedules.length
      ? [{
          key: 'overdue',
          label: '지나간 미완료',
          value: `${overdueSchedules.length}개`,
          detail: overdueSchedules.map((schedule) => schedule.title).slice(0, 2).join(', '),
          tone: 'amber',
        }]
      : []),
    ...(needsTimetableUpload
      ? [{
          key: 'eta',
          label: '시간표 인식',
          value: '필요',
          detail: '이미지를 올리면 수업 시간표를 빠르게 채울 수 있습니다',
          tone: 'blue',
        }]
      : []),
    ...(examNeedsAttention
      ? [{
          key: 'exam',
          label: '시험 준비',
          value: formatDday(getDaysUntil(upcomingExam!.exam_date)),
          detail: `${upcomingExam!.title} 준비 시간을 빈 시간에 배치해보세요`,
          tone: 'blue',
        }]
      : []),
  ];
  const issueCount = issueItems.length;
  /** AI 액션 후 관련 모든 쿼리 무효화 */
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['schedules'] });
    queryClient.invalidateQueries({ queryKey: ['exams'] });
  };

  const runAiCommand = async (action: string, message: string, successMessage: string) => {
    setAiAction(action);
    if (action === 'reschedule') setIsRegenerating(true);
    try {
      const { data } = await api.post<{ reply: string }>('/ai/chat', {
        message,
        messages: [],
      });
      invalidateAll();
      toast.success(data.reply.trim() ? successMessage : 'AI 작업이 완료되었습니다');
      setAiReview({
        title: successMessage,
        reply: data.reply.trim() || 'AI 작업이 완료되었습니다.',
      });
    } catch {
      toast.error('AI 작업 중 오류가 발생했습니다');
    } finally {
      setAiAction(null);
      if (action === 'reschedule') setIsRegenerating(false);
    }
  };

  const handleReschedule = async () => {
    setIsRegenerating(true);
    try {
      const { data } = await api.post<{ moved: number; today_tasks: { id: number; title: string }[] }>(
        '/schedules/collect-incomplete',
      );
      invalidateAll();
      if (data.moved > 0) {
        toast.success(`미완료 일정 ${data.moved}개를 오늘 할 일로 옮겼습니다`);
      } else if (data.today_tasks.length > 0) {
        toast.success(`오늘 할 일 ${data.today_tasks.length}개가 있습니다`);
      } else {
        toast.success('미완료 일정이 없습니다');
      }
    } catch {
      toast.error('오류가 발생했습니다');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleLogout = () => {
    logout();
    queryClient.clear();
    toast.success('로그아웃 되었습니다');
    window.location.replace('/login');
  };

  const handleShare = async () => {
    openShareModal();
    if (shareToken) return;
    setIsGeneratingShare(true);
    try {
      const { data } = await api.post<{ token: string }>('/share-tokens', {});
      setShareToken(data.token);
    } catch {
      toast.error('공유 링크 생성 중 오류가 발생했습니다');
    } finally {
      setIsGeneratingShare(false);
    }
  };

  const shareUrl = shareToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/share/${shareToken}`
    : '';

  const copyShareUrl = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      toast.success('링크가 복사되었습니다');
    }
  };

  const moveCalendar = (direction: -1 | 1) => {
    if (timetableView === 'day') setDayOffset((offset) => offset + direction);
    if (timetableView === 'week') setWeekOffset((offset) => offset + direction);
    if (timetableView === 'month') setMonthOffset((offset) => offset + direction);
  };

  const showDayViewForDate = (date: Date) => {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((date.getTime() - today.getTime()) / 86400000);
    setDayOffset(diff);
    setTimetableView('day');
  };

  const showWeekViewForDate = (date: Date) => {
    const todayWeekStart = getWeekStart(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    const targetWeekStart = getWeekStart(date);
    const diffWeeks = Math.round((targetWeekStart.getTime() - todayWeekStart.getTime()) / (7 * 86400000));
    setWeekOffset(diffWeeks);
    setWeekScrollDate(toLocalDateString(date));
    setTimetableView('week');
  };

  const resetCalendar = () => {
    setDayOffset(0);
    setWeekOffset(0);
    setMonthOffset(0);
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
      schedules: getSchedulesForDate(date, 'month'),
      exams: exams.filter((exam) => exam.exam_date === dateStr),
    };
  });
  const currentViewScheduleCount =
    timetableView === 'day' ? daySchedules.length :
    timetableView === 'week' ? weekSchedules.length :
    monthDays.reduce((count, date) => {
      if (date.getMonth() !== monthDate.getMonth()) return count;
      return count + getSchedulesForDate(date, 'month').length;
    }, 0);

  return (
    <>
      <DashboardStyles />
      <div className="flex h-screen flex-col bg-[#f8f9ff]">
        <NotificationBanner
          notification={notification}
          onOpen={(schedule) => {
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
          onOpenProfile={() => router.push('/profile')}
          onOpenAdminUsers={() => router.push('/admin/users')}
          onOpenAdminLogs={() => router.push('/admin/login-logs')}
          onLogout={handleLogout}
          onAddSchedule={() => openClassForm()}
          onOpenSetlog={() => router.push('/log')}
          onReschedule={handleReschedule}
          onUploadTimetable={() => setIsEtaReimportOpen(true)}
          isRegenerating={isRegenerating}
        />

        <main className="min-h-0 flex-1 overflow-y-auto bg-[#f8f9ff] p-3">
          <div className="flex w-full flex-col gap-3">
            <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
              <div className="flex min-w-0 flex-col rounded-2xl border border-blue-100 bg-sky-50 p-4 shadow-[0_10px_30px_-5px_rgba(0,82,255,0.08)]">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-blue-600">{todayLabel}</p>
                    <h1 className="mt-1 text-2xl font-black text-slate-950 sm:text-3xl">
                      내 시간표
                    </h1>
                    <p className="mt-1 text-sm font-bold text-slate-500">
                      {currentViewLabel} · 표시 {currentViewScheduleCount}개 일정 · 에타 {etaScheduleCount}개
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex rounded-lg border border-blue-100 bg-blue-50/70 p-1">
                      {VIEW_LABELS.map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => setTimetableView(key)}
                          className={`rounded-md px-3 py-1.5 text-xs font-black transition ${
                            timetableView === key
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'text-slate-600 hover:bg-white'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      className="rounded-lg border border-blue-100 p-2 transition hover:bg-blue-50"
                      onClick={() => moveCalendar(-1)}
                      aria-label="이전"
                    >
                      <MaterialIcon icon="chevron_left" size={18} color="#2563eb" />
                    </button>
                    <button
                      className="rounded-lg border border-blue-100 px-4 py-2 text-xs font-black text-blue-700 transition hover:bg-blue-50"
                      onClick={resetCalendar}
                    >
                      오늘
                    </button>
                    <button
                      className="rounded-lg border border-blue-100 p-2 transition hover:bg-blue-50"
                      onClick={() => moveCalendar(1)}
                      aria-label="다음"
                    >
                      <MaterialIcon icon="chevron_right" size={18} color="#2563eb" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex-1 overflow-hidden rounded-2xl border border-blue-100 bg-sky-50 sm:mt-5 sm:min-h-[calc(100vh-170px)]">
                  {timetableView === 'week' && (
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
                      onScrollToDate={(date) =>
                        setWeekScrollDate(toLocalDateString(date))
                      }
                      onShowDayView={showDayViewForDate}
                      scrollToDateStr={weekScrollDate}
                      onScrollConsumed={() => setWeekScrollDate(null)}
                    />
                  )}

                  {timetableView === 'day' && (
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
                      runAiCommand={runAiCommand}
                      aiAction={aiAction}
                      showWeekViewForDate={showWeekViewForDate}
                      getDisplayColor={getDisplayColor}
                      formatDuration={formatDuration}
                      formatMinutesDuration={formatMinutesDuration}
                      setExamForStudyBlocks={setExamForStudyBlocks}
                      setIsFreeTimeDialogOpen={setIsFreeTimeDialogOpen}
                      selectedDayPrimarySchedule={selectedDayPrimarySchedule}
                      openClassForm={openClassForm}
                      isSelectedDayToday={isSelectedDayToday}
                      setIsRemainingDialogOpen={setIsRemainingDialogOpen}
                      issueCount={issueCount}
                      setIsIssueDialogOpen={setIsIssueDialogOpen}
                      issueItems={issueItems}
                      toggleComplete={toggleComplete}
                      setCertSchedule={setCertSchedule}
                    />
                  )}
                  {timetableView === 'month' && (
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
                  getDaysUntil={getDaysUntil}
                  onExamClick={(exam) =>
                    setExamForStudyBlocks({
                      id: exam.id,
                      title: exam.title,
                      exam_date: exam.exam_date,
                    })
                  }
                />
                <AiActions
                  weekStart={weekStart}
                  weekAgendaDays={weekAgendaDays}
                  todayStr={todayStr}
                  upcomingExams={upcomingExams}
                  getDaysUntil={getDaysUntil}
                  timeToMinutes={timeToMinutes}
                  runAiCommand={runAiCommand}
                  aiAction={aiAction}
                />
              </aside>

            </section>

          </div>
        </main>
      </div>

      <FloatingAIChat open={isAiChatOpen} onOpenChange={setIsAiChatOpen} />

      {aiReview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
          <section className="w-full max-w-lg overflow-hidden rounded-lg border border-blue-100 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-blue-50 p-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-600">
                  <MaterialIcon icon="auto_awesome" size={21} color="#fff" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-black text-blue-600">AI 변경 결과</p>
                  <h2 className="mt-1 text-xl font-black text-slate-950">{aiReview.title}</h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAiReview(null)}
                className="rounded-lg p-2 transition hover:bg-blue-50"
                aria-label="닫기"
              >
                <MaterialIcon icon="close" size={20} color="#0f172a" />
              </button>
            </div>

            <div className="max-h-[50vh] overflow-y-auto p-5">
              <div className="rounded-lg border border-blue-100 bg-[#fbfdff] p-4 text-sm font-bold leading-7 text-slate-700 whitespace-pre-wrap">
                {aiReview.reply}
              </div>
              <p className="mt-3 text-xs font-bold text-slate-500">
                반영된 내용이 맞는지 시간표에서 확인하고, 더 수정할 부분은 AI에게 이어서 요청하세요.
              </p>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-blue-50 p-4">
              <button
                type="button"
                onClick={() => setAiReview(null)}
                className="rounded-lg border border-blue-100 px-4 py-2.5 text-sm font-black text-slate-600 transition hover:bg-blue-50"
              >
                확인
              </button>
              <button
                type="button"
                onClick={() => {
                  setAiReview(null);
                  setIsAiChatOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-blue-700"
              >
                <MaterialIcon icon="chat" size={16} color="#fff" />
                AI에게 추가 수정
              </button>
            </div>
          </section>
        </div>
      )}

      <Dialog open={isRemainingDialogOpen} onOpenChange={setIsRemainingDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>오늘 남은 일정</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            {remainingToday.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                <span className="truncate text-sm font-black text-slate-950 mr-2">{s.title}</span>
                <span className="shrink-0 text-xs font-bold text-slate-400">{s.start_time}–{s.end_time}</span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <FreeTimeDialog
        open={isFreeTimeDialogOpen}
        onOpenChange={setIsFreeTimeDialogOpen}
        windows={todayFreeWindows}
        totalAvailableMinutes={todayAvailableMinutes}
        minutesToTime={minutesToTime}
        formatDuration={formatDuration}
        formatMinutesDuration={formatMinutesDuration}
        aiAction={aiAction}
        runAiCommand={runAiCommand}
      />
      <StudyBlockDialog
        exam={examForStudyBlocks}
        onExamChange={setExamForStudyBlocks}
        getDaysUntil={getDaysUntil}
        aiAction={aiAction}
        runAiCommand={runAiCommand}
        exams={exams}
        onDeleteExam={setExamToDelete}
      />
      <DeleteExamDialog
        exam={examToDelete}
        onExamChange={setExamToDelete}
      />
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
