'use client';

import { displayTitle } from '@/lib/utils';
import { getDisplayColor } from '@/lib/scheduleColor';
import MaterialIcon from '@/components/common/MaterialIcon';
import type { ExamSchedule, Schedule } from '@/types';

/**
 * 모바일 주간·월간 보기에서 날짜를 누르면 그 자리에 펼치는 "그날 할 일" 목록 (11/21).
 * 일간 보기로 넘어가지 않고, 일정 오른쪽 동그라미로 완료/완료 취소를 한다.
 */

const LONG_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('ko-KR', { weekday: 'long' });

const TYPE_ICON: Record<string, string> = {
  class: 'school',
  study: 'menu_book',
  assignment: 'assignment',
  personal: 'event',
};

type MobileDayListProps = {
  date: Date;
  isToday: boolean;
  schedules: Schedule[];
  exams: ExamSchedule[];
  onScheduleClick: (schedule: Schedule) => void;
  onExamClick: (exam: ExamSchedule) => void;
  onToggleComplete: (schedule: Schedule) => void;
  /** 주간 보기에서만: 닫으면 처음 상태(날짜 줄 + 시험 카드)로 */
  onClose?: () => void;
};

export default function MobileDayList({
  date,
  isToday,
  schedules,
  exams,
  onScheduleClick,
  onExamClick,
  onToggleComplete,
  onClose,
}: MobileDayListProps) {
  const isEmpty = schedules.length === 0 && exams.length === 0;
  const doneCount = schedules.filter((s) => s.is_completed).length;

  return (
    <section
      aria-label={`${date.getMonth() + 1}월 ${date.getDate()}일 일정`}
      className={`rounded-xl border bg-white p-3 ${isToday ? 'border-black/20' : 'border-black/[0.08]'}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] text-[#5f6f88]">
            {isToday ? '오늘' : LONG_WEEKDAY_FORMATTER.format(date)}
            {schedules.length > 0 && ` · 완료 ${doneCount}/${schedules.length}`}
          </p>
          <h3 className="mt-0.5 text-base font-medium text-[#0f1e3a]">
            {date.getMonth() + 1}월 {date.getDate()}일
          </h3>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#5f6f88] transition-colors hover:bg-[#edf3fc] hover:text-[#0f1e3a]"
          >
            <MaterialIcon icon="close" size={18} color="currentColor" />
          </button>
        )}
      </div>

      {isEmpty ? (
        <p className="rounded-lg bg-[#f5f8fd] px-3 py-6 text-center text-[13px] text-[#5f6f88]">
          이날은 일정이 없어요
        </p>
      ) : (
        <div className="space-y-1.5">
          {exams.map((exam) => (
            <button
              key={`day-list-exam-${exam.id}`}
              type="button"
              onClick={() => onExamClick(exam)}
              className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left transition hover:border-amber-300 hover:bg-amber-100"
            >
              <div className="flex items-center gap-2">
                <MaterialIcon icon="school" size={16} color="#d97706" />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-amber-900">{exam.title}</p>
                <span className="text-xs font-semibold text-amber-700">{exam.exam_time || '종일'}</span>
              </div>
            </button>
          ))}

          {schedules.map((schedule) => {
            const done = Boolean(schedule.is_completed);
            const title = displayTitle(schedule.title);

            return (
              <div
                key={`day-list-${schedule.id}`}
                data-schedule-id={schedule.id}
                className={`flex items-stretch rounded-lg border bg-white ${
                  done ? 'border-black/[0.06]' : 'border-black/[0.08]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onScheduleClick(schedule)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-0 pr-1 text-left transition-colors hover:bg-[#f5f8fd]"
                >
                  <span
                    className="w-[4px] shrink-0 self-stretch rounded-full"
                    style={{ background: done ? '#cbd5e1' : getDisplayColor(schedule) }}
                  />
                  <span
                    className={`w-[52px] shrink-0 font-mono text-[13px] tabular-nums ${
                      done ? 'text-slate-400' : 'text-[#0f1e3a]'
                    }`}
                  >
                    {schedule.start_time}
                    <span className="block text-[12px] text-[#98a6ba]">{schedule.end_time}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <MaterialIcon
                        icon={TYPE_ICON[schedule.schedule_type] ?? 'event_note'}
                        size={14}
                        color={done ? '#cbd5e1' : '#5f6f88'}
                      />
                      <span
                        className={`truncate text-sm font-medium ${
                          done ? 'text-slate-400 line-through' : 'text-slate-950'
                        }`}
                      >
                        {title}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-[#5f6f88]">
                      {schedule.location ||
                        (schedule.schedule_type === 'study'
                          ? '공부 일정'
                          : schedule.schedule_type === 'class'
                            ? '수업'
                            : '일정')}
                    </span>
                  </span>
                </button>

                {/* 완료 체크 — 일간 보기와 같은 동그라미, 누르기 쉽게 터치 영역은 크게 */}
                <button
                  type="button"
                  onClick={() => onToggleComplete(schedule)}
                  aria-label={`${title} ${done ? '완료 취소' : '완료'}`}
                  aria-pressed={done}
                  className="flex w-11 shrink-0 items-center justify-center"
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] transition-colors ${
                      done ? 'border-[#2a6fe3] bg-[#2a6fe3]' : 'border-[#cfdbec] bg-white'
                    }`}
                  >
                    {done && (
                      <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <path
                          d="M2 6l3 3 5-5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
