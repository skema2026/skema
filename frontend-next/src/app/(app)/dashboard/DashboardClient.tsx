'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Timetable, getWeekStart } from '@/components/timetable/Timetable';
import { ClassForm } from '@/components/class-form/ClassForm';
import { ExamList } from '@/components/exam/ExamList';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { useSchedules, useToggleComplete } from '@/hooks/useSchedules';
import { useExams, useUpdateExam, useDeleteExam } from '@/hooks/useExams';
import { useProfile } from '@/hooks/useProfile';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/lib/api';
import { indexToRecurringDay, recurringDayToIndex } from '@/lib/recurringDay';
import { timeToMinutes } from '@/lib/utils';
import MaterialIcon from '@/components/common/MaterialIcon';
import { Schedule, ExamSchedule, UserProfile } from '@/types';
import {
  DashboardHeader,
  DashboardStyles,
  NotificationBanner,
  NotificationPermissionBanner,
  ShareDialog,
} from './_components/DashboardChrome';
import { TypeAnalysis, WeeklyReport } from './_components/DashboardReports';
import { EtaReimportModal } from './_components/EtaReimportModal';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MiniCalendar } from './_components/MiniCalendar';
import { AIChat } from '@/components/ai-chat/AIChat';

interface Props {
  initialSchedules: Schedule[];
  initialProfile: UserProfile | null;
}

type SecondaryPanel = 'exams' | 'report' | 'analysis' | 'ai' | null;

