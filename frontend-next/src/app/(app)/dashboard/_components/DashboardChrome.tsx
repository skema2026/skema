'use client';

import type { MouseEvent } from 'react';
import Image from 'next/image';
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
import { displayTitle } from '@/lib/utils';
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
        border: '1px solid rgba(15,30,58,0.08)',
        borderRadius: 14,
        padding: '12px 16px',
        boxShadow: '0 12px 32px rgba(15,30,58,0.12)',
        maxWidth: 300,
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        cursor: 'pointer',
      }}
      onClick={() => onOpen(notification)}
    >
      <div style={{ width: 32, height: 32, borderRadius: 8, background: '#eaf2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <MaterialIcon icon="notifications_active" size={16} color="#2a6fe3" />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 14, color: '#0f1e3a' }}>곧 시작해요</div>
        <div style={{ fontSize: 13, color: '#44536b', marginTop: 2 }}>{displayTitle(notification.title)} — {notification.start_time}</div>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="닫기"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5f6f88', fontSize: 16, padding: 0, lineHeight: 1 }}
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
        background: 'rgba(255,255,255,0.96)',
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
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5f6f88] transition-colors hover:bg-[#edf3fc] hover:text-[#0f1e3a]"
        >
          <MaterialIcon icon="arrow_back" size={18} color="currentColor" />
        </button>
        <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <Image
            src="/icon-192.png"
            alt="SKEMA 로고"
            width={28}
            height={28}
            style={{ display: 'block', width: '28px', height: '28px', borderRadius: '7px', objectFit: 'contain' }}
          />
        </div>
        <span style={{ fontWeight: 600, fontSize: '17px', color: '#0f1e3a', letterSpacing: '-0.01em' }}>SKEMA</span>
        {todayPct !== null && (
          <span
            className="skema-dashboard-title-badge"
            title={`오늘 일정 ${todayTotal}개 중 ${todayDone}개 완료`}
            style={{ marginLeft: 8, fontSize: 13, color: '#5f6f88', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
          >
            오늘 {todayDone}/{todayTotal}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          onClick={onAddSchedule}
          title="일정 추가"
          className="flex h-9 items-center gap-2 rounded-lg bg-[#2a6fe3] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#1f63d6] active:scale-[0.98]"
        >
          <MaterialIcon icon="add" size={16} color="currentColor" />
          <span className="hide-mobile">일정 추가</span>
        </button>
        <button
          type="button"
          onClick={onOpenSetlog}
          title="기록"
          className="skema-btn-secondary"
        >
          <MaterialIcon icon="photo_camera" size={16} color="currentColor" />
          <span className="hide-mobile">기록</span>
        </button>

        <button
          type="button"
          onClick={onReschedule}
          disabled={isRegenerating}
          title="못 한 공부·과제 블록을 시험 전날까지 빈 시간에 다시 배치"
          className="skema-btn-secondary disabled:opacity-50"
        >
          <MaterialIcon icon="autorenew" size={16} color="currentColor" />
          <span className="hide-mobile">{isRegenerating ? '계산 중' : '다시 짜기'}</span>
        </button>
        <button
          type="button"
          onClick={onUploadTimetable}
          title="시간표 업로드"
          className="skema-btn-secondary"
        >
          <MaterialIcon icon="upload_file" size={16} color="currentColor" />
          <span className="hide-mobile">시간표 업로드</span>
        </button>
        <button
          type="button"
          onClick={onShare}
          title="공유"
          className="flex h-9 items-center gap-2 rounded-lg px-3 text-[14px] text-[#44536b] transition-colors hover:bg-[#edf3fc] hover:text-[#0f1e3a]"
        >
          <MaterialIcon icon="share" size={16} color="currentColor" />
          <span className="hide-mobile">공유</span>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-9 items-center gap-2 rounded-lg border border-black/10 bg-white pl-1 pr-2 transition-colors outline-none hover:bg-[#edf3fc]">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-xs font-medium" style={{ background: '#edf3fc', color: '#44536b' }}>
                {fallback}
              </AvatarFallback>
            </Avatar>
            <span className="hide-mobile max-w-[120px] truncate text-[13px] text-[#0f1e3a]">
              {displayName}
            </span>
            <MaterialIcon icon="expand_more" size={14} color="#64748b" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 overflow-hidden rounded-xl border-black/10 p-2 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="rounded-lg bg-[#edf3fc] p-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-11 w-11">
                    <AvatarFallback className="text-sm font-semibold" style={{ background: 'var(--skema-primary)', color: '#fff' }}>
                      {fallback}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-950">{displayName}</p>
                    <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">{user?.email}</p>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onOpenProfile} className="gap-2 rounded-lg py-2.5 font-medium">
                <MaterialIcon icon="person" size={16} color="#2a6fe3" />
                프로필 관리
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onShare} className="gap-2 rounded-lg py-2.5 font-medium">
                <MaterialIcon icon="share" size={16} color="#2a6fe3" />
                시간표 공유
              </DropdownMenuItem>
              {user?.is_admin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onOpenAdminUsers} className="gap-2 rounded-lg py-2.5 font-medium">
                    <MaterialIcon icon="person" size={16} color="#64748b" />
                    관리자 회원 관리
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onOpenAdminLogs} className="gap-2 rounded-lg py-2.5 font-medium">
                    <MaterialIcon icon="history" size={16} color="#64748b" />
                    관리자 로그인 로그
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => router.push('/notifications')} className="gap-2 rounded-lg py-2.5 font-medium">
                <MaterialIcon icon="notifications" size={16} color="#2a6fe3" />
                알림 설정
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onLogout} className="gap-2 rounded-lg py-2.5 font-medium text-red-600 focus:text-red-600">
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
