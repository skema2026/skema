
'use client';

import { useEffect } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Timetable } from '@/components/timetable/Timetable';
import type { ExamSchedule, Schedule } from '@/types';
import MobileDayList from './MobileDayList';

const SHORT_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  weekday: 'short',
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
  selectedDateStr: string | null;
  onSelectDate: (dateStr: string | null) => void;
  onScheduleClick: (schedule: Schedule) => void;
  onExamClick: (exam: ExamSchedule) => void;
  onToggleComplete: (schedule: Schedule) => void;
  /** 날짜 줄 아래(또는 펼친 하루 목록 아래)에 이어 붙일 '시험 일정 · 준비도' 카드 */
  examsCard?: ReactNode;
};

/**
 * 모바일 주간 보기 (11/21):
 * 처음엔 날짜 줄 + 시험 카드. 날짜를 누르면 '주간' 탭 그대로, 날짜 줄 바로 아래에 그날 목록을
 * 페이지 안에서 펼치고(패널·애니메이션 없음), 시험 카드는 그 아래로 밀린다. 닫으면 처음 상태.
 */
function MobileWeekAgenda({
  days,
  todayStr,
  selectedDateStr,
  onSelectDate,
  onScheduleClick,
  onExamClick,
  onToggleComplete,
  examsCard,
}: MobileWeekAgendaProps) {
  const selectedDay = selectedDateStr
    ? days.find((day) => day.dateStr === selectedDateStr) ?? null
    : null;

  return (
    <div className="space-y-3 bg-[#f5f8fd] p-3">
      <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="이번 주 날짜">
        {days.map((day) => {
          const isToday = day.dateStr === todayStr;
          const isSelected = day.dateStr === selectedDay?.dateStr;
          const count = day.schedules.length + day.exams.length;

          return (
            <button
              key={day.dateStr}
              type="button"
              onClick={() => onSelectDate(day.dateStr)}
              aria-pressed={isSelected}
              className={`min-w-0 rounded-lg border px-1 py-2 text-center transition-colors ${
                isSelected
                  ? 'border-[#2a6fe3] bg-[#2a6fe3] text-white'
                  : isToday
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
                  isSelected || isToday
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

      {selectedDay && (
        <MobileDayList
          date={selectedDay.date}
          isToday={selectedDay.dateStr === todayStr}
          schedules={selectedDay.schedules}
          exams={selectedDay.exams}
          onScheduleClick={onScheduleClick}
          onExamClick={onExamClick}
          onToggleComplete={onToggleComplete}
          onClose={() => onSelectDate(null)}
        />
      )}

      {examsCard}
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
  /** 모바일 전용: 선택한 날짜, 완료 체크, 시험 카드 */
  selectedDateStr: string | null;
  onSelectDate: (dateStr: string | null) => void;
  onToggleComplete: (schedule: Schedule) => void;
  examsCard?: ReactNode;
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
  selectedDateStr,
  onSelectDate,
  onToggleComplete,
  examsCard,
}: WeekViewProps) {
  // 일간 → 주간으로 넘어올 때의 스크롤 요청: 모바일은 이제 날짜별 목록이 없으므로 받기만 하고 비운다
  useEffect(() => {
    if (scrollToDateStr) onScrollConsumed();
  }, [scrollToDateStr, onScrollConsumed]);

  return (
    <>
      <div className="sm:hidden">
        <MobileWeekAgenda
          days={days}
          todayStr={todayStr}
          selectedDateStr={selectedDateStr}
          onSelectDate={onSelectDate}
          onScheduleClick={onScheduleClick}
          onExamClick={onExamClick}
          onToggleComplete={onToggleComplete}
          examsCard={examsCard}
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
