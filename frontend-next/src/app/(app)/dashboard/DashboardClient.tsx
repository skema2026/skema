'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Timetable, getWeekStart } from '@/components/timetable/Timetable';
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
import { useCreateStudyLog, useStreak } from '@/hooks/useStudyLogs';
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

const SHORT_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('ko-KR', { weekday: 'short' });
const LONG_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('ko-KR', { weekday: 'long' });
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

type WeekAgendaDay = {
  date: Date;
  dateStr: string;
  schedules: Schedule[];
  exams: ExamSchedule[];
};

function MobileWeekAgenda({
  days,
  todayStr,
  onScheduleClick,
  onScrollToDate,
  onShowDayView,
  scrollToDateStr,
  onScrollConsumed,
}: {
  days: WeekAgendaDay[];
  todayStr: string;
  onScheduleClick: (schedule: Schedule) => void;
  onScrollToDate: (date: Date) => void;
  onShowDayView: (date: Date) => void;
  scrollToDateStr: string | null;
  onScrollConsumed: () => void;
}) {
  const activeDays = days.filter((day) => day.schedules.length > 0 || day.exams.length > 0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const scrollToDateInternal = useCallback((dateStr: string) => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-agenda-date="${dateStr}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  useEffect(() => {
    if (!scrollToDateStr) return;
    const t = setTimeout(() => {
      scrollToDateInternal(scrollToDateStr);
      onScrollConsumed();
    }, 100);
    return () => clearTimeout(t);
  }, [scrollToDateStr, scrollToDateInternal, onScrollConsumed]);

  return (
    <div ref={containerRef} className="space-y-3 bg-[#f8fbff] p-3">
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((day) => {
          const isToday = day.dateStr === todayStr;
          const count = day.schedules.length + day.exams.length;
          return (
            <button
              key={day.dateStr}
              type="button"
              onClick={() => onScrollToDate(day.date)}
              className={`min-w-0 rounded-xl border px-1 py-2 text-center transition ${
                isToday
                  ? 'border-blue-500 bg-blue-600 text-white shadow-sm'
                  : count
                    ? 'border-blue-100 bg-white text-slate-800'
                    : 'border-slate-100 bg-white/70 text-slate-400'
              }`}
            >
              <p className="text-[11px] font-black leading-none">
                {SHORT_WEEKDAY_FORMATTER.format(day.date)}
              </p>
              <p className="mt-1 text-sm font-black leading-none">{day.date.getDate()}</p>
              <p className={`mt-1 text-[10px] font-black leading-none ${isToday ? 'text-blue-100' : count ? 'text-blue-600' : 'text-slate-300'}`}>
                {count ? `${count}개` : '-'}
              </p>
            </button>
          );
        })}
      </div>

      {activeDays.length === 0 ? (
        <div className="rounded-2xl border border-blue-100 bg-white px-4 py-8 text-center">
          <p className="text-sm font-black text-slate-700">이번 주 일정이 없습니다</p>
          <p className="mt-1 text-xs font-bold text-slate-400">상단 + 버튼으로 일정을 추가할 수 있어요</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {activeDays.map((day) => {
            const isToday = day.dateStr === todayStr;
            return (
              <section
                key={`agenda-${day.dateStr}`}
                data-agenda-date={day.dateStr}
                className={`scroll-mt-3 rounded-2xl border bg-white p-3 shadow-sm ${isToday ? 'border-blue-300' : 'border-blue-100'}`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-black text-blue-600">
                      {isToday ? '오늘' : LONG_WEEKDAY_FORMATTER.format(day.date)}
                    </p>
                    <h3 className="mt-0.5 text-base font-black text-slate-950">
                      {day.date.getMonth() + 1}월 {day.date.getDate()}일
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => onShowDayView(day.date)}
                    className="rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-black text-white transition hover:bg-blue-700"
                  >
                    자세히
                  </button>
                </div>

                <div className="space-y-1.5">
                  {day.exams.map((exam) => (
                    <div key={`mobile-exam-${exam.id}`} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <MaterialIcon icon="school" size={16} color="#d97706" />
                        <p className="min-w-0 flex-1 truncate text-sm font-black text-amber-900">{exam.title}</p>
                        <span className="text-xs font-black text-amber-700">{exam.exam_time || '종일'}</span>
                      </div>
                    </div>
                  ))}

                  {day.schedules.map((schedule) => (
                    <button
                      key={`mobile-week-${day.dateStr}-${schedule.id}`}
                      type="button"
                      onClick={() => onScheduleClick(schedule)}
                      className={`w-full rounded-xl border py-2 pl-0 pr-3 text-left transition hover:border-blue-300 hover:bg-blue-50 ${
                        schedule.is_completed ? 'border-slate-100 bg-slate-50 opacity-70' : 'border-blue-100 bg-[#fbfdff]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-[4px] self-stretch rounded-full shrink-0"
                          style={{ background: schedule.is_completed ? '#cbd5e1' : getDisplayColor(schedule) }}
                        />
                        <div className="w-[64px] shrink-0 text-xs font-black text-blue-700">
                          {schedule.start_time}
                          <span className="block text-[11px] font-bold text-slate-400">{schedule.end_time}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm font-black ${schedule.is_completed ? 'text-slate-400 line-through' : 'text-slate-950'}`}>
                            {schedule.title}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] font-bold text-slate-400">
                            {schedule.location || (schedule.schedule_type === 'study' ? '공부 일정' : '일정')}
                          </p>
                        </div>
                        <MaterialIcon icon={schedule.is_completed ? 'check_circle' : 'chevron_right'} size={16} color={schedule.is_completed ? '#94a3b8' : '#2563eb'} />
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MobileMonthAgenda({
  days,
  monthDate,
  todayStr,
  onDayClick,
}: {
  days: WeekAgendaDay[];
  monthDate: Date;
  todayStr: string;
  onDayClick: (date: Date) => void;
}) {
  return (
    <div className="bg-[#f8fbff] p-3">

      <div className="rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
        <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[11px] font-black text-slate-400">
          {['월', '화', '수', '목', '금', '토', '일'].map((day) => (
            <div key={day} className="py-1">{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((day) => {
            const isToday = day.dateStr === todayStr;
            const isCurrentMonth = day.date.getMonth() === monthDate.getMonth();
            const count = day.schedules.length + day.exams.length;

            return (
              <button
                key={`mobile-month-${day.dateStr}`}
                type="button"
                onClick={() => onDayClick(day.date)}
                className={`aspect-square min-w-0 rounded-xl border p-1 text-left transition ${
                  isToday
                    ? 'border-blue-500 bg-blue-600 text-white shadow-sm'
                    : isCurrentMonth
                      ? count
                        ? 'border-blue-100 bg-blue-50/70 text-slate-800'
                        : 'border-slate-100 bg-white text-slate-500'
                      : 'border-transparent bg-slate-50/50 text-slate-300'
                }`}
              >
                <div className="flex h-full flex-col justify-between">
                  <span className="text-xs font-black leading-none">{day.date.getDate()}</span>
                  {count > 0 && (
                    <div className="flex items-center gap-0.5">
                      {day.exams.length > 0 && (
                        <span className={`h-1.5 w-1.5 rounded-full ${isToday ? 'bg-amber-200' : 'bg-amber-400'}`} />
                      )}
                      {day.schedules.slice(0, 3).map((schedule) => (
                        <span
                          key={`mobile-month-dot-${day.dateStr}-${schedule.id}`}
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: isToday ? '#bfdbfe' : getDisplayColor(schedule) }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

    </div>
  );
}

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
  const [studyHoursPerDay, setStudyHoursPerDay] = useState(2);
  const [isFreeTimeDialogOpen, setIsFreeTimeDialogOpen] = useState(false);
  const [isRemainingDialogOpen, setIsRemainingDialogOpen] = useState(false);
  const [certSchedule, setCertSchedule] = useState<{ id: number; title: string } | null>(null);
  const [certGroupId, setCertGroupId]   = useState<number | null>(null);
  const [certCaption, setCertCaption]   = useState('');
  const [certIsPublic, setCertIsPublic] = useState(true);
  const createStudyLog = useCreateStudyLog();
  const certFileRef = useRef<HTMLInputElement>(null);
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
      key: 'weekly-summary',
      label: '이번 주 요약',
      desc: '완료율·미룬 일정·집중 시간대 분석',
      icon: 'bar_chart',
      onClick: () => {
        // 보고 있는 주 기준
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        const weekStartStr = toLocalDateString(weekStart);
        const weekEndStr = toLocalDateString(weekEnd);
        const todayWeekStartStr = toLocalDateString(getWeekStart(new Date(now.getFullYear(), now.getMonth(), now.getDate())));
        const isCurrentWeek = weekStartStr === todayWeekStartStr;

        // 요일별 일정 집계
        let totalSchedules = 0;
        let totalDone = 0;
        const periodCount = { 오전: 0, 오후: 0, 저녁: 0 };
        const typeCount: Record<string, { total: number; done: number }> = {};
        const dayLines: string[] = [];
        const missedSamples: string[] = [];

        weekAgendaDays.forEach((day) => {
          const wkLabel = ['월','화','수','목','금','토','일'][getLocalDow(day.date)];
          const dayDone = day.schedules.filter(s => s.is_completed).length;
          totalSchedules += day.schedules.length;
          totalDone += dayDone;

          day.schedules.forEach(s => {
            const sm = timeToMinutes(s.start_time);
            if (sm < 12 * 60) periodCount.오전++;
            else if (sm < 18 * 60) periodCount.오후++;
            else periodCount.저녁++;

            const t = s.schedule_type ?? '일정';
            if (!typeCount[t]) typeCount[t] = { total: 0, done: 0 };
            typeCount[t].total++;
            if (s.is_completed) typeCount[t].done++;

            // 지나간 날인데 미완료인 일정 샘플
            if (!s.is_completed && day.dateStr < todayStr && missedSamples.length < 5) {
              missedSamples.push(`${day.dateStr}(${wkLabel}) ${s.title}`);
            }
          });
          dayLines.push(`- ${day.dateStr}(${wkLabel}): ${day.schedules.length}개 (완료 ${dayDone}개)${day.exams.length > 0 ? `, 시험 ${day.exams.length}개` : ''}`);
        });

        const pct = totalSchedules > 0 ? Math.round((totalDone / totalSchedules) * 100) : 0;
        const typeLines = Object.entries(typeCount)
          .map(([t, v]) => `- ${t}: ${v.done}/${v.total}개 (${v.total > 0 ? Math.round(v.done / v.total * 100) : 0}%)`)
          .join('\n') || '- 없음';
        const periodLine = `오전 ${periodCount.오전}개 / 오후 ${periodCount.오후}개 / 저녁 ${periodCount.저녁}개`;
        const upcomingExamLines = upcomingExams.slice(0, 3)
          .map(e => `- ${e.title} (${e.exam_date}, D-${getDaysUntil(e.exam_date)})`).join('\n') || '- 없음';
        const missedLines = missedSamples.length > 0 ? missedSamples.map(s => `- ${s}`).join('\n') : '- 없음';

        const prompt = `주간 요약 분석 요청
주간 기간: ${weekStartStr} ~ ${weekEndStr} (월~일${isCurrentWeek ? ', 현재 진행 중인 주' : ''})

전체 완료율: ${totalDone}/${totalSchedules}개 (${pct}%)

요일별 일정 수:
${dayLines.join('\n')}

시간대별 일정 분포: ${periodLine}

유형별 완료 현황:
${typeLines}

지나간 날의 미완료 일정 (최대 5개):
${missedLines}

다가오는 시험:
${upcomingExamLines}

위 데이터를 정확히 참고해서 한국어로 자연스럽게 답해줘. 정확히 아래 4가지로:
① 이번 주 요약 한 줄 — 전체적인 완료율과 분위기
② 미룬 패턴 — 어떤 종류/요일/시간대가 자주 미뤄지는지 (위 데이터만 참고)
③ 집중이 잘 된 시간대 — 시간대별 분포와 유형별 완료율을 보고 추측
④ 남은 주에 대한 조언 — 다가오는 시험·미완료를 고려해서 무엇을 할지

각 항목은 1-2문장으로 구체적으로. 모르는 정보는 추측하지 말고 위 데이터만 참고해.`;

        runAiCommand('weekly-summary', prompt, '이번 주 요약을 정리했습니다');
      },
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
                    <>
                      <div className="sm:hidden">
                        <MobileWeekAgenda
                          days={weekAgendaDays}
                          todayStr={todayStr}
                          onScheduleClick={openClassForm}
                          onScrollToDate={(date) => setWeekScrollDate(toLocalDateString(date))}
                          onShowDayView={showDayViewForDate}
                          scrollToDateStr={weekScrollDate}
                          onScrollConsumed={() => setWeekScrollDate(null)}
                        />
                      </div>
                      <div
                        ref={timetableRef}
                        className="hidden max-h-[calc(100vh-220px)] overflow-y-auto sm:block"
                      >
                        <Timetable schedules={weekSchedules} exams={exams} weekStart={weekStart} startTime="00:00" onDayClick={showDayViewForDate} />
                      </div>
                    </>
                  )}

                  {timetableView === 'day' && (
                    <div className="h-full overflow-y-auto bg-[#f8fbff] p-4">
                      <div className="mb-3 rounded-lg border border-blue-100 bg-white p-3 shadow-sm">
                        {/* 1행: 날짜 + 버튼 */}
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="whitespace-nowrap text-xs font-black text-blue-600">하루 진행표</p>
                            <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const isToday = toLocalDateString(dayDate) === todayStr;
                              const doneCnt = daySchedules.filter(s => s.is_completed).length;
                              const pct = daySchedules.length > 0 ? Math.round((doneCnt / daySchedules.length) * 100) : 0;
                              const fmt = (s: Schedule) =>
                                `- [${s.is_completed ? '완료' : '미완료'}] ${s.start_time}-${s.end_time} ${s.title} (${s.schedule_type ?? '일정'}${s.location ? `, ${s.location}` : ''})`;
                              const scheduleLines = daySchedules.length > 0
                                ? daySchedules.map(fmt).join('\n')
                                : '- 일정 없음';
                              const dayExamLines = dayExams.length > 0
                                ? dayExams.map(e => `- ${e.title}${e.exam_time ? ` (${e.exam_time})` : ''}${e.location ? ` @${e.location}` : ''}`).join('\n')
                                : '';
                              const upcomingExamLines = upcomingExams
                                .filter(e => e.exam_date !== toLocalDateString(dayDate))
                                .slice(0, 3)
                                .map(e => `- ${e.title} (${e.exam_date}, D-${getDaysUntil(e.exam_date)})`).join('\n');
                              const freeTimeLine = dayFreeWindows.length > 0
                                ? dayFreeWindows.map(w => `${minutesToTime(w.start)}-${minutesToTime(w.end)}`).join(', ')
                                : '없음';
                              const conflictLine = dayConflictSchedules.length > 0
                                ? dayConflictSchedules.map(({ schedule }) => schedule.title).join(', ')
                                : '없음';

                              const header = isToday
                                ? `현재 시각: ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}\n날짜: ${toLocalDateString(dayDate)} (오늘)`
                                : `날짜: ${toLocalDateString(dayDate)}`;

                              const prompt = `${header}
완료율: ${doneCnt}/${daySchedules.length}개 (${pct}%)
기상/취침: ${wakeStartTime} / ${profile?.sleep_start ?? '23:00'}
빈 시간대: ${freeTimeLine}
겹치는 일정: ${conflictLine}
${dayExamLines ? `\n당일 시험:\n${dayExamLines}` : ''}${upcomingExamLines ? `\n\n다가오는 시험:\n${upcomingExamLines}` : ''}

일정 목록:
${scheduleLines}

위 데이터를 정확히 참고해서 한국어로 자연스럽게 정리해줘. 정확히 아래 3가지 항목으로 답해줘:
① ${isToday ? '지금 당장 할 것' : '이 날 가장 중요한 것'} — 미완료 일정 중 우선순위, 시험 D-day 임박 여부 반영
② 빈 시간 활용 — 위의 "빈 시간대"를 그대로 인용해서 무엇을 하면 좋을지
③ 주의할 점 — 겹치는 일정, 무리한 일정, 빠뜨리기 쉬운 것 등

각 항목은 1-2문장으로 짧고 구체적으로 작성해줘. 모르는 정보를 추측하지 말고 위 데이터만 참고해.`;

                              runAiCommand('today-plan', prompt, '하루 시간표를 정리했습니다');
                            }}
                            disabled={aiAction !== null}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"
                          >
                            <MaterialIcon icon="smart_toy" size={15} color="#fff" />
                            {aiAction === 'today-plan' ? '정리 중...' : '하루 정리'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const nextDay = new Date(dayDate);
                              nextDay.setDate(dayDate.getDate() + 1);
                              const nextDayStr = toLocalDateString(nextDay);
                              const nextSchedules = getSchedulesForDate(nextDay, 'day');
                              const nextExams = exams.filter(e => e.exam_date === nextDayStr);
                              const nextScheduleLines = nextSchedules.length > 0
                                ? nextSchedules.map(s => `- ${s.start_time}-${s.end_time} ${s.title} (${s.schedule_type ?? '일정'}${s.location ? `, ${s.location}` : ''})`).join('\n')
                                : '- 일정 없음';
                              const tomorrowExamLines = nextExams.length > 0
                                ? nextExams.map(e => `- ${e.title}${e.exam_time ? ` (${e.exam_time})` : ''}${e.location ? ` @${e.location}` : ''}`).join('\n')
                                : '';
                              const remainingLines = remainingToday.length > 0
                                ? remainingToday.map(s => `- ${s.start_time}-${s.end_time} ${s.title}`).join('\n')
                                : '- 없음';
                              const upcomingExamLines = upcomingExams
                                .filter(e => e.exam_date !== nextDayStr)
                                .slice(0, 3)
                                .map(e => `- ${e.title} (${e.exam_date}, D-${getDaysUntil(e.exam_date)})`).join('\n');
                              const refDate = toLocalDateString(dayDate);
                              const isRefToday = refDate === todayStr;

                              const prompt = `${isRefToday ? `현재 시각: ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}\n` : ''}기준 날짜: ${refDate}${isRefToday ? ' (오늘)' : ''}
다음 날(내일): ${nextDayStr}
${tomorrowExamLines ? `\n내일 시험:\n${tomorrowExamLines}\n` : ''}
내일 일정:
${nextScheduleLines}

${isRefToday ? '오늘 남은 미완료 일정' : '기준 날 미완료 일정'}:
${remainingLines}
${upcomingExamLines ? `\n다가오는 시험:\n${upcomingExamLines}\n` : ''}

위 데이터를 정확히 참고해서 "내일을 위해 ${isRefToday ? '오늘' : '기준 날'} 미리 해둘 것"을 정리해줘. 정확히 아래 3가지 항목으로 답해줘:
① 미리 챙겨야 할 것 — 내일 일정/시험에 필요한 준비물, 자료, 마감
② 오늘 마무리할 것 — ${isRefToday ? '오늘' : '기준 날'} 남은 미완료 일정 중 내일에 영향 줄 수 있는 것
③ 주의할 점 — 일찍 일어나야 하는지, 시험이 임박했는지, 무리한 일정인지 등

각 항목은 1-2문장으로 구체적으로. 모르는 정보를 추측하지 말고 위 데이터만 참고해.`;

                              runAiCommand('tomorrow-plan', prompt, '내일 준비 사항을 정리했습니다');
                            }}
                            disabled={aiAction !== null}
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
                          >
                            <MaterialIcon icon="event" size={15} color="#fff" />
                            {aiAction === 'tomorrow-plan' ? '준비 중...' : '내일 준비'}
                          </button>
                          </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => showWeekViewForDate(dayDate)}
                              className="text-left transition hover:opacity-70"
                              title="주간 보기로 전환"
                            >
                              <h2 className="text-lg font-black text-slate-950 whitespace-nowrap">{formatLongDate(dayDate)}</h2>
                            </button>
                          </div>
                        </div>

                        {/* 2행: 완료율 + 진행바 */}
                        {(() => {
                          const done = daySchedules.filter(s => s.is_completed).length;
                          const total = daySchedules.length;
                          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                          let msg = '';
                          if (total === 0) msg = '일정을 추가해보세요';
                          else if (pct === 100) msg = '모든 일정 완료';
                          else if (pct >= 70) msg = `거의 다 왔어요 · ${total - done}개 남음`;
                          else msg = `${done}/${total}개 완료`;
                          return (
                            <div className="mt-2 flex items-center gap-3">
                              <div className="flex-1">
                                <div className="h-1.5 w-full rounded-full bg-slate-100">
                                  <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                              <span className="shrink-0 text-[11px] font-bold text-slate-400">{msg}</span>
                            </div>
                          );
                        })()}

                        {/* 3행: 타임라인 바 */}
                        {daySchedules.length > 0 && (() => {
                          const dayStart = wakeStartMinutes;
                          const dayEnd = 24 * 60;
                          const total = dayEnd - dayStart;
                          return (
                            <div className="mt-2">
                              <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                                {daySchedules.map(s => {
                                  const start = Math.max(timeToMinutes(s.start_time), dayStart);
                                  const end = Math.min(timeToMinutes(s.end_time), dayEnd);
                                  if (end <= start) return null;
                                  const left = ((start - dayStart) / total) * 100;
                                  const width = ((end - start) / total) * 100;
                                  const periodColor = getDisplayColor(s);
                                  return (
                                    <div key={s.id} className="absolute h-full opacity-80"
                                      style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%`, background: s.is_completed ? '#86efac' : periodColor }} />
                                  );
                                })}
                              </div>
                              <div className="mt-0.5 flex justify-between text-[9px] font-bold text-slate-300">
                                <span>{minutesToTime(dayStart)}</span><span>24:00</span>
                              </div>
                            </div>
                          );
                        })()}

                        {/* 4행: 칩 스트립 (시험·겹침·빈시간 등) */}
                        {(() => {
                          const chips: { label: string; color: string; bg: string; border: string; onClick?: () => void }[] = [];
                          if (dayExams.length > 0) dayExams.forEach(e => chips.push({ label: `오늘 시험 · ${e.title}`, color: '#7c2d12', bg: '#fef3c7', border: '#fcd34d' }));
                          // 시험 D-day 칩 — exam_date 기준 중복 제거
                          const seenExamDates = new Set<string>();
                          upcomingExams.filter(e => e.exam_date !== toLocalDateString(dayDate)).forEach(e => {
                            if (seenExamDates.has(e.exam_date)) return;
                            seenExamDates.add(e.exam_date);
                            const d = getDaysUntil(e.exam_date);
                            if (d <= 14 && d > 0) chips.push({
                              label: `${e.title} D-${d}`,
                              color: d <= 3 ? '#991b1b' : '#92400e',
                              bg: d <= 3 ? '#fee2e2' : '#fef3c7',
                              border: d <= 3 ? '#fca5a5' : '#fcd34d',
                              onClick: () => setExamForStudyBlocks({ id: e.id, title: e.title, exam_date: e.exam_date }),
                            });
                          });
                          if (dayConflictSchedules.length > 0) chips.push({ label: `겹치는 일정 ${dayConflictSchedules.length}개`, color: '#9a3412', bg: '#fff7ed', border: '#fdba74' });
                          if (dayFreeWindows.length > 0) {
                            const freeMin = dayFreeWindows.reduce((s, w) => s + w.end - w.start, 0);
                            chips.push({ label: `빈 시간 ${formatMinutesDuration(freeMin)}`, color: '#1e40af', bg: '#eff6ff', border: '#bfdbfe', onClick: () => setIsFreeTimeDialogOpen(true) });
                          }
                          if (chips.length === 0) return null;
                          return (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {chips.map((chip, i) => (
                                <button key={i} type="button" onClick={chip.onClick}
                                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-black transition hover:opacity-80"
                                  style={{ color: chip.color, background: chip.bg, border: `1px solid ${chip.border}`, cursor: chip.onClick ? 'pointer' : 'default' }}>
                                  {chip.label}
                                </button>
                              ))}
                            </div>
                          );
                        })()}

                        <div className="mt-3 grid gap-1.5 grid-cols-3">
                          <button
                            type="button"
                            onClick={() => selectedDayPrimarySchedule ? openClassForm(selectedDayPrimarySchedule) : openClassForm()}
                            className="rounded-lg border border-blue-100 bg-blue-50/70 px-2 py-2 text-left transition hover:border-blue-300 hover:bg-blue-50"
                          >
                            <p className="text-[10px] font-black text-blue-600 leading-tight">{isSelectedDayToday ? '다음 일정' : '첫 일정'}</p>
                            <p className="mt-1 truncate text-xs font-black text-slate-950">
                              {selectedDayPrimarySchedule ? selectedDayPrimarySchedule.title : '없음'}
                            </p>
                            <p className="truncate text-[10px] font-bold text-slate-400 leading-tight">
                              {selectedDayPrimarySchedule
                                ? `${selectedDayPrimarySchedule.start_time}–${selectedDayPrimarySchedule.end_time}`
                                : '일정 없음'}
                            </p>
                          </button>

                          <button
                            type="button"
                            onClick={remainingToday.length > 0 ? () => setIsRemainingDialogOpen(true) : undefined}
                            className="rounded-lg border border-blue-100 bg-blue-50/70 px-2 py-2 text-left transition hover:border-blue-300 hover:bg-blue-50"
                          >
                            <p className="text-[10px] font-black text-blue-600 leading-tight">
                              해야할 일{!isSelectedDayToday && <span className="text-slate-400"> (오늘)</span>}
                            </p>
                            <p className="mt-1 text-xs font-black text-slate-950">
                              {remainingToday.length > 0 ? `${remainingToday.length}개` : '모두 완료'}
                            </p>
                            <p className="truncate text-[10px] font-bold text-slate-400 leading-tight">
                              {remainingToday.length > 0 ? remainingToday[0].title : '미완료 없음'}
                            </p>
                          </button>

                          <button
                            type="button"
                            onClick={issueCount > 0 ? () => setIsIssueDialogOpen(true) : undefined}
                            className={`rounded-lg border px-2 py-2 text-left transition ${issueCount > 0 ? 'border-amber-200 bg-amber-50/60 hover:bg-amber-50' : 'border-blue-100 bg-blue-50/70 hover:bg-blue-50'}`}
                          >
                            <p className={`text-[10px] font-black leading-tight ${issueCount > 0 ? 'text-amber-600' : 'text-blue-600'}`}>
                              확인 필요{!isSelectedDayToday && <span className="text-slate-400"> (오늘)</span>}
                            </p>
                            <p className="mt-1 text-xs font-black text-slate-950">
                              {issueCount > 0 ? `${issueCount}개` : '정상'}
                            </p>
                            <p className="truncate text-[10px] font-bold text-slate-400 leading-tight">
                              {issueItems[0]?.label ?? '이상 없음'}
                            </p>
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
                          <section className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm">
                            <div className="mb-3 flex items-center justify-between">
                              <h3 className="text-sm font-black text-slate-950">오늘 일정</h3>
                              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">{daySchedules.length}개</span>
                            </div>
                            {daySchedules.length === 0 ? (
                              <div className="rounded-lg border border-dashed border-blue-100 bg-[#fbfdff] p-4 text-sm font-bold text-slate-400">
                                일정이 없습니다
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {daySchedules.map((schedule) => {
                                  const start = timeToMinutes(schedule.start_time);
                                  const end = timeToMinutes(schedule.end_time);
                                  const done = schedule.is_completed;
                                  const periodColor = getDisplayColor(schedule);
                                  return (
                                    <div
                                      key={schedule.id}
                                      className={`flex items-start gap-3 rounded-lg border p-3 transition ${done ? 'border-slate-100 bg-slate-50' : 'border-blue-50 bg-[#fbfdff] shadow-sm'}`}
                                      style={{ borderLeft: `4px solid ${done ? '#cbd5e1' : periodColor}` }}
                                    >
                                      <div className="flex shrink-0 flex-col items-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => toggleComplete.mutate({ id: schedule.id, is_completed: !done })}
                                          className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition ${done ? 'border-emerald-400 bg-emerald-400' : 'border-slate-300 hover:border-blue-400'}`}
                                        >
                                          {done && (
                                            <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                                              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                          )}
                                        </button>
                                        {done && (
                                          <button
                                            type="button"
                                            title="인증샷 올리기"
                                            onClick={() => setCertSchedule({ id: schedule.id, title: schedule.title })}
                                            className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-50 text-blue-500 transition hover:bg-blue-100"
                                          >
                                            <MaterialIcon icon="photo_camera" size={12} color="currentColor" />
                                          </button>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => openClassForm(schedule)}
                                        className="min-w-0 flex-1 text-left"
                                      >
                                        <span className={`block truncate text-sm font-black ${done ? 'text-slate-400 line-through' : 'text-slate-950'}`}>
                                          {schedule.title}
                                        </span>
                                        <span className="mt-0.5 flex flex-wrap items-center gap-2">
                                          <span className="text-xs font-bold" style={{ color: done ? '#94a3b8' : periodColor }}>
                                            {schedule.start_time}–{schedule.end_time}
                                          </span>
                                          {schedule.location && (
                                            <span className="text-xs font-bold text-slate-400">{schedule.location}</span>
                                          )}
                                          <span className="text-xs font-bold text-slate-300">{formatDuration(start, end)}</span>
                                        </span>
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </section>

                          <aside className="space-y-3">

                            <section className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm">
                              <div className="mb-3 flex items-center gap-2">
                                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
                                  <MaterialIcon icon="bar_chart" size={17} color="#2563eb" />
                                </span>
                                <h3 className="text-base font-black text-slate-950">오늘 리포트</h3>
                              </div>

                              {(() => {
                                const total = daySchedules.length;
                                const done = daySchedules.filter(s => s.is_completed).length;
                                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                                const totalMin = daySchedules.reduce((s, sc) => s + Math.max(0, timeToMinutes(sc.end_time) - timeToMinutes(sc.start_time)), 0);
                                const freeMin = dayFreeWindows.reduce((s, w) => s + (w.end - w.start), 0);
                                const busyPeriod = (() => {
                                  const morn = daySchedules.filter(s => timeToMinutes(s.start_time) < 12 * 60).length;
                                  const aftn = daySchedules.filter(s => { const m = timeToMinutes(s.start_time); return m >= 12 * 60 && m < 18 * 60; }).length;
                                  const evng = daySchedules.filter(s => timeToMinutes(s.start_time) >= 18 * 60).length;
                                  if (morn >= aftn && morn >= evng) return '오전';
                                  if (aftn >= evng) return '오후';
                                  return '저녁';
                                })();

                                return (
                                  <div className="space-y-3">
                                    <div>
                                      <div className="mb-1 flex items-center justify-between">
                                        <span className="text-xs font-black text-slate-500">완료율</span>
                                        <span className="text-xs font-black text-slate-950">{pct}%</span>
                                      </div>
                                      <div className="h-2 w-full rounded-full bg-slate-100">
                                        <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
                                      </div>
                                      <p className="mt-0.5 text-[11px] font-bold text-slate-400">{done}/{total}개 완료</p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="rounded-lg bg-blue-50 px-3 py-2">
                                        <p className="text-[10px] font-black text-blue-500">일정 시간</p>
                                        <p className="mt-0.5 text-sm font-black text-slate-950">{formatMinutesDuration(totalMin)}</p>
                                      </div>
                                      <div className="rounded-lg bg-slate-50 px-3 py-2">
                                        <p className="text-[10px] font-black text-slate-500">빈 시간</p>
                                        <p className="mt-0.5 text-sm font-black text-slate-950">{formatMinutesDuration(freeMin)}</p>
                                      </div>
                                    </div>
                                    {total > 0 && (
                                      <p className="text-[11px] font-bold text-slate-500">
                                        오늘은 <span className="font-black text-slate-800">{busyPeriod}</span>에 일정이 집중돼 있어요
                                      </p>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const refDate = toLocalDateString(dayDate);
                                        const isRefToday = refDate === todayStr;
                                        const doneLines = daySchedules.filter(s => s.is_completed)
                                          .map(s => `- ${s.start_time}-${s.end_time} ${s.title} (${s.schedule_type ?? '일정'})`).join('\n') || '- 없음';
                                        const missedLines = daySchedules.filter(s => !s.is_completed)
                                          .map(s => `- ${s.start_time}-${s.end_time} ${s.title} (${s.schedule_type ?? '일정'})`).join('\n') || '- 없음';

                                        const reportPrompt = `${isRefToday ? `현재 시각: ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}\n` : ''}평가 대상 날짜: ${refDate}${isRefToday ? ' (오늘)' : ''}
전체 완료율: ${done}/${total}개 (${pct}%)
일정 점유 시간: ${formatMinutesDuration(totalMin)}
빈 시간: ${formatMinutesDuration(freeMin)}
일정 몰린 시간대: ${busyPeriod}

완료된 일정:
${doneLines}

미완료 일정:
${missedLines}

위 데이터를 정확히 참고해서 한국어로 2~3문장으로 자연스럽게 평가해줘.
- 완료율과 분위기 한 줄
- 시간 활용에서 잘한 점 또는 아쉬운 점 한 줄
- 개선 제안 한 줄
모르는 정보는 추측하지 말고 위 데이터만 참고해.`;

                                        runAiCommand('day-report', reportPrompt, 'AI 평가가 완료됐습니다');
                                      }}
                                      disabled={aiAction !== null}
                                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 text-xs font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
                                    >
                                      <MaterialIcon icon="smart_toy" size={15} color="#fff" />
                                      {aiAction === 'day-report' ? '평가 중...' : 'AI 평가 받기'}
                                    </button>
                                  </div>
                                );
                              })()}
                            </section>

                          </aside>
                        </div>
                      )}
                    </div>
                  )}

                  {timetableView === 'month' && (
                    <>
                      <div className="sm:hidden">
                        <MobileMonthAgenda
                          days={monthAgendaDays}
                          monthDate={monthDate}
                          todayStr={todayStr}
                          onDayClick={showDayViewForDate}
                        />
                      </div>
                      <div className="hidden h-full overflow-y-auto bg-white p-4 sm:block">
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
                            const dayExams = exams.filter((exam) => exam.exam_date === dateStr);
                            const isToday = dateStr === todayStr;
                            const isCurrentMonth = date.getMonth() === monthDate.getMonth();

                            return (
                              <button
                                key={dateStr}
                                onClick={() => showDayViewForDate(date)}
                                className={`min-h-[112px] rounded-lg border p-2 text-left transition hover:border-blue-300 hover:bg-blue-50 ${
                                  isToday
                                    ? 'border-blue-500 bg-blue-50'
                                    : isCurrentMonth
                                      ? 'border-blue-100 bg-white'
                                      : 'border-slate-100 bg-slate-50/70 opacity-60'
                                }`}
                              >
                                <div className="mb-1.5 flex items-center justify-between">
                                  <span className={`text-xs font-black ${isToday ? 'text-blue-700' : 'text-slate-600'}`}>
                                    {date.getDate()}
                                  </span>
                                  {dayExams.length > 0 && (
                                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700">
                                      시험
                                    </span>
                                  )}
                                </div>
                                {items.length > 0 && (
                                  <div className="flex flex-wrap gap-0.5">
                                    {items.slice(0, 6).map((schedule) => (
                                      <span
                                        key={`dot-${dateStr}-${schedule.id}`}
                                        className="h-2 w-2 rounded-full"
                                        style={{ background: getDisplayColor(schedule) }}
                                      />
                                    ))}
                                  </div>
                                )}
                                {items.length > 6 && (
                                  <span className="mt-0.5 block text-[10px] font-black text-slate-400">
                                    +{items.length - 6}개
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <aside className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-20 xl:max-h-[calc(100vh-100px)] xl:overflow-y-auto">

                {/* AI 핵심 작업 */}
                <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-[0_10px_30px_-5px_rgba(0,82,255,0.08)]">
                  <p className="mb-3 text-[11px] font-black text-slate-400">AI 작업</p>
                  <div className="flex flex-col gap-2">
                    {situationAiActions.map((action) => (
                      <button
                        key={action.key}
                        type="button"
                        onClick={action.onClick}
                        disabled={aiAction !== null}
                        className="flex items-center gap-3 rounded-xl border border-blue-100 bg-[#fbfdff] p-3 text-left transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50">
                          <MaterialIcon icon={action.icon} size={18} color="#2563eb" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-black text-slate-950">
                            {aiAction === action.key ? 'AI 처리 중...' : action.label}
                          </span>
                          <span className="block truncate text-[11px] font-bold text-slate-400">
                            {action.desc}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
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

      <Dialog open={isFreeTimeDialogOpen} onOpenChange={setIsFreeTimeDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>오늘 빈 시간</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <p className="text-xs font-bold text-slate-500 mb-3">총 {formatMinutesDuration(todayAvailableMinutes)} 사용 가능</p>
            {todayFreeWindows.map((window, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                <span className="text-sm font-black text-slate-950">
                  {minutesToTime(window.start)} – {minutesToTime(window.end)}
                </span>
                <span className="text-xs font-bold text-slate-400">{formatDuration(window.start, window.end)}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setIsFreeTimeDialogOpen(false);
              runAiCommand(
                'free-plan',
                '오늘 시간표의 빈 시간을 분석해서 지금 할 수 있는 일과 배치하면 좋은 일정을 추천해줘',
                '오늘 빈 시간 활용안을 정리했습니다',
              );
            }}
            disabled={aiAction !== null}
            className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            <MaterialIcon icon="smart_toy" size={16} color="#fff" />
            {aiAction === 'free-plan' ? 'AI 처리 중...' : '빈 시간 활용 AI 추천'}
          </button>
        </DialogContent>
      </Dialog>

      <Dialog open={!!examForStudyBlocks} onOpenChange={(open) => { if (!open) setExamForStudyBlocks(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>공부 일정 자동 배치</DialogTitle>
          </DialogHeader>
          {examForStudyBlocks && (
            <div className="py-2 space-y-4">
              <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
                <p className="text-sm font-black text-slate-950">{examForStudyBlocks.title}</p>
                <p className="mt-0.5 text-xs font-bold text-amber-700">
                  {examForStudyBlocks.exam_date} · D-{getDaysUntil(examForStudyBlocks.exam_date)}
                </p>
              </div>
              <div>
                <p className="mb-2 text-xs font-black text-slate-700">하루 공부 시간</p>
                <div className="flex gap-2">
                  {[1, 2, 3].map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setStudyHoursPerDay(h)}
                      className={`flex-1 rounded-lg border py-2.5 text-sm font-black transition ${
                        studyHoursPerDay === h
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'
                      }`}
                    >
                      {h}시간
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const e = examForStudyBlocks;
                  setExamForStudyBlocks(null);
                  runAiCommand(
                    'study-blocks',
                    `${e.title} 시험(${e.exam_date})까지 남은 기간을 기준으로, 하루 ${studyHoursPerDay}시간씩 공부 블록을 빈 시간에 자동으로 추가해줘. 기존 일정과 충돌하지 않는 시간대에 배치하고, 시험일에 가까울수록 더 집중되게 해줘.`,
                    '공부 블록을 시간표에 추가했습니다',
                  );
                }}
                disabled={aiAction !== null}
                className="w-full rounded-lg bg-blue-600 py-3 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                공부 일정 배치하기
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isIssueDialogOpen} onOpenChange={setIsIssueDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>확인 필요 항목</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            {issueItems.length === 0 ? (
              <p className="text-sm text-slate-500">이상 없음</p>
            ) : (
              issueItems.map((item) => (
                <div key={item.key} className="rounded-lg border border-slate-100 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-slate-500">{item.label}</span>
                    <span className="text-sm font-black text-slate-950">{item.value}</span>
                  </div>
                  <p className="mt-1 text-[11px] font-bold text-slate-400">{item.detail}</p>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ClassForm />

      {/* 인증샷 — 완료 체크 연동, 그룹 피드로 업로드 */}
      <input
        ref={certFileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file || !certSchedule) return;
          const form = new FormData();
          form.append('photo', file);
          form.append('schedule_id', String(certSchedule.id));
          form.append('is_public', String(certIsPublic));
          if (certCaption.trim()) form.append('caption', certCaption.trim());
          if (certGroupId) form.append('group_id', String(certGroupId));
          try {
            await createStudyLog.mutateAsync(form);
            toast.success('기록이 올라갔어요!');
          } catch {
            toast.error('업로드에 실패했습니다.');
          }
          setCertSchedule(null);
          setCertCaption('');
          e.target.value = '';
        }}
      />
      {certSchedule && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-sm rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl">
            {/* 헤더 */}
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-base font-black text-slate-950">기록 남기기</p>
                <p className="text-xs font-bold text-blue-600">{certSchedule.title} 완료</p>
              </div>
              <button type="button" onClick={() => setCertSchedule(null)} className="text-slate-400">
                <MaterialIcon icon="close" size={20} color="currentColor" />
              </button>
            </div>

            {/* 그룹 선택 */}
            {myGroups.length > 0 && (
              <div className="mb-3">
                <p className="mb-1.5 text-[11px] font-black text-slate-400">올릴 그룹</p>
                <div className="flex flex-wrap gap-2">
                  {myGroups.map(g => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setCertGroupId(prev => prev === g.id ? null : g.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${
                        certGroupId === g.id
                          ? 'border-blue-500 bg-blue-600 text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'
                      }`}
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 캡션 */}
            <textarea
              placeholder="한 마디 남기기 (선택사항)"
              value={certCaption}
              onChange={e => setCertCaption(e.target.value.slice(0, 200))}
              rows={2}
              className="mb-3 w-full resize-none rounded-xl border border-blue-100 bg-[#fbfdff] px-3 py-2 text-sm font-bold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />

            {/* 공개 / 비공개 */}
            <div className="mb-3 flex items-center justify-between rounded-xl border border-blue-100 bg-[#fbfdff] px-3 py-2.5">
              <div>
                <p className="text-sm font-black text-slate-950">{certIsPublic ? '전체 공개' : '나만 보기'}</p>
                <p className="text-[11px] font-bold text-slate-400">
                  {certGroupId
                    ? (certIsPublic ? '그룹 + 전체 피드에 표시' : '그룹 멤버에게만 보임')
                    : (certIsPublic ? '전체 피드에 표시됩니다' : '내 기록 탭에서만 보여요')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCertIsPublic(v => !v)}
                style={{
                  width: 44, height: 26, borderRadius: 99,
                  background: certIsPublic ? '#2563eb' : '#e2e8f0',
                  border: 'none', cursor: 'pointer', padding: 0,
                  position: 'relative', transition: 'background .2s',
                }}
              >
                <span style={{
                  position: 'absolute', top: 2, left: certIsPublic ? 20 : 2,
                  width: 22, height: 22, borderRadius: '50%',
                  background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.18)',
                  transition: 'left .2s',
                }} />
              </button>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => certFileRef.current?.click()}
                className="flex-1 rounded-xl bg-blue-600 py-3 text-sm font-black text-white"
              >
                사진 찍어 기록하기
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!certCaption.trim()) { toast.error('사진 또는 한 마디를 입력해주세요.'); return; }
                  const form = new FormData();
                  form.append('schedule_id', String(certSchedule.id));
                  form.append('caption', certCaption.trim());
                  form.append('is_public', String(certIsPublic));
                  if (certGroupId) form.append('group_id', String(certGroupId));
                  try {
                    await createStudyLog.mutateAsync(form);
                    toast.success('기록이 올라갔어요!');
                    setCertSchedule(null);
                    setCertCaption('');
                  } catch {
                    toast.error('업로드에 실패했습니다.');
                  }
                }}
                className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-black text-slate-700"
              >
                텍스트만
              </button>
            </div>
          </div>
        </div>
      )}

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
