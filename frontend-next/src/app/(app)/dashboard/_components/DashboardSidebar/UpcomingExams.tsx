'use client';

import MaterialIcon from '@/components/common/MaterialIcon';
import type { ExamSchedule, Schedule } from '@/types';

type UpcomingExamsProps = {
  exams: ExamSchedule[];
  events: Schedule[];
  getDaysUntil: (date: string) => number;
  onExamClick: (exam: ExamSchedule) => void;
};

export default function UpcomingExams({
  exams,
  events,
  getDaysUntil,
  onExamClick,
}: UpcomingExamsProps) {
  return (
    <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-[0_10px_30px_-5px_rgba(0,82,255,0.08)]">
      <p className="mb-3 text-[11px] font-black text-slate-400">시험 일정</p>
      {exams.length === 0 && events.length === 0 ? (
        <p className="text-xs font-bold text-slate-400">등록된 일정이 없어요</p>
      ) : (
        <div className="flex flex-col gap-2">
          {exams.map((exam) => {
            const days = getDaysUntil(exam.exam_date);
            return (
              <button
                key={`sidebar-exam-${exam.id}`}
                type="button"
                onClick={() => onExamClick(exam)}
                className="flex w-full items-center gap-3 rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2.5 text-left transition hover:border-amber-300 hover:bg-amber-100/70"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100">
                  <MaterialIcon icon="quiz" size={16} color="#d97706" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-black text-slate-900">{exam.title}</span>
                  <span className="text-[10px] font-bold text-slate-400">{exam.exam_date}</span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${days <= 0 ? 'bg-red-100 text-red-700' : days <= 7 ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-600'}`}>
                  {days <= 0 ? 'D-day' : `D-${days}`}
                </span>
              </button>
            );
          })}
          {events.map((schedule) => {
            const days = getDaysUntil(schedule.date!);
            return (
              <div key={`sidebar-event-${schedule.id}`} className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/40 px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-100">
                  <MaterialIcon icon="event" size={16} color="#2563eb" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-black text-slate-900">{schedule.title}</span>
                  <span className="text-[10px] font-bold text-slate-400">{schedule.date} {schedule.start_time}~{schedule.end_time}</span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${days <= 0 ? 'bg-red-100 text-red-700' : days <= 3 ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-600'}`}>
                  {days <= 0 ? 'D-day' : `D-${days}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
