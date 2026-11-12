'use client';

import { useState } from 'react';
import MaterialIcon from '@/components/common/MaterialIcon';
import AddExamDialog from './AddExamDialog';
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
  danger: { text: 'text-red-600', bar: 'bg-red-500', message: '위험 · 오늘부터 공부 블록을 채워야 해요' },
  warn: { text: 'text-orange-500', bar: 'bg-orange-400', message: '주의 · 매일 조금씩 더 해 두기' },
  ok: { text: 'text-[#0f1e3a]', bar: 'bg-[#2a6fe3]' },
};

function ExamReadinessBar({ exam, schedules, days }: { exam: ExamSchedule; schedules: Schedule[]; days: number }) {
  const readiness = getExamReadiness(exam, schedules, days);

  if (readiness.level === 'none') {
    return (
      <span className="mt-2 block text-[11px] font-medium text-slate-400">
        공부 블록을 만들면 준비도가 보여요
      </span>
    );
  }

  const style = READINESS_STYLE[readiness.level];
  return (
    <span className="mt-3 block">
      <span className="flex items-center justify-between text-[12px]">
        <span className="text-[#5f6f88]">
          준비도 · 완료 {readiness.completed}/{readiness.total}
        </span>
        <span className={`font-mono tabular-nums ${style.text}`}>{readiness.pct}%</span>
      </span>
      <span
        className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[#e6effc]"
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
        <span className={`mt-1 block text-[11px] font-medium ${style.text}`}>{style.message}</span>
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
  const [isAddOpen, setIsAddOpen] = useState(false);
  return (
    <div className="rounded-xl border border-black/[0.08] bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[14px] font-medium text-[#0f1e3a]">시험 일정 · 준비도</p>
        <button
          type="button"
          onClick={() => setIsAddOpen(true)}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-[#44536b] transition-colors hover:bg-[#edf3fc] hover:text-[#0f1e3a]"
        >
          <MaterialIcon icon="add" size={14} color="#2a6fe3" />
          시험 추가
        </button>
      </div>
      <AddExamDialog open={isAddOpen} onOpenChange={setIsAddOpen} onCreated={onExamClick} />
      {exams.length === 0 && events.length === 0 ? (
        <p className="text-[13px] leading-5 text-[#5f6f88]">시험을 추가하면 시험 전날까지 공부 블록을 자동으로 배치해요</p>
      ) : (
        <div className="flex flex-col gap-2">
          {exams.map((exam) => {
            const days = getDaysUntil(exam.exam_date);
            return (
              <button
                key={`sidebar-exam-${exam.id}`}
                type="button"
                onClick={() => onExamClick(exam)}
                className="block w-full rounded-lg border border-black/[0.08] px-3 py-3 text-left transition-colors hover:bg-[#f5f8fd]"
              >
                <span className="flex items-center gap-3">
                                    <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-[#0f1e3a]">{exam.title}</span>
                    <span className="font-mono text-[12px] tabular-nums text-[#5f6f88]">{exam.exam_date}</span>
                  </span>
                  <span className={`shrink-0 font-mono text-[13px] tabular-nums ${days <= 0 ? 'text-[#dc2626]' : days <= 7 ? 'text-[#b45309]' : 'text-[#44536b]'}`}>
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
                  <MaterialIcon icon="event" size={16} color="#2a6fe3" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-slate-900">{schedule.title}</span>
                  <span className="text-[11px] font-medium text-slate-400">{schedule.date} {schedule.start_time}~{schedule.end_time}</span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${days <= 0 ? 'bg-red-100 text-red-700' : days <= 3 ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-600'}`}>
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
