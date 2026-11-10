'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type IssueItem = {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone: string;
};

type IssueDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: IssueItem[];
};

export default function IssueDialog({
  open,
  onOpenChange,
  items,
}: IssueDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>확인 필요 항목</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {items.length === 0 ? (
            <p className="text-[14px] text-[#5f6f88]">확인할 항목이 없어요</p>
          ) : (
            items.map((item) => (
              <div key={item.key} className="rounded-xl bg-[#f5f8fd] px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] text-[#44536b]">{item.label}</span>
                  <span className="font-mono text-[14px] font-medium tabular-nums text-[#0f1e3a]">{item.value}</span>
                </div>
                <p className="mt-1 text-[12px] leading-[18px] text-[#5f6f88]">{item.detail}</p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
