'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { recurringDayToIndex } from '@/lib/recurringDay';
import { timeToMinutes } from '@/lib/utils';
import MaterialIcon from '@/components/common/MaterialIcon';
import type { Schedule } from '@/types';

const TYPE_META = [
  { type: 'class',      label: '수업',     color: '#4F46E5', icon: '📚' },
  { type: 'study',      label: '자율학습',  color: '#059669', icon: '✏️' },
  { type: 'assignment', label: '과제',     color: '#F97316', icon: '📋' },
  { type: 'activity',   label: '활동',     color: '#A855F7', icon: '🎯' },
  { type: 'personal',   label: '개인',     color: '#E11D48', icon: '👤' },
];

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

function getWeekMonday(offsetWeeks: number): Date {
  const now = new Date();
  const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - todayDow + offsetWeeks * 7);
  return monday;
}

function dateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatWeekRange(monday: Date) {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${monday.getFullYear()}년 ${fmt(monday)} – ${fmt(sunday)}`;
}

function computeWeekStats(schedules: Schedule[], monday: Date) {
  const todayStr = dateStr(new Date());

  const days = DAY_LABELS.map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dStr = dateStr(d);
    const isPast = dStr <= todayStr;
    const isToday = dStr === todayStr;

    const daySch = schedules.filter((s) => {
      if (!s.date) return recurringDayToIndex(s.recurring_day) === i;
      return s.date === dStr;
    });
    const done = daySch.filter((s) => s.is_completed).length;
    const total = daySch.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : null;
    const mins = daySch.reduce((sum, s) => sum + Math.max(0, timeToMinutes(s.end_time) - timeToMinutes(s.start_time)), 0);
    return { label, dStr, isPast, isToday, done, total, pct, mins };
  });

  const allDone = days.reduce((s, d) => s + d.done, 0);
  const allTotal = days.reduce((s, d) => s + d.total, 0);
  const allMins = days.reduce((s, d) => s + d.mins, 0);
  const overallPct = allTotal > 0 ? Math.round((allDone / allTotal) * 100) : null;

  const typeStats = TYPE_META.map(({ type, label, color, icon }) => {
    const typeSch = schedules.filter((s) => {
      if (s.schedule_type !== type) return false;
      const dayIdx = s.date
        ? (() => { const [y, m, dd] = s.date.split('-').map(Number); const dow = new Date(y, m - 1, dd).getDay(); return dow === 0 ? 6 : dow - 1; })()
        : recurringDayToIndex(s.recurring_day);
      const d = new Date(monday);
      d.setDate(monday.getDate() + dayIdx);
      if (s.date) return s.date >= dateStr(monday) && s.date <= dateStr(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6));
      return true;
    });
    const done = typeSch.filter((s) => s.is_completed).length;
    const total = typeSch.length;
    const mins = typeSch.reduce((sum, s) => sum + Math.max(0, timeToMinutes(s.end_time) - timeToMinutes(s.start_time)), 0);
    return { type, label, color, icon, done, total, mins };
  }).filter((t) => t.total > 0);

  return { days, allDone, allTotal, allMins, overallPct, typeStats };
}

export default function ReportPage() {
  const router = useRouter();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => {
    api.get('/schedules')
      .then(({ data }) => setSchedules(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const monday = getWeekMonday(weekOffset);
  const { days, allDone, allTotal, allMins, overallPct, typeStats } = computeWeekStats(schedules, monday);
  const isCurrentWeek = weekOffset === 0;
  const maxDayMins = Math.max(...days.map((d) => d.mins), 1);

  const overallColor =
    overallPct === null ? '#94a3b8'
    : overallPct >= 80 ? '#059669'
    : overallPct >= 50 ? '#d97706'
    : '#dc2626';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#f8fbff' }}>
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
            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #4F46E5, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcon icon="bar_chart" size={15} color="#fff" filled />
            </div>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#181c1e' }}>주간 수행률 리포트</span>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, maxWidth: 720, width: '100%', margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 주간 네비게이션 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', borderRadius: 16, padding: '12px 16px', border: '1px solid #ebeef1' }}>
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: '1px solid #e2e8f0', borderRadius: 10, padding: '6px 12px', fontSize: 13, fontWeight: 600, color: '#3f4b61', cursor: 'pointer' }}
          >
            <MaterialIcon icon="chevron_left" size={16} color="#3f4b61" />
            이전 주
          </button>

          <div style={{ textAlign: 'center' }}>
            {isCurrentWeek && (
              <div style={{ fontSize: 10, fontWeight: 700, color: '#4F46E5', letterSpacing: 1, marginBottom: 2 }}>이번 주</div>
            )}
            <div style={{ fontSize: 13, fontWeight: 700, color: '#181c1e' }}>{formatWeekRange(monday)}</div>
          </div>

          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            disabled={weekOffset >= 0}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: '1px solid #e2e8f0', borderRadius: 10, padding: '6px 12px', fontSize: 13, fontWeight: 600, color: weekOffset >= 0 ? '#d1d5db' : '#3f4b61', cursor: weekOffset >= 0 ? 'not-allowed' : 'pointer' }}
          >
            다음 주
            <MaterialIcon icon="chevron_right" size={16} color={weekOffset >= 0 ? '#d1d5db' : '#3f4b61'} />
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', border: '3px solid #e2e8f0', borderTopColor: '#4F46E5', animation: 'spin 0.8s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : (
          <>
            {/* 전체 요약 */}
            <div style={{ background: '#fff', borderRadius: 16, padding: '20px 20px', border: '1px solid #ebeef1', display: 'flex', alignItems: 'center', gap: 20 }}>
              <div style={{ flexShrink: 0, width: 80, height: 80, borderRadius: '50%', border: `5px solid ${overallColor}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: `${overallColor}10` }}>
                <span style={{ fontSize: 22, fontWeight: 900, color: overallColor, lineHeight: 1 }}>
                  {overallPct !== null ? `${overallPct}%` : '-'}
                </span>
                <span style={{ fontSize: 10, color: overallColor, fontWeight: 600, marginTop: 2 }}>완료율</span>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 15, fontWeight: 800, color: '#181c1e', marginBottom: 4 }}>
                  {allTotal > 0 ? `${allDone}개 완료 / ${allTotal}개 전체` : '이번 주 일정 없음'}
                </p>
                <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
                  {allMins > 0 ? `총 ${Math.floor(allMins / 60)}시간 ${allMins % 60 > 0 ? `${allMins % 60}분` : ''} 계획` : ''}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[
                    { label: '완료', value: allDone, color: '#059669', bg: '#d1fae5' },
                    { label: '미완료', value: allTotal - allDone, color: '#dc2626', bg: '#fee2e2' },
                    { label: '총 계획 시간', value: `${Math.floor(allMins / 60)}h ${allMins % 60}m`, color: '#4F46E5', bg: '#ede9fe' },
                  ].map(({ label, value, color, bg }) => (
                    <div key={label} style={{ padding: '4px 10px', borderRadius: 20, background: bg, display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color }}>{value}</span>
                      <span style={{ fontSize: 11, color, opacity: 0.8 }}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 요일별 수행률 */}
            <div style={{ background: '#fff', borderRadius: 16, padding: '20px', border: '1px solid #ebeef1' }}>
              <p style={{ fontSize: 14, fontWeight: 800, color: '#181c1e', marginBottom: 16 }}>요일별 수행률</p>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120 }}>
                {days.map(({ label, pct, isToday, done, total, mins }) => {
                  const barH = pct !== null ? Math.max(pct * 0.9, 4) : 0;
                  const barColor = isToday ? '#4F46E5' : '#c3d0ff';
                  return (
                    <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 10, color: pct !== null ? '#3f4b61' : '#cbd5e1', fontWeight: 600 }}>
                        {pct !== null ? `${pct}%` : total > 0 ? `0%` : '-'}
                      </span>
                      <div
                        title={total > 0 ? `${done}/${total}개 · ${Math.floor(mins / 60)}h${mins % 60}m` : '일정 없음'}
                        style={{ width: '100%', height: 90, background: '#f1f4f7', borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'flex-end', cursor: total > 0 ? 'default' : 'default' }}
                      >
                        {pct !== null && (
                          <div style={{ width: '100%', height: `${barH}%`, background: barColor, borderRadius: 8, transition: 'height 0.5s' }} />
                        )}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: isToday ? 800 : 500, color: isToday ? '#4F46E5' : '#3f4b61' }}>{label}</span>
                      {total > 0 && (
                        <span style={{ fontSize: 9, color: '#94a3b8' }}>{done}/{total}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 유형별 분석 */}
            {typeStats.length > 0 ? (
              <div style={{ background: '#fff', borderRadius: 16, padding: '20px', border: '1px solid #ebeef1' }}>
                <p style={{ fontSize: 14, fontWeight: 800, color: '#181c1e', marginBottom: 16 }}>유형별 분석</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {typeStats.map(({ type, label, color, icon, done, total, mins }) => {
                    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                    const hrs = Math.floor(mins / 60);
                    const rem = mins % 60;
                    const timeStr = hrs > 0 ? `${hrs}시간${rem > 0 ? ` ${rem}분` : ''}` : `${rem}분`;
                    return (
                      <div key={type}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ fontSize: 16 }}>{icon}</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#181c1e' }}>{label}</span>
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>· {total}개 · {timeStr}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 800, color }}>{pct}%</span>
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>{done}/{total}</span>
                          </div>
                        </div>
                        <div style={{ height: 10, borderRadius: 99, background: '#f1f4f7', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.6s' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : allTotal === 0 ? (
              <div style={{ background: '#fff', borderRadius: 16, padding: '40px 20px', border: '1px solid #ebeef1', textAlign: 'center' }}>
                <MaterialIcon icon="event_busy" size={36} color="#d1d5db" />
                <p style={{ fontSize: 14, color: '#94a3b8', marginTop: 12, fontWeight: 600 }}>이 주의 일정이 없습니다</p>
                <p style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>대시보드에서 일정을 추가해보세요</p>
              </div>
            ) : null}

            {/* 패턴 인사이트 */}
            {allTotal > 0 && (
              <div style={{ background: 'linear-gradient(135deg, #ede9fe, #dbeafe)', borderRadius: 16, padding: '16px 20px', border: '1px solid #c4b5fd' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <MaterialIcon icon="lightbulb" size={16} color="#7c3aed" filled />
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#4c1d95' }}>학습 패턴 인사이트</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(() => {
                    const insights: string[] = [];
                    const bestDay = days.filter((d) => d.pct !== null).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0];
                    if (bestDay && (bestDay.pct ?? 0) >= 80) insights.push(`${bestDay.label}요일 수행률이 ${bestDay.pct}%로 가장 높아요 🎉`);
                    if (overallPct !== null && overallPct >= 80) insights.push('이번 주 전체 수행률이 80% 이상입니다. 훌륭해요! 🏆');
                    else if (overallPct !== null && overallPct < 40 && allTotal > 0) insights.push('미완료 일정이 많아요. AI 채팅으로 일정을 재배치해볼까요?');
                    const zeroDays = days.filter((d) => d.total > 0 && d.done === 0);
                    if (zeroDays.length > 0) insights.push(`${zeroDays.map((d) => d.label).join('·')}요일 일정을 하나도 완료하지 못했어요.`);
                    if (insights.length === 0) insights.push('일정을 완료 표시하면 여기에 인사이트가 나타납니다.');
                    return insights.map((text, i) => (
                      <p key={i} style={{ fontSize: 12, color: '#4c1d95', lineHeight: 1.6 }}>· {text}</p>
                    ));
                  })()}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
