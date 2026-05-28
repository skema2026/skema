'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import MaterialIcon from '@/components/common/MaterialIcon';
import { usePushNotifications, useNotificationPrefs, useReminderSettings } from '@/hooks/usePushNotifications';

export default function NotificationsClient() {
  const router = useRouter();
  const push = usePushNotifications();
  const { prefs, loading: prefsLoading, updatePref } = useNotificationPrefs();
  const { enabled: reminderEnabled, minutes: reminderMinutes, setNotifEnabled, setNotifMinutes } = useReminderSettings();

  return (
    <div style={{ minHeight: '100vh', background: '#f8faff' }}>
      <header
        style={{
          height: '56px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '0 20px',
          borderBottom: '1px solid #e2e8f0',
          background: 'rgba(255,255,255,0.94)',
          position: 'sticky',
          top: 0,
          zIndex: 30,
          backdropFilter: 'blur(16px)',
        }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '6px', cursor: 'pointer' }}
        >
          <MaterialIcon icon="arrow_back" size={18} color="#64748b" />
        </button>
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '10px',
          background: 'linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-black text-slate-950">OS 푸시 알림</p>
              <p className="mt-1 text-sm font-bold text-slate-500">
                {push.permission === 'unsupported'
                  ? '이 브라우저는 푸시 알림을 지원하지 않습니다'
                  : push.permission === 'denied'
                    ? '브라우저 설정에서 알림 권한을 허용해주세요'
                    : push.isSubscribed
                      ? '앱이 꺼진 상태에서도 알림을 받을 수 있습니다'
                      : '일정 시작 전 OS 알림을 받으려면 켜주세요'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {push.isSubscribed && (
                <button
                  type="button"
                  onClick={async () => { await push.sendTest(); toast.success('테스트 알림을 전송했습니다'); }}
                  className="rounded-lg border border-blue-100 px-3 py-2 text-xs font-black text-blue-600 transition hover:bg-blue-50"
                >
                  테스트
                </button>
              )}
              <button
                type="button"
                disabled={push.isLoading || push.permission === 'unsupported' || push.permission === 'denied'}
                onClick={push.isSubscribed ? push.unsubscribe : push.subscribe}
                className={`h-9 rounded-full px-4 text-sm font-black transition disabled:opacity-40 ${
                  push.isSubscribed ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 border border-slate-200'
                }`}
              >
                {push.isLoading ? '처리 중...' : push.isSubscribed ? '켜짐' : '꺼짐'}
              </button>
            </div>
          </div>
          {push.permission === 'denied' && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
              브라우저 주소창 왼쪽 자물쇠 아이콘 → 알림 → 허용으로 변경해주세요
            </p>
          )}
        </section>

        {/* 앱 내 알림 */}
        <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
          <p className="mb-4 text-[11px] font-black text-slate-400">앱 내 알림</p>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-base font-black text-slate-950">앱 내 알림</p>
              <p className="mt-1 text-sm font-bold text-slate-500">앱이 열려 있을 때 상단 배너로 알림</p>
            </div>
            <button
              type="button"
              onClick={() => setNotifEnabled(!reminderEnabled)}
              className={`h-9 rounded-full px-4 text-sm font-black transition ${
                reminderEnabled ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 border border-slate-200'
              }`}
            >
              {reminderEnabled ? '켜짐' : '꺼짐'}
            </button>
          </div>
          {reminderEnabled && (
            <div>
              <p className="mb-2 text-xs font-black text-slate-500">일정 시작 몇 분 전에 알릴까요?</p>
              <div className="flex flex-wrap gap-2">
                {[5, 10, 15, 30, 60].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setNotifMinutes(m)}
                    className={`rounded-lg border px-3 py-2 text-sm font-black transition ${
                      reminderMinutes === m
                        ? 'border-blue-600 bg-blue-50 text-blue-600'
                        : 'border-blue-100 bg-white text-slate-600 hover:bg-blue-50'
                    }`}
                  >
                    {m}분 전
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 알림 종류 */}
        {!prefsLoading && (
          <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            <p className="mb-4 text-[11px] font-black text-slate-400">알림 종류</p>
            <div className="space-y-3">
              {([
                { key: 'reminder',      label: '일정 리마인더',   desc: '일정 시작 전 미리 알림' },
                { key: 'exam_alert',    label: '시험 D-day 알림', desc: '시험 전날 경고' },
                { key: 'motivation',    label: '학습 동기 부여',   desc: '매일 오전 동기 부여 메시지' },
                { key: 'weekly_report', label: '주간 리포트',      desc: '매주 월요일 한 주 계획 요약' },
                { key: 'comparison',    label: '학습 비교',        desc: '매주 수요일 다른 사용자 대비 현황' },
              ] as const).map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-950">{label}</p>
                    <p className="text-xs font-bold text-slate-400">{desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updatePref(key, !prefs[key])}
                    className={`h-8 shrink-0 rounded-full px-3 text-xs font-black transition ${
                      prefs[key] ? 'bg-blue-600 text-white' : 'bg-white text-slate-400 border border-slate-200'
                    }`}
                  >
                    {prefs[key] ? 'ON' : 'OFF'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

      </main>
    </div>
  );
}
