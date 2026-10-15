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
        <div className="py-2 space-y-3">
          {items.length === 0 ? (
            <p className="text-sm text-slate-500">이상 없음</p>
          ) : (
            items.map((item) => (
              <div key={item.key} className="rounded-lg border border-slate-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-slate-500">{item.label}</span>
                  <span className="text-sm font-black text-slate-950">{item.value}</span>
                </div>
                <p className="mt-1 text-[11px] font-bold text-slate-400">{item.detail}</p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
