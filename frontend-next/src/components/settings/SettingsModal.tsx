'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useProfile, useUpdateProfile } from '@/hooks/useProfile';
import {
  getPushAvailability,
  sendTestPush,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/lib/push';
import { api } from '@/lib/api';

const OCCUPATIONS = ['학생', '직장인', '프리랜서', '기타'];

const NOTIF_TYPES = [
  { key: 'motivation',     label: '동기부여 메시지',    desc: '매일 오전 9시 · 랜덤 동기부여 문구' },
  { key: 'weekly_report',  label: '주간 수행률 리포트', desc: '매주 월요일 오전 8시 · 지난주 완료율' },
  { key: 'reminder',       label: '일정 리마인더',      desc: '시작 30분 전 · 미완료 재촉' },
  { key: 'comparison',     label: '주간 달성 비교',     desc: '매주 수요일 오전 10시 · 전체 평균 비교' },
  { key: 'exam_alert',     label: '시험 전날 경보',     desc: '시험 전날 · 복습 완료 독려' },
] as const;

type NotifTypeKey = (typeof NOTIF_TYPES)[number]['key'];

const DEFAULT_NOTIF_PREFS: Record<NotifTypeKey, boolean> = {
  motivation: true,
  weekly_report: true,
  reminder: true,
  comparison: true,
  exam_alert: true,
};

function loadNotifPrefs(): Record<NotifTypeKey, boolean> {
  if (typeof window === 'undefined') return DEFAULT_NOTIF_PREFS;
  try {
    const raw = localStorage.getItem('skema_notif_prefs');
    return raw ? { ...DEFAULT_NOTIF_PREFS, ...JSON.parse(raw) } : DEFAULT_NOTIF_PREFS;
  } catch {
    return DEFAULT_NOTIF_PREFS;
  }
}

type ProfileForm = {
  occupation: string;
  sleep_start: string;
  sleep_end: string;
};

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();

  const [profileDraft, setProfileDraft] = useState<ProfileForm | null>(null);
  const profileForm: ProfileForm = profileDraft ?? {
    occupation: profile?.occupation || '',
    sleep_start: profile?.sleep_start || '23:00',
    sleep_end: profile?.sleep_end || '07:00',
  };

  const [notifEnabled, setNotifEnabled] = useState(() => (
    typeof window === 'undefined' ? true : localStorage.getItem('skema_notif_enabled') !== 'false'
  ));
  const [notifMinutes, setNotifMinutes] = useState(() => (
    typeof window === 'undefined' ? 30 : parseInt(localStorage.getItem('skema_notif_minutes') || '30', 10)
  ));
  const [pushState, setPushState] = useState<{
    loading: boolean;
    supported: boolean;
    enabled: boolean;
    subscribed: boolean;
    reason: string | null;
  }>({
    loading: true,
    supported: false,
    enabled: false,
    subscribed: false,
    reason: null,
  });
  const [pushBusy, setPushBusy] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<Record<NotifTypeKey, boolean>>(loadNotifPrefs);

  const isCustomOccupation = !!profileForm.occupation && !OCCUPATIONS.includes(profileForm.occupation);
  const updateProfileDraft = (next: ProfileForm) => setProfileDraft(next);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setProfileDraft(null);
      onClose();
    }
  };

  const handleSaveProfile = () => {
    updateProfile.mutate(profileForm, {
      onSuccess: () => {
        toast.success('프로필이 저장되었습니다');
        setProfileDraft(null);
        onClose();
      },
      onError: () => toast.error('저장 중 오류가 발생했습니다'),
    });
  };

  const handleSaveNotif = async () => {
    localStorage.setItem('skema_notif_enabled', String(notifEnabled));
    localStorage.setItem('skema_notif_minutes', String(notifMinutes));
    localStorage.setItem('skema_notif_prefs', JSON.stringify(notifPrefs));
    try {
      await api.put('/notifications/prefs', notifPrefs);
    } catch {
      // 백엔드 저장 실패해도 로컬 설정은 유지
    }
    toast.success('알림 설정이 저장되었습니다');
    onClose();
  };

  const toggleNotifPref = (key: NotifTypeKey) => {
    setNotifPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const refreshPushState = async () => {
    try {
      const state = await getPushAvailability();
      setPushState({ loading: false, ...state });
    } catch {
      setPushState({
        loading: false,
        supported: true,
        enabled: false,
        subscribed: false,
        reason: 'server',
      });
    }
  };

  useEffect(() => {
    if (!open) return;
    refreshPushState();
  }, [open]);

  const handleEnablePush = async () => {
    setPushBusy(true);
    try {
      await subscribeToPush();
      await refreshPushState();
      toast.success('휴대폰 푸시 알림이 켜졌습니다');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'insecure') {
        toast.error('휴대폰 푸시는 HTTPS 주소에서만 켤 수 있습니다');
      } else if (message === 'server_disabled') {
        toast.error('서버에 Web Push 키가 설정되지 않았습니다');
      } else if (message === 'permission_denied') {
        toast.error('브라우저 알림 권한이 허용되지 않았습니다');
      } else {
        toast.error('푸시 알림을 켤 수 없습니다');
      }
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    setPushBusy(true);
    try {
      await unsubscribeFromPush();
      await refreshPushState();
      toast.success('휴대폰 푸시 알림이 꺼졌습니다');
    } catch {
      toast.error('푸시 알림 해제 중 오류가 발생했습니다');
    } finally {
      setPushBusy(false);
    }
  };

  const handleTestPush = async () => {
    setPushBusy(true);
    try {
      const result = await sendTestPush();
      if (result.disabled) {
        toast.error('서버에 Web Push 키가 설정되지 않았습니다');
      } else if ((result.sent ?? 0) > 0) {
        toast.success('테스트 푸시를 보냈습니다');
      } else {
        toast.error('등록된 푸시 기기가 없습니다');
      }
    } catch {
      toast.error('테스트 푸시 발송에 실패했습니다');
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md border-[#d8e2ef] bg-[#ffffff]">
        <DialogHeader>
          <DialogTitle>설정</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="profile">
          <TabsList className="w-full mb-4">
            <TabsTrigger value="profile" className="flex-1">프로필</TabsTrigger>
            <TabsTrigger value="notifications" className="flex-1">알림</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="space-y-5">
            <div className="space-y-2">
              <Label>직업 / 신분</Label>
              <div className="grid grid-cols-2 gap-2">
                {OCCUPATIONS.map((occ) => (
                  <button
                    key={occ}
                    type="button"
                    onClick={() => updateProfileDraft({ ...profileForm, occupation: occ })}
                    className={`py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                      (occ === '기타' ? profileForm.occupation === '기타' || isCustomOccupation : profileForm.occupation === occ)
                        ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                    }`}
                  >
                    {occ}
                  </button>
                ))}
              </div>
              {(profileForm.occupation === '기타' || isCustomOccupation) && (
                <Input
                  placeholder="직접 입력"
                  value={profileForm.occupation === '기타' ? '' : profileForm.occupation}
                  onChange={(e) => updateProfileDraft({ ...profileForm, occupation: e.target.value })}
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="s-sleep-start">취침 시간</Label>
                <Input
                  id="s-sleep-start"
                  type="time"
                  value={profileForm.sleep_start}
                  onChange={(e) => updateProfileDraft({ ...profileForm, sleep_start: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-sleep-end">기상 시간</Label>
                <Input
                  id="s-sleep-end"
                  type="time"
                  value={profileForm.sleep_end}
                  onChange={(e) => updateProfileDraft({ ...profileForm, sleep_end: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>취소</Button>
              <Button
                onClick={handleSaveProfile}
                disabled={updateProfile.isPending}
                style={{ background: 'var(--skema-primary)', color: '#fff' }}
              >
                {updateProfile.isPending ? '저장 중...' : '저장'}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="notifications" className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">알림 활성화</p>
                <p className="text-xs text-gray-500 mt-0.5">일정 시작 전 알림을 받습니다</p>
              </div>
              <button
                type="button"
                onClick={() => setNotifEnabled(!notifEnabled)}
                style={{
                  width: 44, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer',
                  background: notifEnabled ? 'var(--skema-primary)' : '#d1d5db',
                  position: 'relative', transition: 'background 0.2s',
                }}
              >
                <span style={{
                  position: 'absolute', top: 3, left: notifEnabled ? 23 : 3,
                  width: 18, height: 18, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </button>
            </div>

            {notifEnabled && (
              <div className="space-y-2">
                <Label>알림 시간 (분 전)</Label>
                <div className="flex gap-2 flex-wrap">
                  {[10, 15, 30, 60].map((min) => (
                    <button
                      key={min}
                      type="button"
                      onClick={() => setNotifMinutes(min)}
                      className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                        notifMinutes === min
                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {min}분
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 알람 종류별 토글 */}
            <div className="space-y-2">
              <p className="text-sm font-medium">알림 종류 선택</p>
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
                {NOTIF_TYPES.map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-gray-500">{desc}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleNotifPref(key)}
                      style={{
                        width: 40, height: 22, borderRadius: 999, border: 'none', cursor: 'pointer',
                        background: notifPrefs[key] ? 'var(--skema-primary)' : '#d1d5db',
                        position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                      }}
                    >
                      <span style={{
                        position: 'absolute', top: 2, left: notifPrefs[key] ? 20 : 2,
                        width: 18, height: 18, borderRadius: '50%', background: '#fff',
                        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sm">휴대폰 푸시</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {pushState.subscribed ? '이 기기에 푸시 알림이 연결되었습니다' : '앱을 닫아도 일정 알림을 받을 수 있습니다'}
                  </p>
                </div>
                <span
                  className={`text-xs font-semibold px-2 py-1 rounded-full ${
                    pushState.subscribed ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {pushState.subscribed ? '켜짐' : '꺼짐'}
                </span>
              </div>

              {!pushState.loading && pushState.reason === 'insecure' && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
                  HTTPS 주소에서만 사용할 수 있습니다.
                </p>
              )}
              {!pushState.loading && pushState.supported && !pushState.enabled && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
                  서버 Web Push 키 설정이 필요합니다.
                </p>
              )}
              {!pushState.loading && pushState.reason === 'unsupported' && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
                  이 브라우저는 푸시 알림을 지원하지 않습니다.
                </p>
              )}

              <div className="flex gap-2">
                {pushState.subscribed ? (
                  <>
                    <Button type="button" variant="outline" onClick={handleDisablePush} disabled={pushBusy}>
                      끄기
                    </Button>
                    <Button type="button" onClick={handleTestPush} disabled={pushBusy} style={{ background: 'var(--skema-primary)', color: '#fff' }}>
                      테스트
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    onClick={handleEnablePush}
                    disabled={pushBusy || pushState.loading || !pushState.supported || !pushState.enabled}
                    style={{ background: 'var(--skema-primary)', color: '#fff' }}
                  >
                    푸시 켜기
                  </Button>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>취소</Button>
              <Button
                onClick={handleSaveNotif}
                style={{ background: 'var(--skema-primary)', color: '#fff' }}
              >
                저장
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
