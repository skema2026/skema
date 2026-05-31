'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import MaterialIcon from '@/components/common/MaterialIcon';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const QUICK_CHIPS = [
  '오늘 일정 알려줘',
  '이번 주 빈 시간 찾아줘',
  '내일 일정 보여줘',
  '미완료 일정 재배치해줘',
];

function parseLine(line: string): React.ReactNode {
  // **굵게** 파싱
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i} className="font-bold text-slate-950">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function renderText(text: string) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      elements.push(<br key={i} />);
      return;
    }
    // 글머리 기호 (• 또는 - 또는 * 로 시작)
    if (/^[•\-\*]\s/.test(trimmed)) {
      elements.push(
        <div key={i} className="flex gap-1.5">
          <span className="mt-0.5 shrink-0 text-slate-400">•</span>
          <span>{parseLine(trimmed.replace(/^[•\-\*]\s/, ''))}</span>
        </div>
      );
    } else {
      elements.push(<p key={i} className="leading-relaxed">{parseLine(trimmed)}</p>);
    }
  });

  return <div className="space-y-1">{elements}</div>;
}

function TypingDots() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '12px 16px', background: '#fff', borderRadius: '18px 18px 18px 4px', width: 'fit-content', boxShadow: '0 1px 6px rgba(0,0,0,0.07)', border: '1px solid #ebeef1' }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: '#94a3b8',
            animation: `typing-bounce 1.2s ${i * 0.2}s ease-in-out infinite`,
          }}
        />
      ))}
    </div>
  );
}

function WelcomeCard() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '40px 24px', gap: 16 }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #2563eb, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(37,99,235,0.25)' }}>
        <MaterialIcon icon="smart_toy" size={28} color="#fff" filled />
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 17, fontWeight: 800, color: '#181c1e', marginBottom: 6 }}>AI 일정 어시스턴트</p>
        <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.7, maxWidth: 280 }}>
          자연어로 일정을 추가·수정·삭제하거나<br />
          시험 일정을 등록하고 빈 시간을 찾아보세요.
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 320, marginTop: 8 }}>
        {[
          { icon: 'add_circle', text: '"내일 오후 2시에 알고리즘 공부 추가해줘"' },
          { icon: 'search', text: '"이번 주 금요일 빈 시간 찾아줘"' },
          { icon: 'event', text: '"5월 21일 중간고사 시험 등록해줘"' },
        ].map(({ icon, text }) => (
          <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#f8fbff', borderRadius: 12, border: '1px solid #e2e8f0' }}>
            <MaterialIcon icon={icon} size={16} color="#2563eb" />
            <span style={{ fontSize: 12, color: '#3f4b61', fontWeight: 500 }}>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChatWindow() {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.get('/ai-chat-logs?limit=100')
      .then(({ data }) => {
        const sorted = [...data].sort((a: { id: number }, b: { id: number }) => a.id - b.id);
        setMessages(sorted.map((log: { role: string; message: string }) => ({
          role: (log.role as string).toLowerCase() as 'user' | 'assistant',
          content: log.message,
        })));
      })
      .catch(() => {})
      .finally(() => setInitialLoading(false));
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const { data } = await api.post<{ reply: string }>('/ai/chat', {
        message: trimmed,
        messages: history,
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      queryClient.invalidateQueries({ queryKey: ['exams'] });
    } catch {
      toast.error('AI 응답 중 오류가 발생했습니다');
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [loading, messages, queryClient]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleClearChat = async () => {
    if (!confirm('대화 기록을 모두 삭제하시겠습니까?')) return;
    try {
      await api.delete('/ai-chat-logs');
      setMessages([]);
    } catch {
      toast.error('삭제 중 오류가 발생했습니다');
    }
  };

  const isEmpty = messages.length === 0 && !initialLoading;

  return (
    <>
      <style>{`
        @keyframes typing-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
          30% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', maxWidth: 720, width: '100%', margin: '0 auto' }}>
        {/* 상단 액션 */}
        {messages.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 16px 0' }}>
            <button
              onClick={handleClearChat}
              style={{ fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <MaterialIcon icon="delete_sweep" size={14} color="#94a3b8" />
              대화 초기화
            </button>
          </div>
        )}

        {/* 메시지 영역 */}
        <div
          ref={scrollRef}
          style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {initialLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid #e2e8f0', borderTopColor: '#2563eb', animation: 'spin 0.8s linear infinite' }} />
            </div>
          ) : isEmpty ? (
            <WelcomeCard />
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8 }}
              >
                {msg.role === 'assistant' && (
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #2563eb, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: 2 }}>
                    <MaterialIcon icon="smart_toy" size={15} color="#fff" filled />
                  </div>
                )}
                <div
                  style={{
                    maxWidth: '75%',
                    padding: '10px 14px',
                    borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                    background: msg.role === 'user' ? '#2563eb' : '#fff',
                    color: msg.role === 'user' ? '#fff' : '#181c1e',
                    fontSize: 14,
                    lineHeight: 1.65,
                    boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
                    border: msg.role === 'assistant' ? '1px solid #ebeef1' : 'none',
                    wordBreak: 'break-word',
                  }}
                >
                  {renderText(msg.content)}
                </div>
              </div>
            ))
          )}

          {loading && (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #2563eb, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <MaterialIcon icon="smart_toy" size={15} color="#fff" filled />
              </div>
              <TypingDots />
            </div>
          )}
        </div>

        {/* 빠른 질문 칩 */}
        {isEmpty && (
          <div style={{ padding: '0 16px 8px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip}
                onClick={() => sendMessage(chip)}
                style={{ padding: '7px 14px', borderRadius: 20, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#2563eb', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'background 0.15s' }}
                onMouseOver={(e) => (e.currentTarget.style.background = '#dbeafe')}
                onMouseOut={(e) => (e.currentTarget.style.background = '#eff6ff')}
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* 입력창 */}
        <div style={{ padding: '10px 16px 16px', borderTop: '1px solid #ebeef1', background: '#fff', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder="메시지를 입력하세요... (Enter 전송, Shift+Enter 줄바꿈)"
            rows={1}
            style={{ flex: 1, resize: 'none', border: '1.5px solid #e2e8f0', borderRadius: 14, padding: '10px 14px', fontSize: 14, lineHeight: 1.5, outline: 'none', fontFamily: 'inherit', background: '#f8fbff', color: '#181c1e', overflowY: 'hidden', maxHeight: 120, transition: 'border-color 0.15s' }}
            onFocus={(e) => (e.target.style.borderColor = '#2563eb')}
            onBlur={(e) => (e.target.style.borderColor = '#e2e8f0')}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            style={{ width: 44, height: 44, borderRadius: 14, border: 'none', background: !input.trim() || loading ? '#e2e8f0' : '#2563eb', color: '#fff', cursor: !input.trim() || loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.15s' }}
          >
            <MaterialIcon icon="send" size={18} color="#fff" filled />
          </button>
        </div>
      </div>
    </>
  );
}
