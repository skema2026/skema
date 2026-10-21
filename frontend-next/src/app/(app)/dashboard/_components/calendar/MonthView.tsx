
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
    <div className="bg-[#f8fbff] p-3">
      <div className="rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
        <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[11px] font-black text-slate-400">
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
                className={`aspect-square min-w-0 rounded-xl border p-1 text-left transition ${
                  isToday
                    ? 'border-blue-500 bg-blue-600 text-white shadow-sm'
                    : isCurrentMonth
                      ? count
                        ? 'border-blue-100 bg-blue-50/70 text-slate-800'
                        : 'border-slate-100 bg-white text-slate-500'
                      : 'border-transparent bg-slate-50/50 text-slate-300'
                }`}
              >
                <div className="flex h-full flex-col justify-between">
                  <span className="text-xs font-black leading-none">
                    {day.date.getDate()}
                  </span>

                  {count > 0 && (
                    <div className="flex items-center gap-0.5">
                      {day.exams.length > 0 && (
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            isToday ? 'bg-amber-200' : 'bg-amber-400'
                          }`}
                        />
                      )}

                      {day.schedules.slice(0, 3).map((schedule) => (
                        <span
                          key={`mobile-month-dot-${day.dateStr}-${schedule.id}`}
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            background: isToday
                              ? '#bfdbfe'
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

      <div className="hidden h-full overflow-y-auto bg-white p-4 sm:block">
        <div className="mb-3 flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50/70 px-4 py-3">
          <span className="text-sm font-black text-slate-950">
            {monthLabel}
          </span>

          <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-blue-700">
            {minutesToTime(wakeStartMinutes)} 기준
          </span>
        </div>

        <div className="mb-3 grid grid-cols-7 gap-2 text-center text-xs font-black text-slate-500">
          {['월', '화', '수', '목', '금', '토', '일'].map((day) => (
            <div key={day} className="rounded-md bg-blue-50 py-2">
              {day}
            </div>
          ))}
        </div>

        <div className="grid min-h-[540px] grid-cols-7 gap-2">
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
                className={`min-h-[112px] rounded-lg border p-2 text-left transition hover:border-blue-300 hover:bg-blue-50 ${
                  isToday
                    ? 'border-blue-500 bg-blue-50'
                    : isCurrentMonth
                      ? 'border-blue-100 bg-white'
                      : 'border-slate-100 bg-slate-50/70 opacity-60'
                }`}
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span
                    className={`text-xs font-black ${
                      isToday ? 'text-blue-700' : 'text-slate-600'
                    }`}
                  >
                    {date.getDate()}
                  </span>

                  {dayExams.length > 0 && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700">
                      시험
                    </span>
                  )}
                </div>

                {items.length > 0 && (
                  <div className="flex flex-wrap gap-0.5">
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
                  <span className="mt-0.5 block text-[10px] font-black text-slate-400">
                    +{items.length - 6}개
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
