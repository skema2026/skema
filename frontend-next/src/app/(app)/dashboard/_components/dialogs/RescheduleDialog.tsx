'use client';

import { useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { RescheduleApplyResult, ReschedulePreview, RescheduleSegment } from '@/types';

type RescheduleDialogProps = {
  preview: ReschedulePreview | null;
  onPreviewChange: (preview: ReschedulePreview | null) => void;
  onApplied: () => void;
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function formatDay(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

function formatSegment(seg: RescheduleSegment) {
  return `${formatDay(seg.date)} ${seg.start_time}–${seg.end_time}`;
}

/** 다시 짜기 미리보기 → 적용 (#11). 미리보기 단계에서는 DB가 바뀌지 않는다. */
export default function RescheduleDialog({
  preview,
  onPreviewChange,
  onApplied,
}: RescheduleDialogProps) {
  const [isApplying, setIsApplying] = useState(false);

  const close = () => {
    if (!isApplying) onPreviewChange(null);
  };

  const apply = async () => {
    if (!preview) return;
    setIsApplying(true);
    try {
      const { data } = await api.post<RescheduleApplyResult>('/reschedule/apply', {
        moves: preview.moves.map((m) => ({ schedule_id: m.schedule_id, to: m.to })),
      });
      toast.success(`일정 ${data.applied}개를 다시 배치했어요`);
      onApplied();
      onPreviewChange(null);
    } catch (error) {
      const code = axios.isAxiosError(error) ? error.response?.data?.detail?.code : undefined;
      if (code === 'SLOT_TAKEN' || code === 'ALREADY_CHANGED') {
        // 미리보기 뒤에 일정이 바뀜 → 새 미리보기로 바꿔서 보여준다
        toast.error('그사이 일정이 바뀌어서 미리보기를 새로 불러왔어요');
        try {
          const { data } = await api.post<ReschedulePreview>('/reschedule/preview');
          onPreviewChange(data);
        } catch {
          onPreviewChange(null);
        }
      } else {
        toast.error('다시 짜기를 적용하지 못했어요');
      }
    } finally {
      setIsApplying(false);
    }
  };

  const hasMoves = !!preview && preview.moves.length > 0;

  return (
    <Dialog open={!!preview} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>다시 짜기 미리보기</DialogTitle>
        </DialogHeader>
        {preview && (
          <div className="space-y-4 py-2">
            <p className="text-sm font-bold text-slate-600">
              {hasMoves
                ? `못 한 블록 ${preview.summary.target}개 중 ${preview.summary.placed}개를 시험 전날까지 빈 시간에 옮겨요. 수업·시험·개인 일정은 그대로예요.`
                : '옮길 수 있는 블록이 없어요.'}
            </p>

            {hasMoves && (
              <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {preview.moves.map((m) => (
                  <li key={m.schedule_id} className="rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5">
                    <p className="text-sm font-black text-slate-950">{m.title}</p>
                    <p className="mt-1 text-xs font-bold text-slate-400 line-through">
                      {formatSegment(m.from)}
                    </p>
                    {m.to.map((seg) => (
                      <p key={`${seg.date}-${seg.start_time}`} className="text-xs font-black text-blue-700">
                        → {formatSegment(seg)}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            )}

            {preview.unplaced.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="text-sm font-black text-amber-800">⚠️ {preview.warning ?? '자리가 부족해요'}</p>
                <ul className="mt-1 space-y-0.5">
                  {preview.unplaced.map((u) => (
                    <li key={u.schedule_id} className="text-xs font-bold text-amber-700">
                      {u.title} · {u.minutes}분
                      {u.reason === 'DEADLINE_PASSED' ? ' (시험이 이미 지났어요)' : ` (${formatDay(u.deadline)}까지 빈 시간 없음)`}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] font-bold text-amber-600">이 블록들은 그대로 남아요.</p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={close}
                disabled={isApplying}
                className="flex-1 rounded-lg border border-slate-200 bg-white py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {hasMoves ? '취소' : '닫기'}
              </button>
              {hasMoves && (
                <button
                  type="button"
                  onClick={() => void apply()}
                  disabled={isApplying}
                  className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {isApplying ? '적용 중...' : '적용'}
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
