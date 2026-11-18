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
import { normalizeTimeString } from '@/lib/utils';
import MaterialIcon from '@/components/common/MaterialIcon';

interface ParsedEntry {
  _id: string;                     // 화면에서 줄을 구분하는 값 (저장하지 않음)
  subject_name: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  location: string;
  source?: string;
  schedule_type: EtaScheduleKind;  // 수업 / 개인 (알바·스터디 등)
}

const DAY_KO = ['월', '화', '수', '목', '금', '토', '일'];

// 넓은 화면의 칸 배치: 과목명 · 종류 · 요일 · 시작 · 종료 · 강의실 · 지우기
const ROW_GRID = 'sm:grid-cols-[minmax(0,2fr)_96px_88px_124px_124px_minmax(0,1fr)_32px]';
const FIELD =
  'h-9 w-full rounded-lg border border-[#dfe7f3] bg-[#f5f8fd] px-2 text-base text-[#0f1e3a] outline-none focus:border-[#2a6fe3] sm:text-[14px]';

const isEntryValid = (e: ParsedEntry) =>
  Boolean(e.subject_name.trim()) && Boolean(e.start_time) && Boolean(e.end_time) && e.start_time < e.end_time;

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
  // 11/19: 시간표 초기화 (에타에서 가져온 수업·일정만 지운다)
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hasFile, setHasFile] = useState(false);

  const reset = () => {
    setEntries([]);
    setHasFile(false);
    setPreviewUrl(null);
    setParsing(false);
    setSaving(false);
    setConfirmOpen(false);
    setResetOpen(false);
    setResetting(false);
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
      setEntries(
        parsed.map((e, i) => ({
          ...e,
          _id: `eta-${Date.now()}-${i}`,
          start_time: normalizeTimeString(e.start_time) || e.start_time,
          end_time: normalizeTimeString(e.end_time) || e.end_time,
          location: e.location ?? '',
          schedule_type: toEtaKind(e.schedule_type),
        })),
      );
      if (parsed.length === 0) toast('시간표를 읽지 못했어요. 다른 캡처로 해 보세요');
    } catch (err) {
      toast.error(apiErrorMessage(err, '시간표를 읽지 못했어요'));
    } finally {
      setParsing(false);
    }
  };

  // 11/19: 인식이 틀린 칸을 이 창에서 바로 고치고, 빠진 수업은 추가하고, 잘못 읽은 줄은 지운다
  const updateEntry = <K extends keyof ParsedEntry>(id: string, key: K, value: ParsedEntry[K]) =>
    setEntries((prev) => prev.map((x) => (x._id === id ? { ...x, [key]: value } : x)));
  const removeEntry = (id: string) => setEntries((prev) => prev.filter((x) => x._id !== id));
  const addEntry = () =>
    setEntries((prev) => [
      ...prev,
      {
        _id: `new-${Date.now()}`,
        subject_name: '',
        day_of_week: 0,
        start_time: '09:00',
        end_time: '10:30',
        location: '',
        source: 'manual',
        schedule_type: 'class',
      },
    ]);
  const invalidCount = entries.filter((e) => !isEntryValid(e)).length;

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
      const valid = entries.filter(isEntryValid);
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

  const doReset = async () => {
    setResetting(true);
    try {
      await api.delete('/eta/schedules');
      toast.success('시간표를 비웠어요');
      qc.invalidateQueries({ queryKey: ['schedules'] });
      handleClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, '시간표를 비우지 못했어요. 다시 시도해 주세요'));
      setResetting(false);
    }
  };

  return (
    <>
      <Dialog open={open && !confirmOpen && !resetOpen} onOpenChange={(o) => !o && handleClose()}>
        {/* 11/19: 기본 대화창 폭(sm:max-w-sm, 384px)이 그대로 적용돼 좁았다 → 넓게 */}
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>시간표 수정</DialogTitle>
          </DialogHeader>
          <p className="-mt-2 text-[13px] text-[#5f6f88]">
            다른 학기 캡처를 올리면 지금 수업을 새 시간표로 바꿔요
          </p>

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
                <img src={previewUrl} alt="올린 시간표 캡처" className="max-h-64 rounded-lg object-contain" />
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

            {hasFile && !parsing && (
              <div className="space-y-2">
                <p className="text-[12px] leading-[18px] text-[#5f6f88]">
                  {entries.length}개 읽음 · 틀린 칸은 눌러서 고치고, 빠진 수업은 아래에서 추가해 주세요.
                  알바·스터디 같은 개인 일정은 &lsquo;개인&rsquo;으로 골라 주세요
                </p>
                <div className="overflow-hidden rounded-xl border border-[#0f1e3a]/8">
                  <div
                    className={`hidden gap-2 border-b border-[#0f1e3a]/8 bg-[#f5f8fd] px-3 py-2 text-[12px] font-medium text-[#44536b] sm:grid ${ROW_GRID}`}
                  >
                    <span>과목명</span>
                    <span>종류</span>
                    <span>요일</span>
                    <span>시작</span>
                    <span>종료</span>
                    <span>강의실</span>
                    <span />
                  </div>
                  {entries.length === 0 && (
                    <p className="px-4 py-6 text-center text-[13px] text-[#5f6f88]">
                      읽은 수업이 없어요. 아래 &lsquo;수업 추가&rsquo;로 직접 넣어 주세요
                    </p>
                  )}
                  <div className="divide-y divide-[#0f1e3a]/8">
                    {entries.map((e) => (
                      <div key={e._id} className={`grid grid-cols-2 items-center gap-2 px-3 py-3 sm:py-2 ${ROW_GRID}`}>
                        <input
                          type="text"
                          value={e.subject_name}
                          onChange={(ev) => updateEntry(e._id, 'subject_name', ev.target.value)}
                          placeholder="과목명"
                          aria-label="과목명"
                          className={`${FIELD} col-span-2 sm:col-span-1 ${e.subject_name.trim() ? '' : 'border-[#fecaca]'}`}
                        />
                        <ScheduleKindToggle
                          value={e.schedule_type}
                          onChange={(v) => updateEntry(e._id, 'schedule_type', v)}
                        />
                        <select
                          value={e.day_of_week}
                          onChange={(ev) => updateEntry(e._id, 'day_of_week', Number(ev.target.value))}
                          aria-label="요일"
                          className={FIELD}
                        >
                          {DAY_KO.map((d, i) => (
                            <option key={d} value={i}>{d}요일</option>
                          ))}
                        </select>
                        <input
                          type="time"
                          step="300"
                          value={e.start_time}
                          onChange={(ev) => updateEntry(e._id, 'start_time', ev.target.value)}
                          aria-label="시작 시간"
                          className={FIELD}
                        />
                        <input
                          type="time"
                          step="300"
                          value={e.end_time}
                          onChange={(ev) => updateEntry(e._id, 'end_time', ev.target.value)}
                          aria-label="종료 시간"
                          className={`${FIELD} ${e.start_time && e.end_time && e.start_time >= e.end_time ? 'border-[#fecaca]' : ''}`}
                        />
                        <input
                          type="text"
                          value={e.location}
                          onChange={(ev) => updateEntry(e._id, 'location', ev.target.value)}
                          placeholder="강의실"
                          aria-label="강의실"
                          className={FIELD}
                        />
                        <button
                          type="button"
                          onClick={() => removeEntry(e._id)}
                          aria-label={`${e.subject_name || '이 줄'} 지우기`}
                          className="flex h-9 items-center justify-center gap-1 rounded-lg bg-[#fef2f2] text-[13px] text-[#dc2626] hover:bg-[#fee2e2] sm:w-8"
                        >
                          <MaterialIcon icon="delete" size={14} color="currentColor" />
                          <span className="sm:hidden">지우기</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addEntry}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#bcd8fe] py-2.5 text-[13px] font-medium text-[#2a6fe3] hover:bg-[#eaf2ff]"
                >
                  <MaterialIcon icon="add" size={14} color="currentColor" />
                  수업 추가
                </button>
                {invalidCount > 0 && (
                  <p className="text-[12px] text-[#dc2626]">
                    과목명이 비었거나 끝나는 시간이 시작보다 빠른 줄이 {invalidCount}개 있어요. 고치거나 지워 주세요
                  </p>
                )}
              </div>
            )}

            {existingEtaCount > 0 && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-[#0f1e3a]/8 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-[#0f1e3a]">시간표 초기화</p>
                  <p className="text-[12px] text-[#5f6f88]">에타에서 가져온 수업·일정 {existingEtaCount}개를 모두 지워요</p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setResetOpen(true)}
                  disabled={parsing || saving}
                  className="shrink-0 border-[#fecaca] text-[#dc2626] hover:bg-[#fef2f2] hover:text-[#b91c1c]"
                >
                  <MaterialIcon icon="delete" size={14} color="currentColor" />
                  초기화
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>취소</Button>
            <Button
              onClick={handleSave}
              disabled={entries.length === 0 || invalidCount > 0 || parsing || saving}
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

      <Dialog open={resetOpen} onOpenChange={(o) => !o && !resetting && setResetOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>시간표 초기화</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[14px] leading-[22px] text-[#44536b]">
              에타에서 가져온 수업·일정{' '}
              <span className="font-medium text-[#0f1e3a]">{existingEtaCount}개</span>를 모두 지울까요? 되돌릴 수 없어요.
            </p>
            <p className="rounded-xl bg-[#f5f8fd] px-4 py-3 text-[13px] text-[#44536b]">
              직접 넣은 일정, 시험, 공부 블록과 완료 기록은 그대로 남아요
            </p>
            <p className="text-[12px] leading-[18px] text-[#5f6f88]">
              이제 대학생이 아니라면 프로필에서 &lsquo;대학생 시간표 모드&rsquo;를 끄면 시간표 등록 안내가 더 이상 뜨지 않아요
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)} disabled={resetting}>취소</Button>
            <Button onClick={doReset} disabled={resetting} className="bg-[#dc2626] text-white hover:bg-[#b91c1c]">
              {resetting ? '지우는 중' : '초기화'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
