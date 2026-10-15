
'use client';

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
  onScrollToDate: (date: Date) => void;
  onShowDayView: (date: Date) => void;
  scrollToDateStr: string | null;
  onScrollConsumed: () => void;
};

function MobileWeekAgenda({
  days,
  todayStr,
  onScheduleClick,
  onExamClick,
  onScrollToDate,
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
    <div ref={containerRef} className="space-y-3 bg-[#f8fbff] p-3">
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((day) => {
          const isToday = day.dateStr === todayStr;
          const count = day.schedules.length + day.exams.length;

          return (
            <button
              key={day.dateStr}
              type="button"
              onClick={() => onScrollToDate(day.date)}
              className={`min-w-0 rounded-xl border px-1 py-2 text-center transition ${
                isToday
                  ? 'border-blue-500 bg-blue-600 text-white shadow-sm'
                  : count
                    ? 'border-blue-100 bg-white text-slate-800'
                    : 'border-slate-100 bg-white/70 text-slate-400'
              }`}
            >
              <p className="text-[11px] font-black leading-none">
                {SHORT_WEEKDAY_FORMATTER.format(day.date)}
              </p>

              <p className="mt-1 text-sm font-black leading-none">
                {day.date.getDate()}
              </p>

              <p
                className={`mt-1 text-[10px] font-black leading-none ${
                  isToday
                    ? 'text-blue-100'
                    : count
                      ? 'text-blue-600'
                      : 'text-slate-300'
                }`}
              >
                {count ? `${count}개` : '-'}
              </p>
            </button>
          );
        })}
      </div>

      {activeDays.length === 0 ? (
        <div className="rounded-2xl border border-blue-100 bg-white px-4 py-8 text-center">
          <p className="text-sm font-black text-slate-700">
            이번 주 일정이 없습니다
          </p>
          <p className="mt-1 text-xs font-bold text-slate-400">
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
                className={`scroll-mt-3 rounded-2xl border bg-white p-3 shadow-sm ${
                  isToday ? 'border-blue-300' : 'border-blue-100'
                }`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-black text-blue-600">
                      {isToday
                        ? '오늘'
                        : LONG_WEEKDAY_FORMATTER.format(day.date)}
                    </p>

                    <h3 className="mt-0.5 text-base font-black text-slate-950">
                      {day.date.getMonth() + 1}월 {day.date.getDate()}일
                    </h3>
                  </div>

                  <button
                    type="button"
                    onClick={() => onShowDayView(day.date)}
                    className="rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-black text-white transition hover:bg-blue-700"
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

                        <p className="min-w-0 flex-1 truncate text-sm font-black text-amber-900">
                          {exam.title}
                        </p>

                        <span className="text-xs font-black text-amber-700">
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
                      className={`w-full rounded-xl border py-2 pl-0 pr-3 text-left transition hover:border-blue-300 hover:bg-blue-50 ${
                        schedule.is_completed
                          ? 'border-slate-100 bg-slate-50 opacity-70'
                          : 'border-blue-100 bg-[#fbfdff]'
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

                        <div className="w-[64px] shrink-0 text-xs font-black text-blue-700">
                          {schedule.start_time}

                          <span className="block text-[11px] font-bold text-slate-400">
                            {schedule.end_time}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate text-sm font-black ${
                              schedule.is_completed
                                ? 'text-slate-400 line-through'
                                : 'text-slate-950'
                            }`}
                          >
                            {schedule.title}
                          </p>

                          <p className="mt-0.5 truncate text-[11px] font-bold text-slate-400">
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
                            schedule.is_completed ? '#94a3b8' : '#2563eb'
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
  onScrollToDate: (date: Date) => void;
  onShowDayView: (date: Date) => void;
  onScrollConsumed: () => void;
}

export default function WeekView(props: WeekViewProps) {
  return (
    <>
      <div className="sm:hidden">
        <MobileWeekAgenda
          days={props.days}
          todayStr={props.todayStr}
          onScheduleClick={props.onScheduleClick}
          onExamClick={props.onExamClick}
          onScrollToDate={props.onScrollToDate}
          onShowDayView={props.onShowDayView}
          scrollToDateStr={props.scrollToDateStr}
          onScrollConsumed={props.onScrollConsumed}
        />
      </div>

      <div
        ref={props.timetableRef}
        className="hidden max-h-[calc(100vh-220px)] overflow-y-auto sm:block"
      >
        <Timetable
          schedules={props.schedules}
          exams={props.exams}
          weekStart={props.weekStart}
          startTime="00:00"
          onDayClick={props.onShowDayView}
        />
      </div>
    </>
  );
}
