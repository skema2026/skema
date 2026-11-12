'use client';

import { displayTitle } from '@/lib/utils';
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
          <div className="space-y-4">
            <p className="text-[14px] leading-[22px] text-[#44536b]">
              {hasMoves
                ? `못 한 블록 ${preview.summary.target}개 중 ${preview.summary.placed}개를 시험 전날까지 빈 시간으로 옮겨요. 수업·시험·개인 일정은 그대로 둬요`
                : '옮길 수 있는 블록이 없어요'}
            </p>

            {hasMoves && (
              <ul className="max-h-72 divide-y divide-[#0f1e3a]/8 overflow-y-auto rounded-xl border border-[#0f1e3a]/8">
                {preview.moves.map((m) => (
                  <li key={m.schedule_id} className="px-4 py-3">
                    <p className="truncate text-[14px] font-medium text-[#0f1e3a]">{displayTitle(m.title)}</p>
                    <p className="mt-1 font-mono text-[12px] tabular-nums text-[#98a6ba] line-through">
                      {formatSegment(m.from)}
                    </p>
                    {m.to.map((seg) => (
                      <p key={`${seg.date}-${seg.start_time}`} className="font-mono text-[12px] tabular-nums text-[#1f63d6]">
                        → {formatSegment(seg)}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            )}

            {preview.unplaced.length > 0 && (
              <div className="rounded-xl bg-[#fff8eb] px-4 py-3">
                <p className="text-[14px] font-medium text-[#92400e]">{preview.warning ?? '자리가 부족해요'}</p>
                <ul className="mt-1 space-y-0.5">
                  {preview.unplaced.map((u) => (
                    <li key={u.schedule_id} className="text-[12px] leading-[18px] text-[#92400e]/80">
                      {displayTitle(u.title)} · {u.minutes}분
                      {u.reason === 'DEADLINE_PASSED' ? ' (시험이 이미 지났어요)' : ` (${formatDay(u.deadline)}까지 빈 시간 없음)`}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[12px] text-[#92400e]/80">이 블록들은 그대로 남아요</p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={close}
                disabled={isApplying}
                className="h-11 flex-1 rounded-[10px] border border-[#0f1e3a]/10 bg-white text-[15px] text-[#0f1e3a] transition-colors hover:bg-[#edf3fc] disabled:opacity-50"
              >
                {hasMoves ? '취소' : '닫기'}
              </button>
              {hasMoves && (
                <button
                  type="button"
                  onClick={() => void apply()}
                  disabled={isApplying}
                  className="h-11 flex-1 rounded-[10px] bg-[#2a6fe3] text-[15px] font-medium text-white transition-colors hover:bg-[#1f63d6] disabled:opacity-50"
                >
                  {isApplying ? '적용하는 중' : '적용'}
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
