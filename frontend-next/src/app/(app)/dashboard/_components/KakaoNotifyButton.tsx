'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

export function KakaoNotifyButton() {
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<'idle' | 'ok' | 'err' | 'not_connected'>('idle');

  const handleSend = async () => {
    setSending(true);
    try {
      const res = await api.post('/kakao/notify/schedule-summary');
      if (res.data?.success) {
        setStatus('ok');
        toast.success('카카오톡으로 오늘 일정을 보냈습니다!');
      } else if (res.data?.error === 'kakao_not_connected') {
        setStatus('not_connected');
        toast.error('카카오 로그인 후 이용할 수 있습니다');
      } else {
        setStatus('err');
        toast.error('카카오톡 발송에 실패했습니다');
      }
    } catch {
      setStatus('err');
      toast.error('카카오톡 발송에 실패했습니다');
    } finally {
      setSending(false);
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const label = status === 'ok' ? '발송 완료!' : status === 'not_connected' ? '카카오 미연결' : '카카오톡으로 일정 알림';

  return (
    <button
      onClick={handleSend}
      disabled={sending}
      style={{
        width: '100%',
        padding: '9px 0',
        borderRadius: 10,
        background: status === 'ok' ? '#16A34A' : status === 'not_connected' ? '#64748b' : '#FEE500',
        color: status === 'ok' || status === 'not_connected' ? '#fff' : '#3C1E1E',
        fontWeight: 700,
        fontSize: 12,
        border: 'none',
        cursor: sending ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        opacity: sending ? 0.7 : 1,
        transition: 'background 0.2s',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
        <ellipse cx="9" cy="8.5" rx="8.5" ry="7.5" fill="currentColor" fillOpacity="0.15"/>
        <path d="M9 2C5.134 2 2 4.686 2 8c0 2.09 1.183 3.93 3 5.07l-.5 2.43 2.78-1.82C7.72 13.89 8.35 14 9 14c3.866 0 7-2.686 7-6S12.866 2 9 2z" fill="#3C1E1E"/>
      </svg>
      {sending ? '발송 중...' : label}
    </button>
  );
}

