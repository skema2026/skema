'use client';

import type { MouseEvent } from 'react';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import MaterialIcon from '@/components/common/MaterialIcon';
import type { Schedule, User } from '@/types';

export function DashboardStyles() {
  return (
    <style>{`
      .hide-mobile { display: none; }
      @media (min-width: 640px) { .hide-mobile { display: inline; } }
      .skema-dashboard-header {
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
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
      }
    `}</style>
  );
}

type NotificationBannerProps = {
  notification: Schedule | null;
  onOpen: (schedule: Schedule) => void;
  onDismiss: () => void;
};

export function NotificationBanner({ notification, onOpen, onDismiss }: NotificationBannerProps) {
  if (!notification) return null;

  const handleDismiss = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onDismiss();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 64,
        right: 16,
        zIndex: 200,
        background: '#fff',
        border: '1px solid rgba(195,198,213,0.25)',
        borderLeft: '4px solid var(--skema-primary)',
        borderRadius: 14,
        padding: '12px 16px',
        boxShadow: '0 8px 32px rgba(24,28,30,0.12)',
        maxWidth: 300,
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        cursor: 'pointer',
      }}
      onClick={() => onOpen(notification)}
    >
      <div style={{ width: 32, height: 32, borderRadius: 8, background: '#dae1ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <MaterialIcon icon="notifications_active" size={18} color="var(--skema-primary)" filled />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#181c1e' }}>곧 시작! (클릭하면 일정 확인)</div>
        <div style={{ fontSize: 12, color: '#334155', marginTop: 2 }}>{notification.title} — {notification.start_time}</div>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3f4b61', fontSize: 16, padding: 0, lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  );
}

type SecondaryPanelKey = 'exams' | 'report' | 'analysis' | 'ai' | null;

type DashboardHeaderProps = {
  user: User | null;
  todayPct: number | null;
  todayDone: number;
  todayTotal: number;
  secondaryPanel: SecondaryPanelKey;
  onSetSecondaryPanel: (panel: SecondaryPanelKey) => void;
  onOpenEtaReimport: () => void;
  onAddSchedule: () => void;
  onShare: () => void;
  onOpenAdminUsers: () => void;
  onOpenAdminLogs: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
};

const NAV_ITEMS: { key: SecondaryPanelKey; label: string; icon: string }[] = [
  { key: 'exams',    label: '시험 일정', icon: 'school' },
  { key: 'report',   label: '리포트',   icon: 'bar_chart' },
  { key: 'analysis', label: '유형 분석', icon: 'pie_chart' },
];

