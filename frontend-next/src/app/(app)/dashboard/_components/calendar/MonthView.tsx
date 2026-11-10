
'use client';

import { getDisplayColor } from '@/lib/scheduleColor';
import { minutesToTime } from '@/lib/utils';
import type { WeekAgendaDay } from './WeekView';

type MonthViewProps = {
  days: WeekAgendaDay[];
  monthDate: Date;
  monthLabel: string;
  todayStr: string;
  wakeStartMinutes: number;
  onDayClick: (date: Date) => void;
};

function MobileMonthAgenda({
  days,
  monthDate,
  todayStr,
  onDayClick,
}: Pick<
  MonthViewProps,
  'days' | 'monthDate' | 'todayStr' | 'onDayClick'
>) {
  return (
    <div className="p-3">
      <div className="rounded-2xl border border-[#0f1e3a]/8 bg-white p-3">
        <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[12px] text-[#5f6f88]">
          {['월', '화', '수', '목', '금', '토', '일'].map((day) => (
            <div key={day} className="py-1">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {days.map((day) => {
            const isToday = day.dateStr === todayStr;
            const isCurrentMonth =
              day.date.getMonth() === monthDate.getMonth();
            const count = day.schedules.length + day.exams.length;

            return (
              <button
                key={`mobile-month-${day.dateStr}`}
                type="button"
                onClick={() => onDayClick(day.date)}
                className={`aspect-square min-w-0 rounded-[10px] border p-1.5 text-left transition-colors ${
                  isToday
                    ? 'border-[#2a6fe3] bg-[#2a6fe3] text-white'
                    : isCurrentMonth
                      ? count
                        ? 'border-[#0f1e3a]/8 bg-white text-[#0f1e3a]'
                        : 'border-[#0f1e3a]/8 bg-white text-[#5f6f88]'
                      : 'border-transparent bg-transparent text-[#98a6ba]'
                }`}
              >
                <div className="flex h-full flex-col justify-between">
                  <span className="font-mono text-[13px] leading-none tabular-nums">
                    {day.date.getDate()}
                  </span>

                  {count > 0 && (
                    <div className="flex items-center gap-0.5">
                      {day.exams.length > 0 && (
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isToday ? 'bg-white' : 'bg-[#dc2626]'
                          }`}
                        />
                      )}

                      {day.schedules.slice(0, 3).map((schedule) => (
                        <span
                          key={`mobile-month-dot-${day.dateStr}-${schedule.id}`}
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            background: isToday
                              ? 'rgba(255,255,255,0.7)'
                              : getDisplayColor(schedule),
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function MonthView({
  days,
  monthDate,
  monthLabel,
  todayStr,
  wakeStartMinutes,
  onDayClick,
}: MonthViewProps) {
  return (
    <>
      <div className="sm:hidden">
        <MobileMonthAgenda
          days={days}
          monthDate={monthDate}
          todayStr={todayStr}
          onDayClick={onDayClick}
        />
      </div>

      <div className="hidden h-full overflow-y-auto bg-white p-5 sm:block">
        <div className="mb-4 flex items-baseline justify-between">
          <span className="text-[15px] font-medium text-[#0f1e3a]">{monthLabel}</span>
          <span className="font-mono text-[12px] tabular-nums text-[#5f6f88]">
            하루 시작 {minutesToTime(wakeStartMinutes)}
          </span>
        </div>

        <div className="grid grid-cols-7 pb-2 text-center text-[13px] text-[#5f6f88]">
          {['월', '화', '수', '목', '금', '토', '일'].map((day) => (
            <div key={day}>{day}</div>
          ))}
        </div>

        <div className="grid min-h-[540px] grid-cols-7 gap-px overflow-hidden rounded-xl border border-[#0f1e3a]/8 bg-[#0f1e3a]/8">
          {days.map((day) => {
            const date = day.date;
            const dateStr = day.dateStr;
            const items = day.schedules;
            const dayExams = day.exams;
            const isToday = dateStr === todayStr;
            const isCurrentMonth =
              date.getMonth() === monthDate.getMonth();

            return (
              <button
                key={dateStr}
                onClick={() => onDayClick(date)}
                className={`min-h-[108px] p-2 text-left transition-colors hover:bg-[#f5f8fd] ${
                  isCurrentMonth ? 'bg-white' : 'bg-[#f5f8fd]'
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span
                    className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 font-mono text-[13px] tabular-nums ${
                      isToday
                        ? 'bg-[#2a6fe3] font-medium text-white'
                        : isCurrentMonth
                          ? 'text-[#0f1e3a]'
                          : 'text-[#98a6ba]'
                    }`}
                  >
                    {date.getDate()}
                  </span>

                  {dayExams.length > 0 && (
                    <span className="flex items-center gap-1 text-[12px] text-[#dc2626]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#dc2626]" />
                      시험
                    </span>
                  )}
                </div>

                {items.length > 0 && (
                  <div className={`flex flex-wrap gap-1 ${isCurrentMonth ? '' : 'opacity-50'}`}>
                    {items.slice(0, 6).map((schedule) => (
                      <span
                        key={`dot-${dateStr}-${schedule.id}`}
                        className="h-2 w-2 rounded-full"
                        style={{
                          background: getDisplayColor(schedule),
                        }}
                      />
                    ))}
                  </div>
                )}

                {items.length > 6 && (
                  <span className="mt-1 block font-mono text-[11px] tabular-nums text-[#5f6f88]">
                    +{items.length - 6}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
