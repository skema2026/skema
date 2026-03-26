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
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/lib/api';
import MaterialIcon from '@/components/common/MaterialIcon';
import { Schedule } from '@/types';

export default function DashboardPage() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { isChatOpen, toggleChat, openClassForm, isShareModalOpen, openShareModal, closeShareModal } = useUIStore();
  const { data: schedules = [], isLoading } = useSchedules();
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [notification, setNotification] = useState<Schedule | null>(null);
  const [isRegenerateOpen, setIsRegenerateOpen] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerateForm, setRegenerateForm] = useState({ subject: '', days: '7', hours: '2' });
  const queryClient = useQueryClient();

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
          {/* Left: Logo + completion rate */}
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

          {/* Right: Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Add button: icon + text */}
            <button onClick={() => openClassForm()} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--skema-primary)', color: '#fff', border: 'none', borderRadius: '10px', padding: '7px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              <MaterialIcon icon="add" size={16} color="#fff" />
              수업 추가
            </button>

            {/* AI Chat toggle */}
            <button
              onClick={toggleChat}
              title="AI 채팅"
              style={{ display: 'flex', alignItems: 'center', gap: '5px', background: isChatOpen ? 'var(--skema-secondary-container)' : 'var(--skema-surface-low)', border: 'none', borderRadius: '10px', padding: '7px 12px', fontSize: '13px', fontWeight: 600, color: isChatOpen ? 'var(--skema-primary)' : 'var(--skema-on-surface-variant)', cursor: 'pointer' }}
            >
              <MaterialIcon icon="smart_toy" size={16} color={isChatOpen ? 'var(--skema-primary)' : 'var(--skema-on-surface-variant)'} filled={isChatOpen} />
              <span className="hide-mobile">AI</span>
            </button>

            {/* Share button */}
            <button
              onClick={handleShare}
              title="공유"
              style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--skema-surface-low)', border: 'none', borderRadius: '10px', padding: '7px 12px', fontSize: '13px', fontWeight: 600, color: 'var(--skema-on-surface-variant)', cursor: 'pointer' }}
            >
              <MaterialIcon icon="share" size={16} color="var(--skema-on-surface-variant)" />
              <span className="hide-mobile">공유</span>
            </button>

            {/* User menu */}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-full transition-all outline-none">
                <Avatar className="w-8 h-8">
                  <AvatarFallback className="text-xs font-bold" style={{ background: 'var(--skema-secondary-container)', color: 'var(--skema-primary)' }}>
                    {user?.username?.[0]?.toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>
                  <p className="font-semibold">{user?.username}</p>
                  <p className="text-xs text-gray-500 font-normal">{user?.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setIsSettingsOpen(true)}>
                  설정
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
                  로그아웃
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Timetable + Exams */}
          <div className="flex-1 overflow-auto p-4">
            <Tabs defaultValue="timetable">
              <TabsList className="mb-4">
                <TabsTrigger value="timetable">시간표</TabsTrigger>
                <TabsTrigger value="exams">시험 일정</TabsTrigger>
              </TabsList>
              <TabsContent value="timetable">
                <div className="flex justify-end mb-3">
                  <button
                    onClick={() => setIsRegenerateOpen(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--skema-surface-low)', border: 'none', borderRadius: '10px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, color: 'var(--skema-on-surface-variant)', cursor: 'pointer' }}
                  >
                    <MaterialIcon icon="refresh" size={15} color="var(--skema-on-surface-variant)" />
                    학습 시간표 재생성
                  </button>
                </div>
                {isLoading ? (
                  <div className="flex items-center justify-center h-64">
                    <div className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--skema-secondary-container)', borderTopColor: 'transparent' }} />
                  </div>
                ) : (
                  <Timetable schedules={schedules} />
                )}
              </TabsContent>
              <TabsContent value="exams">
                <ExamList />
              </TabsContent>
            </Tabs>
          </div>

          {/* Right: AI Chat Sidebar */}
          {isChatOpen && (
            <div className="w-80 flex-shrink-0 overflow-hidden border-l">
              <AIChat onClose={toggleChat} />
            </div>
          )}
        </div>

        {/* Class Form Dialog */}
        <ClassForm />

        {/* Settings Modal */}
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