export default function DashboardClient({ initialSchedules, initialProfile }: Props) {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { openClassForm, isShareModalOpen, openShareModal, closeShareModal } = useUIStore();
  const { data: schedules = [] } = useSchedules(initialSchedules);
  const { data: exams = [] } = useExams();
  const { data: profile } = useProfile(initialProfile ?? undefined);
  const toggleComplete = useToggleComplete();
  const updateExam = useUpdateExam();
  const deleteExam = useDeleteExam();

  const schedulesRef = useRef(schedules);
  useEffect(() => { schedulesRef.current = schedules; }, [schedules]);

  const secondaryPanelRef = useRef<HTMLDivElement>(null);

  const [shareToken, setShareToken] = useState<string | null>(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isEtaReimportOpen, setIsEtaReimportOpen] = useState(false);
  const [notification, setNotification] = useState<Schedule | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [secondaryPanel, setSecondaryPanel] = useState<SecondaryPanel>(null);
  const [selectedExam, setSelectedExam] = useState<ExamSchedule | null>(null);
  const [examEditFields, setExamEditFields] = useState<Partial<ExamSchedule>>({});
  const etaScheduleCount = schedules.filter((s) => s.schedule_source === 'eta_import').length;
  const queryClient = useQueryClient();

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

  // 시험 전날 복습 자동 생성
  useEffect(() => {
    if (!exams.length) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    for (const exam of exams) {
      const [y, m, d] = exam.exam_date.split('-').map(Number);
      const examDate = new Date(y, m - 1, d); examDate.setHours(0, 0, 0, 0);
      if (examDate <= today) continue;

      const preExamDate = new Date(y, m - 1, d - 1); preExamDate.setHours(0, 0, 0, 0);
      if (preExamDate < today) continue;

      const preExamStr = `${preExamDate.getFullYear()}-${String(preExamDate.getMonth() + 1).padStart(2, '0')}-${String(preExamDate.getDate()).padStart(2, '0')}`;
      const lsKey = `skema_pre_exam_${exam.id}_${preExamStr}`;
      if (localStorage.getItem(lsKey)) continue;

      const alreadyExists = schedulesRef.current.some(
        s => s.date === preExamStr && s.linked_exam_id === exam.id,
      );
      if (alreadyExists) { localStorage.setItem(lsKey, '1'); continue; }

      const dow = preExamDate.getDay() === 0 ? 6 : preExamDate.getDay() - 1;
      api.post('/schedules', {
        title: `📝 ${exam.title} 전날 복습`,
        schedule_type: 'study',
        date: preExamStr,
        recurring_day: indexToRecurringDay(dow),
        start_time: '20:00',
        end_time: '22:00',
        color: '#DC2626',
        priority: 2,
        linked_exam_id: exam.id,
      }).then(() => {
        localStorage.setItem(lsKey, '1');
        queryClient.invalidateQueries({ queryKey: ['schedules'] });
        toast.info(`${exam.title} 전날 복습 일정이 자동으로 추가되었습니다`, { duration: 6000 });
      }).catch(() => {
        localStorage.setItem(lsKey, '1'); // 충돌 등 실패 시 재시도 방지
      });
    }
  }, [exams, queryClient]);

  // 시험 전날 경보 토스트
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
        `내일 "${exam.title}" 시험! 오늘 전날 복습을 꼭 완료하세요`,
        { duration: 15000 },
      );
    });
  }, [exams]);

  // 오늘 할 일
  const now = new Date();
  const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekStart = getWeekStart(new Date(now.getFullYear(), now.getMonth(), now.getDate() + weekOffset * 7));
  // 서버의 get_today_schedules와 동일한 중복 제거:
  // 반복 일정 + 오늘 날짜 일정을 합치되, 같은 title+start_time의 dated 인스턴스가 있으면 반복 일정은 제외
  const todaySpecific = schedules.filter((s) => s.date === todayStr);
  const todayRecurring = schedules.filter((s) => !s.date && recurringDayToIndex(s.recurring_day) === todayDow);
  const todaySpecificKeys = new Set(todaySpecific.map((s) => `${s.title}|${s.start_time}`));
  const todaySchedules = [
    ...todaySpecific,
    ...todayRecurring.filter((s) => !todaySpecificKeys.has(`${s.title}|${s.start_time}`)),
  ].sort((a, b) => a.start_time.localeCompare(b.start_time));

  // 오늘 수행률
  const todayTotal = todaySchedules.length;
  const todayDone  = todaySchedules.filter((s) => s.is_completed).length;
  const todayPct   = todayTotal > 0 ? Math.round((todayDone / todayTotal) * 100) : null;

  // 미달성 일정 (오늘 + 이미 지난 시간 + 미완료)
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const unachievedSchedules = todaySchedules.filter((s) => {
    if (s.is_completed) return false;
    return timeToMinutes(s.end_time) < nowMin;
  });
  const remainingToday = todaySchedules.filter((s) => !s.is_completed);
  const nextSchedule = remainingToday.find((s) => timeToMinutes(s.start_time) >= nowMin) ?? remainingToday[0] ?? null;
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

  // 완료 토글 — optimistic update (useToggleComplete 훅 사용)
  const handleToggleComplete = (s: Schedule) => {
    toggleComplete.mutate(
      { id: s.id, is_completed: !s.is_completed },
      { onError: () => toast.error('업데이트 중 오류가 발생했습니다') },
    );
  };

  /** AI 액션 후 관련 모든 쿼리 무효화 */
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['schedules'] });
    queryClient.invalidateQueries({ queryKey: ['schedules', 'today'] });
    queryClient.invalidateQueries({ queryKey: ['schedules', 'conflicts'] });
    queryClient.invalidateQueries({ queryKey: ['exams'] });
  };

  const handleReschedule = async () => {
    setIsRegenerating(true);
    try {
      const { data } = await api.post<{ reply: string }>('/ai/chat', {
        message: '미완료 일정을 오늘 이후 빈 시간에 자동으로 재배치해줘',
        messages: [],
      });
      invalidateAll();
      toast.success(data.reply.includes('재배치했습니다') ? '일정이 재배치되었습니다' : '재배치 완료');
    } catch {
      toast.error('재배치 중 오류가 발생했습니다');
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
      const { data } = await api.post<{ token: string }>('/share-tokens');
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

  return (
    <>
      <DashboardStyles />
      <div className="flex h-screen flex-col bg-[#F1F5F9]">
        <NotificationBanner
          notification={notification}
          onOpen={(schedule) => {
            openClassForm(schedule);
            setNotification(null);
          }}
          onDismiss={() => setNotification(null)}
        />

        <NotificationPermissionBanner />

        <DashboardHeader
          user={user}
          todayPct={todayPct}
          todayDone={todayDone}
          todayTotal={todayTotal}
          secondaryPanel={secondaryPanel}
          onSetSecondaryPanel={setSecondaryPanel}
          onOpenEtaReimport={() => setIsEtaReimportOpen(true)}
          onAddSchedule={() => openClassForm()}
          onShare={handleShare}
          onOpenAdminUsers={() => router.push('/admin/users')}
          onOpenAdminLogs={() => router.push('/admin/login-logs')}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onLogout={handleLogout}
        />

        <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          <div className="mx-auto w-full max-w-[1400px] flex flex-col gap-3 sm:gap-5">

            {/* ── 상단 3열 ── */}
            <section className="grid gap-3 sm:gap-4 lg:grid-cols-[1fr_210px_280px]">

              {/* 오늘 할 일 카드 */}
              <div className="flex flex-col overflow-hidden rounded-2xl bg-white border border-slate-200">
                {/* 그라디언트 헤더 — 컴팩트 */}
                <div className="bg-gradient-to-r from-blue-200 via-sky-200 to-indigo-200 px-5 py-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <MaterialIcon icon="wb_sunny" size={13} color="#1d4ed8" filled />
                      <p className="text-xs font-bold text-blue-900">{todayLabel}</p>
                      <span className="text-blue-300">·</span>
                      <p className="text-xs font-bold text-blue-700">
                        완료 {todayDone}/{todayTotal} · 남은 {remainingToday.length}개
                      </p>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-black leading-none text-blue-900">{todayPct ?? 0}%</span>
                      <span className="text-[10px] font-bold text-blue-600">수행률</span>
                    </div>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-blue-100/80">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all duration-700"
                      style={{ width: `${todayPct ?? 0}%` }}
                    />
                  </div>
                </div>

                {/* 할 일 목록 */}
                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-50">
                        <MaterialIcon icon="checklist" size={15} color="#2563eb" />
                      </span>
                      <h2 className="text-sm font-black text-slate-900">오늘 할 일</h2>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700">
                        {remainingToday.length}개 남음
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => openClassForm()}
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-black text-white transition hover:bg-blue-700"
                      >
                        <MaterialIcon icon="add" size={13} color="#fff" />
                        추가
                      </button>
                      <button
                        onClick={handleReschedule}
                        disabled={isRegenerating || unachievedSchedules.length === 0}
                        className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-black text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <MaterialIcon icon="auto_fix_high" size={13} color="#2563eb" />
                        {isRegenerating ? '...' : 'AI 재배치'}
                      </button>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {todaySchedules.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-blue-100 bg-blue-50/50 py-8">
                        <MaterialIcon icon="event_available" size={28} color="#93c5fd" />
                        <p className="text-xs font-bold text-slate-400">오늘 일정이 없습니다</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                      {todaySchedules.map((schedule) => (
                        <button
                          key={schedule.id}
                          onClick={() => handleToggleComplete(schedule)}
                          className={`flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition ${
                            schedule.is_completed
                              ? 'border-emerald-100 bg-emerald-50/60 hover:bg-emerald-50'
                              : 'border-slate-100 bg-white hover:bg-blue-50/60 hover:border-blue-200'
                          }`}
                        >
                          {/* 컬러 인디케이터 */}
                          <span
                            className="h-7 w-1 shrink-0 rounded-full"
                            style={{ background: schedule.color || '#2563eb' }}
                          />
                          {/* 체크박스 */}
                          <span
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition"
                            style={{
                              background: schedule.is_completed ? '#10b981' : '#fff',
                              borderColor: schedule.is_completed ? '#10b981' : '#bfdbfe',
                            }}
                          >
                            {schedule.is_completed && <MaterialIcon icon="check" size={10} color="#fff" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-sm font-bold ${schedule.is_completed ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                              {schedule.title}
                            </span>
                            <span className="text-xs text-slate-400">
                              {schedule.start_time} – {schedule.end_time}
                            </span>
                          </span>
                          {schedule.is_completed && (
                            <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                              완료 ✓
                            </span>
                          )}
                        </button>
                      ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 다가오는 시험 */}
              <div className="flex flex-col overflow-hidden rounded-2xl bg-white border border-slate-200">
                <div className="bg-gradient-to-r from-blue-200 via-sky-200 to-indigo-200 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <MaterialIcon icon="school" size={16} color="#1d4ed8" filled />
                    <h2 className="text-sm font-black text-blue-900">다가오는 시험</h2>
                  </div>
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-3 flex justify-end">
                    <button
                      onClick={() => setSecondaryPanel('exams')}
                      className="text-[10px] font-black text-amber-600 hover:text-amber-700"
                    >
                      전체 보기 →
                    </button>
                  </div>
                  {upcomingExam ? (
                    <div className="space-y-2">
                      {upcomingExams.map((exam) => {
                        const days = getDaysUntil(exam.exam_date);
                        const isUrgent = days <= 3;
                        const isWarning = !isUrgent && days <= 7;
                        return (
                          <button
                            key={exam.id}
                            onClick={() => {
                              setSecondaryPanel('exams');
                              setTimeout(() => secondaryPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-xl border p-2.5 text-left transition ${
                              isUrgent
                                ? 'border-blue-300 bg-blue-100/60 hover:bg-blue-100'
                                : isWarning
                                ? 'border-sky-200 bg-sky-50/70 hover:bg-sky-50'
                                : 'border-slate-100 hover:bg-sky-50/50'
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <MaterialIcon
                                icon={isUrgent ? 'warning' : 'event'}
                                size={14}
                                color={isUrgent ? '#1d4ed8' : isWarning ? '#0284c7' : '#64748b'}
                                filled
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-xs font-black text-slate-900">{exam.title}</span>
                                <span className="text-[10px] font-bold text-slate-400">{exam.exam_date}</span>
                              </span>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
                              isUrgent
                                ? 'bg-blue-200 text-blue-800'
                                : isWarning
                                ? 'bg-sky-100 text-sky-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}>
                              {formatDday(days)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-amber-100 bg-amber-50/40 py-6">
                      <MaterialIcon icon="school" size={26} color="#fbbf24" />
                      <p className="text-xs font-bold text-slate-400">등록된 시험 없음</p>
                    </div>
                  )}
                </div>
              </div>

              {/* 월간 달력 */}
              <div className="flex flex-col overflow-hidden rounded-2xl bg-white border border-slate-200">
                <div className="flex-1 p-4">
                  <MiniCalendar schedules={schedules} />
                </div>
              </div>
            </section>

            {/* ── 하단 2열 ── */}
            <section className="grid gap-3 sm:gap-5 xl:grid-cols-[440px_1fr]">

              {/* AI 채팅 */}
              <div className="overflow-hidden rounded-2xl bg-white border border-slate-200">
                <AIChat height={480} />
              </div>

              {/* 주간 시간표 */}
              <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl bg-white border border-slate-200 min-h-[400px] xl:min-h-[480px]">
                <div className="bg-gradient-to-r from-blue-200 via-sky-200 to-indigo-200 px-5 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MaterialIcon icon="calendar_view_week" size={16} color="#1d4ed8" filled />
                      <div>
                        <h2 className="text-sm font-black text-blue-900">주간 시간표</h2>
                        <p className="text-[10px] font-bold text-blue-600">{weekLabel}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        className="rounded-lg bg-white/50 p-1.5 transition hover:bg-white/80"
                        onClick={() => setWeekOffset((o) => o - 1)}
                        aria-label="이전 주"
                      >
                        <MaterialIcon icon="chevron_left" size={16} color="#1d4ed8" />
                      </button>
                      <button
                        className="rounded-lg bg-white/50 px-3 py-1.5 text-xs font-black text-blue-900 transition hover:bg-white/80"
                        onClick={() => setWeekOffset(0)}
                      >
                        이번 주
                      </button>
                      <button
                        className="rounded-lg bg-white/50 p-1.5 transition hover:bg-white/80"
                        onClick={() => setWeekOffset((o) => o + 1)}
                        aria-label="다음 주"
                      >
                        <MaterialIcon icon="chevron_right" size={16} color="#1d4ed8" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="min-h-[440px] flex-1 overflow-hidden">
                  <Timetable
                    schedules={schedules}
                    exams={exams}
                    weekStart={weekStart}
                    onExamClick={(exam) => {
                      setSelectedExam(exam);
                      setExamEditFields({
                        title: exam.title,
                        exam_date: exam.exam_date,
                        exam_time: exam.exam_time ?? '',
                        location: exam.location ?? '',
                        memo: exam.memo ?? '',
                      });
                    }}
                  />
                </div>
              </div>
            </section>

          </div>
        </main>
      </div>

      <ClassForm />

      {/* 보조 패널 모달 */}
      <Dialog open={!!secondaryPanel} onOpenChange={(open) => !open && setSecondaryPanel(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {secondaryPanel === 'exams'    && '시험 일정'}
              {secondaryPanel === 'report'   && '주간 리포트'}
              {secondaryPanel === 'analysis' && '유형별 분석'}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2">
            {secondaryPanel === 'exams'    && <ExamList />}
            {secondaryPanel === 'report'   && <WeeklyReport schedules={schedules} />}
            {secondaryPanel === 'analysis' && <TypeAnalysis schedules={schedules} weekStart={weekStart} />}
          </div>
        </DialogContent>
      </Dialog>

      <SettingsModal
        open={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
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

      {/* 시험 편집/삭제 다이얼로그 (주간 시간표에서 시험 클릭 시) */}
      <Dialog open={!!selectedExam} onOpenChange={(open) => !open && setSelectedExam(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon icon="school" size={18} color="#1d4ed8" filled />
              시험 일정
            </DialogTitle>
          </DialogHeader>
          {selectedExam && (
            <div className="mt-2 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">제목</label>
                <input
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  value={examEditFields.title ?? ''}
                  onChange={(e) => setExamEditFields((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">시험일</label>
                <input
                  type="date"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  value={examEditFields.exam_date ?? ''}
                  onChange={(e) => setExamEditFields((f) => ({ ...f, exam_date: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">시험 시간</label>
                <input
                  type="time"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  value={examEditFields.exam_time ?? ''}
                  onChange={(e) => setExamEditFields((f) => ({ ...f, exam_time: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">장소</label>
                <input
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  value={examEditFields.location ?? ''}
                  onChange={(e) => setExamEditFields((f) => ({ ...f, location: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-600">메모</label>
                <textarea
                  rows={2}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 resize-none"
                  value={examEditFields.memo ?? ''}
                  onChange={(e) => setExamEditFields((f) => ({ ...f, memo: e.target.value }))}
                />
              </div>
              <div className="flex justify-between gap-2 pt-1">
                <button
                  onClick={async () => {
                    if (!confirm('이 시험 일정을 삭제할까요? 연결된 공부 블록도 함께 삭제됩니다.')) return;
                    try {
                      await deleteExam.mutateAsync(selectedExam.id);
                      queryClient.invalidateQueries({ queryKey: ['schedules'] });
                      toast.success('시험 일정이 삭제되었습니다');
                      setSelectedExam(null);
                    } catch {
                      toast.error('삭제 중 오류가 발생했습니다');
                    }
                  }}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-100"
                >
                  삭제
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedExam(null)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
                  >
                    취소
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await updateExam.mutateAsync({ id: selectedExam.id, ...examEditFields });
                        toast.success('시험 일정이 수정되었습니다');
                        setSelectedExam(null);
                      } catch {
                        toast.error('수정 중 오류가 발생했습니다');
                      }
                    }}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-blue-700"
                  >
                    저장
                  </button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
