'use client';

import { useState } from 'react';
import MaterialIcon from '@/components/common/MaterialIcon';
import type { Schedule } from '@/types';

const DOW_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

interface MiniCalendarProps {
  schedules: Schedule[];
}

export function MiniCalendar({ schedules }: MiniCalendarProps) {
  const todayFull = new Date();
  const [year, setYear] = useState(todayFull.getFullYear());
  const [month, setMonth] = useState(todayFull.getMonth());

  const todayStr = `${todayFull.getFullYear()}-${String(todayFull.getMonth() + 1).padStart(2, '0')}-${String(todayFull.getDate()).padStart(2, '0')}`;
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  const startOffset = firstDow === 0 ? 6 : firstDow - 1;

  const scheduledDays = new Set(
    schedules
      .filter((s) => s.date?.startsWith(monthPrefix))
      .map((s) => Number(s.date!.slice(-2)))
  );

  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  };

  const cells: (number | null)[] = [
    ...Array<null>(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="select-none">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-black text-slate-800">{year}년 {month + 1}월</span>
        <div className="flex">
          <button onClick={prevMonth} className="rounded p-0.5 transition hover:bg-blue-50" aria-label="이전 달">
            <MaterialIcon icon="chevron_left" size={14} color="#64748b" />
          </button>
          <button onClick={nextMonth} className="rounded p-0.5 transition hover:bg-blue-50" aria-label="다음 달">
            <MaterialIcon icon="chevron_right" size={14} color="#64748b" />
          </button>
        </div>
      </div>

      <div className="mb-1.5 grid grid-cols-7">
        {DOW_LABELS.map((d, i) => (
          <span
            key={d}
            className={`text-center text-[10px] font-bold ${i === 5 ? 'text-blue-400' : i === 6 ? 'text-red-400' : 'text-slate-400'}`}
          >
            {d}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((day, i) => {
          if (day === null) return <span key={i} />;
          const dateStr = `${monthPrefix}-${String(day).padStart(2, '0')}`;
          const isToday = dateStr === todayStr;
          const hasSched = scheduledDays.has(day);
          const col = i % 7;
          const isSat = col === 5;
          const isSun = col === 6;

          return (
            <div key={i} className="flex flex-col items-center">
              <span
                className={`flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-bold transition
                  ${isToday
                    ? 'bg-blue-600 text-white'
                    : isSat
                    ? 'text-blue-500 hover:bg-blue-50'
                    : isSun
                    ? 'text-red-400 hover:bg-red-50'
                    : 'text-slate-700 hover:bg-blue-50'}`}
              >
                {day}
              </span>
              {hasSched && (
                <span className={`mt-0.5 h-1 w-1 rounded-full ${isToday ? 'bg-white/70' : 'bg-blue-400'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
