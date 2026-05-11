'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Timetable, getWeekStart } from '@/components/timetable/Timetable';
import { ClassForm } from '@/components/class-form/ClassForm';
import { ExamList } from '@/components/exam/ExamList';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { useConflicts, useSchedules, useToggleComplete } from '@/hooks/useSchedules';
import { useExams } from '@/hooks/useExams';
import { useProfile } from '@/hooks/useProfile';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/lib/api';
import { indexToRecurringDay, recurringDayToIndex } from '@/lib/recurringDay';
import { timeToMinutes } from '@/lib/utils';
import MaterialIcon from '@/components/common/MaterialIcon';
import { Schedule, UserProfile, ExamSchedule } from '@/types';
import {
  DashboardHeader,
  DashboardStyles,
  NotificationBanner,
  ShareDialog,
} from './_components/DashboardChrome';
import { TypeAnalysis, WeeklyReport } from './_components/DashboardReports';
import { SmartAlertPanel } from './_components/SmartAlertPanel';

interface Props {
  initialSchedules: Schedule[];
  initialProfile: UserProfile | null;
}

export default function DashboardClient({ initialSchedules, initialProfile }: Props) {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { openClassForm, isShareModalOpen, openShareModal, closeShareModal } = useUIStore();
  const { data: schedules = [] } = useSchedules(initialSchedules);
  const { data: exams = [] } = useExams();
  const { data: profile } = useProfile(initialProfile ?? undefined);
  const { data: conflicts = [] } = useConflicts();
  const toggleComplete = useToggleComplete();

  const schedulesRef = useRef(schedules);
  useEffect(() => { schedulesRef.current = schedules; }, [schedules]);

  const [shareToken, setShareToken] = useState<string | null>(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [notification, setNotification] = useState<Schedule | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const ALL_TYPES = ['class', 'study', 'assignment', 'activity', 'personal'] as const;
  type ScheduleTypeTuple = typeof ALL_TYPES;
  type ScheduleTypeFilter = ScheduleTypeTuple[number];
  const [activeTypes, setActiveTypes] = useState<Set<ScheduleTypeFilter>>(new Set(ALL_TYPES));
  const toggleType = (t: ScheduleTypeFilter) =>
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) {
        next.delete(t);
      } else {
        next.add(t);
      }
      return next;
    });
  const filteredSchedules = schedules.filter(s =>
    activeTypes.has((s.schedule_type as ScheduleTypeFilter) ?? 'personal')
  );
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

  // 이번 주 수행률 (현재 실제 주, weekOffset 무관)
  const currentWeekStart = getWeekStart(now);
  const currentWeekEnd   = currentWeekStart.getTime() + 7 * 24 * 3600 * 1000;
  const weekSchedules = schedules.filter((s) => {
    if (!s.date) return true; // 반복 일정: 요일 기준으로 이번 주에 존재
    const [y, m, d] = s.date.split('-').map(Number);
    const t = new Date(y, m - 1, d).getTime();
    return t >= currentWeekStart.getTime() && t < currentWeekEnd;
  });
  const weekTotal = weekSchedules.length;
  const weekDone  = weekSchedules.filter((s) => s.is_completed).length;
  const weekPct   = weekTotal > 0 ? Math.round((weekDone / weekTotal) * 100) : null;

  // 미달성 일정 (오늘 + 이미 지난 시간 + 미완료)
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const unachievedSchedules = todaySchedules.filter((s) => {
    if (s.is_completed) return false;
    return timeToMinutes(s.end_time) < nowMin;
  });
  const remainingToday = todaySchedules.filter((s) => !s.is_completed);
  const nextSchedule = remainingToday.find((s) => timeToMinutes(s.start_time) >= nowMin) ?? remainingToday[0] ?? null;
  const upcomingExam = exams
    .filter((e) => {
      const [y, m, d] = e.exam_date.split('-').map(Number);
      const examDate = new Date(y, m - 1, d);
      examDate.setHours(23, 59, 59, 999);
      return examDate >= now;
    })
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date))[0] ?? null;
  const daysUntilExam = upcomingExam
    ? Math.ceil((new Date(`${upcomingExam.exam_date}T00:00:00`).getTime() - new Date(`${todayStr}T00:00:00`).getTime()) / 86400000)
    : null;
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

      <div className="skema-dashboard-shell flex h-screen flex-col bg-slate-50">
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

        {/* 메인 영역 */}
        <main className="flex min-h-0 flex-1 gap-4 overflow-hidden bg-slate-50 p-4">
          {/* 왼쪽: 시간표 */}
          <section className="flex min-w-0 flex-[3] flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="mb-6 flex items-end justify-between">
              <div>
                <h1 className="text-4xl font-black tracking-tight text-slate-900">
                  주간 시간표
                </h1>
                <p className="mt-2 text-sm text-slate-400">
                  {weekLabel} · 이번 주는 {weekTotal}개의 일정이 있습니다
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex rounded-lg bg-slate-100 p-0.5">
                  <button className="rounded p-1.5 hover:bg-white" onClick={() => setWeekOffset((o) => o - 1)}>
                    <MaterialIcon icon="chevron_left" size={18} color="#334155" />
                  </button>
                  <button className="px-4 py-1 text-xs font-bold text-slate-700" onClick={() => setWeekOffset(0)}>
                    이번 주
                  </button>
                  <button className="rounded p-1.5 hover:bg-white" onClick={() => setWeekOffset((o) => o + 1)}>
                    <MaterialIcon icon="chevron_right" size={18} color="#334155" />
                  </button>
                </div>

                <button
                  className="rounded-lg border border-slate-200 px-4 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
                  onClick={() => setActiveTypes(activeTypes.size === ALL_TYPES.length ? new Set() : new Set(ALL_TYPES))}
                >
                  {activeTypes.size === ALL_TYPES.length ? '필터 해제' : '전체 표시'}
                </button>
              </div>
            </div>

            <div className="mb-6 flex gap-4">
              <div className="flex flex-1 items-center justify-between rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-blue-500 p-2 text-white">
                    <MaterialIcon icon="event_upcoming" size={18} color="#fff" />
                  </div>

                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      오늘은 이것만 놓치지 마세요:{" "}
                      {nextSchedule ? nextSchedule.title : '남은 일정이 없습니다'}
                    </h2>
                  </div>

                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[10px] font-bold uppercase text-blue-500">다음 액션</p>
                    <p className="mt-1 truncate text-sm font-bold text-slate-900">
                      {nextSchedule ? nextSchedule.title : '남은 일정이 없습니다'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex w-48 flex-col justify-center rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-[10px] font-bold text-slate-400">남은 오늘 일정</p>
                <div className="flex items-baseline gap-1">
                  <p className="text-2xl font-black text-slate-900">
                    {remainingToday.length}
                  </p>
                  <p className="text-xs font-bold text-slate-500">개</p>
                </div>
              </div>
            </div>

            <div className="mb-6 flex flex-wrap gap-2">
              {[
                { type: 'class', label: '수업', color: '#2563eb' },
                { type: 'study', label: '자율학습', color: '#16a34a' },
                { type: 'assignment', label: '과제', color: '#ea580c' },
                { type: 'activity', label: '활동', color: '#9333ea' },
                { type: 'personal', label: '개인', color: '#0ea5e9' },
              ].map(({ type, label, color }) => {
                const active = activeTypes.has(type as ScheduleTypeFilter);
                return (
                  <button
                    key={type}
                    onClick={() => toggleType(type as ScheduleTypeFilter)}
                    className="rounded-full px-3 py-1 text-xs font-bold"
                    style={{
                      background: active ? `${color}20` : '#f1f5f9',
                      color: active ? color : '#64748b',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <Tabs defaultValue="timetable" className="flex min-h-0 flex-1 flex-col">
              <TabsList className="mb-4 w-fit">
                <TabsTrigger value="timetable">시간표</TabsTrigger>
                <TabsTrigger value="exams">시험 일정</TabsTrigger>
                <TabsTrigger value="report">리포트</TabsTrigger>
                <TabsTrigger value="type-analysis">분석</TabsTrigger>
              </TabsList>

              <div className="min-h-0 flex-1 overflow-hidden">
                <TabsContent value="timetable" className="h-full">
                  <Timetable schedules={filteredSchedules} exams={exams} weekStart={weekStart} />
                </TabsContent>
                <TabsContent value="exams">
                  <ExamList />
                </TabsContent>
                <TabsContent value="report">
                  <WeeklyReport schedules={schedules} />
                </TabsContent>
                <TabsContent value="type-analysis">
                  <TypeAnalysis schedules={schedules} weekStart={weekStart} />
                </TabsContent>
              </div>
            </Tabs>
          </section>

          {/* 오른쪽: 요약 */}
          <aside className="flex-1 max-w-sm overflow-y-auto pr-1">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <p className="text-[10px] font-bold text-slate-400">오늘 진행률</p>
                  <p className="mt-2 text-2xl font-black text-slate-900">{todayPct ?? 0}%</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-blue-500" style={{ width: `${todayPct ?? 0}%` }} />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <p className="text-[10px] font-bold text-slate-400">남은 일정</p>
                  <p className="mt-2 text-2xl font-black text-slate-900">{remainingToday.length}개</p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <h3 className="mb-4 text-xs font-bold text-slate-900">오늘 할 일</h3>

                {todaySchedules.length === 0 ? (
                  <div className="rounded-xl border-2 border-dashed border-slate-100 p-6 text-center">
                    <p className="text-xs font-medium text-slate-400">오늘은 비어 있습니다</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {todaySchedules.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => handleToggleComplete(s)}
                        className="flex w-full items-center gap-3 rounded-xl border border-slate-100 p-3 text-left hover:bg-slate-50"
                      >
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2"
                        style={{
                          background: s.is_completed ? '#16a34a' : '#fff',
                          borderColor: s.is_completed ? '#16a34a' : '#cbd5e1',
                        }}
                      >
                        {s.is_completed && <MaterialIcon icon="check" size={13} color="#fff" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-slate-900">{s.title}</span>
                        <span className="text-xs text-slate-400">{s.start_time} - {s.end_time}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {unachievedSchedules.length > 0 && (
                <button
                  onClick={handleReschedule}
                  disabled={isRegenerating}
                  className="mt-4 w-full rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-600 hover:bg-blue-100 disabled:opacity-60"
                >
                  {isRegenerating ? '재배치 중...' : '밀린 일정 AI 재배치'}
                </button>
              )}
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-xs font-bold text-slate-900">우선순위 패널</h3>

              {upcomingExam ? (
                <div className="mb-4 rounded-xl border border-green-100 bg-green-50 p-4">
                  <p className="text-xs font-bold text-green-600">다가오는 시험</p>
                  <p className="mt-2 text-sm font-black text-slate-900">{upcomingExam.title}</p>
                  <p className="text-xs font-bold text-slate-500">
                    {upcomingExam.exam_date} · D-{daysUntilExam}
                  </p>
                </div>
              ) : (
                <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-4 text-center">
                  <p className="text-[10px] font-bold text-slate-400">
                    등록된 예정 시험이 없습니다
                  </p>
                </div>
              )}

              <SmartAlertPanel exams={exams} schedules={schedules} currentWeekStart={weekStart} />
            </div>
          </div>
        </aside>
      </main>
    </div>
  </>
  );
}
