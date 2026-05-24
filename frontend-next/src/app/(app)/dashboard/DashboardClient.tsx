'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Timetable, getWeekStart } from '@/components/timetable/Timetable';
import { ClassForm } from '@/components/class-form/ClassForm';
import { useSchedules } from '@/hooks/useSchedules';
import { useExams } from '@/hooks/useExams';
import { useProfile } from '@/hooks/useProfile';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/lib/api';
import { recurringDayToIndex } from '@/lib/recurringDay';
import { scheduleVisibleIn } from '@/lib/scheduleViewScope';
import { minutesToTime, timeToMinutes } from '@/lib/utils';
import MaterialIcon from '@/components/common/MaterialIcon';
import { Schedule, UserProfile } from '@/types';
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

const getLocalDow = (date: Date) => {
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
};

const formatLongDate = (date: Date) =>
  new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date);

const DEFAULT_WAKE_TIME = '07:00';
const DAY_END_MINUTES = 24 * 60;
const AGENDA_PERIODS = [
  { key: 'morning', label: '오전', icon: 'wb_sunny' },
  { key: 'afternoon', label: '오후', icon: 'light_mode' },
  { key: 'evening', label: '저녁', icon: 'nights_stay' },
] as const;

type StatusCardTone = 'blue' | 'slate' | 'green' | 'amber';

const STATUS_CARD_TONES: Record<StatusCardTone, {
  border: string;
  iconColor: string;
}> = {
  blue: {
    border: 'border-l-blue-500',
    iconColor: '#2563eb',
  },
  slate: {
    border: 'border-l-slate-300',
    iconColor: '#64748b',
  },
  green: {
    border: 'border-l-emerald-500',
    iconColor: '#059669',
  },
  amber: {
    border: 'border-l-amber-500',
    iconColor: '#d97706',
  },
};

function StatusSummaryCard({
  label,
  value,
  detail,
  icon,
  tone = 'slate',
}: {
  label: string;
  value: string;
  detail: string;
  icon: string;
  tone?: StatusCardTone;
}) {
  const toneClass = STATUS_CARD_TONES[tone];

  return (
    <section className={`min-w-0 border-l-4 py-1 pl-3 pr-2 text-left ${toneClass.border}`}>
      <div className="flex items-center gap-1.5">
        <MaterialIcon icon={icon} size={13} color={toneClass.iconColor} />
        <p className="truncate text-[11px] font-black text-slate-500">{label}</p>
      </div>
      <p className="mt-1 truncate text-base font-black text-slate-950">{value}</p>
      <p className="truncate text-[11px] font-bold text-slate-400">{detail}</p>
    </section>
  );
}

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

