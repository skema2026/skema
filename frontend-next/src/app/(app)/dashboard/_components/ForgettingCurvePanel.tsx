'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { indexToRecurringDay, recurringDayToIndex } from '@/lib/recurringDay';
import { timeToMinutes } from '@/lib/utils';
import type { Schedule } from '@/types';

export function ForgettingCurvePanel({ schedules }: { schedules: Schedule[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);

  const completedClasses = schedules.filter((s) => s.schedule_type === 'class' && s.is_completed);
  const completedClassCount = completedClasses.length;
  const reviewsTomorrow = completedClasses
    .filter((s) => (s.date || todayStr) === todayStr)
    .map((s) => ({ label: s.title.replace(/^[📚📖🔁]\s*/, ''), color: s.color || '#8B5CF6' }));

  const findFreeHourSlot = (dateStr: string): { start_time: string; end_time: string } => {
    const jsDay = new Date(`${dateStr}T00:00:00`).getDay();
    const dow = jsDay === 0 ? 6 : jsDay - 1;
    const daySchedules = schedules.filter((s) =>
      s.date === dateStr || (!s.date && recurringDayToIndex(s.recurring_day) === dow)
    );
    const occupied: [number, number][] = daySchedules
      .filter((s) => s.start_time && s.end_time)
      .map((s) => [timeToMinutes(s.start_time), timeToMinutes(s.end_time)] as [number, number]);
    const isFree = (start: number) => {
      const end = start + 60;
      return start >= 7 * 60 && end <= 23 * 60 && !occupied.some(([s, e]) => s < end && e > start);
    };
    for (const start of [20*60, 19*60, 21*60, 18*60, 22*60, 17*60, 14*60, 15*60, 16*60, 13*60, 10*60, 11*60, 9*60, 8*60, 7*60]) {
      if (isFree(start)) {
        return {
          start_time: `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`,
          end_time: `${String(Math.floor((start + 60) / 60)).padStart(2, '0')}:${String((start + 60) % 60).padStart(2, '0')}`,
        };
      }
    }
    return { start_time: '20:00', end_time: '21:00' };
  };

  const runGenerate = async (silent: boolean) => {
    const classMap = new Map<string, { baseDate: string; title: string; color: string }>();
    for (const s of completedClasses) {
      const baseDate = s.date || todayStr;
      const cur = classMap.get(s.title);
      if (!cur || baseDate > cur.baseDate) {
        classMap.set(s.title, { baseDate, title: s.title, color: s.color || '#8B5CF6' });
      }
    }
    if (classMap.size === 0) return 0;

    let created = 0;
    for (const [, cls] of classMap) {
      const [y, m, d] = cls.baseDate.split('-').map(Number);
      const reviewDate = new Date(y, m - 1, d + 1);
      if (reviewDate <= today) continue;

      const dateStr = `${reviewDate.getFullYear()}-${String(reviewDate.getMonth() + 1).padStart(2, '0')}-${String(reviewDate.getDate()).padStart(2, '0')}`;
      const alreadyExists = schedules.some((s) =>
        s.date === dateStr && s.title.includes(cls.title) && s.schedule_type === 'study'
      );
      if (alreadyExists) continue;

      const dow = reviewDate.getDay() === 0 ? 6 : reviewDate.getDay() - 1;
      const { start_time, end_time } = findFreeHourSlot(dateStr);
      try {
        await api.post('/schedules', {
          title: `🔁 ${cls.title} 복습`,
          schedule_type: 'study',
          date: dateStr,
          recurring_day: indexToRecurringDay(dow),
          start_time,
          end_time,
          color: cls.color,
          priority: 1,
        });
        created++;
      } catch {
        // 충돌 시 해당 복습 일정만 건너뜁니다.
      }
    }
    if (created > 0) {
      await queryClient.invalidateQueries({ queryKey: ['schedules'] });
      toast.success(silent
        ? `수업 완료 감지 — 다음 날 복습 ${created}개 자동 배치!`
        : `복습 일정 ${created}개를 생성했습니다!`);
    } else if (!silent) {
      toast.info('새로 생성할 복습 일정이 없습니다.');
    }
    return created;
  };

  useEffect(() => {
    if (completedClassCount === 0) return;
    const autoKey = `skema_review_auto_${todayStr}_cnt${completedClassCount}`;
    if (localStorage.getItem(autoKey)) return;
    localStorage.setItem(autoKey, '1');
    setGenerating(true);
    runGenerate(true).finally(() => setGenerating(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedClassCount]);

  const handleManualGenerate = async () => {
    setGenerating(true);
    await runGenerate(false);
    setGenerating(false);
  };

  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#3f4b61', marginBottom: 8, letterSpacing: '0.5px' }}>복습 스케줄러</p>
      {reviewsTomorrow.length === 0 ? (
        <p style={{ fontSize: 11, color: '#64748b', textAlign: 'center', padding: '6px 0 8px' }}>오늘 완료된 수업 없음</p>
      ) : (
        <div style={{ padding: '10px 12px', borderRadius: 10, background: '#f5f3ff', border: '1px solid #ddd6fe', marginBottom: 8 }}>
          <p style={{ fontSize: 10, color: '#5b21b6', marginBottom: 6, fontWeight: 600 }}>내일 복습 예정</p>
          <div className="space-y-1.5">
            {reviewsTomorrow.map(({ label, color }, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#3730a3', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: color, borderRadius: 9999, padding: '1px 6px', flexShrink: 0 }}>내일</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={handleManualGenerate}
        disabled={generating}
        style={{
          width: '100%', padding: '7px 0', borderRadius: 8,
          background: generating ? '#e5e7eb' : '#ede9fe',
          color: generating ? '#64748b' : '#5b21b6',
          fontWeight: 700, fontSize: 11,
          border: '1px solid #c4b5fd',
          cursor: generating ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          transition: 'all 0.2s',
        }}
      >
        {generating ? '생성 중...' : '복습 일정 생성'}
      </button>
      <p style={{ fontSize: 9, color: '#64748b', textAlign: 'center', marginTop: 4 }}>수업 완료 시 다음 날 빈 시간 1시간 자동 배치</p>
    </div>
  );
}

