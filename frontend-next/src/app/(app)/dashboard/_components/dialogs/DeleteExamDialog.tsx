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
          <div className="py-2 space-y-4">
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
              <p className="text-sm font-black text-slate-950">{exam.title}</p>
              <p className="mt-0.5 text-xs font-bold text-amber-700">
                {exam.exam_date}{exam.exam_time ? ` · ${exam.exam_time}` : ''}
              </p>
            </div>
            <p className="text-sm font-bold text-slate-600">
              이 시험을 삭제할까요? 시험을 위해 만든 공부 일정도 함께 사라집니다.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onExamChange(null)}
                disabled={deleteExam.isPending}
                className="flex-1 rounded-lg border border-slate-200 bg-white py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  deleteExam.mutate(exam.id, {
                    onSuccess: () => {
                      toast.success('시험이 삭제되었습니다');
                      onExamChange(null);
                    },
                    onError: () => toast.error('삭제 중 오류가 발생했습니다'),
                  });
                }}
                disabled={deleteExam.isPending}
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-black text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {deleteExam.isPending ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
