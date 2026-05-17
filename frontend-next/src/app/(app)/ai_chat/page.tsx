'use client';

import { useRouter } from 'next/navigation';
import MaterialIcon from '@/components/common/MaterialIcon';
import { ChatWindow } from './_components/ChatWindow';

export default function AIChatPage() {
  const router = useRouter();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f8fbff' }}>
      {/* 헤더 */}
      <header style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', borderBottom: '1px solid #ebeef1', background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(16px)', position: 'sticky', top: 0, zIndex: 30, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => router.push('/dashboard')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 13, fontWeight: 600, padding: '6px 10px', borderRadius: 10 }}
          >
            <MaterialIcon icon="arrow_back" size={18} color="#64748b" />
            대시보드
          </button>
          <div style={{ width: 1, height: 18, background: '#e2e8f0' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #2563eb, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcon icon="smart_toy" size={15} color="#fff" filled />
            </div>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#181c1e' }}>AI 일정 어시스턴트</span>
          </div>
        </div>

        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
          일정 추가·수정·삭제를 자연어로
        </span>
      </header>

      {/* 채팅창 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ChatWindow />
      </div>
    </div>
  );
}