export function DashboardHeader({
  user,
  todayPct,
  todayDone,
  todayTotal,
  secondaryPanel,
  onSetSecondaryPanel,
  onOpenEtaReimport,
  onAddSchedule,
  onShare,
  onOpenAdminUsers,
  onOpenAdminLogs,
  onOpenSettings,
  onLogout,
}: DashboardHeaderProps) {
  const router = useRouter();
  return (
    <header
      className="skema-dashboard-header"
      style={{
        height: '56px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        borderBottom: '1px solid var(--skema-container)',
        background: 'rgba(255,255,255,0.94)',
        position: 'sticky',
        top: 0,
        zIndex: 30,
        flexShrink: 0,
        gap: '12px',
      }}
    >
      {/* 좌측: 로고 + 뱃지 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'var(--skema-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <MaterialIcon icon="schedule" size={15} color="#fff" filled />
        </div>
        <span className="skema-headline" style={{ fontWeight: 800, fontSize: '18px', color: 'var(--skema-on-surface)', letterSpacing: 0 }}>SKEMA</span>
        {todayPct !== null && (
          <span
            className="skema-dashboard-title-badge hide-mobile"
            style={{
              padding: '2px 10px',
              borderRadius: 9999,
              fontSize: 11,
              fontWeight: 700,
              background: todayPct >= 80 ? '#d1fae5' : todayPct >= 40 ? '#fef9c3' : 'var(--skema-surface-low)',
              color: todayPct >= 80 ? '#059669' : todayPct >= 40 ? '#d97706' : 'var(--skema-on-surface-variant)',
            }}
          >
            오늘 {todayPct}% ({todayDone}/{todayTotal})
          </span>
        )}
      </div>

      {/* 우측: 모든 버튼 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto', flexShrink: 0 }}>

        {/* nav 버튼들 */}
        {NAV_ITEMS.map(({ key, label, icon }) => {
          const active = secondaryPanel === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSetSecondaryPanel(active ? null : key)}
              className="hide-mobile"
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '7px 12px', borderRadius: '10px', border: 'none',
                fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                transition: 'all 0.15s',
                background: active ? 'var(--skema-primary)' : 'var(--skema-surface-low)',
                color: active ? '#fff' : 'var(--skema-on-surface-variant)',
              }}
            >
              <MaterialIcon icon={icon} size={15} color={active ? '#fff' : 'var(--skema-on-surface-variant)'} />
              {label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onOpenEtaReimport}
          className="hide-mobile"
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '7px 12px', borderRadius: '10px', border: 'none',
            fontSize: '13px', fontWeight: 700, cursor: 'pointer',
            background: 'var(--skema-surface-low)', color: 'var(--skema-on-surface-variant)',
            transition: 'all 0.15s',
          }}
        >
          <MaterialIcon icon="upload" size={15} color="var(--skema-on-surface-variant)" />
          시간표 업로드
        </button>

        {/* 구분선 */}
        <div className="hide-mobile" style={{ width: 1, height: 22, background: 'var(--skema-container)', margin: '0 2px' }} />

        <button
          type="button"
          onClick={onAddSchedule}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--skema-surface-low)', color: 'var(--skema-on-surface-variant)', border: 'none', borderRadius: '10px', padding: '7px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
        >
          <MaterialIcon icon="add" size={16} color="var(--skema-on-surface-variant)" />
          <span className="hide-mobile">일정</span> 추가
        </button>

        <button
          type="button"
          onClick={() => router.push('/ai_chat')}
          title="AI 어시스턴트"
          style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--skema-surface-low)', border: 'none', borderRadius: '10px', padding: '7px 12px', fontSize: '13px', fontWeight: 700, color: 'var(--skema-on-surface-variant)', cursor: 'pointer' }}
        >
          <MaterialIcon icon="smart_toy" size={16} color="var(--skema-on-surface-variant)" filled />
          <span className="hide-mobile">AI 채팅</span>
        </button>

        <button
          type="button"
          onClick={onShare}
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
                  <DropdownMenuItem onClick={onOpenAdminUsers}>
                    관리자 회원 관리
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onOpenAdminLogs}>
                    관리자 로그인 로그
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem onClick={onOpenSettings}>
                설정
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onLogout} className="text-red-600 focus:text-red-600">
                로그아웃
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

type ShareDialogProps = {
  open: boolean;
  isGeneratingShare: boolean;
  shareUrl: string;
  onClose: () => void;
  onCopy: () => void;
};

export function ShareDialog({ open, isGeneratingShare, shareUrl, onClose, onCopy }: ShareDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
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
                <Button size="sm" onClick={onCopy} className="flex-shrink-0" style={{ background: 'var(--skema-primary)', color: '#fff' }}>
                  복사
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-red-500">공유 링크를 생성할 수 없습니다.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── 알림 권한 요청 배너 ──────────────────────────────────────────────────────────

export function NotificationPermissionBanner() {
  const [show, setShow] = useState(false);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      const dismissed = sessionStorage.getItem('skema_notif_banner_dismissed');
      if (!dismissed) setShow(true);
    }
  }, []);

  if (!show) return null;

  const handleAllow = async () => {
    setRequesting(true);
    const result = await Notification.requestPermission();
    setRequesting(false);
    setShow(false);
    if (result === 'granted') {
      new Notification('Skema 알림 활성화 ✅', {
        body: '시험 D-day, 공부 완료율 알림을 받을 수 있습니다.',
        icon: '/icon-192.png',
      });
    }
  };

  const handleDismiss = () => {
    sessionStorage.setItem('skema_notif_banner_dismissed', '1');
    setShow(false);
  };

  return (
    <div className="flex items-center justify-between gap-3 bg-indigo-600 px-4 py-2.5 text-white">
      <div className="flex items-center gap-2">
        <span className="text-lg">🔔</span>
        <p className="text-xs font-bold">
          시험 D-day·공부 완료율 알림을 받으려면 알림을 허용해주세요
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={handleAllow}
          disabled={requesting}
          className="rounded-lg bg-white px-3 py-1 text-xs font-black text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-60"
        >
          {requesting ? '요청 중...' : '알림 허용'}
        </button>
        <button
          onClick={handleDismiss}
          className="rounded-lg bg-indigo-500 px-2 py-1 text-xs font-bold text-indigo-100 transition hover:bg-indigo-400"
        >
          나중에
        </button>
      </div>
    </div>
  );
}
