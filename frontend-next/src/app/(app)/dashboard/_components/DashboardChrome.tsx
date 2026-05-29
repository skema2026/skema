'use client';

import type { MouseEvent } from 'react';
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

type DashboardHeaderProps = {
  user: User | null;
  todayPct: number | null;
  todayDone: number;
  todayTotal: number;
  onShare: () => void;
  onOpenProfile: () => void;
  onOpenAdminUsers: () => void;
  onOpenAdminLogs: () => void;
  onLogout: () => void;
  onAddSchedule: () => void;
  onOpenSetlog: () => void;
  onReschedule: () => void;
  onUploadTimetable: () => void;
  isRegenerating: boolean;
};

export function DashboardHeader({
  user,
  todayPct,
  todayDone,
  todayTotal,
  onShare,
  onOpenProfile,
  onOpenAdminUsers,
  onOpenAdminLogs,
  onLogout,
  onAddSchedule,
  onOpenSetlog,
  onReschedule,
  onUploadTimetable,
  isRegenerating,
}: DashboardHeaderProps) {
  const router = useRouter();
  const displayName = user?.username || user?.email?.split('@')[0] || '사용자';
  const fallback = (displayName || user?.email || 'U')[0]?.toUpperCase() || 'U';

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
        <button
          type="button"
          onClick={() => router.back()}
          title="이전으로"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--skema-surface-low)', border: 'none', borderRadius: '8px', padding: '6px', cursor: 'pointer' }}
        >
          <MaterialIcon icon="arrow_back" size={18} color="var(--skema-on-surface-variant)" />
        </button>
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
          title="일정 추가"
          className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-blue-400 px-5 py-2 text-sm font-bold text-white shadow-sm hover:opacity-90"
        >
          <MaterialIcon icon="add" size={16} color="#fff" />
          <span className="hide-mobile">일정 추가</span>
        </button>
        <button
          type="button"
          onClick={onOpenSetlog}
          title="셋로그 MVP"
          className="flex items-center gap-2 rounded-lg bg-slate-950 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-slate-800"
        >
          <MaterialIcon icon="photo_camera" size={16} color="#fff" />
          <span className="hide-mobile">셋로그</span>
        </button>

        <button
          type="button"
          onClick={onUploadTimetable}
          title="시간표 업로드"
          className="flex items-center gap-2 rounded-lg bg-blue-50 px-5 py-2 text-sm font-bold text-slate-900 hover:bg-blue-100"
        >
          <MaterialIcon icon="upload_file" size={16} color="#2563eb" />
          <span className="hide-mobile">시간표 업로드</span>
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
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-full border border-blue-100 bg-white px-1.5 py-1 pr-2 shadow-sm transition-all outline-none hover:border-blue-200 hover:bg-blue-50">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs font-black" style={{ background: 'var(--skema-secondary-container)', color: 'var(--skema-primary)' }}>
                {fallback}
              </AvatarFallback>
            </Avatar>
            <span className="hide-mobile max-w-[120px] truncate text-xs font-black text-slate-700">
              {displayName}
            </span>
            <MaterialIcon icon="expand_more" size={14} color="#64748b" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 overflow-hidden rounded-2xl border-blue-100 p-2 shadow-xl">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="rounded-xl bg-blue-50 p-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-11 w-11">
                    <AvatarFallback className="text-sm font-black" style={{ background: 'var(--skema-primary)', color: '#fff' }}>
                      {fallback}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-slate-950">{displayName}</p>
                    <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{user?.email}</p>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onOpenProfile} className="gap-2 rounded-lg py-2.5 font-bold">
                <MaterialIcon icon="person" size={16} color="#2563eb" />
                프로필 관리
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onShare} className="gap-2 rounded-lg py-2.5 font-bold">
                <MaterialIcon icon="share" size={16} color="#2563eb" />
                시간표 공유
              </DropdownMenuItem>
              {user?.is_admin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onOpenAdminUsers} className="gap-2 rounded-lg py-2.5 font-bold">
                    <MaterialIcon icon="person" size={16} color="#64748b" />
                    관리자 회원 관리
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onOpenAdminLogs} className="gap-2 rounded-lg py-2.5 font-bold">
                    <MaterialIcon icon="history" size={16} color="#64748b" />
                    관리자 로그인 로그
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => router.push('/notifications')} className="gap-2 rounded-lg py-2.5 font-bold">
                <MaterialIcon icon="notifications" size={16} color="#2563eb" />
                알림 설정
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onLogout} className="gap-2 rounded-lg py-2.5 font-bold text-red-600 focus:text-red-600">
                <MaterialIcon icon="close" size={16} color="#dc2626" />
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