const getAgendaPeriod = (schedule: Schedule) => {
  const start = timeToMinutes(schedule.start_time);
  if (start < 12 * 60) return 'morning';
  if (start < 18 * 60) return 'afternoon';
  return 'evening';
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
  const { data: profile } = useProfile(initialProfile ?? undefined);

  const [shareToken, setShareToken] = useState<string | null>(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [isEtaReimportOpen, setIsEtaReimportOpen] = useState(false);
  const [notification, setNotification] = useState<Schedule | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [aiAction, setAiAction] = useState<string | null>(null);
  const [aiReview, setAiReview] = useState<{ title: string; reply: string } | null>(null);
  const [isAiChatOpen, setIsAiChatOpen] = useState(false);
  const [timetableView, setTimetableView] = useState<TimetableView>('week');
  const [dayOffset, setDayOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const etaScheduleCount = schedules.filter((s) => s.schedule_source === 'eta_import').length;
  const queryClient = useQueryClient();
  const timetableRef = useRef<HTMLDivElement | null>(null);

  // 온보딩 미완료 시 온보딩 페이지로 이동 (SSR에서 처리 안된 경우 fallback)
  useEffect(() => {
    if (profile && !profile.onboarding_completed) {
      router.replace('/onboarding');
    }
  }, [profile, router]);

  // Notification system
  const checkNotifications = useCallback(() => {
    if (typeof window === 'undefined') return;
    const notifEnabled = localStorage.getItem('skema_notif_enabled') !== 'false';
    if (!notifEnabled || !schedules.length) return;
    const notifMinutes = parseInt(localStorage.getItem('skema_notif_minutes') || '30', 10);
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
  }, [schedules]);

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

  const getSchedulesForDate = (date: Date, target: 'day' | 'month' = 'day') => {
    const dateStr = toLocalDateString(date);
    const dow = getLocalDow(date);
    const dated = schedules.filter((s) => scheduleVisibleIn(s, target) && s.date === dateStr);
    const recurring = schedules.filter((s) => (
      scheduleVisibleIn(s, target) && !s.date && recurringDayToIndex(s.recurring_day) === dow
    ));
    const datedKeys = new Set(dated.map((s) => `${s.title}|${s.start_time}`));

    return [
      ...dated,
      ...recurring.filter((s) => !datedKeys.has(`${s.title}|${s.start_time}`)),
    ].sort(compareByWakeTime(wakeStartMinutes));
  };

  const daySchedules = getSchedulesForDate(dayDate);
  const weekSchedules = schedules.filter((schedule) => scheduleVisibleIn(schedule, 'week'));
  const dayExams = exams.filter((exam) => exam.exam_date === toLocalDateString(dayDate));
  const dayFreeWindows = findFreeWindows(daySchedules, wakeStartMinutes).slice(0, 4);
  const dayConflictSchedules = getOverlappingSchedules(daySchedules);
  const isSelectedDayToday = toLocalDateString(dayDate) === todayStr;
  const selectedDayPrimarySchedule = (
    isSelectedDayToday
      ? daySchedules.find((s) => !s.is_completed && timeToMinutes(s.start_time) >= nowMin)
      : daySchedules.find((s) => !s.is_completed)
  ) ?? daySchedules[0] ?? null;
  const agendaByPeriod = AGENDA_PERIODS.map((period) => ({
    ...period,
    schedules: daySchedules.filter((schedule) => getAgendaPeriod(schedule) === period.key),
  }));

  // 오늘 수행률
  const todayTotal = todaySchedules.length;
  const todayDone  = todaySchedules.filter((s) => s.is_completed).length;
  const todayPct   = todayTotal > 0 ? Math.round((todayDone / todayTotal) * 100) : null;

  const remainingToday = todaySchedules.filter((s) => !s.is_completed);
  const nextSchedule = remainingToday.find((s) => timeToMinutes(s.start_time) >= nowMin) ?? remainingToday[0] ?? null;
  const todayFreeWindows = findFreeWindows(todaySchedules, wakeStartMinutes);
  const todayAvailableMinutes = todayFreeWindows.reduce(
    (sum, window) => sum + Math.max(0, window.end - window.start),
    0,
  );
  const longestFreeWindow = todayFreeWindows.reduce<{ start: number; end: number } | null>(
    (longest, window) => {
      if (!longest) return window;
      return window.end - window.start > longest.end - longest.start ? window : longest;
    },
    null,
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
  const getDaysUntil = (date: string) =>
    Math.ceil((new Date(`${date}T00:00:00`).getTime() - new Date(`${todayStr}T00:00:00`).getTime()) / 86400000);
  const formatDday = (days: number) => (days <= 0 ? 'D-day' : `D-${days}`);
  const todayLabel = new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(now);
  const weekEndDate = new Date(weekStart);
  weekEndDate.setDate(weekStart.getDate() + 6);
  const weekLabel = `${weekStart.getMonth() + 1}.${weekStart.getDate()} - ${weekEndDate.getMonth() + 1}.${weekEndDate.getDate()}`;
  const currentViewLabel =
    timetableView === 'day' ? formatLongDate(dayDate) :
    timetableView === 'week' ? weekLabel :
    monthLabel;
  const needsTimetableUpload = schedules.length === 0 || etaScheduleCount === 0;
  const examNeedsAttention = upcomingExam ? getDaysUntil(upcomingExam.exam_date) <= 7 : false;
  const issueItems = [
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
  const situationAiActions = [
    {
      key: 'free-plan',
      label: '오늘 빈 시간 활용',
      desc: `${formatMinutesDuration(todayAvailableMinutes)} 안에 할 일을 배치`,
      icon: 'schedule',
      onClick: () => runAiCommand(
        'free-plan',
        '오늘 시간표의 빈 시간을 분석해서 지금 할 수 있는 일과 배치하면 좋은 일정을 추천해줘',
        '오늘 빈 시간 활용안을 정리했습니다',
      ),
    },
    {
      key: 'issues',
      label: issueCount > 0 ? '확인 필요 정리' : '오늘 일정 점검',
      desc: issueCount > 0 ? `${issueCount}개 항목을 AI로 점검` : '겹침과 미완료를 확인',
      icon: 'warning',
      onClick: () => runAiCommand(
        'issues',
        '오늘 시간표에서 겹친 일정, 지나간 미완료 일정, 확인해야 할 항목을 점검하고 해결 방법을 제안해줘',
        '확인 필요 항목을 점검했습니다',
      ),
    },
    {
      key: upcomingExam ? 'exam-plan' : 'tomorrow',
      label: upcomingExam ? '시험 준비 배치' : '내일 준비하기',
      desc: upcomingExam ? `${upcomingExam.title} 기준` : '내일 필요한 일 확인',
      icon: upcomingExam ? 'quiz' : 'tips_and_updates',
      onClick: () => runAiCommand(
        upcomingExam ? 'exam-plan' : 'tomorrow',
        upcomingExam
          ? '다가오는 시험 일정과 현재 시간표를 보고 시험 준비 학습 일정을 빈 시간에 자동으로 생성해줘'
          : '내일 시간표와 오늘 남은 일정을 보고 미리 준비해야 할 일을 정리해줘',
        upcomingExam ? '시험 준비 일정을 시간표에 반영했습니다' : '내일 준비할 일을 정리했습니다',
      ),
    },
  ];

  /** AI 액션 후 관련 모든 쿼리 무효화 */
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['schedules'] });
    queryClient.invalidateQueries({ queryKey: ['schedules', 'today'] });
    queryClient.invalidateQueries({ queryKey: ['schedules', 'conflicts'] });
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
    setAiAction('reschedule');
    setIsRegenerating(true);
    try {
      const { data } = await api.post<{ reply: string }>('/ai/chat', {
        message: '미완료 일정을 오늘 이후 빈 시간에 자동으로 재배치해줘',
        messages: [],
      });
      invalidateAll();
      toast.success(data.reply.includes('재배치했습니다') ? '일정이 재배치되었습니다' : '재배치 완료');
      setAiReview({
        title: '일정 재배치 결과',
        reply: data.reply.trim() || '미완료 일정을 빈 시간 기준으로 재배치했습니다.',
      });
    } catch {
      toast.error('재배치 중 오류가 발생했습니다');
    } finally {
      setAiAction(null);
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
          onReschedule={handleReschedule}
          onUploadTimetable={() => setIsEtaReimportOpen(true)}
          isRegenerating={isRegenerating}
        />

        <main className="min-h-0 flex-1 overflow-y-auto bg-[#f8f9ff] p-4 sm:p-5">
          <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="flex min-w-0 flex-col rounded-2xl border border-blue-100 bg-white p-6 shadow-[0_10px_30px_-5px_rgba(0,82,255,0.08)]">
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

                <div className="mt-5 min-h-[calc(100vh-170px)] flex-1 overflow-hidden rounded-2xl border border-blue-100 bg-white">
                  {timetableView === 'week' && (
                    <div
                      ref={timetableRef}
                      className="max-h-[calc(100vh-220px)] overflow-y-auto"
                    >
                      <Timetable schedules={weekSchedules} exams={exams} weekStart={weekStart} startTime="00:00" />
                    </div>
                  )}

                  {timetableView === 'day' && (
                    <div className="h-full overflow-y-auto bg-[#f8fbff] p-4">
                      <div className="mb-4 rounded-lg border border-blue-100 bg-white p-4 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-black text-blue-600">하루 진행표</p>
                            <h2 className="mt-1 text-2xl font-black text-slate-950">
                              {formatLongDate(dayDate)}
                            </h2>
                            <p className="mt-1 text-sm font-bold text-slate-500">
                              {minutesToTime(wakeStartMinutes)} 기상 기준 · 일정 {daySchedules.length}개 · 빈 시간 {dayFreeWindows.length}개
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => runAiCommand(
                              'today-plan',
                              '선택한 하루 시간표를 기준으로 오늘 해야 할 일, 빈 시간 활용, 겹침 여부를 정리해줘',
                              '하루 시간표를 정리했습니다',
                            )}
                            disabled={aiAction !== null}
                            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"
                          >
                            <MaterialIcon icon="smart_toy" size={18} color="#fff" />
                            {aiAction === 'today-plan' ? '정리 중...' : 'AI에게 오늘 정리 맡기기'}
                          </button>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                          <button
                            type="button"
                            onClick={() => selectedDayPrimarySchedule ? openClassForm(selectedDayPrimarySchedule) : openClassForm()}
                            className="rounded-lg border border-blue-100 bg-blue-50/70 p-4 text-left transition hover:border-blue-300 hover:bg-blue-50"
                          >
                            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white">
                              <MaterialIcon icon="event" size={18} color="#2563eb" />
                            </span>
                            <span className="mt-3 block text-xs font-black text-blue-600">
                              {isSelectedDayToday ? '다음 일정' : '첫 일정'}
                            </span>
                            <span className="mt-1 block truncate text-base font-black text-slate-950">
                              {selectedDayPrimarySchedule ? selectedDayPrimarySchedule.title : '일정이 없습니다'}
                            </span>
                            <span className="mt-1 block truncate text-xs font-bold text-slate-500">
                              {selectedDayPrimarySchedule
                                ? `${selectedDayPrimarySchedule.start_time}-${selectedDayPrimarySchedule.end_time}${selectedDayPrimarySchedule.location ? ` · ${selectedDayPrimarySchedule.location}` : ''}`
                                : '직접 추가하거나 AI에게 요청하세요'}
                            </span>
                          </button>

                          <div className="rounded-lg border border-blue-100 bg-white p-4 text-left shadow-sm">
                            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
                              <MaterialIcon icon="schedule" size={18} color="#2563eb" />
                            </span>
                            <span className="mt-3 block text-xs font-black text-blue-600">가장 가까운 빈 시간</span>
                            <span className="mt-1 block truncate text-base font-black text-slate-950">
                              {dayFreeWindows[0]
                                ? `${minutesToTime(dayFreeWindows[0].start)}-${minutesToTime(dayFreeWindows[0].end)}`
                                : '빈 시간이 없습니다'}
                            </span>
                            <span className="mt-1 block truncate text-xs font-bold text-slate-500">
                              {dayFreeWindows[0]
                                ? `${formatDuration(dayFreeWindows[0].start, dayFreeWindows[0].end)} 활용 가능`
                                : '일정을 조정하면 확보할 수 있습니다'}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={handleReschedule}
                            disabled={aiAction !== null}
                            className="flex items-center gap-2 rounded-lg bg-blue-50 px-5 py-2 text-sm font-bold text-slate-900 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <MaterialIcon icon="auto_awesome" size={16} color="#2563eb" />
                            {isRegenerating ? '정리 중입니다' : 'AI 재배치'}
                          </button>
                        </div>
                      </div>

                      {dayExams.length > 0 && (
                        <div className="mb-3 space-y-2">
                          {dayExams.map((exam) => (
                            <div
                              key={exam.id}
                              className="flex w-full items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left"
                            >
                              <span>
                                <span className="block text-sm font-black text-amber-950">{exam.title}</span>
                                <span className="text-xs font-bold text-amber-700">
                                  {exam.exam_time || '시간 미정'}{exam.location ? ` · ${exam.location}` : ''}
                                </span>
                              </span>
                              <MaterialIcon icon="quiz" size={18} color="#d97706" />
                            </div>
                          ))}
                        </div>
                      )}

                      {dayConflictSchedules.length > 0 && (
                        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-4">
                          <div className="flex items-start gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white">
                              <MaterialIcon icon="warning" size={18} color="#dc2626" />
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-black text-red-900">겹치는 일정이 있습니다</p>
                              <p className="mt-1 text-xs font-bold text-red-700">
                                {dayConflictSchedules.map(({ schedule }) => schedule.title).join(', ')}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {daySchedules.length === 0 && dayExams.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-blue-100 bg-white p-10 text-center shadow-sm">
                          <MaterialIcon icon="calendar_month" size={42} color="#93c5fd" />
                          <p className="mt-3 text-lg font-black text-slate-950">이 날은 비어 있습니다</p>
                          <p className="mt-1 text-sm font-bold text-slate-500">직접 일정을 추가하거나 AI에게 빈 시간을 채워달라고 요청하세요.</p>
                            <div className="mt-5 flex flex-wrap justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => openClassForm()}
                              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-blue-400 px-5 py-2 text-sm font-bold text-white shadow-sm hover:opacity-90"
                            >
                              <MaterialIcon icon="add" size={16} color="#fff" />
                              일정 추가
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                          <section className="space-y-3">
                            {agendaByPeriod.map((period) => (
                              <div key={period.key} className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm">
                                <div className="mb-3 flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
                                      <MaterialIcon icon={period.icon} size={17} color="#2563eb" />
                                    </span>
                                    <h3 className="text-base font-black text-slate-950">{period.label}</h3>
                                  </div>
                                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">
                                    {period.schedules.length}개
                                  </span>
                                </div>

                                {period.schedules.length === 0 ? (
                                  <div className="rounded-lg border border-dashed border-blue-100 bg-[#fbfdff] p-4 text-sm font-bold text-slate-400">
                                    이 시간대에는 일정이 없습니다
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {period.schedules.map((schedule) => {
                                      const start = timeToMinutes(schedule.start_time);
                                      const end = timeToMinutes(schedule.end_time);
                                      return (
                                        <button
                                          key={schedule.id}
                                          type="button"
                                          onClick={() => openClassForm(schedule)}
                                          className="w-full rounded-lg border border-blue-50 bg-[#fbfdff] p-4 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
                                          style={{ borderLeft: `5px solid ${schedule.color || '#2563eb'}` }}
                                        >
                                          <span className="flex flex-wrap items-center justify-between gap-2">
                                            <span className="min-w-0">
                                              <span className="block truncate text-base font-black text-slate-950">{schedule.title}</span>
                                              <span className="mt-1 block truncate text-xs font-bold text-slate-500">
                                                {schedule.location || schedule.schedule_type}
                                              </span>
                                            </span>
                                            <span className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-black text-blue-700">
                                              {schedule.start_time}-{schedule.end_time}
                                            </span>
                                          </span>
                                          <span className="mt-3 block text-xs font-bold text-slate-400">
                                            {formatDuration(start, end)}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            ))}
                          </section>

                          <aside className="space-y-3">
                            <section className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm">
                              <div className="mb-3 flex items-center gap-2">
                                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
                                  <MaterialIcon icon="free_cancellation" size={17} color="#2563eb" />
                                </span>
                                <h3 className="text-base font-black text-slate-950">빈 시간</h3>
                              </div>

                              {dayFreeWindows.length === 0 ? (
                                <p className="rounded-lg border border-dashed border-blue-100 bg-[#fbfdff] p-4 text-sm font-bold text-slate-500">
                                  확보된 빈 시간이 없습니다.
                                </p>
                              ) : (
                                <div className="space-y-2">
                                  {dayFreeWindows.map((window) => (
                                    <div
                                      key={`${window.start}-${window.end}`}
                                      className="w-full rounded-lg border border-blue-50 bg-[#fbfdff] p-3 text-left"
                                    >
                                      <span className="block text-sm font-black text-slate-950">
                                        {minutesToTime(window.start)}-{minutesToTime(window.end)}
                                      </span>
                                      <span className="mt-1 block text-xs font-bold text-blue-700">
                                        {formatDuration(window.start, window.end)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={() => runAiCommand(
                                  'free-plan',
                                  '선택한 날짜의 빈 시간을 분석해서 활용하면 좋은 일정이나 할 일을 추천해줘',
                                  '빈 시간 활용안을 정리했습니다',
                                )}
                                disabled={aiAction !== null}
                                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 text-xs font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <MaterialIcon icon="smart_toy" size={15} color="#fff" />
                                {aiAction === 'free-plan' ? '추천 중...' : '빈 시간 활용 추천'}
                              </button>
                            </section>

                            <section className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm">
                              <div className="mb-3 flex items-center gap-2">
                                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
                                  <MaterialIcon icon="tips_and_updates" size={17} color="#2563eb" />
                                </span>
                                <h3 className="text-base font-black text-slate-950">AI로 바로 할 수 있는 일</h3>
                              </div>
                              <div className="space-y-2">
                                {situationAiActions.map((action) => (
                                  <button
                                    key={action.key}
                                    type="button"
                                    onClick={action.onClick}
                                    disabled={aiAction !== null}
                                    className="w-full rounded-lg border border-blue-50 bg-[#fbfdff] px-3 py-2 text-left text-xs font-black text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {aiAction === action.key ? 'AI 처리 중...' : action.label}
                                  </button>
                                ))}
                              </div>
                            </section>
                          </aside>
                        </div>
                      )}
                    </div>
                  )}

                  {timetableView === 'month' && (
                    <div className="h-full overflow-y-auto bg-white p-4">
                      <div className="mb-3 flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50/70 px-4 py-3">
                        <span className="text-sm font-black text-slate-950">{monthLabel}</span>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-blue-700">
                          {minutesToTime(wakeStartMinutes)} 기준
                        </span>
                      </div>
                      <div className="mb-3 grid grid-cols-7 gap-2 text-center text-xs font-black text-slate-500">
                        {['월', '화', '수', '목', '금', '토', '일'].map((day) => (
                          <div key={day} className="rounded-md bg-blue-50 py-2">{day}</div>
                        ))}
                      </div>
                      <div className="grid min-h-[540px] grid-cols-7 gap-2">
                        {monthDays.map((date) => {
                          const dateStr = toLocalDateString(date);
                          const items = getSchedulesForDate(date, 'month');
                          const dayExamCount = exams.filter((exam) => exam.exam_date === dateStr).length;
                          const isToday = dateStr === todayStr;
                          const isCurrentMonth = date.getMonth() === monthDate.getMonth();

                          return (
                            <button
                              key={dateStr}
                              onClick={() => {
                                const diff = Math.round((date.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
                                setDayOffset(diff);
                                setTimetableView('day');
                              }}
                              className={`min-h-[112px] rounded-lg border p-2 text-left transition hover:border-blue-300 hover:bg-blue-50 ${
                                isToday
                                  ? 'border-blue-500 bg-blue-50'
                                  : isCurrentMonth
                                    ? 'border-blue-100 bg-white'
                                    : 'border-slate-100 bg-slate-50/70 opacity-60'
                              }`}
                            >
                              <div className="mb-2 flex items-center justify-between">
                                <span className={`text-xs font-black ${isToday ? 'text-blue-700' : 'text-slate-600'}`}>
                                  {date.getDate()}
                                </span>
                                {dayExamCount > 0 && (
                                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700">
                                    시험
                                  </span>
                                )}
                              </div>
                              <div className="space-y-1">
                                {items.slice(0, 3).map((schedule) => (
                                  <span
                                    key={`${dateStr}-${schedule.id}`}
                                    className="block truncate rounded bg-blue-600/10 px-1.5 py-1 text-[10px] font-bold text-blue-800"
                                  >
                                    {schedule.start_time} {schedule.title}
                                  </span>
                                ))}
                                {items.length > 3 && (
                                  <span className="block text-[10px] font-black text-slate-400">
                                    +{items.length - 3}개
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <aside className="flex min-w-0 flex-col gap-6 xl:sticky xl:top-20 xl:max-h-[calc(100vh-100px)] xl:overflow-y-auto">
                <div className="rounded-2xl border border-blue-100 bg-white p-6 shadow-[0_10px_30px_-5px_rgba(0,82,255,0.08)]">
                  <p className="mb-2 text-[11px] font-black text-slate-400">오늘 현황</p>
                  <div className="grid grid-cols-2 gap-2">
                    <StatusSummaryCard
                      label="다음 일정"
                      value={nextSchedule ? nextSchedule.title : '없음'}
                      detail={nextSchedule
                        ? `${nextSchedule.start_time}-${nextSchedule.end_time}`
                        : '오늘 남은 일정 없음'}
                      icon="event_available"
                      tone="blue"
                    />
                    <StatusSummaryCard
                      label="오늘 빈 시간"
                      value={formatMinutesDuration(todayAvailableMinutes)}
                      detail={`최장 ${longestFreeWindow ? formatDuration(longestFreeWindow.start, longestFreeWindow.end) : '없음'}`}
                      icon="schedule"
                      tone="slate"
                    />
                    <StatusSummaryCard
                      label="확인 필요"
                      value={issueCount > 0 ? `${issueCount}개` : '정상'}
                      detail={issueItems[0]?.label ?? '이상 없음'}
                      icon={issueCount > 0 ? 'warning' : 'check_circle'}
                      tone={issueCount > 0 ? 'amber' : 'green'}
                    />
                    <button
                      type="button"
                      onClick={handleReschedule}
                      disabled={aiAction !== null}
                      className="rounded-lg border border-blue-100 bg-blue-600 p-3 text-left text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
                    >
                      <span className="flex items-center justify-between gap-1">
                        <span className="text-[10px] font-black text-blue-100">AI 작업</span>
                        <MaterialIcon icon="smart_toy" size={13} color="#fff" />
                      </span>
                      <span className="mt-1 block text-sm font-black">바로 정리</span>
                      <span className="block truncate text-[10px] font-bold text-blue-100">
                        빈 시간·겹침·시험 자동 처리
                      </span>
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-blue-100 bg-white p-6 shadow-[0_10px_30px_-5px_rgba(0,82,255,0.08)]">
                  <p className="mb-2 text-[11px] font-black text-slate-400">AI 빠른 작업</p>
                  <div className="flex flex-col gap-1.5">
                    {situationAiActions.map((action) => (
                      <button
                        key={action.key}
                        type="button"
                        onClick={action.onClick}
                        disabled={aiAction !== null}
                        className="flex items-center gap-2 rounded-lg border border-blue-100 bg-white p-2.5 text-left transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                          <MaterialIcon icon={action.icon} size={15} color="#2563eb" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-black text-slate-950">
                            {aiAction === action.key ? 'AI 처리 중...' : action.label}
                          </span>
                          <span className="block truncate text-[10px] font-bold text-slate-400">
                            {action.desc}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {needsTimetableUpload && (
                  <div className="rounded-2xl border border-blue-100 bg-white p-6 shadow-[0_10px_30px_-5px_rgba(0,82,255,0.08)]">
                    <div className="flex items-start gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white">
                        <MaterialIcon icon="upload_file" size={16} color="#2563eb" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-black text-slate-950">시간표 이미지로 빠르게 시작</p>
                        <p className="mt-0.5 text-[11px] font-bold text-slate-500">인식 결과 검토 후 반영</p>
                        <button
                          type="button"
                          onClick={() => setIsEtaReimportOpen(true)}
                          className="flex items-center gap-2 rounded-lg bg-blue-50 px-5 py-2 text-sm font-bold text-slate-900 hover:bg-blue-100"
                        >
                          <MaterialIcon icon="image" size={16} color="#2563eb" />
                          시간표 업로드
                        </button>
                      </div>
                    </div>
                  </div>
                )}
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

      <ClassForm />

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
