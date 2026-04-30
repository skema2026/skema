'use client';

import { recurringDayToIndex } from '@/lib/recurringDay';
import { timeToMinutes } from '@/lib/utils';
import type { Schedule } from '@/types';

export function TypeAnalysis({ schedules, weekStart }: { schedules: Schedule[]; weekStart: Date }) {
  const typeMeta = [
    { type: 'class', label: '수업', color: '#4F46E5', icon: '📚' },
    { type: 'study', label: '자율학습', color: '#059669', icon: '✏️' },
    { type: 'assignment', label: '과제', color: '#F97316', icon: '📋' },
    { type: 'activity', label: '활동', color: '#A855F7', icon: '🎯' },
    { type: 'personal', label: '개인', color: '#E11D48', icon: '👤' },
  ];
  const weekEnd = weekStart.getTime() + 7 * 24 * 3600 * 1000;
  const thisWeek = schedules.filter((s) => {
    if (!s.date) return true;
    const [y, m, d] = s.date.split('-').map(Number);
    const t = new Date(y, m - 1, d).getTime();
    return t >= weekStart.getTime() && t < weekEnd;
  });
  const stats = typeMeta.map(({ type, label, color, icon }) => {
    const typeSch = thisWeek.filter((s) => s.schedule_type === type);
    const done = typeSch.filter((s) => s.is_completed).length;
    const totalMins = typeSch.reduce((sum, s) => sum + (timeToMinutes(s.end_time) - timeToMinutes(s.start_time)), 0);
    return { type, label, color, icon, count: typeSch.length, done, totalMins };
  });
  const maxMins = Math.max(...stats.map((s) => s.totalMins), 1);
  const totalMinsAll = stats.reduce((s, t) => s + t.totalMins, 0);

  return (
    <div className="space-y-3">
      <div className="rounded-xl p-4" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#181c1e', marginBottom: 4 }}>이번 주 유형별 분석</p>
        <p style={{ fontSize: 11, color: '#3f4b61', marginBottom: 16 }}>
          총 {thisWeek.length}개 일정 · {Math.floor(totalMinsAll / 60)}시간 {totalMinsAll % 60}분
        </p>
        <div className="flex gap-3 flex-wrap mb-4">
          {stats.filter((s) => s.count > 0).map(({ type, label, color, icon, count }) => (
            <div key={type} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 20,
              background: `${color}15`, border: `1.5px solid ${color}40`,
            }}>
              <span style={{ fontSize: 14 }}>{icon}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color }}>{label}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color }}>{count}</span>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {stats.map(({ type, label, color, icon, count, done, totalMins }) => {
            const hrs = Math.floor(totalMins / 60);
            const mins = totalMins % 60;
            const timeStr = hrs > 0 ? `${hrs}시간 ${mins > 0 ? `${mins}분` : ''}` : `${mins}분`;
            const pct = count > 0 ? Math.round((done / count) * 100) : 0;
            return (
              <div key={type}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13 }}>{icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#181c1e' }}>{label}</span>
                    {count > 0 && (
                      <span style={{ fontSize: 10, color: '#3f4b61' }}>· {count}개 · {timeStr}</span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: count > 0 ? color : '#d1d5db' }}>
                    {count > 0 ? `완료 ${pct}%` : '없음'}
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 99, background: '#f1f4f7' }}>
                  <div style={{
                    height: '100%',
                    width: `${totalMins > 0 ? (totalMins / maxMins) * 100 : 0}%`,
                    background: color,
                    borderRadius: 99,
                    transition: 'width 0.5s',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function WeeklyReport({ schedules }: { schedules: Schedule[] }) {
  const now = new Date();
  const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const weekDays = ['월', '화', '수', '목', '금', '토', '일'];
  const weekMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - todayDow);
  const weekStats = weekDays.map((day, i) => {
    const colDate = new Date(weekMonday);
    colDate.setDate(weekMonday.getDate() + i);
    const colStr = `${colDate.getFullYear()}-${String(colDate.getMonth()+1).padStart(2,'0')}-${String(colDate.getDate()).padStart(2,'0')}`;
    const daySch = schedules.filter((s) => {
      if (!s.date) return recurringDayToIndex(s.recurring_day) === i;
      return s.date === colStr;
    });
    const done = daySch.filter((s) => s.is_completed).length;
    return { day, done, total: daySch.length, pct: daySch.length > 0 ? Math.round((done / daySch.length) * 100) : null, isToday: i === todayDow };
  });
  const typeBreakdown = [
    { type: 'class', label: '수업', color: '#4F46E5' },
    { type: 'study', label: '자율학습', color: '#10b981' },
    { type: 'assignment', label: '과제', color: '#F97316' },
    { type: 'activity', label: '활동', color: '#A855F7' },
    { type: 'personal', label: '개인', color: '#E11D48' },
  ].map(({ type, label, color }) => {
    const typeSch = schedules.filter((s) => s.schedule_type === type);
    const done = typeSch.filter((s) => s.is_completed).length;
    return { type, label, color, done, total: typeSch.length };
  }).filter(({ total }) => total > 0);

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#181c1e', marginBottom: 16 }}>요일별 수행률</p>
        <div className="flex items-end gap-2" style={{ height: 80 }}>
          {weekStats.map(({ day, pct, isToday }) => (
            <div key={day} className="flex-1 flex flex-col items-center gap-1">
              <span style={{ fontSize: 10, color: '#3f4b61' }}>{pct !== null ? `${pct}%` : '-'}</span>
              <div style={{ width: '100%', height: 50, background: '#f1f4f7', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'flex-end' }}>
                {pct !== null && (
                  <div style={{
                    width: '100%', height: `${pct}%`,
                    background: isToday ? 'var(--skema-primary)' : '#c3d0ff',
                    borderRadius: 6, transition: 'height 0.5s',
                  }} />
                )}
              </div>
              <span style={{ fontSize: 11, fontWeight: isToday ? 800 : 400, color: isToday ? 'var(--skema-primary)' : '#3f4b61' }}>{day}</span>
            </div>
          ))}
        </div>
      </div>

      {typeBreakdown.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#181c1e', marginBottom: 12 }}>유형별 수행 현황</p>
          <div className="space-y-3">
            {typeBreakdown.map(({ type, label, color, done, total }) => (
              <div key={type}>
                <div className="flex justify-between mb-1">
                  <span style={{ fontSize: 12, color: '#181c1e' }}>{label}</span>
                  <span style={{ fontSize: 12, color: '#3f4b61' }}>{done}/{total}</span>
                </div>
                <div style={{ height: 6, borderRadius: 99, background: '#f1f4f7' }}>
                  <div style={{ height: '100%', width: `${total > 0 ? (done / total) * 100 : 0}%`, background: color, borderRadius: 99, transition: 'width 0.5s' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
