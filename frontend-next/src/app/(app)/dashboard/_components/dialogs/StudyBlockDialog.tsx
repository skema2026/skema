'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ExamSchedule } from '@/types';

type StudyBlockDialogProps = {
  exam: Pick<ExamSchedule, 'id' | 'title' | 'exam_date'> | null;
  onExamChange: (exam: null) => void;
  getDaysUntil: (date: string) => number;
  aiAction: string | null;
  runAiCommand: (action: string, prompt: string, successMessage: string) => Promise<void>;
  exams: ExamSchedule[];
  onDeleteExam: (exam: ExamSchedule | null) => void;
};

export default function StudyBlockDialog({
  exam,
  onExamChange,
  getDaysUntil,
  aiAction,
  runAiCommand,
  exams,
  onDeleteExam,
}: StudyBlockDialogProps) {
  const [studyHoursPerDay, setStudyHoursPerDay] = useState(2);

  return (
    <Dialog open={!!exam} onOpenChange={(open) => { if (!open) onExamChange(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>공부 일정 자동 배치</DialogTitle>
        </DialogHeader>
        {exam && (
          <div className="py-2 space-y-4">
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
              <p className="text-sm font-black text-slate-950">{exam.title}</p>
              <p className="mt-0.5 text-xs font-bold text-amber-700">
                {exam.exam_date} · D-{getDaysUntil(exam.exam_date)}
              </p>
            </div>
            <div>
              <p className="mb-2 text-xs font-black text-slate-700">하루 공부 시간</p>
              <div className="flex gap-2">
                {[1, 2, 3].map((hours) => (
                  <button
                    key={hours}
                    type="button"
                    onClick={() => setStudyHoursPerDay(hours)}
                    className={`flex-1 rounded-lg border py-2.5 text-sm font-black transition ${
                      studyHoursPerDay === hours
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300'
                    }`}
                  >
                    {hours}시간
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onExamChange(null);
                void runAiCommand(
                  'study-blocks',
                  `${exam.title} 시험(${exam.exam_date}) 공부 일정을 다시 배치해줘. 이 시험을 위해 기존에 배치된 미완료 공부 블록이 있으면 모두 삭제하고, 남은 기간 동안 하루 ${studyHoursPerDay}시간씩 빈 시간에 새로 배치해줘. 기존 일정과 충돌하지 않는 시간대에 두고, 시험일에 가까울수록 더 집중되게 해줘.`,
                  '공부 일정을 새로 배치했습니다',
                );
              }}
              disabled={aiAction !== null}
              className="w-full rounded-lg bg-blue-600 py-3 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {aiAction === 'study-blocks' ? '배치 중...' : '공부 일정 배치하기'}
            </button>
            <p className="text-center text-[11px] font-bold text-slate-400">
              이미 배치한 공부 일정은 자동으로 지우고 새로 만듭니다.
            </p>
            <button
              type="button"
              onClick={() => {
                const fullExam = exams.find((item) => item.id === exam.id) ?? null;
                onExamChange(null);
                onDeleteExam(fullExam);
              }}
              disabled={aiAction !== null}
              className="w-full rounded-lg border border-red-200 py-2.5 text-sm font-black text-red-600 transition hover:bg-red-50 disabled:opacity-50"
            >
              시험 삭제
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
