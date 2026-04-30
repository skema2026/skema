'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { recurringDayToIndex } from '@/lib/recurringDay';
import type { Schedule } from '@/types';

export function WeeklyAIFeedbackPanel({ schedules, currentWeekStart }: { schedules: Schedule[]; currentWeekStart: Date }) {
  const weekKey = `${currentWeekStart.getFullYear()}-${currentWeekStart.getMonth() + 1}-${currentWeekStart.getDate()}`;
  const cacheKey = `skema_weekly_letter_${weekKey}`;
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const weekEnd = currentWeekStart.getTime() + 7 * 86400000;
  const thisWeek = schedules.filter((s) => {
    if (!s.date) return true;
    const [y, mo, d] = s.date.split('-').map(Number);
    const t = new Date(y, mo - 1, d).getTime();
    return t >= currentWeekStart.getTime() && t < weekEnd;
  });
  const done = thisWeek.filter((s) => s.is_completed).length;
  const total = thisWeek.length;
  const dayStats = ['월', '화', '수', '목', '금', '토', '일'].map((name, dow) => {
    const daySch = thisWeek.filter((s) => {
      if (s.date) {
        const [y, m, d] = s.date.split('-').map(Number);
        const gd = new Date(y, m - 1, d).getDay();
        return (gd === 0 ? 6 : gd - 1) === dow;
      }
      return recurringDayToIndex(s.recurring_day) === dow;
    });
    return { name, done: daySch.filter((s) => s.is_completed).length, total: daySch.length };
  }).filter((d) => d.total > 0);
  const patternStr = dayStats.map((d) => `${d.name}요일 ${d.done}/${d.total}개`).join(', ');
  const sorted = [...dayStats].sort((a, b) => (b.done / Math.max(b.total, 1)) - (a.done / Math.max(a.total, 1)));
  const bestDay = sorted[0];
  const worstDay = sorted[sorted.length - 1];

  useEffect(() => {
    if (total === 0 || done === 0) return;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      setFeedback(cached);
      return;
    }

    const typeCount = ['class', 'study', 'assignment', 'activity', 'personal']
      .map((t) => {
        const n = thisWeek.filter((s) => s.schedule_type === t).length;
        return n > 0 ? `${t} ${n}개` : '';
      })
      .filter(Boolean)
      .join(', ');

    setLoading(true);
    api.post<{ reply: string }>('/ai/chat', {
      message: `이번 주 학습 데이터: 총 ${total}개 중 ${done}개 완료(완료율 ${Math.round(done / total * 100)}%). 요일별: ${patternStr}. 유형별: ${typeCount}. "이번 주의 나에게" 형식의 짧은 AI 편지를 3문장으로 써줘. ${bestDay ? `${bestDay.name}요일에 집중력이 높았고` : ''} ${worstDay && worstDay !== bestDay ? `${worstDay.name}요일에 아쉬운 점이 있었다는 점을 구체적으로 언급하고,` : ''} 다음 주 실천 가능한 제안 1가지를 담아줘. 이모지 없이, 존댓말로.`,
      messages: [],
    }).then(({ data }) => {
      setFeedback(data.reply);
      try {
        localStorage.setItem(cacheKey, data.reply);
      } catch {
        // localStorage 저장 실패는 화면 표시를 막지 않습니다.
      }
    }).catch(() => {}).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, done]);

  const today = new Date();
  const dateLabel = `${today.getMonth() + 1}월 ${today.getDate()}일`;

  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#3f4b61', marginBottom: 8, letterSpacing: '0.5px' }}>주간 AI 편지</p>
      <div style={{ padding: '12px', borderRadius: 10, background: '#faf9ff', border: '1px solid #e0d9ff', minHeight: 72 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #c4b5fd', borderTopColor: '#7c3aed', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
            <p style={{ fontSize: 11, color: '#3f4b61' }}>편지 작성 중...</p>
          </div>
        ) : feedback ? (
          <>
            <p style={{ fontSize: 9, color: '#64748b', marginBottom: 6 }}>To. 이번 주의 나 · {dateLabel}</p>
            <p style={{ fontSize: 12, color: '#3730a3', lineHeight: 1.7 }}>{feedback}</p>
            <p style={{ fontSize: 9, color: '#c4b5fd', marginTop: 6, textAlign: 'right' }}>— AI SKEMA</p>
          </>
        ) : (
          <p style={{ fontSize: 11, color: '#64748b', lineHeight: 1.6 }}>이번 주 일정을 완료하면<br />AI 편지가 자동 작성됩니다.</p>
        )}
      </div>
    </div>
  );
}

