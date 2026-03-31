'use client';

import { useState, useEffect, useCallback } from 'react';
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
import { Timetable } from '@/components/timetable/Timetable';
import { ClassForm } from '@/components/class-form/ClassForm';
import { AIChat } from '@/components/ai-chat/AIChat';
import { ExamList } from '@/components/exam/ExamList';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { useSchedules } from '@/hooks/useSchedules';
import { useProfile } from '@/hooks/useProfile';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/lib/api';
import MaterialIcon from '@/components/common/MaterialIcon';
import { Schedule, UserProfile } from '@/types';

const DAILY_QUOTES = {
  exam_prep: '오늘 하루도 목표를 향해 한 걸음씩. 합격은 반드시 옵니다 💪',
  civil_service: '꾸준함이 실력입니다. 오늘의 공부가 내일의 합격을 만듭니다 🔥',
  student: '지금 이 순간의 노력이 미래를 바꿉니다. 화이팅! 📚',
  worker: '성장하는 당신은 이미 앞서가고 있습니다 🌱',
  default: 'SKEMA와 함께 오늘도 계획대로 실천해보세요 ✨',
};

function WeeklyReport({ schedules }: { schedules: Schedule[] }) {
  const now = new Date();
  const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const weekDays = ['월', '화', '수', '목', '금', '토', '일'];

  const weekStats = weekDays.map((day, i) => {
    const daySch = schedules.filter((s) => !s.date && s.day_of_week === i);
    const done = daySch.filter((s) => s.is_completed).length;
    const total = daySch.length;
    return { day, done, total, pct: total > 0 ? Math.round((done / total) * 100) : null, isToday: i === todayDow };
  });

  const totalDone = schedules.filter((s) => s.is_completed).length;
  const totalAll = schedules.length;
  const typeBreakdown = ['class', 'study', 'event'].map((type) => {
    const typeSch = schedules.filter((s) => s.schedule_type === type);
    const done = typeSch.filter((s) => s.is_completed).length;
    return { type, done, total: typeSch.length };
  });
  const typeLabels: Record<string, string> = { class: '수업', study: '자율학습', event: '이벤트' };
  const typeColors: Record<string, string> = { class: '#1a4db2', study: '#10b981', event: '#f59e0b' };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl p-4 text-center" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
          <p style={{ fontSize: 28, fontWeight: 800, color: 'var(--skema-primary)' }}>{totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0}%</p>
          <p style={{ fontSize: 11, color: '#747684', marginTop: 2 }}>전체 수행률</p>
        </div>
        <div className="rounded-xl p-4 text-center" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
          <p style={{ fontSize: 28, fontWeight: 800, color: '#10b981' }}>{totalDone}</p>
          <p style={{ fontSize: 11, color: '#747684', marginTop: 2 }}>완료한 일정</p>
        </div>
        <div className="rounded-xl p-4 text-center" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
          <p style={{ fontSize: 28, fontWeight: 800, color: '#f59e0b' }}>{totalAll - totalDone}</p>
          <p style={{ fontSize: 11, color: '#747684', marginTop: 2 }}>미완료 일정</p>
        </div>
      </div>

      {/* 요일별 수행률 */}
      <div className="rounded-xl p-4" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#181c1e', marginBottom: 16 }}>요일별 수행률</p>
        <div className="flex items-end gap-2" style={{ height: 80 }}>
          {weekStats.map(({ day, done, total, pct, isToday }) => (
            <div key={day} className="flex-1 flex flex-col items-center gap-1">
              <span style={{ fontSize: 10, color: '#747684' }}>{pct !== null ? `${pct}%` : '-'}</span>
              <div style={{ width: '100%', height: 50, background: '#f1f4f7', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'flex-end' }}>
                {pct !== null && (
                  <div style={{
                    width: '100%', height: `${pct}%`,
                    background: isToday ? 'var(--skema-primary)' : '#c3d0ff',
                    borderRadius: 6, transition: 'height 0.5s',
                  }} />
                )}
              </div>
              <span style={{ fontSize: 11, fontWeight: isToday ? 800 : 400, color: isToday ? 'var(--skema-primary)' : '#747684' }}>{day}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 유형별 수행률 */}
      <div className="rounded-xl p-4" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#181c1e', marginBottom: 12 }}>유형별 수행 현황</p>
        <div className="space-y-3">
          {typeBreakdown.map(({ type, done, total }) => (
            <div key={type}>
              <div className="flex justify-between mb-1">
                <span style={{ fontSize: 12, color: '#181c1e' }}>{typeLabels[type]}</span>
                <span style={{ fontSize: 12, color: '#747684' }}>{done}/{total}</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: '#f1f4f7' }}>
                <div style={{ height: '100%', width: `${total > 0 ? (done / total) * 100 : 0}%`, background: typeColors[type], borderRadius: 99, transition: 'width 0.5s' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface Props {
  initialSchedules: Schedule[];
  initialProfile: UserProfile | null;
}

export default function DashboardClient({ initialSchedules, initialProfile }: Props) {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { isChatOpen, toggleChat, openClassForm, isShareModalOpen, openShareModal, closeShareModal } = useUIStore();
  const { data: schedules = [] } = useSchedules(initialSchedules);
  const { data: profile } = useProfile(initialProfile ?? undefined);

  const [shareToken, setShareToken] = useState<string | null>(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [notification, setNotification] = useState<Schedule | null>(null);
  const [isRegenerateOpen, setIsRegenerateOpen] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerateForm, setRegenerateForm] = useState({ subject: '', days: '7', hours: '2' });
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
    const todayStr = now.toISOString().slice(0, 10);
    const upcoming = schedules.find((s) => {
      if (s.is_completed) return false;
      const matchDay = s.date ? s.date === todayStr : s.day_of_week === todayDow;
      if (!matchDay) return false;
      const [sh, sm] = s.start_time.split(':').map(Number);
      const startMin = sh * 60 + sm;
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

  // Completion rate
  const total = schedules.length;
  const done = schedules.filter((s) => s.is_completed).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : null;

  // 오늘 할 일
  const now = new Date();
  const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const todayStr = now.toISOString().slice(0, 10);
  const todaySchedules = schedules
    .filter((s) => s.date ? s.date === todayStr : s.day_of_week === todayDow)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  // 미달성 일정 (오늘 + 이미 지난 시간 + 미완료)
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const unachievedSchedules = todaySchedules.filter((s) => {
    if (s.is_completed) return false;
    const [eh, em] = s.end_time.split(':').map(Number);
    return (eh * 60 + em) < nowMin;
  });

  // 완료 토글
  const handleToggleComplete = async (s: Schedule) => {
    try {
      await api.put(`/schedules/${s.id}`, { is_completed: !s.is_completed });
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    } catch {
      toast.error('업데이트 중 오류가 발생했습니다');
    }
  };

  const handleReschedule = async () => {
    setIsRegenerating(true);
    try {
      const { data } = await api.post<{ response: string }>('/ai/chat', {
        message: '미완료 일정을 오늘 이후 빈 시간에 자동으로 재배치해줘',
        messages: [],
      });
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      toast.success(data.response.includes('재배치했습니다') ? '일정이 재배치되었습니다' : data.response);
    } catch {
      toast.error('재배치 중 오류가 발생했습니다');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleRegenerate = async () => {
    const { subject, days, hours } = regenerateForm;
    if (!subject.trim()) { toast.error('과목명을 입력하세요'); return; }
    setIsRegenerating(true);
    try {
      const message = `기존 학습 일정을 모두 삭제하고 ${subject} 학습 일정을 ${days}일간 하루 ${hours}시간씩 새로 만들어줘`;
      await api.post('/ai/chat', { message, messages: [] });
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      toast.success('학습 시간표가 재생성되었습니다');
      setIsRegenerateOpen(false);
      setRegenerateForm({ subject: '', days: '7', hours: '2' });
    } catch {
      toast.error('재생성 중 오류가 발생했습니다');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
    toast.success('로그아웃 되었습니다');
  };

  const handleShare = async () => {
    openShareModal();
    if (shareToken) return;
    setIsGeneratingShare(true);
    try {
      const { data } = await api.post<{ token: string }>('/share');
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
      `}</style>
      <div className="flex flex-col h-screen" style={{ background: 'var(--skema-surface)' }}>

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
              <div style={{ fontSize: 12, color: '#434653', marginTop: 2 }}>{notification.title} — {notification.start_time}</div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setNotification(null); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#747684', fontSize: 16, padding: 0, lineHeight: 1 }}
            >×</button>
          </div>
        )}

        {/* Header */}
        <header style={{
          height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 20px', borderBottom: '1px solid var(--skema-container)',
          background: '#fff', position: 'sticky', top: 0, zIndex: 30, flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'var(--skema-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcon icon="schedule" size={15} color="#fff" filled />
            </div>
            <span className="skema-headline" style={{ fontWeight: 800, fontSize: '18px', color: 'var(--skema-on-surface)' }}>SKEMA</span>
            {pct !== null && (
              <span style={{
                padding: '2px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 700,
                background: pct >= 80 ? '#d1fae5' : pct >= 40 ? '#fef9c3' : 'var(--skema-surface-low)',
                color: pct >= 80 ? '#059669' : pct >= 40 ? '#d97706' : 'var(--skema-on-surface-variant)',
              }}>
                수행률 {pct}% ({done}/{total})
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button onClick={() => openClassForm()} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--skema-primary)', color: '#fff', border: 'none', borderRadius: '10px', padding: '7px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              <MaterialIcon icon="add" size={16} color="#fff" />
              수업 추가
            </button>

            <button
              onClick={toggleChat}
              title="AI 채팅"
              style={{ display: 'flex', alignItems: 'center', gap: '5px', background: isChatOpen ? 'var(--skema-secondary-container)' : 'var(--skema-surface-low)', border: 'none', borderRadius: '10px', padding: '7px 12px', fontSize: '13px', fontWeight: 600, color: isChatOpen ? 'var(--skema-primary)' : 'var(--skema-on-surface-variant)', cursor: 'pointer' }}
            >
              <MaterialIcon icon="smart_toy" size={16} color={isChatOpen ? 'var(--skema-primary)' : 'var(--skema-on-surface-variant)'} filled={isChatOpen} />
              <span className="hide-mobile">AI</span>
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
                    {user?.username?.[0]?.toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <p className="font-semibold">{user?.username}</p>
                    <p className="text-xs text-gray-500 font-normal">{user?.email}</p>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
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
        <div className="flex flex-1 overflow-hidden">

          {/* ── 오늘 할 일 사이드바 ── */}
          <div className="w-60 flex-shrink-0 overflow-y-auto border-r p-3 flex flex-col gap-3" style={{ background: '#fff' }}>

            {/* 동기부여 카드 */}
            <div className="rounded-xl p-3" style={{ background: 'var(--skema-primary)' }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <MaterialIcon icon="auto_awesome" size={14} color="#c3d0ff" filled />
                <span style={{ fontSize: 10, fontWeight: 700, color: '#c3d0ff', letterSpacing: '1px' }}>AI 인사이트</span>
              </div>
              <p style={{ fontSize: 12, color: '#fff', lineHeight: 1.6 }}>
                {DAILY_QUOTES[profile?.user_type as keyof typeof DAILY_QUOTES] ?? DAILY_QUOTES.default}
              </p>
            </div>

            {/* 수행률 */}
            <div className="rounded-xl p-3" style={{ background: 'var(--skema-surface-low)' }}>
              <div className="flex items-center justify-between mb-2">
                <span style={{ fontSize: 11, fontWeight: 700, color: '#181c1e' }}>전체 수행률</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--skema-primary)' }}>{pct ?? 0}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: '#ebeef1', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct ?? 0}%`, background: pct && pct >= 80 ? '#10b981' : pct && pct >= 40 ? '#f59e0b' : 'var(--skema-primary)', borderRadius: 99, transition: 'width 0.5s' }} />
              </div>
              <p style={{ fontSize: 10, color: '#747684', marginTop: 6 }}>{done}/{total}개 완료</p>
            </div>

            {/* 오늘 할 일 */}
            <div className="flex-1">
              <div className="flex items-center gap-1.5 mb-2">
                <MaterialIcon icon="today" size={14} color="var(--skema-primary)" filled />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#181c1e' }}>오늘 할 일</span>
              </div>
              {todaySchedules.length === 0 ? (
                <div className="text-center py-4">
                  <MaterialIcon icon="check_circle" size={24} color="#10b981" filled />
                  <p style={{ fontSize: 11, color: '#747684', marginTop: 4 }}>오늘 일정이 없습니다</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {todaySchedules.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors"
                      style={{ background: s.is_completed ? '#f0fdf4' : '#f7fafd' }}
                      onClick={() => handleToggleComplete(s)}
                    >
                      <div style={{
                        width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 1,
                        background: s.is_completed ? '#10b981' : '#fff',
                        border: `2px solid ${s.is_completed ? '#10b981' : '#d1d5db'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {s.is_completed && <MaterialIcon icon="check" size={10} color="#fff" />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontSize: 12, fontWeight: 600, color: s.is_completed ? '#6b7280' : '#181c1e',
                          textDecoration: s.is_completed ? 'line-through' : 'none',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{s.title}</p>
                        <p style={{ fontSize: 10, color: '#747684' }}>{s.start_time} – {s.end_time}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 미달성 제안 */}
              {unachievedSchedules.length > 0 && (
                <div className="mt-3 p-2.5 rounded-xl" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
                  <div className="flex items-center gap-1 mb-1">
                    <MaterialIcon icon="warning" size={13} color="#f59e0b" filled />
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#92400e' }}>미완료 일정 {unachievedSchedules.length}개</span>
                  </div>
                  <p style={{ fontSize: 10, color: '#92400e', lineHeight: 1.5 }}>AI에게 재배치를 요청해보세요</p>
                  <button
                    onClick={handleReschedule}
                    disabled={isRegenerating}
                    className="mt-1.5 w-full py-1 rounded-lg text-xs font-bold transition-colors"
                    style={{ background: '#f59e0b', color: '#fff', border: 'none', cursor: 'pointer' }}
                  >
                    자동 재배치
                  </button>
                </div>
              )}
            </div>

            {/* 빠른 일정 추가 */}
            <button
              onClick={() => openClassForm()}
              className="w-full py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-colors"
              style={{ background: '#eef1ff', color: 'var(--skema-primary)', border: 'none', cursor: 'pointer' }}
            >
              <MaterialIcon icon="add" size={14} color="var(--skema-primary)" />
              일정 추가
            </button>
          </div>

          {/* ── 메인 콘텐츠 ── */}
          <div className="flex-1 overflow-auto p-4">
            <Tabs defaultValue="timetable">
              <TabsList className="mb-4">
                <TabsTrigger value="timetable">시간표</TabsTrigger>
                <TabsTrigger value="exams">시험 일정</TabsTrigger>
                <TabsTrigger value="report">주간 리포트</TabsTrigger>
              </TabsList>
              <TabsContent value="timetable">
                <div className="flex justify-end gap-2 mb-3">
                  <button
                    onClick={handleReschedule}
                    disabled={isRegenerating}
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--skema-surface-low)', border: 'none', borderRadius: '10px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, color: 'var(--skema-on-surface-variant)', cursor: isRegenerating ? 'not-allowed' : 'pointer' }}
                  >
                    <MaterialIcon icon="update" size={15} color="var(--skema-on-surface-variant)" />
                    미완료 재배치
                  </button>
                  <button
                    onClick={() => setIsRegenerateOpen(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--skema-surface-low)', border: 'none', borderRadius: '10px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, color: 'var(--skema-on-surface-variant)', cursor: 'pointer' }}
                  >
                    <MaterialIcon icon="refresh" size={15} color="var(--skema-on-surface-variant)" />
                    시간표 재생성
                  </button>
                </div>
                <Timetable schedules={schedules} />
              </TabsContent>
              <TabsContent value="exams">
                <ExamList />
              </TabsContent>
              <TabsContent value="report">
                <WeeklyReport schedules={schedules} />
              </TabsContent>
            </Tabs>
          </div>

          {isChatOpen && (
            <div className="w-80 flex-shrink-0 overflow-hidden border-l">
              <AIChat onClose={toggleChat} />
            </div>
          )}
        </div>

        <ClassForm />
        <SettingsModal open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

        {/* Regenerate Modal */}
        <Dialog open={isRegenerateOpen} onOpenChange={(o) => !o && setIsRegenerateOpen(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>학습 시간표 재생성</DialogTitle>
            </DialogHeader>
            <div className="py-2 space-y-4">
              <p className="text-xs text-gray-500">기존 학습 일정을 삭제하고 새로운 학습 시간표를 생성합니다.</p>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">과목 / 내용</label>
                <input
                  className="w-full px-3 py-2 text-sm border rounded-lg"
                  placeholder="예: 알고리즘, 영어"
                  value={regenerateForm.subject}
                  onChange={(e) => setRegenerateForm({ ...regenerateForm, subject: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">기간 (일)</label>
                  <select
                    className="w-full px-3 py-2 text-sm border rounded-lg bg-white"
                    value={regenerateForm.days}
                    onChange={(e) => setRegenerateForm({ ...regenerateForm, days: e.target.value })}
                  >
                    {[3, 5, 7, 14].map((d) => <option key={d} value={d}>{d}일</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">하루 목표 (시간)</label>
                  <select
                    className="w-full px-3 py-2 text-sm border rounded-lg bg-white"
                    value={regenerateForm.hours}
                    onChange={(e) => setRegenerateForm({ ...regenerateForm, hours: e.target.value })}
                  >
                    {[1, 1.5, 2, 3, 4].map((h) => <option key={h} value={h}>{h}시간</option>)}
                  </select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsRegenerateOpen(false)}>취소</Button>
              <Button
                onClick={handleRegenerate}
                disabled={isRegenerating}
                style={{ background: 'var(--skema-primary)', color: '#fff' }}
              >
                {isRegenerating ? '생성 중...' : '재생성'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
