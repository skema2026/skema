'use client';

import { toast } from 'sonner';
import { useDeleteExam } from '@/hooks/useExams';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ExamSchedule } from '@/types';

type DeleteExamDialogProps = {
  exam: ExamSchedule | null;
  onExamChange: (exam: ExamSchedule | null) => void;
};

export default function DeleteExamDialog({
  exam,
  onExamChange,
}: DeleteExamDialogProps) {
  const deleteExam = useDeleteExam();

  return (
    <Dialog open={!!exam} onOpenChange={(open) => { if (!open) onExamChange(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>시험 삭제</DialogTitle>
        </DialogHeader>
        {exam && (
          <div className="space-y-5">
            <div className="rounded-xl bg-[#f5f8fd] px-4 py-3">
              <p className="text-[15px] font-medium text-[#0f1e3a]">{exam.title}</p>
              <p className="mt-1 font-mono text-[13px] tabular-nums text-[#5f6f88]">
                {exam.exam_date}{exam.exam_time ? ` · ${exam.exam_time}` : ''}
              </p>
            </div>
            <p className="text-[14px] leading-[22px] text-[#44536b]">
              이 시험을 삭제할까요? 이 시험을 위해 만든 공부 블록도 함께 지워져요.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onExamChange(null)}
                disabled={deleteExam.isPending}
                className="h-11 flex-1 rounded-[10px] border border-[#0f1e3a]/10 bg-white text-[15px] text-[#0f1e3a] transition-colors hover:bg-[#edf3fc] disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  deleteExam.mutate(exam.id, {
                    onSuccess: () => {
                      toast.success('시험을 삭제했어요');
                      onExamChange(null);
                    },
                    onError: () => toast.error('시험을 삭제하지 못했어요'),
                  });
                }}
                disabled={deleteExam.isPending}
                className="h-11 flex-1 rounded-[10px] bg-[#dc2626] text-[15px] font-medium text-white transition-colors hover:bg-[#b91c1c] disabled:opacity-50"
              >
                {deleteExam.isPending ? '삭제하는 중' : '삭제'}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
