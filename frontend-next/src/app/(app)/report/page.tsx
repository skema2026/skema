'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { recurringDayToIndex } from '@/lib/recurringDay';
import { timeToMinutes } from '@/lib/utils';
import MaterialIcon from '@/components/common/MaterialIcon';
import type { Schedule } from '@/types';

// 색은 대시보드 블록 색과 같게 (수업 = 로고 하늘색, 공부 = 인디고)
const TYPE_META = [
  { type: 'class',      label: '수업',     color: '#4591fd' },
  { type: 'study',      label: '공부',     color: '#4f46e5' },
  { type: 'assignment', label: '과제',     color: '#d97706' },
  { type: 'activity',   label: '활동',     color: '#ec4899' },
  { type: 'personal',   label: '개인',     color: '#ec4899' },
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

  const typeStats = TYPE_META.map(({ type, label, color }) => {
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
    return { type, label, color, done, total, mins };
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

  const fmtMins = (m: number) => {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h > 0 ? `${h}시간${r > 0 ? ` ${r}분` : ''}` : `${r}분`;
  };

  const insights: string[] = [];
  const bestDay = days.filter((d) => d.pct !== null).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0];
  if (bestDay && (bestDay.pct ?? 0) >= 80) insights.push(`${bestDay.label}요일 수행률이 ${bestDay.pct}%로 가장 높아요`);
  if (overallPct !== null && overallPct >= 80) insights.push('이번 주 전체 수행률이 80%를 넘었어요');
  else if (overallPct !== null && overallPct < 40 && allTotal > 0) insights.push('못 한 블록이 많아요. 하루 보기의 다시 짜기로 빈 시간에 옮길 수 있어요');
  const zeroDays = days.filter((d) => d.total > 0 && d.done === 0);
  if (zeroDays.length > 0) insights.push(`${zeroDays.map((d) => d.label).join('·')}요일은 완료한 일정이 없어요`);
  if (insights.length === 0) insights.push('일정을 완료로 표시하면 여기에 한 주 흐름이 정리돼요');

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f8fd] text-[#0f1e3a]">
      <header className="sticky top-0 z-30 border-b border-[#0f1e3a]/8 bg-white">
        <div className="mx-auto flex h-14 max-w-[720px] items-center gap-3 px-4">
          <button
            onClick={() => router.push('/dashboard')}
            aria-label="대시보드로"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#44536b] transition-colors hover:bg-[#edf3fc]"
          >
            <MaterialIcon icon="arrow_back" size={18} color="currentColor" />
          </button>
          <h1 className="text-[16px] font-semibold">주간 리포트</h1>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-4 px-4 py-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] text-[#5f6f88]">{isCurrentWeek ? '이번 주' : `${-weekOffset}주 전`}</p>
            <p className="mt-0.5 text-[15px] font-medium">{formatWeekRange(monday)}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setWeekOffset((w) => w - 1)}
              aria-label="이전 주"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#0f1e3a]/10 bg-white text-[#44536b] transition-colors hover:bg-[#edf3fc]"
            >
              <MaterialIcon icon="chevron_left" size={18} color="currentColor" />
            </button>
            <button
              onClick={() => setWeekOffset((w) => w + 1)}
              disabled={weekOffset >= 0}
              aria-label="다음 주"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#0f1e3a]/10 bg-white text-[#44536b] transition-colors hover:bg-[#edf3fc] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <MaterialIcon icon="chevron_right" size={18} color="currentColor" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center pt-16">
            <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-[#e1eaf6] border-t-[#2a6fe3]" />
          </div>
        ) : (
          <>
            {/* 요약: 숫자 세 개 */}
            <section className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-[#0f1e3a]/8 bg-[#0f1e3a]/8">
              <div className="bg-white p-5">
                <p className="text-[13px] text-[#5f6f88]">완료율</p>
                <p className="mt-2 font-mono text-[28px] font-medium tabular-nums text-[#1f63d6]">
                  {overallPct !== null ? `${overallPct}%` : '–'}
                </p>
              </div>
              <div className="bg-white p-5">
                <p className="text-[13px] text-[#5f6f88]">완료</p>
                <p className="mt-2 font-mono text-[28px] font-medium tabular-nums">
                  {allDone}<span className="text-[15px] text-[#5f6f88]"> / {allTotal}</span>
                </p>
              </div>
              <div className="bg-white p-5">
                <p className="text-[13px] text-[#5f6f88]">계획한 시간</p>
                <p className="mt-2 text-[20px] font-medium tabular-nums leading-[34px]">{allMins > 0 ? fmtMins(allMins) : '–'}</p>
              </div>
            </section>

            {/* 요일별 수행률: 오늘만 파랑 */}
            <section className="rounded-2xl border border-[#0f1e3a]/8 bg-white p-5">
              <p className="text-[15px] font-medium">요일별 수행률</p>
              <div className="mt-5 flex h-[148px] items-end gap-2">
                {days.map(({ label, pct, isToday, done, total, mins }) => {
                  const barH = pct !== null ? Math.max(pct, 3) : 0;
                  return (
                    <div key={label} className="flex flex-1 flex-col items-center gap-1.5">
                      <span className={`font-mono text-[11px] tabular-nums ${pct !== null ? 'text-[#44536b]' : 'text-[#98a6ba]'}`}>
                        {pct !== null ? `${pct}%` : '–'}
                      </span>
                      <div
                        title={total > 0 ? `${done}/${total}개 · ${fmtMins(mins)}` : '일정 없음'}
                        className="flex h-[88px] w-full items-end overflow-hidden rounded-md bg-[#f5f8fd]"
                      >
                        {pct !== null && (
                          <div
                            className="w-full rounded-md"
                            style={{ height: `${barH}%`, background: isToday ? '#2a6fe3' : '#bcd8fe' }}
                          />
                        )}
                      </div>
                      <span className={`text-[12px] ${isToday ? 'font-medium text-[#1f63d6]' : 'text-[#44536b]'}`}>{label}</span>
                      <span className="font-mono text-[11px] tabular-nums text-[#98a6ba]">{total > 0 ? `${done}/${total}` : ' '}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 유형별 */}
            {typeStats.length > 0 ? (
              <section className="rounded-2xl border border-[#0f1e3a]/8 bg-white p-5">
                <p className="text-[15px] font-medium">유형별</p>
                <ul className="mt-4 space-y-4">
                  {typeStats.map(({ type, label, color, done, total, mins }) => {
                    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                    return (
                      <li key={type}>
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                            <span className="text-[14px]">{label}</span>
                            <span className="truncate text-[12px] text-[#5f6f88]">{total}개 · {fmtMins(mins)}</span>
                          </div>
                          <span className="shrink-0 font-mono text-[13px] tabular-nums text-[#44536b]">
                            {pct}% <span className="text-[#98a6ba]">{done}/{total}</span>
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#edf3fc]">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : allTotal === 0 ? (
              <section className="rounded-2xl border border-[#0f1e3a]/8 bg-white px-5 py-10 text-center">
                <MaterialIcon icon="event_busy" size={24} color="#98a6ba" />
                <p className="mt-3 text-[15px] font-medium">이 주에는 일정이 없어요</p>
                <p className="mt-1 text-[13px] text-[#5f6f88]">시간표 화면에서 일정을 추가할 수 있어요</p>
              </section>
            ) : null}

            {allTotal > 0 && (
              <section className="rounded-2xl border border-[#0f1e3a]/8 bg-white p-5">
                <p className="text-[15px] font-medium">이번 주 돌아보기</p>
                <ul className="mt-3 space-y-2">
                  {insights.map((text) => (
                    <li key={text} className="flex gap-2 text-[14px] leading-[22px] text-[#44536b]">
                      <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[#2a6fe3]" />
                      {text}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
