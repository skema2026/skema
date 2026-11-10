'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import MaterialIcon from '@/components/common/MaterialIcon';
import { usePushNotifications, useNotificationPrefs } from '@/hooks/usePushNotifications';

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-[#2a6fe3]' : 'bg-[#cfdbec]'
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_1px_2px_rgba(15,30,58,0.2)] transition-transform duration-150 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export default function NotificationsClient() {
  const router = useRouter();
  const push = usePushNotifications();
  const { prefs, loading: prefsLoading, updatePref } = useNotificationPrefs();
  const reminderMinutes = prefs.reminder_minutes ?? 30;

  return (
    <div className="min-h-screen bg-[#f5f8fd] text-[#0f1e3a]">
      <header className="sticky top-0 z-30 border-b border-[#0f1e3a]/8 bg-white">
        <div className="mx-auto flex h-14 max-w-[640px] items-center gap-3 px-4">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="뒤로"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#44536b] transition-colors hover:bg-[#edf3fc]"
          >
            <MaterialIcon icon="arrow_back" size={18} color="currentColor" />
          </button>
          <h1 className="text-[16px] font-semibold">알림 설정</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-[640px] flex-col gap-4 px-4 py-6">

        {/* OS 푸시 알림 */}
        <section className="rounded-2xl border border-[#0f1e3a]/8 bg-white p-5">
                    <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[15px] font-medium text-[#0f1e3a]">휴대폰·PC 푸시 알림</p>
              <p className="mt-0.5 text-xs font-medium text-[#5f6f88]">
                {push.permission === 'unsupported'
                  ? '이 브라우저는 푸시 알림을 지원하지 않아요'
                  : push.permission === 'denied'
                    ? '브라우저 설정에서 알림 권한을 허용해 주세요'
                    : push.isSubscribed
                      ? '앱이 꺼져 있어도 알림을 받아요'
                      : '켜면 앱 밖에서도 알림을 받을 수 있어요'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {push.isSubscribed && (
                <button
                  type="button"
                  onClick={async () => { await push.sendTest(); toast.success('테스트 알림을 보냈어요'); }}
                  className="h-8 rounded-lg border border-[#0f1e3a]/10 px-3 text-[13px] text-[#0f1e3a] transition-colors hover:bg-[#edf3fc]"
                >
                  테스트
                </button>
              )}
              <Toggle
                checked={push.isSubscribed}
                onChange={push.isSubscribed ? push.unsubscribe : push.subscribe}
                disabled={push.isLoading || push.permission === 'unsupported' || push.permission === 'denied'}
              />
            </div>
          </div>
          {push.permission === 'denied' && (
            <p className="mt-4 rounded-xl bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
              주소창의 자물쇠 아이콘 → 알림 → 허용으로 바꿔 주세요
            </p>
          )}
        </section>

        {/* 알림 종류 */}
        {!prefsLoading && (
          <section className="rounded-2xl border border-[#0f1e3a]/8 bg-white p-5">
            <p className="mb-2 text-[15px] font-medium text-[#0f1e3a]">알림 종류</p>
            <div className="divide-y divide-[#0f1e3a]/8">

              {/* 일정 시작 전 알림 */}
              <div className="py-3 first:pt-0">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[14px] text-[#0f1e3a]">일정 시작 전 알림</p>
                    <p className="mt-0.5 text-[13px] text-[#5f6f88]">시작하기 몇 분 전에 알려요</p>
                  </div>
                  <Toggle
                    checked={!!prefs.reminder_start}
                    onChange={() => updatePref('reminder_start', !prefs.reminder_start)}
                  />
                </div>
                {prefs.reminder_start && (
                  <div className="mt-3 rounded-xl bg-[#f5f8fd] p-3">
                    <p className="mb-2 text-[13px] text-[#44536b]">몇 분 전에 알릴까요?</p>
                    <div className="grid grid-cols-5 gap-1.5">
                      {[5, 10, 15, 30, 60].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => updatePref('reminder_minutes', m)}
                          className={`h-9 rounded-lg border font-mono text-[13px] tabular-nums transition-colors ${
                            reminderMinutes === m
                              ? 'border-[#2a6fe3] bg-[#2a6fe3] text-white'
                              : 'border-[#0f1e3a]/10 bg-white text-[#44536b] hover:bg-[#edf3fc]'
                          }`}
                        >
                          {m}분
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 종료 후 미완료 알림 */}
              <div className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-[14px] text-[#0f1e3a]">미완료 알림</p>
                  <p className="mt-0.5 text-[13px] text-[#5f6f88]">끝났는데 완료 안 한 일정을 알려요</p>
                </div>
                <Toggle
                  checked={!!prefs.reminder_incomplete}
                  onChange={() => updatePref('reminder_incomplete', !prefs.reminder_incomplete)}
                />
              </div>

              {/* 나머지 알림 종류 */}
              {([
                { key: 'exam_alert',         label: '시험 D-day',   desc: 'D-7 · D-3 · D-1 · 당일' },
                { key: 'motivation',         label: '학습 동기 부여',     desc: '매일 09:00' },
                { key: 'weekly_report',      label: '주간 리포트',        desc: '매주 월요일 08:00' },
                { key: 'group_member_post',  label: '그룹 새 기록',  desc: '그룹원이 기록을 올리면 알려요' },
                { key: 'log_like',           label: '좋아요',        desc: '내 기록에 좋아요가 달리면 알려요' },
                { key: 'comparison',         label: '학습 비교',          desc: '매주 월요일 08:00 · 기본 꺼짐' },
              ] as const).map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between gap-4 py-3 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-[14px] text-[#0f1e3a]">{label}</p>
                    <p className="mt-0.5 text-[13px] text-[#5f6f88]">{desc}</p>
                  </div>
                  <Toggle
                    checked={!!prefs[key]}
                    onChange={() => updatePref(key, !prefs[key])}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

      </main>
    </div>
  );
}
