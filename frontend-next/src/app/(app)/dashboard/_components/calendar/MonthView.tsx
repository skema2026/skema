
'use client';

import { getDisplayColor } from '@/lib/scheduleColor';
import { minutesToTime } from '@/lib/utils';
import type { ExamSchedule, Schedule } from '@/types';
import type { WeekAgendaDay } from './WeekView';
import MobileDayList from './MobileDayList';

type MonthViewProps = {
  days: WeekAgendaDay[];
  monthDate: Date;
  monthLabel: string;
  todayStr: string;
  wakeStartMinutes: number;
  /** 데스크톱 달력: 누르면 일간 보기로 (기존 동작) */
  onDayClick: (date: Date) => void;
  /** 모바일 전용: 월간 탭을 유지한 채 달력 아래에 그날 할 일을 펼친다 (11/21) */
  selectedDateStr: string | null;
  onSelectDate: (dateStr: string) => void;
  onScheduleClick: (schedule: Schedule) => void;
  onExamClick: (exam: ExamSchedule) => void;
  onToggleComplete: (schedule: Schedule) => void;
};

function MobileMonthAgenda({
  days,
  monthDate,
  todayStr,
  selectedDateStr,
  onSelectDate,
  onScheduleClick,
  onExamClick,
  onToggleComplete,
}: Pick<
  MonthViewProps,
  | 'days'
  | 'monthDate'
  | 'todayStr'
  | 'selectedDateStr'
  | 'onSelectDate'
  | 'onScheduleClick'
  | 'onExamClick'
  | 'onToggleComplete'
>) {
  const selectedDay = selectedDateStr
    ? days.find((day) => day.dateStr === selectedDateStr) ?? null
    : null;

  return (
    <div className="space-y-3 p-3">
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
            const isSelected = day.dateStr === selectedDay?.dateStr;

            return (
              <button
                key={`mobile-month-${day.dateStr}`}
                type="button"
                onClick={() => onSelectDate(day.dateStr)}
                aria-pressed={isSelected}
                aria-label={`${day.date.getMonth() + 1}월 ${day.date.getDate()}일${count ? `, 일정 ${count}개` : ''}`}
                className={`aspect-square min-w-0 rounded-[10px] border p-1.5 text-left transition-colors ${
                  isToday
                    ? `border-[#2a6fe3] bg-[#2a6fe3] text-white ${isSelected ? 'ring-2 ring-[#2a6fe3] ring-offset-2' : ''}`
                    : isSelected
                      ? 'border-[#2a6fe3] bg-[#eaf2ff] text-[#1f63d6] ring-1 ring-[#2a6fe3]'
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

      {selectedDay ? (
        <MobileDayList
          date={selectedDay.date}
          isToday={selectedDay.dateStr === todayStr}
          schedules={selectedDay.schedules}
          exams={selectedDay.exams}
          onScheduleClick={onScheduleClick}
          onExamClick={onExamClick}
          onToggleComplete={onToggleComplete}
        />
      ) : (
        <p className="px-1 text-center text-[12px] text-[#98a6ba]">날짜를 누르면 그날 할 일을 보여 줘요</p>
      )}
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
  selectedDateStr,
  onSelectDate,
  onScheduleClick,
  onExamClick,
  onToggleComplete,
}: MonthViewProps) {
  return (
    <>
      <div className="sm:hidden">
        <MobileMonthAgenda
          days={days}
          monthDate={monthDate}
          todayStr={todayStr}
          selectedDateStr={selectedDateStr}
          onSelectDate={onSelectDate}
          onScheduleClick={onScheduleClick}
          onExamClick={onExamClick}
          onToggleComplete={onToggleComplete}
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
