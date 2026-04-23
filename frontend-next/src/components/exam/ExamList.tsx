'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useExams, useCreateExam, useUpdateExam, useDeleteExam } from '@/hooks/useExams';
import { formatDate } from '@/lib/utils';
import { ExamSchedule, Schedule } from '@/types';
import { api } from '@/lib/api';

function getDaysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const examDate = new Date(dateStr);
  examDate.setHours(0, 0, 0, 0);
  return Math.ceil((examDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function dateStrFromObj(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function isAm(time: string): boolean {
  const h = parseInt(time.split(':')[0] ?? '9', 10);
  return h < 12;
}

function applyAmPm(time: string, period: 'am' | 'pm'): string {
  const [hStr, mStr] = time.split(':');
  let h = parseInt(hStr ?? '9', 10);
  const m = parseInt(mStr ?? '0', 10);
  if (period === 'am' && h >= 12) h -= 12;
  if (period === 'pm' && h < 12) h += 12;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function AmPmToggle({ time, onChange }: { time: string; onChange: (t: string) => void }) {
  const am = isAm(time);
  const base: React.CSSProperties = { padding: '6px 14px', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', transition: 'background 0.15s, color 0.15s' };
  return (
    <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e7eb', flexShrink: 0 }}>
      <button type="button" onClick={() => onChange(applyAmPm(time, 'am'))}
        style={{ ...base, background: am ? 'var(--skema-primary)' : '#f9fafb', color: am ? '#fff' : '#747684' }}>오전</button>
      <button type="button" onClick={() => onChange(applyAmPm(time, 'pm'))}
        style={{ ...base, background: !am ? 'var(--skema-primary)' : '#f9fafb', color: !am ? '#fff' : '#747684', borderLeft: '1px solid #e5e7eb' }}>오후</button>
    </div>
  );
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

function getSchedulesForDate(allSchedules: Schedule[], dateStr: string): Schedule[] {
  const d = new Date(dateStr + 'T00:00:00');
  const jsDay = d.getDay();
  const dow = jsDay === 0 ? 6 : jsDay - 1;
  return allSchedules.filter(s => {
    if (s.date === dateStr) return true;
    if (!s.date && s.day_of_week === dow) return true;
    return false;
  });
}

function getTotalBusyMinutes(schedules: Schedule[]): number {
  return schedules.reduce((sum, s) => {
    if (s.start_time && s.end_time) {
      return sum + Math.max(0, timeToMinutes(s.end_time) - timeToMinutes(s.start_time));
    }
    return sum + 60;
  }, 0);
}

// 기존 일정을 피해 가장 여유로운 빈 슬롯 자동 탐색 (06:00~23:00, 30분 단위)
function findFreeSlot(
  schedules: Schedule[],
  durationMin: number,
): { start_time: string; end_time: string } {
  const occupied: [number, number][] = schedules
    .filter(s => s.start_time && s.end_time)
    .map(s => [timeToMinutes(s.start_time!), timeToMinutes(s.end_time!)]);

  const isFree = (start: number) => {
    const end = start + durationMin;
    return end <= 23 * 60 && start >= 6 * 60 && !occupied.some(([s, e]) => s < end && e > start);
  };

  // 저녁 시간대(18~22시)부터 탐색 → 없으면 오후 → 오전 순으로 확장
  const PREFERRED_STARTS = [18 * 60, 19 * 60, 20 * 60, 17 * 60, 21 * 60, 14 * 60, 15 * 60, 16 * 60, 13 * 60, 9 * 60, 10 * 60, 11 * 60, 8 * 60, 7 * 60, 6 * 60];
  for (const start of PREFERRED_STARTS) {
    if (isFree(start)) return { start_time: minutesToTime(start), end_time: minutesToTime(start + durationMin) };
  }
  // 30분 단위 전수 탐색
  for (let start = 6 * 60; start + durationMin <= 23 * 60; start += 30) {
    if (isFree(start)) return { start_time: minutesToTime(start), end_time: minutesToTime(start + durationMin) };
  }

  return { start_time: '20:00', end_time: minutesToTime(20 * 60 + durationMin) };
}

function ExamBadge({ days }: { days: number }) {
  if (days < 0) return <Badge variant="secondary">종료</Badge>;
  if (days === 0) return <Badge className="bg-red-500 hover:bg-red-600">오늘</Badge>;
  if (days <= 3) return <Badge className="bg-orange-500 hover:bg-orange-600">{days}일 후</Badge>;
  if (days <= 7) return <Badge className="bg-yellow-500 hover:bg-yellow-600">{days}일 후</Badge>;
  return <Badge variant="outline">{days}일 후</Badge>;
}

const defaultForm = {
  title: '',
  exam_date: '',
  exam_time: '09:00',
  exam_duration_minutes: '120',
  location: '',
};

// 0 = 지금부터(시험 전날까지), 나머지는 D-N
const BLOCK_DAYS_OPTIONS = [
  { value: 0,  label: '지금부터' },
  { value: 7,  label: 'D-7' },
  { value: 14, label: 'D-14' },
  { value: 21, label: 'D-21' },
  { value: 30, label: 'D-30' },
  { value: 60, label: 'D-60' },
  { value: 90, label: 'D-90' },
] as const;

export function ExamList() {
  const { data: exams, isLoading } = useExams();
  const createExam = useCreateExam();
  const updateExam = useUpdateExam();
  const deleteExam = useDeleteExam();
  const queryClient = useQueryClient();

  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 상세/편집 다이얼로그
  const [detailExam, setDetailExam] = useState<ExamSchedule | null>(null);
  const [editForm, setEditForm] = useState(defaultForm);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  const openDetail = (exam: ExamSchedule) => {
    setDetailExam(exam);
    setEditForm({
      title: exam.title,
      exam_date: exam.exam_date,
      exam_time: exam.exam_time ?? '09:00',
      exam_duration_minutes: String(exam.exam_duration_minutes ?? 120),
      location: exam.location ?? '',
    });
    setEditErrors({});
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailExam) return;
    const errs: Record<string, string> = {};
    if (!editForm.title.trim()) errs.title = '시험 이름을 입력해주세요';
    if (!editForm.exam_date) errs.exam_date = '날짜를 선택해주세요';
    setEditErrors(errs);
    if (Object.keys(errs).length > 0) return;

    updateExam.mutate({
      id: detailExam.id,
      title: editForm.title,
      exam_date: editForm.exam_date,
      exam_time: editForm.exam_time || undefined,
      exam_duration_minutes: editForm.exam_duration_minutes ? Number(editForm.exam_duration_minutes) : 120,
      location: editForm.location || undefined,
    }, {
      onSuccess: (updated) => {
        toast.success('시험 일정이 수정되었습니다');
        setDetailExam(updated);
      },
      onError: () => toast.error('수정 중 오류가 발생했습니다'),
    });
  };

  const [blockExam, setBlockExam] = useState<ExamSchedule | null>(null);
  const [blockDays, setBlockDays] = useState<number>(14);      // 0 = 지금부터
  const [daysPerWeek, setDaysPerWeek] = useState<number>(3);   // 1~7
  const [studyMinutes, setStudyMinutes] = useState(120);        // 30분 단위
  const [isBlocking, setIsBlocking] = useState(false);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!form.title.trim()) newErrors.title = '시험 이름을 입력해주세요';
    if (!form.exam_date) newErrors.exam_date = '시험 날짜를 선택해주세요';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const payload: Omit<ExamSchedule, 'id' | 'user_id'> = {
      title: form.title,
      exam_date: form.exam_date,
      exam_time: form.exam_time || undefined,
      exam_duration_minutes: form.exam_duration_minutes ? Number(form.exam_duration_minutes) : 120,
      location: form.location || undefined,
    };

    createExam.mutate(payload, {
      onSuccess: (exam) => {
        setIsOpen(false);
        setForm(defaultForm);
        setErrors({});
        toast.success('시험 일정이 추가되었습니다');
        setBlockExam(exam);
      },
      onError: () => toast.error('추가 중 오류가 발생했습니다'),
    });
  };

  const handleDelete = (id: number) => {
    const allSchedules = queryClient.getQueryData<Schedule[]>(['schedules']) ?? [];
    const linked = allSchedules.filter(s => s.linked_exam_id === id);
    const msg = linked.length > 0
      ? `시험 일정과 연결된 공부 블록 ${linked.length}개도 함께 삭제됩니다.`
      : '시험 일정을 삭제하시겠습니까?';
    if (!confirm(msg)) return;

    deleteExam.mutate(id, {
      onSuccess: async () => {
        for (const s of linked) {
          try { await api.delete(`/schedules/${s.id}`); } catch { /* ignore */ }
        }
        queryClient.invalidateQueries({ queryKey: ['schedules'] });
        queryClient.invalidateQueries({ queryKey: ['schedules', 'today'] });
        toast.success(
          linked.length > 0
            ? `시험 일정과 공부 블록 ${linked.length}개가 삭제되었습니다`
            : '시험 일정이 삭제되었습니다'
        );
      },
      onError: () => toast.error('삭제 중 오류가 발생했습니다'),
    });
  };

  const handleCreateBlocks = async () => {
    if (!blockExam) return;
    if (studyMinutes < 30) { toast.error('공부 시간을 30분 이상으로 설정해주세요'); return; }

    setIsBlocking(true);
    try {
      const examDateObj = new Date(blockExam.exam_date + 'T00:00:00');
      const actualDays = blockDays === 0
        ? Math.max(1, getDaysUntil(blockExam.exam_date))
        : blockDays;

      const candidateDays: string[] = [];
      for (let d = actualDays; d >= 1; d--) {
        const day = new Date(examDateObj);
        day.setDate(examDateObj.getDate() - d);
        candidateDays.push(dateStrFromObj(day));
      }

      const allSchedules = queryClient.getQueryData<Schedule[]>(['schedules']) ?? [];

      const chosenDays: string[] = [];
      for (let i = 0; i < candidateDays.length; i += 7) {
        const week = candidateDays.slice(i, i + 7);
        if (daysPerWeek >= 7) {
          chosenDays.push(...week);
        } else {
          const scored = week.map(day => ({
            day,
            busy: getTotalBusyMinutes(getSchedulesForDate(allSchedules, day)),
          }));
          scored.sort((a, b) => a.busy - b.busy);
          chosenDays.push(...scored.slice(0, daysPerWeek).map(x => x.day).sort());
        }
      }

      let created = 0;
      for (const dateStr of chosenDays) {
        const jsDay = new Date(dateStr + 'T00:00:00').getDay();
        const dow = jsDay === 0 ? 6 : jsDay - 1;
        const daySchedules = getSchedulesForDate(allSchedules, dateStr);
        const { start_time, end_time } = findFreeSlot(daySchedules, studyMinutes);

        await api.post('/schedules', {
          title: `📖 ${blockExam.title} 준비`,
          day_of_week: dow,
          date: dateStr,
          start_time,
          end_time,
          schedule_type: 'study',
          schedule_source: 'user_created',
          linked_exam_id: blockExam.id,
          color: '#059669',
        });
        created++;
      }

      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      queryClient.invalidateQueries({ queryKey: ['schedules', 'today'] });
      toast.success(`빈 시간에 공부 블록 ${created}개를 자동 배치했습니다 ✅`);
      setBlockExam(null);
    } catch {
      toast.error('일정 생성 중 오류가 발생했습니다');
    } finally {
      setIsBlocking(false);
    }
  };

  const sortedExams = [...(exams || [])].sort(
    (a, b) => new Date(a.exam_date).getTime() - new Date(b.exam_date).getTime()
  );

  const btnStyle = (active: boolean) => ({
    borderColor: active ? '#059669' : '#ebeef1',
    background: active ? '#d1fae5' : '#fff',
    color: active ? '#059669' : '#747684',
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--skema-on-surface)' }}>시험 일정</h2>
          <p style={{ fontSize: 11, color: 'var(--skema-outline-strong)', marginTop: 2 }}>
            시험을 추가하고 공부 시간을 캘린더에 자동으로 넣어보세요
          </p>
        </div>
        <button
          onClick={() => setIsOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--skema-primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          + 시험 추가
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-8" style={{ color: 'var(--skema-outline-strong)', fontSize: 13 }}>로딩 중...</div>
      ) : sortedExams.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📅</div>
          <p style={{ fontSize: 13, color: 'var(--skema-outline-strong)' }}>등록된 시험 일정이 없습니다</p>
          <p style={{ fontSize: 12, color: 'var(--skema-outline-strong)', marginTop: 4, opacity: 0.7 }}>시험을 추가하면 공부 시간을 캘린더에 자동으로 배치할 수 있어요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedExams.map((exam) => {
            const days = getDaysUntil(exam.exam_date);
            const urgency = days <= 3 ? '#fef2f2' : days <= 7 ? '#fffbeb' : '#f7fafd';
            return (
              <div
                key={exam.id}
                onClick={() => openDetail(exam)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--skema-container)', background: urgency, gap: 12, cursor: 'pointer' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--skema-on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exam.title}</p>
                    {exam.subject && (
                      <span style={{ fontSize: 11, fontWeight: 600, background: 'var(--skema-secondary-container)', color: 'var(--skema-primary)', borderRadius: 6, padding: '1px 7px', flexShrink: 0 }}>{exam.subject}</span>
                    )}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--skema-outline-strong)' }}>
                    {formatDate(exam.exam_date)}
                    {exam.exam_time && ` ${exam.exam_time}`}
                    {exam.location && ` • ${exam.location}`}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <ExamBadge days={days} />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(exam.id); }}
                    style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 시험 상세/편집 다이얼로그 */}
      <Dialog open={!!detailExam && !blockExam} onOpenChange={(open) => { if (!open) { setDetailExam(null); setEditErrors({}); } }}>
        <DialogContent className="max-w-sm" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
          <DialogHeader>
            <DialogTitle>시험 상세</DialogTitle>
          </DialogHeader>
          {detailExam && (() => {
            const days = getDaysUntil(detailExam.exam_date);
            const linkedBlocks = (queryClient.getQueryData<Schedule[]>(['schedules']) ?? [])
              .filter(s => s.linked_exam_id === detailExam.id);
            return (
              <form onSubmit={handleUpdate} className="space-y-4 py-2">
                {/* D-day 배지 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ExamBadge days={days} />
                  {linkedBlocks.length > 0 && (
                    <span style={{ fontSize: 11, color: '#059669', background: '#d1fae5', borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>
                      📖 공부 블록 {linkedBlocks.length}개
                    </span>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="edit-title">시험 이름 *</Label>
                  <Input id="edit-title" value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className={editErrors.title ? 'border-red-500' : ''} />
                  {editErrors.title && <p className="text-red-500 text-xs">{editErrors.title}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-date">시험 날짜 *</Label>
                  <Input id="edit-date" type="date" value={editForm.exam_date} onChange={(e) => setEditForm({ ...editForm, exam_date: e.target.value })} className={editErrors.exam_date ? 'border-red-500' : ''} />
                  {editErrors.exam_date && <p className="text-red-500 text-xs">{editErrors.exam_date}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label>시험 시간</Label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <AmPmToggle time={editForm.exam_time} onChange={(t) => setEditForm({ ...editForm, exam_time: t })} />
                    <Input type="time" value={editForm.exam_time} onChange={(e) => setEditForm({ ...editForm, exam_time: e.target.value })} style={{ flex: 1 }} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-duration">시험 시간(분)</Label>
                  <Input id="edit-duration" type="number" min="30" max="360" step="30" placeholder="120" value={editForm.exam_duration_minutes} onChange={(e) => setEditForm({ ...editForm, exam_duration_minutes: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-location">장소 (선택)</Label>
                  <Input id="edit-location" placeholder="시험 장소" value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} />
                </div>

                <DialogFooter className="flex-col gap-2 sm:flex-row">
                  {days > 0 && (
                    <Button
                      type="button"
                      onClick={() => { setBlockExam(detailExam); setDetailExam(null); }}
                      style={{ background: '#d1fae5', color: '#059669', border: 'none', fontWeight: 700 }}
                      className="w-full sm:w-auto"
                    >
                      📖 공부 예약
                    </Button>
                  )}
                  <div className="flex gap-2 w-full sm:w-auto">
                    <Button type="button" variant="outline" onClick={() => setDetailExam(null)} className="flex-1">닫기</Button>
                    <Button type="submit" disabled={updateExam.isPending} style={{ background: 'var(--skema-primary)', color: '#fff' }} className="flex-1">
                      {updateExam.isPending ? '저장 중...' : '저장'}
                    </Button>
                  </div>
                </DialogFooter>
              </form>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* 시험 추가 다이얼로그 */}
      <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) { setForm(defaultForm); setErrors({}); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>시험 일정 추가</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="exam-title">시험 이름 *</Label>
              <Input
                id="exam-title"
                placeholder="예: 중간고사, 기말시험, 토익"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className={errors.title ? 'border-red-500' : ''}
              />
              {errors.title && <p className="text-red-500 text-xs">{errors.title}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exam-date">시험 날짜 *</Label>
              <Input
                id="exam-date"
                type="date"
                value={form.exam_date}
                onChange={(e) => setForm({ ...form, exam_date: e.target.value })}
                className={errors.exam_date ? 'border-red-500' : ''}
              />
              {errors.exam_date && <p className="text-red-500 text-xs">{errors.exam_date}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>시험 시간</Label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <AmPmToggle time={form.exam_time} onChange={(t) => setForm({ ...form, exam_time: t })} />
                <Input type="time" value={form.exam_time} onChange={(e) => setForm({ ...form, exam_time: e.target.value })} style={{ flex: 1 }} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exam-duration">시험 시간(분)</Label>
              <Input id="exam-duration" type="number" min="30" max="360" step="30" placeholder="120" value={form.exam_duration_minutes} onChange={(e) => setForm({ ...form, exam_duration_minutes: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exam-location">장소 (선택)</Label>
              <Input id="exam-location" placeholder="시험 장소" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>취소</Button>
              <Button type="submit" disabled={createExam.isPending} style={{ background: 'var(--skema-primary)', color: '#fff' }}>
                {createExam.isPending ? '저장 중...' : '추가'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 공부 시간 자동 배치 다이얼로그 */}
      <Dialog open={!!blockExam} onOpenChange={(open) => { if (!open) setBlockExam(null); }}>
        <DialogContent className="max-w-sm" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
          <DialogHeader>
            <DialogTitle>공부 시간 자동 배치</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-4">
            {blockExam && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: '#f7fafd', border: '1px solid #ebeef1' }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#181c1e' }}>{blockExam.title}</p>
                <p style={{ fontSize: 11, color: '#747684', marginTop: 2 }}>
                  {formatDate(blockExam.exam_date)} · D-{getDaysUntil(blockExam.exam_date)}
                </p>
              </div>
            )}

            {/* 시작 시점 */}
            <div className="space-y-1.5">
              <Label>언제부터</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {BLOCK_DAYS_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setBlockDays(value)}
                    className="py-1.5 text-xs font-semibold rounded-lg border-2 transition-colors"
                    style={{ ...btnStyle(blockDays === value), padding: '6px 10px' }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 주 며칠 */}
            <div className="space-y-1.5">
              <Label>주 며칠</Label>
              <div style={{ display: 'flex', gap: 4 }}>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDaysPerWeek(d)}
                    className="flex-1 py-1.5 text-xs font-semibold rounded-lg border-2 transition-colors"
                    style={btnStyle(daysPerWeek === d)}
                  >
                    {d === 7 ? '매일' : `${d}일`}
                  </button>
                ))}
              </div>
            </div>

            {/* 하루 공부 시간 */}
            <div className="space-y-1.5">
              <Label htmlFor="study-minutes">하루 공부 시간</Label>
              <select
                id="study-minutes"
                value={studyMinutes}
                onChange={(e) => setStudyMinutes(Number(e.target.value))}
                style={{ width: '100%', padding: '7px 10px', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 8, outline: 'none', background: '#fff' }}
              >
                {Array.from({ length: 24 }, (_, i) => (i + 1) * 30).map((m) => (
                  <option key={m} value={m}>{formatDuration(m)}</option>
                ))}
              </select>
            </div>

            <div style={{ fontSize: 11, color: '#747684', background: '#f0fdf4', padding: '8px 12px', borderRadius: 8, lineHeight: 1.7, border: '1px solid #bbf7d0' }}>
              기존 일정을 피해 <strong style={{ color: '#059669' }}>비어있는 시간에 자동 배치</strong>합니다<br />
              {blockDays === 0 ? '오늘부터' : `D-${blockDays}부터`} · 주 {daysPerWeek === 7 ? '매일' : `${daysPerWeek}일`} · {formatDuration(studyMinutes)}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockExam(null)}>건너뛰기</Button>
            <Button onClick={handleCreateBlocks} disabled={isBlocking} style={{ background: '#059669', color: '#fff' }}>
              {isBlocking ? '배치 중...' : '자동 배치'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
