'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { SmartAlertPanel, TypeAnalysis, WeeklyReport } from './_components/DashboardPanels';

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
      <style>{`
        .hide-mobile { display: none; }
        @media (min-width: 640px) { .hide-mobile { display: inline; } }
        .skema-dashboard-shell {
          background:
            linear-gradient(135deg, rgba(246,248,252,.98), rgba(232,243,255,.94)),
            linear-gradient(90deg, rgba(37,99,235,.08) 1px, transparent 1px),
            linear-gradient(rgba(14,165,233,.07) 1px, transparent 1px);
          background-size: auto, 28px 28px, 28px 28px;
        }
        .skema-dashboard-header {
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
        }
        .skema-dashboard-main [data-slot="tabs-list"] {
          max-width: 100%;
          overflow-x: auto;
          justify-content: flex-start;
          background: #f8fbff;
          border: 1px solid #d8e2ef;
          box-shadow: 0 8px 20px rgba(23,32,51,.05);
        }
        .skema-dashboard-main [data-slot="tabs-trigger"] {
          min-width: fit-content;
          color: #3f4b61;
          font-weight: 700;
        }
        .skema-dashboard-main [data-slot="tabs-trigger"][data-active] {
          background: #2563eb;
          color: white;
        }
        .skema-dash-scroll {
          min-height: 0;
          overflow: auto;
          padding: 18px;
        }
        .skema-command-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.45fr) minmax(320px, .85fr);
          gap: 14px;
          margin-bottom: 14px;
        }
        .skema-panel {
          background: rgba(255,255,255,.96);
          border: 1px solid #d8e2ef;
          border-radius: 8px;
          box-shadow: 0 12px 32px rgba(23,32,51,.07);
        }
        .skema-focus-panel {
          padding: 20px;
          background:
            linear-gradient(135deg, rgba(255,255,255,.97), rgba(247,250,255,.97)),
            linear-gradient(90deg, rgba(37,99,235,.06) 1px, transparent 1px),
            linear-gradient(rgba(37,99,235,.05) 1px, transparent 1px);
          background-size: auto, 24px 24px, 24px 24px;
        }
        .skema-kpi-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .skema-kpi {
          padding: 14px;
          border-radius: 8px;
          border: 1px solid #d8e2ef;
          background: #f8fbff;
        }
        .skema-work-grid {
          display: grid;
          grid-template-columns: 310px minmax(0, 1fr) 330px;
          gap: 14px;
          align-items: start;
        }
        .skema-section-title {
          color: #0f172a;
          font-size: 13px;
          font-weight: 900;
          letter-spacing: .01em;
        }
        .skema-muted {
          color: #516078;
          font-size: 12px;
          line-height: 1.6;
        }
        .skema-icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          border: 1px solid #d8e2ef;
          background: #fff;
          color: #334155;
          cursor: pointer;
        }
        .skema-primary-action {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          min-height: 36px;
          padding: 0 14px;
          border: 0;
          border-radius: 8px;
          background: #2563eb;
          color: #fff;
          font-size: 13px;
          font-weight: 800;
          box-shadow: 0 8px 18px rgba(37,99,235,.2);
          cursor: pointer;
        }
        .skema-secondary-action {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          min-height: 36px;
          padding: 0 12px;
          border: 1px solid #c7d2e2;
          border-radius: 8px;
          background: #fff;
          color: #334155;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
        }
        .skema-task-row {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          padding: 10px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          background: #fffdf9;
          cursor: pointer;
        }
        .skema-task-row + .skema-task-row {
          margin-top: 8px;
        }
        .skema-dashboard-main [data-slot="tabs"] {
          gap: 10px;
        }
        @media (max-width: 640px) {
          .skema-dashboard-header {
            height: auto !important;
            min-height: 58px;
            gap: 10px;
            padding: 10px 12px !important;
            flex-wrap: wrap;
          }
          .skema-dashboard-title-badge {
            order: 3;
            width: 100%;
          }
          .skema-dashboard-main {
            padding: 12px !important;
          }
        }
        @media (max-width: 1180px) {
          .skema-command-grid,
          .skema-work-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 720px) {
          .skema-dash-scroll {
            padding: 12px;
          }
          .skema-kpi-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
      <div className="skema-dashboard-shell flex h-screen flex-col">

        {/* Notification Banner */}
        {notification && (
          <div
            style={{
              position: 'fixed', top: 64, right: 16, zIndex: 200,
              background: '#fff', border: '1px solid rgba(195,198,213,0.25)',
              borderLeft: '4px solid var(--skema-primary)',
              borderRadius: 14, padding: '12px 16px',
              boxShadow: '0 8px 32px rgba(24,28,30,0.12)',
              maxWidth: 300, display: 'flex', gap: 10, alignItems: 'flex-start',
              cursor: 'pointer',
            }}
            onClick={() => { openClassForm(notification); setNotification(null); }}
          >
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#dae1ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <MaterialIcon icon="notifications_active" size={18} color="var(--skema-primary)" filled />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#181c1e' }}>곧 시작! (클릭하면 일정 확인)</div>
              <div style={{ fontSize: 12, color: '#334155', marginTop: 2 }}>{notification.title} — {notification.start_time}</div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setNotification(null); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3f4b61', fontSize: 16, padding: 0, lineHeight: 1 }}
            >×</button>
          </div>
        )}

        {/* Header */}
        <header className="skema-dashboard-header" style={{
          height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 20px', borderBottom: '1px solid var(--skema-container)',
          background: 'rgba(255,255,255,0.94)', position: 'sticky', top: 0, zIndex: 30, flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'var(--skema-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcon icon="schedule" size={15} color="#fff" filled />
            </div>
              <span className="skema-headline" style={{ fontWeight: 800, fontSize: '18px', color: 'var(--skema-on-surface)', letterSpacing: 0 }}>SKEMA</span>
            {todayPct !== null && (
              <span className="skema-dashboard-title-badge" style={{
                padding: '2px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 700,
                background: todayPct >= 80 ? '#d1fae5' : todayPct >= 40 ? '#fef9c3' : 'var(--skema-surface-low)',
                color: todayPct >= 80 ? '#059669' : todayPct >= 40 ? '#d97706' : 'var(--skema-on-surface-variant)',
              }}>
                오늘 {todayPct}% ({todayDone}/{todayTotal})
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button onClick={() => openClassForm()} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--skema-primary)', color: '#fff', border: 'none', borderRadius: '10px', padding: '7px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 8px 18px var(--skema-primary-shadow)' }}>
              <MaterialIcon icon="add" size={16} color="#fff" />
              <span className="hide-mobile">일정</span> 추가
            </button>

            <button
              onClick={handleShare}
              title="공유"
              style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--skema-surface-low)', border: 'none', borderRadius: '10px', padding: '7px 12px', fontSize: '13px', fontWeight: 600, color: 'var(--skema-on-surface-variant)', cursor: 'pointer' }}
            >
              <MaterialIcon icon="share" size={16} color="var(--skema-on-surface-variant)" />
              <span className="hide-mobile">공유</span>
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-full transition-all outline-none">
                <Avatar className="w-8 h-8">
                  <AvatarFallback className="text-xs font-bold" style={{ background: 'var(--skema-secondary-container)', color: 'var(--skema-primary)' }}>
                    {user?.email?.[0]?.toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <p className="font-semibold">{user?.email}</p>
                    <p className="text-xs text-gray-500 font-normal">{user?.email}</p>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  {user?.is_admin && (
                    <>
                      <DropdownMenuItem onClick={() => router.push('/admin/users')}>
                        관리자 회원 관리
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => router.push('/admin/login-logs')}>
                        관리자 로그인 로그
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem onClick={() => setIsSettingsOpen(true)}>
                    설정
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
                    로그아웃
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Main Content */}
        <div className="skema-dash-scroll flex-1">
          <section className="skema-command-grid">
            <div className="skema-panel skema-focus-panel">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em]" style={{ color: '#2563eb' }}>{todayLabel}</p>
                  <h1 className="mt-2 text-2xl font-black tracking-normal text-[#0f172a] sm:text-3xl">
                    오늘은 이것만 놓치지 마세요
                  </h1>
                  <p className="mt-2 max-w-xl text-sm font-medium leading-7 text-[#516078]">
                    다음 일정, 밀린 일정, 시험 경보를 먼저 처리하고 시간표에서 주간 흐름을 조정하세요.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="skema-primary-action" onClick={() => openClassForm()}>
                    <MaterialIcon icon="add" size={16} color="#fff" />
                    일정 추가
                  </button>
                  <button className="skema-secondary-action" onClick={handleShare}>
                    <MaterialIcon icon="share" size={16} color="#334155" />
                    공유
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                <div className="rounded-lg border border-[#d8e3ff] bg-[#f7faff] p-4">
                  <div className="flex items-center gap-2">
                    <span className="skema-sticker h-9 w-9">
                      <MaterialIcon icon="flag" size={18} color="#2563eb" filled />
                    </span>
                    <div>
                      <p className="text-xs font-black text-[#2563eb]">다음 액션</p>
                      <p className="text-lg font-black text-[#0f172a]">
                        {nextSchedule ? nextSchedule.title : '오늘 남은 일정이 없습니다'}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-[#3f4b61]">
                    {nextSchedule
                      ? `${nextSchedule.start_time} - ${nextSchedule.end_time}${nextSchedule.location ? ` · ${nextSchedule.location}` : ''}`
                      : '새 일정을 추가하거나 주간 리포트를 확인해보세요.'}
                  </p>
                </div>
                <div className="rounded-lg border border-[#f4c9dd] bg-[#fff6fa] p-4">
                  <p className="text-xs font-black text-[#0ea5e9]">오늘 진행률</p>
                  <div className="mt-3 flex items-end gap-2">
                    <span className="text-4xl font-black text-[#0f172a]">{todayPct ?? 0}%</span>
                    <span className="pb-1 text-xs font-bold text-[#516078]">{todayDone}/{todayTotal} 완료</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-[#0ea5e9]" style={{ width: `${todayPct ?? 0}%` }} />
                  </div>
                </div>
              </div>
            </div>

            <div className="skema-kpi-grid">
              {[
                { label: '남은 오늘 일정', value: `${remainingToday.length}개`, icon: 'checklist', color: '#2563eb', bg: '#eaf1ff' },
                { label: '미완료/지난 일정', value: `${unachievedSchedules.length}개`, icon: 'update', color: '#b45309', bg: '#eef6ff' },
                { label: '시간 충돌', value: `${conflicts.length}건`, icon: 'warning', color: '#dc2626', bg: '#fff1f2' },
                { label: '다가오는 시험', value: upcomingExam ? `D-${daysUntilExam}` : '없음', icon: 'quiz', color: '#087f5b', bg: '#e9fff7' },
              ].map((item) => (
                <div key={item.label} className="skema-kpi">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-[#516078]">{item.label}</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: item.bg }}>
                      <MaterialIcon icon={item.icon} size={17} color={item.color} filled />
                    </span>
                  </div>
                  <p className="mt-3 text-2xl font-black text-[#0f172a]">{item.value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="skema-work-grid">
            <aside className="skema-panel p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="skema-section-title">오늘 할 일</p>
                  <p className="skema-muted">클릭하면 완료 상태가 바뀝니다</p>
                </div>
                <span className="rounded-lg bg-[#eaf1ff] px-2.5 py-1 text-xs font-black text-[#2563eb]">
                  {remainingToday.length} left
                </span>
              </div>
              {todaySchedules.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#c7d2e2] bg-[#f8fbff] p-5 text-center">
                  <MaterialIcon icon="weekend" size={24} color="#087f5b" filled />
                  <p className="mt-2 text-sm font-bold text-[#3f4b61]">오늘은 비어 있습니다</p>
                </div>
              ) : (
                <div>
                  {todaySchedules.map((s) => (
                    <button key={s.id} className="skema-task-row w-full text-left" onClick={() => handleToggleComplete(s)}>
                      <span
                        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2"
                        style={{
                          background: s.is_completed ? '#087f5b' : '#fff',
                          borderColor: s.is_completed ? '#087f5b' : '#b8c5d6',
                        }}
                      >
                        {s.is_completed && <MaterialIcon icon="check" size={13} color="#fff" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-sm font-extrabold"
                          style={{ color: s.is_completed ? '#64748b' : '#0f172a', textDecoration: s.is_completed ? 'line-through' : 'none' }}
                        >
                          {s.title}
                        </span>
                        <span className="mt-0.5 block text-xs font-semibold text-[#516078]">
                          {s.start_time} - {s.end_time}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {unachievedSchedules.length > 0 && (
                <button
                  onClick={handleReschedule}
                  disabled={isRegenerating}
                  className="mt-4 w-full rounded-lg border border-[#fed7aa] bg-[#eef6ff] px-3 py-2 text-xs font-black text-[#9a5b00]"
                >
                  {isRegenerating ? '재배치 중...' : '밀린 일정 AI 재배치'}
                </button>
              )}
            </aside>

            <section className="min-w-0">
              <div className="skema-panel mb-3 p-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="skema-section-title">주간 시간표</p>
                    <p className="skema-muted">{weekLabel}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="skema-icon-btn h-9 w-9" onClick={() => setWeekOffset((o) => o - 1)} aria-label="이전 주">
                      <MaterialIcon icon="chevron_left" size={18} color="#334155" />
                    </button>
                    <button className="skema-secondary-action" onClick={() => setWeekOffset(0)}>
                      이번 주
                    </button>
                    <button className="skema-icon-btn h-9 w-9" onClick={() => setWeekOffset((o) => o + 1)} aria-label="다음 주">
                      <MaterialIcon icon="chevron_right" size={18} color="#334155" />
                    </button>
                    <button
                      className="skema-secondary-action"
                      onClick={() => setActiveTypes(activeTypes.size === ALL_TYPES.length ? new Set() : new Set(ALL_TYPES))}
                    >
                      {activeTypes.size === ALL_TYPES.length ? '필터 해제' : '전체 표시'}
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(
                    [
                      { type: 'class', label: '수업', color: '#4F46E5' },
                      { type: 'study', label: '자율학습', color: '#087f5b' },
                      { type: 'assignment', label: '과제', color: '#b45309' },
                      { type: 'activity', label: '활동', color: '#7c3aed' },
                      { type: 'personal', label: '개인', color: '#0ea5e9' },
                    ] as { type: ScheduleTypeFilter; label: string; color: string }[]
                  ).map(({ type, label, color }) => {
                    const active = activeTypes.has(type);
                    return (
                      <button
                        key={type}
                        onClick={() => toggleType(type)}
                        className="rounded-lg border px-2.5 py-1.5 text-xs font-black"
                        style={{
                          borderColor: active ? color : '#d8e2ef',
                          background: active ? `${color}16` : '#fff',
                          color: active ? color : '#516078',
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Tabs defaultValue="timetable" className="skema-dashboard-main">
                <TabsList className="mb-3 w-full sm:w-fit">
                  <TabsTrigger value="timetable">시간표</TabsTrigger>
                  <TabsTrigger value="exams">시험</TabsTrigger>
                  <TabsTrigger value="report">리포트</TabsTrigger>
                  <TabsTrigger value="type-analysis">분석</TabsTrigger>
                </TabsList>
                <TabsContent value="timetable">
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
              </Tabs>
            </section>

            <aside className="skema-panel p-4">
              <div className="mb-4">
                <p className="skema-section-title">우선순위 패널</p>
                <p className="skema-muted">시험과 위험 신호를 먼저 봅니다</p>
              </div>
              {upcomingExam ? (
                <div className="mb-4 rounded-lg border border-[#c7f3df] bg-[#effdf7] p-3">
                  <div className="flex items-center gap-2">
                    <MaterialIcon icon="quiz" size={18} color="#087f5b" filled />
                    <p className="text-xs font-black text-[#087f5b]">다가오는 시험</p>
                  </div>
                  <p className="mt-2 text-lg font-black text-[#0f172a]">{upcomingExam.title}</p>
                  <p className="text-xs font-bold text-[#516078]">
                    {upcomingExam.exam_date} · D-{daysUntilExam}
                  </p>
                </div>
              ) : (
                <div className="mb-4 rounded-lg border border-[#d8e2ef] bg-[#f8fbff] p-3">
                  <p className="text-sm font-bold text-[#3f4b61]">등록된 예정 시험이 없습니다</p>
                </div>
              )}
              <SmartAlertPanel exams={exams} schedules={schedules} currentWeekStart={weekStart} />
            </aside>
          </section>
        </div>

        <ClassForm />
        <SettingsModal open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

        {/* Share Modal */}
        <Dialog open={isShareModalOpen} onOpenChange={(open) => !open && closeShareModal()}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>시간표 공유</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              {isGeneratingShare ? (
                <div className="flex items-center justify-center py-4">
                  <div className="w-6 h-6 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--skema-secondary-container)', borderTopColor: 'transparent' }} />
                </div>
              ) : shareUrl ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    아래 링크를 공유하면 누구나 내 시간표를 볼 수 있습니다.
                  </p>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={shareUrl}
                      className="flex-1 px-3 py-2 text-xs border rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                    />
                    <Button size="sm" onClick={copyShareUrl} className="flex-shrink-0" style={{ background: 'var(--skema-primary)', color: '#fff' }}>
                      복사
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-red-500">공유 링크를 생성할 수 없습니다.</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeShareModal}>닫기</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
