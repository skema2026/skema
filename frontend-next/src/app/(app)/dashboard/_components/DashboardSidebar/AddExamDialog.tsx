'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useCreateExam } from '@/hooks/useExams';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ExamSchedule } from '@/types';

/**
 * 대시보드에서 시험 추가 (11/9).
 * AI 채팅을 빼면서(#37) 온보딩 뒤에는 시험을 넣을 곳이 없어졌다.
 * 시험을 만들면 onCreated로 넘겨서 바로 '공부 일정 자동 배치' 창을 연다.
 */
type AddExamDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (exam: ExamSchedule) => void;
};

function todayLocal() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function AddExamDialog({ open, onOpenChange, onCreated }: AddExamDialogProps) {
  const createExam = useCreateExam();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const today = todayLocal();

  const close = (next: boolean) => {
    if (!next) {
      setTitle('');
      setDate('');
      setError('');
    }
    onOpenChange(next);
  };

  const submit = () => {
    const name = title.trim();
    if (!name) return setError('시험 이름을 입력해 주세요');
    if (!date) return setError('시험 날짜를 골라 주세요');
    if (date < today) return setError('오늘 이후 날짜를 골라 주세요');
    setError('');
    createExam.mutate(
      { title: name, subject: name, exam_date: date },
      {
        onSuccess: (exam) => {
          toast.success('시험을 추가했어요. 공부 일정을 만들어 볼까요?');
          close(false);
          onCreated(exam);
        },
        onError: () => setError('시험을 추가하지 못했어요. 잠시 후 다시 시도해 주세요'),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>시험 추가</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-black text-slate-600">시험 이름</span>
            <input
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setError(''); }}
              placeholder="예: 자료구조 기말고사"
              maxLength={100}
              autoFocus
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-blue-400"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-black text-slate-600">시험 날짜</span>
            <input
              type="date"
              value={date}
              min={today}
              onChange={(e) => { setDate(e.target.value); setError(''); }}
              aria-label="시험 날짜"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none focus:border-blue-400"
            />
          </label>
          {error && <p className="text-xs font-bold text-red-600">{error}</p>}
          <p className="text-[11px] font-bold leading-relaxed text-slate-400">
            추가하면 시험 전날까지 빈 시간에 공부 블록을 배치하는 창이 바로 열려요.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => close(false)}
              disabled={createExam.isPending}
              className="flex-1 rounded-lg border border-slate-200 bg-white py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={createExam.isPending}
              className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {createExam.isPending ? '추가 중...' : '추가'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
