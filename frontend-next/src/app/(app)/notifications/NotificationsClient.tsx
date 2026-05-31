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
      className="relative shrink-0 transition disabled:opacity-40"
      style={{
        width: 48,
        height: 28,
        borderRadius: 99,
        background: checked ? '#2563eb' : '#e2e8f0',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: 0,
        transition: 'background 0.2s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 23 : 3,
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
          transition: 'left 0.2s',
        }}
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
    <div style={{ minHeight: '100vh', background: '#f8faff' }}>
      <header style={{
        height: '56px', display: 'flex', alignItems: 'center', gap: '10px',
        padding: '0 20px', borderBottom: '1px solid #e2e8f0',
        background: 'rgba(255,255,255,0.94)', position: 'sticky', top: 0, zIndex: 30,
        backdropFilter: 'blur(16px)',
      }}>
        <button
          type="button"
          onClick={() => router.back()}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '6px', cursor: 'pointer' }}
        >
          <MaterialIcon icon="arrow_back" size={18} color="#64748b" />
        </button>
        <div style={{
          width: '32px', height: '32px', borderRadius: '10px',
          background: 'linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 8px 18px rgba(37, 99, 235, 0.24)',
        }}>
          <MaterialIcon icon="notifications" size={18} color="#fff" filled />
        </div>
        <span style={{ fontWeight: 800, fontSize: '18px', color: '#0f172a' }}>알림 설정</span>
      </header>

      <main style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* OS 푸시 알림 */}
        <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
          <p className="mb-4 text-[11px] font-black text-slate-400">OS 푸시 알림</p>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-black text-slate-950">OS 푸시 알림</p>
              <p className="mt-0.5 text-xs font-bold text-slate-400">
                {push.permission === 'unsupported'
                  ? '이 브라우저는 푸시 알림을 지원하지 않습니다'
                  : push.permission === 'denied'
                    ? '브라우저 설정에서 알림 권한을 허용해주세요'
                    : push.isSubscribed
                      ? '앱이 꺼진 상태에서도 알림을 받습니다'
                      : '켜면 앱 밖에서도 알림을 받을 수 있습니다'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {push.isSubscribed && (
                <button
                  type="button"
                  onClick={async () => { await push.sendTest(); toast.success('테스트 알림을 전송했습니다'); }}
                  className="rounded-lg border border-blue-100 px-3 py-1.5 text-xs font-black text-blue-600 transition hover:bg-blue-50"
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
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
              브라우저 주소창 자물쇠 아이콘 → 알림 → 허용으로 변경해주세요
            </p>
          )}
        </section>

        {/* 알림 종류 */}
        {!prefsLoading && (
          <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            <p className="mb-4 text-[11px] font-black text-slate-400">알림 종류</p>
            <div className="divide-y divide-slate-100">

              {/* 일정 시작 전 알림 */}
              <div className="py-3 first:pt-0">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-950">일정 시작 전 알림</p>
                    <p className="text-xs font-bold text-slate-400">일정 시작 N분 전에 알림</p>
                  </div>
                  <Toggle
                    checked={!!prefs.reminder_start}
                    onChange={() => updatePref('reminder_start', !prefs.reminder_start)}
                  />
                </div>
                {prefs.reminder_start && (
                  <div className="mt-3 rounded-xl bg-blue-50/60 px-3 py-3">
                    <p className="mb-2 text-xs font-black text-slate-600">몇 분 전에 알릴까요?</p>
                    <div className="grid grid-cols-5 gap-1.5">
                      {[5, 10, 15, 30, 60].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => updatePref('reminder_minutes', m)}
                          className={`rounded-lg border py-2 text-xs font-black transition ${
                            reminderMinutes === m
                              ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                              : 'border-blue-100 bg-white text-slate-600 hover:border-blue-300'
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
                  <p className="text-sm font-black text-slate-950">미완료 알림</p>
                  <p className="text-xs font-bold text-slate-400">일정 종료 후에도 미완료면 알림</p>
                </div>
                <Toggle
                  checked={!!prefs.reminder_incomplete}
                  onChange={() => updatePref('reminder_incomplete', !prefs.reminder_incomplete)}
                />
              </div>

              {/* 나머지 알림 종류 */}
              {([
                { key: 'exam_alert',         label: '시험 D-day 알림',   desc: 'D-7 · D-3 · D-1 · 당일' },
                { key: 'motivation',         label: '학습 동기 부여',     desc: '매일 09:00' },
                { key: 'weekly_report',      label: '주간 리포트',        desc: '매주 월요일 08:00' },
                { key: 'group_member_post',  label: '그룹 새 기록 알림',  desc: '그룹원이 기록을 올리면 알림' },
                { key: 'log_like',           label: '좋아요 알림',        desc: '내 기록에 좋아요가 달리면 알림' },
                { key: 'comparison',         label: '학습 비교',          desc: '매주 월요일 08:00 · 사용자 많아지면 켜세요' },
              ] as const).map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between gap-4 py-3 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-950">{label}</p>
                    <p className="text-xs font-bold text-slate-400">{desc}</p>
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
