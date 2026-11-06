'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ExamSchedule, StudyBlocksGenerateResult } from '@/types';

type StudyBlockDialogProps = {
  exam: Pick<ExamSchedule, 'id' | 'title' | 'exam_date'> | null;
  onExamChange: (exam: null) => void;
  getDaysUntil: (date: string) => number;
  onGenerated: () => void;
  exams: ExamSchedule[];
  onDeleteExam: (exam: ExamSchedule | null) => void;
};

export default function StudyBlockDialog({
  exam,
  onExamChange,
  getDaysUntil,
  onGenerated,
  exams,
  onDeleteExam,
}: StudyBlockDialogProps) {
  const [studyHoursPerDay, setStudyHoursPerDay] = useState(2);
  const [isGenerating, setIsGenerating] = useState(false);
  const busy = isGenerating;

  /** 시험 전날까지 빈 시간에 30분 단위로 배치 (#12). AI 없이 서버 규칙으로. */
  const generate = async (examId: number) => {
    setIsGenerating(true);
    try {
      const { data } = await api.post<StudyBlocksGenerateResult>('/study-blocks/generate', {
        exam_ids: [examId],
        start_days_before: 0,
        days_per_week: 7,
        minutes_per_day: studyHoursPerDay * 60,
        replace: true,
      });
      onGenerated();
      if (data.created === 0) {
        toast.error('시험 전날까지 빈 시간이 없어서 배치하지 못했어요');
      } else if (data.warning) {
        toast.success(`공부 블록 ${data.created}개를 배치했어요 (자리가 부족해 일부만 들어갔어요)`);
      } else {
        toast.success(`공부 블록 ${data.created}개를 배치했어요`);
      }
      onExamChange(null);
    } catch {
      toast.error('공부 일정을 배치하지 못했어요');
    } finally {
      setIsGenerating(false);
    }
  };

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
              onClick={() => void generate(exam.id)}
              disabled={busy}
              className="w-full rounded-lg bg-blue-600 py-3 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {isGenerating ? '배치 중...' : '공부 일정 배치하기'}
            </button>
            <p className="text-center text-[11px] font-bold text-slate-400">
              시험 전날까지 빈 시간에 30분 단위로 넣어요. 아직 안 한 자동 배치 블록은 지우고 새로 만듭니다.
            </p>
            <button
              type="button"
              onClick={() => {
                const fullExam = exams.find((item) => item.id === exam.id) ?? null;
                onExamChange(null);
                onDeleteExam(fullExam);
              }}
              disabled={busy}
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
