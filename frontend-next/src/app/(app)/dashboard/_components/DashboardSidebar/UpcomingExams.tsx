'use client';

import MaterialIcon from '@/components/common/MaterialIcon';
import { getExamReadiness, type ReadinessLevel } from '@/lib/examReadiness';
import type { ExamSchedule, Schedule } from '@/types';

type UpcomingExamsProps = {
  exams: ExamSchedule[];
  events: Schedule[];
  /** 준비도 계산용 전체 일정 (완료 체크하면 바로 다시 계산됨) */
  schedules: Schedule[];
  getDaysUntil: (date: string) => number;
  onExamClick: (exam: ExamSchedule) => void;
};

const READINESS_STYLE: Record<Exclude<ReadinessLevel, 'none'>, { text: string; bar: string; message?: string }> = {
  danger: { text: 'text-red-600', bar: 'bg-red-500', message: '위험 · 지금 바로 공부 시작!' },
  warn: { text: 'text-orange-500', bar: 'bg-orange-400', message: '주의 · 매일 조금씩 더 해 두기' },
  ok: { text: 'text-emerald-600', bar: 'bg-emerald-500' },
};

function ExamReadinessBar({ exam, schedules, days }: { exam: ExamSchedule; schedules: Schedule[]; days: number }) {
  const readiness = getExamReadiness(exam, schedules, days);

  if (readiness.level === 'none') {
    return (
      <span className="mt-2 block text-[10px] font-bold text-slate-400">
        공부 블록을 만들면 준비도가 보여요
      </span>
    );
  }

  const style = READINESS_STYLE[readiness.level];
  return (
    <span className="mt-2 block">
      <span className="flex items-center justify-between text-[10px] font-bold">
        <span className="text-slate-500">
          준비도 · 완료 {readiness.completed}/{readiness.total}
        </span>
        <span className={`font-black ${style.text}`}>{readiness.pct}%</span>
      </span>
      <span
        className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-label={`${exam.title} 준비도`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={readiness.pct}
      >
        <span
          className={`block h-full rounded-full transition-[width] duration-500 ${style.bar}`}
          style={{ width: `${readiness.pct}%` }}
        />
      </span>
      {style.message && (
        <span className={`mt-1 block text-[10px] font-bold ${style.text}`}>{style.message}</span>
      )}
    </span>
  );
}

export default function UpcomingExams({
  exams,
  events,
  schedules,
  getDaysUntil,
  onExamClick,
}: UpcomingExamsProps) {
  return (
    <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-[0_10px_30px_-5px_rgba(0,82,255,0.08)]">
      <p className="mb-3 text-[11px] font-black text-slate-400">시험 일정 · 준비도</p>
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
                className="block w-full rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2.5 text-left transition hover:border-amber-300 hover:bg-amber-100/70"
              >
                <span className="flex items-center gap-3">
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
                </span>
                <ExamReadinessBar exam={exam} schedules={schedules} days={Math.max(days, 0)} />
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
