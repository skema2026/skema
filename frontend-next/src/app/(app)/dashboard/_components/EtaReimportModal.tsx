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
import { ScheduleKindToggle, toEtaKind, type EtaScheduleKind } from '@/components/timetable/ScheduleKindToggle';
import { apiErrorMessage } from '@/lib/apiError';
import MaterialIcon from '@/components/common/MaterialIcon';

interface ParsedEntry {
  subject_name: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  location: string;
  source?: string;
  schedule_type: EtaScheduleKind;  // 수업 / 개인 (알바·스터디 등)
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
        schedule_type?: string;
      }>;
      setEntries(parsed.map((e) => ({ ...e, location: e.location ?? '', schedule_type: toEtaKind(e.schedule_type) })));
      if (parsed.length === 0) toast('시간표를 읽지 못했어요. 다른 캡처로 해 보세요');
    } catch (err) {
      toast.error(apiErrorMessage(err, '시간표를 읽지 못했어요'));
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
          entries: valid.map(({ subject_name, day_of_week, start_time, end_time, location, source, schedule_type }) => ({
            subject_name,
            day_of_week,
            start_time,
            end_time,
            location,
            source: source ?? 'eta_image',
            schedule_type,
          })),
        });
      }
      toast.success(`수업 ${valid.length}개를 시간표에 넣었어요`);
      qc.invalidateQueries({ queryKey: ['schedules'] });
      handleClose();
    } catch {
      toast.error('저장하지 못했어요. 다시 시도해 주세요');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open && !confirmOpen} onOpenChange={(o) => !o && handleClose()}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>시간표 다시 가져오기</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
            />

            <div
              onClick={() => fileRef.current?.click()}
              className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed transition-colors hover:bg-[#eaf2ff]"
              style={{
                borderColor: hasFile ? '#2a6fe3' : '#bcd8fe',
                background: hasFile ? '#eaf2ff' : '#f5f8fd',
              }}
            >
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="preview" className="max-h-36 rounded-lg object-contain" />
              ) : (
                <>
                  <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-white text-[#2a6fe3]">
                    <MaterialIcon icon="upload_file" size={18} color="currentColor" />
                  </span>
                  <p className="text-[14px] font-medium text-[#0f1e3a]">시간표 캡처 고르기</p>
                  <p className="text-[12px] text-[#5f6f88]">에브리타임 시간표 화면 캡처</p>
                </>
              )}
            </div>

            {parsing && (
              <div className="flex items-center gap-2 rounded-xl bg-[#eaf2ff] px-4 py-3">
                <div
                  className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-t-transparent"
                  style={{ borderColor: '#bcd8fe', borderTopColor: 'transparent' }}
                />
                <p className="text-[14px] text-[#1f63d6]">시간표를 읽는 중</p>
              </div>
            )}

            {entries.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[12px] text-[#5f6f88]">
                  {entries.length}개 인식 · 알바·스터디 같은 개인 일정은 &lsquo;개인&rsquo;으로 골라 주세요
                </p>
                <div className="overflow-hidden rounded-xl border border-[#0f1e3a]/8">
                  {entries.map((e, i) => (
                    <div
                      key={i}
                      className="flex h-11 items-center gap-2 border-b border-[#0f1e3a]/8 px-3 text-[14px] last:border-b-0"
                    >
                      <span className="w-4 text-center font-medium text-[#1f63d6]">{DAY_KO[e.day_of_week]}</span>
                      <span className="flex-1 truncate text-[#0f1e3a]">{e.subject_name}</span>
                      <span className="font-mono text-[12px] tabular-nums text-[#5f6f88]">{e.start_time}–{e.end_time}</span>
                      <div className="w-24 shrink-0">
                        <ScheduleKindToggle
                          value={e.schedule_type}
                          onChange={(v) =>
                            setEntries((prev) => prev.map((x, j) => (j === i ? { ...x, schedule_type: v } : x)))
                          }
                        />
                      </div>
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
              className="bg-[#2a6fe3] text-white hover:bg-[#1f63d6]"
            >
              {saving ? '저장하는 중' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>시간표 덮어쓰기 확인</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[14px] leading-[22px] text-[#44536b]">
              지금 등록된 수업{' '}
              <span className="font-medium text-[#0f1e3a]">{existingEtaCount}개</span>를 모두 지우고 새로 저장할까요?
            </p>
            <p className="rounded-xl bg-[#f5f8fd] px-4 py-3 text-[13px] text-[#44536b]">
              직접 넣은 개인 일정과 시험은 그대로 남아요
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>취소</Button>
            <Button onClick={doSave} disabled={saving} className="bg-[#dc2626] text-white hover:bg-[#b91c1c]">
              {saving ? '저장하는 중' : '지우고 새로 저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
