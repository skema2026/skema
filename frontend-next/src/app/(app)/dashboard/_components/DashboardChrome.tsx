'use client';

import type { MouseEvent } from 'react';
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

type DashboardHeaderProps = {
  user: User | null;
  todayPct: number | null;
  todayDone: number;
  todayTotal: number;
  onAddSchedule: () => void;
  onShare: () => void;
  onOpenAdminUsers: () => void;
  onOpenAdminLogs: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
};

export function DashboardHeader({
  user,
  todayPct,
  todayDone,
  todayTotal,
  onAddSchedule,
  onShare,
  onOpenAdminUsers,
  onOpenAdminLogs,
  onOpenSettings,
  onLogout,
}: DashboardHeaderProps) {
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
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'var(--skema-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <MaterialIcon icon="schedule" size={15} color="#fff" filled />
        </div>
        <span className="skema-headline" style={{ fontWeight: 800, fontSize: '18px', color: 'var(--skema-on-surface)', letterSpacing: 0 }}>SKEMA</span>
        {todayPct !== null && (
          <span
            className="skema-dashboard-title-badge"
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

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          onClick={onAddSchedule}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--skema-primary)', color: '#fff', border: 'none', borderRadius: '10px', padding: '7px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', boxShadow: '0 8px 18px var(--skema-primary-shadow)' }}
        >
          <MaterialIcon icon="add" size={16} color="#fff" />
          <span className="hide-mobile">일정</span> 추가
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
