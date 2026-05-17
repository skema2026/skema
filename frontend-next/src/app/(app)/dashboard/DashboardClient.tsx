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
import { useExams } from '@/hooks/useExams';
import { useProfile } from '@/hooks/useProfile';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/lib/api';
import { indexToRecurringDay, recurringDayToIndex } from '@/lib/recurringDay';
import { timeToMinutes } from '@/lib/utils';
import MaterialIcon from '@/components/common/MaterialIcon';
import { Schedule, UserProfile } from '@/types';
import {
  DashboardHeader,
  DashboardStyles,
  NotificationBanner,
  ShareDialog,
} from './_components/DashboardChrome';
import { TypeAnalysis, WeeklyReport } from './_components/DashboardReports';
import { SmartAlertPanel } from './_components/SmartAlertPanel';
import { EtaReimportModal } from './_components/EtaReimportModal';

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
      <div className="flex h-screen flex-col bg-[#f8fbff]">
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
          onAddSchedule={() => openClassForm()}
          onShare={handleShare}
          onOpenAdminUsers={() => router.push('/admin/users')}
          onOpenAdminLogs={() => router.push('/admin/login-logs')}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onLogout={handleLogout}
        />

        <main className="min-h-0 flex-1 overflow-y-auto bg-[#f8fbff] p-5">
          <div className="mx-auto flex max-w-7xl flex-col gap-5">
            <section className="grid gap-4 lg:grid-cols-[1.45fr_0.9fr]">
              <div className="rounded-lg border border-blue-100 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black text-blue-600">{todayLabel}</p>
                    <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">
                      오늘 해야 할 것만 먼저 봅니다
                    </h1>
                    <p className="mt-2 text-sm font-medium text-slate-500">
                      남은 일정 {remainingToday.length}개, 완료 {todayDone}/{todayTotal}
                    </p>
                  </div>

                  <div className="min-w-[140px]">
                    <div className="text-right text-3xl font-black text-blue-600">
                      {todayPct ?? 0}%
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-50">
                      <div
                        className="h-full rounded-full bg-blue-600"
                        style={{ width: `${todayPct ?? 0}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-blue-700">다음 일정</p>
                      <p className="mt-1 truncate text-lg font-black text-slate-950">
                        {nextSchedule ? nextSchedule.title : '오늘 남은 일정이 없습니다'}
                      </p>
                      {nextSchedule && (
                        <p className="mt-1 text-sm font-bold text-slate-500">
                          {nextSchedule.start_time} - {nextSchedule.end_time}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => openClassForm()}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white transition hover:bg-blue-700"
                      >
                        <MaterialIcon icon="add" size={18} color="#fff" />
                        일정 추가
                      </button>
                      <button
                        onClick={handleReschedule}
                        disabled={isRegenerating || unachievedSchedules.length === 0}
                        className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-black text-blue-700 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <MaterialIcon icon="auto_fix_high" size={18} color="#2563eb" />
                        {isRegenerating ? '재배치 중...' : 'AI 재배치'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-blue-100 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-black text-slate-950">다가오는 시험</h2>
                  <button
                    onClick={() => setSecondaryPanel('exams')}
                    className="text-xs font-black text-blue-600 hover:text-blue-700"
                  >
                    전체 보기
                  </button>
                </div>

                {upcomingExam ? (
                  <div className="space-y-2">
                    {upcomingExams.map((exam) => {
                      const days = getDaysUntil(exam.exam_date);

                      return (
                        <button
                          key={exam.id}
                          onClick={() => {
                            setSecondaryPanel('exams');
                            setTimeout(() => secondaryPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                          }}
                          className="flex w-full items-center justify-between gap-3 rounded-lg border border-blue-50 p-3 text-left transition hover:bg-blue-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-black text-slate-950">
                              {exam.title}
                            </span>
                            <span className="text-xs font-bold text-slate-500">
                              {exam.exam_date}
                            </span>
                          </span>
                          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">
                            {formatDday(days)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-blue-100 bg-blue-50/40 p-5 text-center">
                    <p className="text-sm font-bold text-slate-500">등록된 예정 시험이 없습니다</p>
                  </div>
                )}
              </div>
            </section>

            <section className="grid min-h-[560px] gap-5 xl:grid-cols-[360px_1fr]">
              <div className="rounded-lg border border-blue-100 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-black text-slate-950">오늘 할 일</h2>
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">
                    {remainingToday.length}개 남음
                  </span>
                </div>

                {todaySchedules.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-blue-100 bg-blue-50/40 p-6 text-center">
                    <p className="text-sm font-bold text-slate-500">오늘은 비어 있습니다</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {todaySchedules.map((schedule) => (
                      <button
                        key={schedule.id}
                        onClick={() => handleToggleComplete(schedule)}
                        className="flex w-full items-center gap-3 rounded-lg border border-blue-50 p-3 text-left transition hover:bg-blue-50/70"
                      >
                        <span
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2"
                          style={{
                            background: schedule.is_completed ? '#2563eb' : '#fff',
                            borderColor: schedule.is_completed ? '#2563eb' : '#bfdbfe',
                          }}
                        >
                          {schedule.is_completed && (
                            <MaterialIcon icon="check" size={13} color="#fff" />
                          )}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-black text-slate-950">
                            {schedule.title}
                          </span>
                          <span className="text-xs font-bold text-slate-400">
                            {schedule.start_time} - {schedule.end_time}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-col rounded-lg border border-blue-100 bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-black text-slate-950">주간 시간표</h2>
                    <p className="mt-1 text-sm font-bold text-slate-400">{weekLabel}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-lg border border-blue-100 p-2 transition hover:bg-blue-50"
                      onClick={() => setWeekOffset((o) => o - 1)}
                      aria-label="이전 주"
                    >
                      <MaterialIcon icon="chevron_left" size={18} color="#2563eb" />
                    </button>
                    <button
                      className="rounded-lg border border-blue-100 px-4 py-2 text-xs font-black text-blue-700 transition hover:bg-blue-50"
                      onClick={() => setWeekOffset(0)}
                    >
                      이번 주
                    </button>
                    <button
                      className="rounded-lg border border-blue-100 p-2 transition hover:bg-blue-50"
                      onClick={() => setWeekOffset((o) => o + 1)}
                      aria-label="다음 주"
                    >
                      <MaterialIcon icon="chevron_right" size={18} color="#2563eb" />
                    </button>
                  </div>
                </div>

                <div className="min-h-[480px] flex-1 overflow-hidden rounded-lg border border-blue-50">
                  <Timetable schedules={schedules} exams={exams} weekStart={weekStart} />
                </div>
              </div>
            </section>

            <section ref={secondaryPanelRef} className="rounded-lg border border-blue-100 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-black text-slate-950">보조 화면</h2>
                  <p className="mt-1 text-sm font-bold text-slate-400">
                    자주 쓰지 않는 분석과 관리 기능은 필요할 때만 엽니다
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSecondaryPanel(secondaryPanel === 'exams' ? null : 'exams')}
                    className={`rounded-lg border px-3 py-2 text-xs font-black transition ${
                      secondaryPanel === 'exams'
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-blue-100 bg-white text-slate-600 hover:bg-blue-50'
                    }`}
                  >
                    시험 일정
                  </button>
                  <button
                    onClick={() => setSecondaryPanel(secondaryPanel === 'report' ? null : 'report')}
                    className={`rounded-lg border px-3 py-2 text-xs font-black transition ${
                      secondaryPanel === 'report'
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-blue-100 bg-white text-slate-600 hover:bg-blue-50'
                    }`}
                  >
                    리포트
                  </button>
                  <button
                    onClick={() => setSecondaryPanel(secondaryPanel === 'analysis' ? null : 'analysis')}
                    className={`rounded-lg border px-3 py-2 text-xs font-black transition ${
                      secondaryPanel === 'analysis'
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-blue-100 bg-white text-slate-600 hover:bg-blue-50'
                    }`}
                  >
                    유형 분석
                  </button>
                  <button
                    onClick={() => setSecondaryPanel(secondaryPanel === 'ai' ? null : 'ai')}
                    className={`rounded-lg border px-3 py-2 text-xs font-black transition ${
                      secondaryPanel === 'ai'
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-blue-100 bg-white text-slate-600 hover:bg-blue-50'
                    }`}
                  >
                    AI 패널
                  </button>
                  <button
                    onClick={() => setIsEtaReimportOpen(true)}
                    className="rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:bg-blue-50"
                  >
                    시간표 업로드
                  </button>
                  <button
                    onClick={handleShare}
                    className="rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:bg-blue-50"
                  >
                    공유
                  </button>
                </div>
              </div>

              {secondaryPanel && (
                <div className="mt-5 rounded-lg border border-blue-50 bg-[#fbfdff] p-4">
                  {secondaryPanel === 'exams' && <ExamList />}
                  {secondaryPanel === 'report' && <WeeklyReport schedules={schedules} />}
                  {secondaryPanel === 'analysis' && (
                    <TypeAnalysis schedules={schedules} weekStart={weekStart} />
                  )}
                  {secondaryPanel === 'ai' && (
                    <SmartAlertPanel
                      exams={exams}
                      schedules={schedules}
                    />
                  )}
                </div>
              )}
            </section>
          </div>
        </main>
      </div>

      <ClassForm />

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
    </>
  );
}
