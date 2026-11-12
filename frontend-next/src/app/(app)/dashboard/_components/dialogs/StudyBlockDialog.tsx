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
          <div className="space-y-5">
            <div className="rounded-xl bg-[#f5f8fd] px-4 py-3">
              <p className="text-[15px] font-medium text-[#0f1e3a]">{exam.title}</p>
              <p className="mt-1 font-mono text-[13px] tabular-nums text-[#5f6f88]">
                {exam.exam_date} · D-{getDaysUntil(exam.exam_date)}
              </p>
            </div>
            <div>
              <p className="mb-2 text-[13px] text-[#44536b]">하루 공부 시간</p>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map((hours) => (
                  <button
                    key={hours}
                    type="button"
                    onClick={() => setStudyHoursPerDay(hours)}
                    aria-pressed={studyHoursPerDay === hours}
                    className={`h-10 rounded-[10px] border text-[14px] transition-colors ${
                      studyHoursPerDay === hours
                        ? 'border-[#2a6fe3] bg-[#eaf2ff] font-medium text-[#1f63d6]'
                        : 'border-[#0f1e3a]/10 bg-white text-[#44536b] hover:bg-[#f5f8fd]'
                    }`}
                  >
                    {hours}시간
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => void generate(exam.id)}
                disabled={busy}
                className="h-11 w-full rounded-[10px] bg-[#2a6fe3] text-[15px] font-medium text-white transition-colors hover:bg-[#1f63d6] disabled:opacity-50"
              >
                {isGenerating ? '배치하는 중' : '공부 일정 배치하기'}
              </button>
              <p className="text-center text-[12px] leading-[18px] text-[#5f6f88]">
                시험 전날까지 빈 시간에 30분 단위로 넣어요. 아직 안 한 자동 배치 블록은 지우고 새로 만들어요
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const fullExam = exams.find((item) => item.id === exam.id) ?? null;
                onExamChange(null);
                onDeleteExam(fullExam);
              }}
              disabled={busy}
              className="h-10 w-full rounded-[10px] text-[14px] text-[#dc2626] transition-colors hover:bg-[#fef2f2] disabled:opacity-50"
            >
              시험 삭제
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
