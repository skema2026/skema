
'use client';

import { displayTitle } from "@/lib/utils";
import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { Timetable } from '@/components/timetable/Timetable';
import { getDisplayColor } from '@/lib/scheduleColor';
import MaterialIcon from '@/components/common/MaterialIcon';
import type { ExamSchedule, Schedule } from '@/types';

const SHORT_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  weekday: 'short',
});

const LONG_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  weekday: 'long',
});

export type WeekAgendaDay = {
  date: Date;
  dateStr: string;
  schedules: Schedule[];
  exams: ExamSchedule[];
};

type MobileWeekAgendaProps = {
  days: WeekAgendaDay[];
  todayStr: string;
  onScheduleClick: (schedule: Schedule) => void;
  onExamClick: (exam: ExamSchedule) => void;
  onShowDayView: (date: Date) => void;
  scrollToDateStr: string | null;
  onScrollConsumed: () => void;
};

function MobileWeekAgenda({
  days,
  todayStr,
  onScheduleClick,
  onExamClick,
  onShowDayView,
  scrollToDateStr,
  onScrollConsumed,
}: MobileWeekAgendaProps) {
  const activeDays = days.filter(
    (day) => day.schedules.length > 0 || day.exams.length > 0
  );

  const containerRef = useRef<HTMLDivElement | null>(null);

  const scrollToDateInternal = useCallback((dateStr: string) => {
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-agenda-date="${dateStr}"]`
    );

    if (el) {
      el.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }
  }, []);

  useEffect(() => {
    if (!scrollToDateStr) return;

    const t = setTimeout(() => {
      scrollToDateInternal(scrollToDateStr);
      onScrollConsumed();
    }, 100);

    return () => clearTimeout(t);
  }, [scrollToDateStr, scrollToDateInternal, onScrollConsumed]);

  return (
    <div ref={containerRef} className="space-y-3 bg-[#f5f8fd] p-3">
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((day) => {
          const isToday = day.dateStr === todayStr;
          const count = day.schedules.length + day.exams.length;

          return (
            <button
              key={day.dateStr}
              type="button"
              onClick={() => onShowDayView(day.date)}
              className={`min-w-0 rounded-lg border px-1 py-2 text-center transition-colors ${
                isToday
                  ? 'border-[#0f1e3a] bg-[#0f1e3a] text-white'
                  : count
                    ? 'border-black/10 bg-white text-[#0f1e3a]'
                    : 'border-black/[0.06] bg-transparent text-[#98a6ba]'
              }`}
            >
              <p className="text-[11px] font-semibold leading-none">
                {SHORT_WEEKDAY_FORMATTER.format(day.date)}
              </p>

              <p className="mt-1 font-mono text-sm font-medium leading-none tabular-nums">
                {day.date.getDate()}
              </p>

              <p
                className={`mt-1 text-[11px] leading-none ${
                  isToday
                    ? 'text-white/70'
                    : count
                      ? 'text-[#5f6f88]'
                      : 'text-[#cfdbec]'
                }`}
              >
                {count ? `${count}개` : '-'}
              </p>
            </button>
          );
        })}
      </div>

      {activeDays.length === 0 ? (
        <div className="rounded-xl border border-black/[0.08] bg-white px-4 py-8 text-center">
          <p className="text-sm font-semibold text-slate-700">
            이번 주 일정이 없어요
          </p>
          <p className="mt-1 text-xs font-medium text-slate-400">
            상단 + 버튼으로 일정을 추가할 수 있어요
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {activeDays.map((day) => {
            const isToday = day.dateStr === todayStr;

            return (
              <section
                key={`agenda-${day.dateStr}`}
                data-agenda-date={day.dateStr}
                className={`scroll-mt-3 rounded-xl border bg-white p-3 ${
                  isToday ? 'border-black/20' : 'border-black/[0.08]'
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[12px] text-[#5f6f88]">
                      {isToday
                        ? '오늘'
                        : LONG_WEEKDAY_FORMATTER.format(day.date)}
                    </p>

                    <h3 className="mt-0.5 text-base font-medium text-[#0f1e3a]">
                      {day.date.getMonth() + 1}월 {day.date.getDate()}일
                    </h3>
                  </div>

                  <button
                    type="button"
                    onClick={() => onShowDayView(day.date)}
                    className="h-7 rounded-md px-2 text-[13px] text-[#44536b] transition-colors hover:bg-[#edf3fc] hover:text-[#0f1e3a]"
                  >
                    자세히
                  </button>
                </div>

                <div className="space-y-1.5">
                  {day.exams.map((exam) => (
                    <button
                      key={`mobile-exam-${exam.id}`}
                      type="button"
                      onClick={() => onExamClick(exam)}
                      className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left transition hover:border-amber-300 hover:bg-amber-100"
                    >
                      <div className="flex items-center gap-2">
                        <MaterialIcon
                          icon="school"
                          size={16}
                          color="#d97706"
                        />

                        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-amber-900">
                          {exam.title}
                        </p>

                        <span className="text-xs font-semibold text-amber-700">
                          {exam.exam_time || '종일'}
                        </span>
                      </div>
                    </button>
                  ))}

                  {day.schedules.map((schedule) => (
                    <button
                      key={`mobile-week-${day.dateStr}-${schedule.id}`}
                      type="button"
                      onClick={() => onScheduleClick(schedule)}
                      className={`w-full rounded-lg border py-2 pl-0 pr-3 text-left transition-colors hover:bg-[#f5f8fd] ${
                        schedule.is_completed
                          ? 'border-black/[0.06] bg-white opacity-60'
                          : 'border-black/[0.08] bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-[4px] shrink-0 self-stretch rounded-full"
                          style={{
                            background: schedule.is_completed
                              ? '#cbd5e1'
                              : getDisplayColor(schedule),
                          }}
                        />

                        <div className="w-[56px] shrink-0 font-mono text-[13px] tabular-nums text-[#0f1e3a]">
                          {schedule.start_time}

                          <span className="block text-[12px] text-[#98a6ba]">
                            {schedule.end_time}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate text-sm font-medium ${
                              schedule.is_completed
                                ? 'text-slate-400 line-through'
                                : 'text-slate-950'
                            }`}
                          >
                            {displayTitle(schedule.title)}
                          </p>

                          <p className="mt-0.5 truncate text-[12px] text-[#5f6f88]">
                            {schedule.location ||
                              (schedule.schedule_type === 'study'
                                ? '공부 일정'
                                : '일정')}
                          </p>
                        </div>

                        <MaterialIcon
                          icon={
                            schedule.is_completed
                              ? 'check_circle'
                              : 'chevron_right'
                          }
                          size={16}
                          color={
                            schedule.is_completed ? '#98a6ba' : '#98a6ba'
                          }
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface WeekViewProps {
  timetableRef: RefObject<HTMLDivElement | null>;
  days: WeekAgendaDay[];
  todayStr: string;
  weekStart: Date;
  schedules: Schedule[];
  exams: ExamSchedule[];
  scrollToDateStr: string | null;
  onScheduleClick: (schedule: Schedule) => void;
  onExamClick: (exam: ExamSchedule) => void;
  onShowDayView: (date: Date) => void;
  onScrollConsumed: () => void;
}

export default function WeekView({
  timetableRef,
  days,
  todayStr,
  weekStart,
  schedules,
  exams,
  scrollToDateStr,
  onScheduleClick,
  onExamClick,
  onShowDayView,
  onScrollConsumed,
}: WeekViewProps) {
  return (
    <>
      <div className="sm:hidden">
        <MobileWeekAgenda
          days={days}
          todayStr={todayStr}
          onScheduleClick={onScheduleClick}
          onExamClick={onExamClick}
          onShowDayView={onShowDayView}
          scrollToDateStr={scrollToDateStr}
          onScrollConsumed={onScrollConsumed}
        />
      </div>

      <div
        ref={timetableRef}
        className="hidden max-h-[calc(100vh-220px)] overflow-y-auto sm:block"
      >
        <Timetable
          schedules={schedules}
          exams={exams}
          weekStart={weekStart}
          startTime="00:00"
          onDayClick={onShowDayView}
        />
      </div>
    </>
  );
}
