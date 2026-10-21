'use client';

import MaterialIcon from '@/components/common/MaterialIcon';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type FreeTimeWindow = { start: number; end: number };

type FreeTimeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  windows: FreeTimeWindow[];
  totalAvailableMinutes: number;
  minutesToTime: (minutes: number) => string;
  formatDuration: (start: number, end: number) => string;
  formatMinutesDuration: (minutes: number) => string;
  aiAction: string | null;
  runAiCommand: (action: string, prompt: string, successMessage: string) => Promise<void>;
};

export default function FreeTimeDialog({
  open,
  onOpenChange,
  windows,
  totalAvailableMinutes,
  minutesToTime,
  formatDuration,
  formatMinutesDuration,
  aiAction,
  runAiCommand,
}: FreeTimeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>오늘 빈 시간</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-2">
          <p className="mb-3 text-xs font-bold text-slate-500">
            총 {formatMinutesDuration(totalAvailableMinutes)} 사용 가능
          </p>
          {windows.map((window, index) => (
            <div key={index} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
              <span className="text-sm font-black text-slate-950">
                {minutesToTime(window.start)} – {minutesToTime(window.end)}
              </span>
              <span className="text-xs font-bold text-slate-400">
                {formatDuration(window.start, window.end)}
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
            void runAiCommand(
              'free-plan',
              '오늘 시간표의 빈 시간을 분석해서 지금 할 수 있는 일과 배치하면 좋은 일정을 추천해줘',
              '오늘 빈 시간 활용안을 정리했습니다',
            );
          }}
          disabled={aiAction !== null}
          className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          <MaterialIcon icon="smart_toy" size={16} color="#fff" />
          {aiAction === 'free-plan' ? 'AI 처리 중...' : '빈 시간 활용 AI 추천'}
        </button>
      </DialogContent>
    </Dialog>
  );
}
