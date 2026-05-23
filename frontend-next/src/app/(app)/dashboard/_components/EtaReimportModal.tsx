'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';

interface ParsedEntry {
  subject_name: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  location: string;
  source?: string;
}

const DAY_KO = ['월', '화', '수', '목', '금', '토', '일'];

interface Props {
  open: boolean;
  onClose: () => void;
  existingEtaCount: number;
}

export function EtaReimportModal({ open, onClose, existingEtaCount }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<ParsedEntry[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hasFile, setHasFile] = useState(false);

  const reset = () => {
    setEntries([]);
    setHasFile(false);
    setPreviewUrl(null);
    setParsing(false);
    setSaving(false);
    setConfirmOpen(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileSelect = async (file: File) => {
    setHasFile(true);
    setPreviewUrl(URL.createObjectURL(file));
    setParsing(true);
    setEntries([]);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/eta/parse-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const parsed = (Array.isArray(res.data) ? res.data : []) as Array<{
        subject_name: string;
        day_of_week: number;
        start_time: string;
        end_time: string;
        location?: string;
        source?: string;
      }>;
      setEntries(parsed.map((e) => ({ ...e, location: e.location ?? '' })));
      if (parsed.length === 0) toast('시간표를 인식하지 못했습니다. 다른 이미지로 시도해 주세요.');
    } catch {
      toast.error('이미지 분석에 실패했습니다.');
    } finally {
      setParsing(false);
    }
  };

  const handleSave = () => {
    if (existingEtaCount > 0) {
      setConfirmOpen(true);
    } else {
      doSave();
    }
  };

  const doSave = async () => {
    setSaving(true);
    setConfirmOpen(false);
    try {
      if (existingEtaCount > 0) {
        await api.delete('/eta/schedules');
      }
      const valid = entries.filter(
        (e) => e.subject_name.trim() && e.start_time && e.end_time && e.start_time < e.end_time,
      );
      if (valid.length > 0) {
        await api.post('/eta/save-schedules', {
          entries: valid.map(({ subject_name, day_of_week, start_time, end_time, location, source }) => ({
            subject_name,
            day_of_week,
            start_time,
            end_time,
            location,
            source: source ?? 'eta_image',
          })),
        });
      }
      toast.success(`${valid.length}개 과목을 시간표에 등록했습니다`);
      qc.invalidateQueries({ queryKey: ['schedules'] });
      handleClose();
    } catch {
      toast.error('저장에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open && !confirmOpen} onOpenChange={(o) => !o && handleClose()}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto border-[#d8e2ef]">
          <DialogHeader>
            <DialogTitle>강의 시간표 재업로드</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
            />

            <div
              onClick={() => fileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-colors hover:bg-blue-50"
              style={{
                minHeight: 120,
                borderColor: hasFile ? '#2563eb' : '#d1d5db',
                background: hasFile ? '#eef1ff' : '#fafbfc',
              }}
            >
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="preview" className="max-h-36 rounded-lg object-contain" />
              ) : (
                <>
                  <span style={{ fontSize: 30 }}>📷</span>
                  <p className="text-sm font-semibold text-slate-600">클릭해서 시간표 이미지 선택</p>
                  <p className="text-xs text-slate-400">에브리타임 스크린샷 권장</p>
                </>
              )}
            </div>

            {parsing && (
              <div className="flex items-center gap-2 rounded-lg p-3" style={{ background: '#eef1ff' }}>
                <div
                  className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-t-transparent"
                  style={{ borderColor: '#c3d0ff', borderTopColor: 'transparent' }}
                />
                <p className="text-sm font-semibold text-blue-700">AI가 시간표를 분석하고 있습니다...</p>
              </div>
            )}

            {entries.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-slate-500">{entries.length}개 과목 인식됨</p>
                <div className="overflow-hidden rounded-lg border">
                  {entries.map((e, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
                      style={{ background: i % 2 ? '#f8fbff' : '#fff' }}
                    >
                      <span className="w-4 text-center font-bold text-blue-700">{DAY_KO[e.day_of_week]}</span>
                      <span className="flex-1 truncate font-medium">{e.subject_name}</span>
                      <span className="text-xs text-slate-400">{e.start_time}–{e.end_time}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>취소</Button>
            <Button
              onClick={handleSave}
              disabled={entries.length === 0 || parsing || saving}
              style={{ background: '#2563eb', color: '#fff' }}
            >
              {saving ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(false)}>
        <DialogContent className="max-w-sm border-[#d8e2ef]">
          <DialogHeader>
            <DialogTitle>시간표 덮어쓰기 확인</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <p className="text-sm text-slate-600">
              기존에 등록된 강의 시간표{' '}
              <strong className="text-slate-900">{existingEtaCount}개</strong>를 모두 삭제하고
              새로 업로드하겠습니까?
            </p>
            <p className="text-xs rounded-lg px-3 py-2" style={{ background: '#f0fdf4', color: '#166534' }}>
              ✓ 개인 일정은 삭제되지 않고 그대로 유지됩니다.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>취소</Button>
            <Button onClick={doSave} disabled={saving} style={{ background: '#ef4444', color: '#fff' }}>
              {saving ? '저장 중...' : '기존 삭제 후 새로 저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
