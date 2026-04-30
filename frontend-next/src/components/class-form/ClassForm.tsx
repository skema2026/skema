
'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUIStore } from '@/store/uiStore';
import { useCreateSchedule, useDeleteSchedule, useUpdateSchedule } from '@/hooks/useSchedules';
import {
  DAY_NAMES_FULL,
  PRIORITY_LABELS,
  cn,
} from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ALL_SCHEDULE_COLORS, getAutoColor } from '@/lib/scheduleColor';
import { dateStringToRecurringDay, recurringDayToIndex, indexToRecurringDay } from '@/lib/recurringDay';
import { RecurringDay, Schedule } from '@/types';

const SCHEDULE_TYPE_OPTIONS = [
  { value: 'class',      label: '수업',     icon: '📚', desc: '강의·실습' },
  { value: 'study',      label: '자율학습', icon: '✏️', desc: '복습·공부' },
  { value: 'assignment', label: '과제',     icon: '📋', desc: '제출·마감' },
  { value: 'activity',   label: '활동',     icon: '🏃', desc: '동아리·알바' },
  { value: 'personal',   label: '개인',     icon: '🏠', desc: '약속·기타' },
] as const;

const defaultForm = {
  title: '',
  schedule_type: 'class' as Schedule['schedule_type'],
  recurring_day: 'MON' as RecurringDay,
  date: '',
  start_time: '09:00',
  end_time: '10:00',
  location: '',
  color: '#6366F1',
  priority: 0 as Schedule['priority'],
  is_completed: false,
};

function timesOverlap(s1: string, e1: string, s2: string, e2: string): boolean {
  return s1 < e2 && s2 < e1;
}

function findConflict(
  form: typeof defaultForm,
  isRecurring: boolean,
  selectedDays: RecurringDay[],
  schedules: Schedule[],
  excludeId?: number,
): Schedule | null {
  for (const s of schedules) {
    if (s.id === excludeId) continue;
    if (!timesOverlap(form.start_time, form.end_time, s.start_time, s.end_time)) continue;

    const formDays = isRecurring
      ? selectedDays
      : [form.date ? dateStringToRecurringDay(form.date) : form.recurring_day];
    const scheduleDay = s.date ? dateStringToRecurringDay(s.date) : s.recurring_day;

    if (!formDays.includes(scheduleDay)) continue;

    // 특정날짜 vs 특정날짜면 날짜도 정확히 일치해야 함
    if (!isRecurring && form.date && s.date && form.date !== s.date) continue;

    return s;
  }
  return null;
}

export function ClassForm() {
  const { isClassFormOpen, editingSchedule, closeClassForm } = useUIStore();
  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const deleteSchedule = useDeleteSchedule();
  const qc = useQueryClient();

  const [form, setForm] = useState(defaultForm);
  const [selectedDays, setSelectedDays] = useState<RecurringDay[]>([defaultForm.recurring_day]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // true = color was not manually overridden by the user; auto-follows title hash
  const [isAutoColor, setIsAutoColor] = useState(true);
  // true = 매주 반복(요일 기반), false = 특정 날짜 1회
  const [isRecurring, setIsRecurring] = useState(true);

  useEffect(() => {
    if (editingSchedule) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsAutoColor(false); // editing: keep stored color as-is
      const hasDate = !!editingSchedule.date;
      setIsRecurring(!hasDate);
      setForm({
        title: editingSchedule.title,
        schedule_type: editingSchedule.schedule_type,
        recurring_day: editingSchedule.recurring_day,
        date: editingSchedule.date || '',
        start_time: editingSchedule.start_time,
        end_time: editingSchedule.end_time,
        location: editingSchedule.location || '',
        color: editingSchedule.color,
        priority: editingSchedule.priority,
        is_completed: editingSchedule.is_completed,
      });
      setSelectedDays([editingSchedule.recurring_day]);
    } else {
      setIsAutoColor(true); // new schedule: auto-derive from title
      setIsRecurring(true);
      setForm(defaultForm);
      setSelectedDays([defaultForm.recurring_day]);
    }
    setErrors({});
  }, [editingSchedule, isClassFormOpen]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!form.title.trim()) newErrors.title = '제목을 입력해주세요';
    if (isRecurring && selectedDays.length === 0) newErrors.days = '요일을 최소 1개 이상 선택해주세요';
    if (!isRecurring && !form.date) newErrors.date = '날짜를 선택해주세요';
    if (!form.start_time) newErrors.start_time = '시작 시간을 입력해주세요';
    if (!form.end_time) newErrors.end_time = '종료 시간을 입력해주세요';
    if (form.start_time >= form.end_time) newErrors.end_time = '종료 시간은 시작 시간 이후여야 합니다';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const allSchedules = qc.getQueryData<Schedule[]>(['schedules']) ?? [];
    const conflicting = findConflict(form, isRecurring, selectedDays, allSchedules, editingSchedule?.id);
    if (conflicting) {
      setErrors((prev) => ({
        ...prev,
        conflict: `"${conflicting.title}"과(와) 시간이 겹칩니다 (${conflicting.start_time}–${conflicting.end_time})`,
      }));
      return;
    }

    const payload = {
      title: form.title,
      schedule_type: form.schedule_type,
      recurring_day: isRecurring ? selectedDays[0] : form.recurring_day,
      days: isRecurring ? selectedDays : undefined,
      date: isRecurring ? undefined : (form.date || undefined),
      start_time: form.start_time,
      end_time: form.end_time,
      location: form.location || undefined,
      color: form.color,
      priority: form.priority,
      is_completed: form.is_completed,
    };

    if (editingSchedule) {
      updateSchedule.mutate(
        { id: editingSchedule.id, ...payload },
        {
          onSuccess: () => {
            toast.success('일정이 수정되었습니다');
            closeClassForm();
          },
          onError: () => toast.error('수정 중 오류가 발생했습니다'),
        }
      );
    } else {
      createSchedule.mutate(payload, {
        onSuccess: (created) => {
          toast.success(created.length > 1 ? `일정 ${created.length}개가 추가되었습니다` : '일정이 추가되었습니다');
          closeClassForm();
        },
        onError: () => toast.error('추가 중 오류가 발생했습니다'),
      });
    }
  };

  const isPending = createSchedule.isPending || updateSchedule.isPending || deleteSchedule.isPending;

  const handleDelete = () => {
    if (!editingSchedule) return;
    deleteSchedule.mutate(editingSchedule.id, {
      onSuccess: () => {
        toast.success('일정이 삭제되었습니다');
        closeClassForm();
      },
      onError: () => toast.error('삭제 중 오류가 발생했습니다'),
    });
  };

  return (
    <Dialog open={isClassFormOpen} onOpenChange={(open) => !open && closeClassForm()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto border-[#d8e2ef] bg-[#ffffff]">
        <DialogHeader>
          <DialogTitle>{editingSchedule ? '일정 수정' : '일정 추가'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="title">제목 *</Label>
            <Input
              id="title"
              placeholder="일정 제목"
              value={form.title}
              onChange={(e) => {
                const title = e.target.value;
                // 새 일정이고 색상을 수동으로 바꾸지 않았으면 제목에서 자동 파생
                if (isAutoColor) {
                  setForm({ ...form, title, color: title.trim() ? getAutoColor(title) : defaultForm.color });
                } else {
                  setForm({ ...form, title });
                }
              }}
              className={errors.title ? 'border-red-500' : ''}
            />
            {errors.title && <p className="text-red-500 text-xs">{errors.title}</p>}
          </div>

          {/* Schedule Type */}
          <div className="space-y-1.5">
            <Label>유형</Label>
            <div className="grid grid-cols-3 gap-2">
              {SCHEDULE_TYPE_OPTIONS.map(({ value, label, icon, desc }) => {
                const selected = form.schedule_type === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      const newType = value as Schedule['schedule_type'];
                      if (isAutoColor && form.title.trim()) {
                        setForm({ ...form, schedule_type: newType, color: getAutoColor(form.title) });
                      } else {
                        setForm({ ...form, schedule_type: newType });
                      }
                    }}
                    className={cn(
                      'flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg border-2 text-center transition-all',
                      selected
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-100 bg-white hover:border-gray-300'
                    )}
                  >
                    <span style={{ fontSize: 20 }}>{icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: selected ? '#4338CA' : '#181c1e' }}>{label}</span>
                    <span style={{ fontSize: 9, color: '#64748b', lineHeight: 1.3 }}>{desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 반복 방식 토글 */}
          <div className="space-y-1.5">
            <Label>일정 방식</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsRecurring(true);
                  setSelectedDays((days) => days.length ? days : [form.recurring_day]);
                  setForm((f) => ({ ...f, date: '' }));
                }}
                className={cn(
                  'flex-1 py-1.5 rounded-lg text-sm font-semibold border transition-colors',
                  isRecurring
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-400'
                )}
              >
                매주 반복
              </button>
              <button
                type="button"
                onClick={() => setIsRecurring(false)}
                className={cn(
                  'flex-1 py-1.5 rounded-lg text-sm font-semibold border transition-colors',
                  !isRecurring
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-400'
                )}
              >
                특정 날짜
              </button>
            </div>
          </div>

          {/* 매주 반복 → 요일 선택 / 특정 날짜 → 날짜 입력 */}
          {isRecurring ? (
            <div className="space-y-1.5">
              <Label>요일</Label>
              <div className="grid grid-cols-7 gap-1.5">
                {DAY_NAMES_FULL.map((day, idx) => {
                  const recurringDay = indexToRecurringDay(idx);
                  const selected = selectedDays.includes(recurringDay);
                  return (
                    <button
                      key={idx}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setSelectedDays((days) => {
                          const next = selected
                            ? days.filter((day) => day !== recurringDay)
                            : [...days, recurringDay].sort((a, b) => recurringDayToIndex(a) - recurringDayToIndex(b));
                          if (next.length > 0) {
                            setForm((f) => ({ ...f, recurring_day: next[0] }));
                          }
                          return next;
                        });
                      }}
                      className={cn(
                        'h-10 rounded-lg border text-sm font-semibold transition-all',
                        selected
                          ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                          : 'border-gray-200 bg-white text-gray-500 hover:border-indigo-300 hover:text-indigo-600'
                      )}
                    >
                      {day.slice(0, 1)}
                    </button>
                  );
                })}
              </div>
              {errors.days && <p className="text-red-500 text-xs">{errors.days}</p>}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="date">날짜 *</Label>
              <Input
                id="date"
                type="date"
                value={form.date}
                onChange={(e) => {
                  const dateVal = e.target.value;
                  const recurringDay = dateVal ? dateStringToRecurringDay(dateVal) : form.recurring_day;
                  setForm((f) => ({ ...f, date: dateVal, recurring_day: recurringDay }));
                }}
                className={errors.date ? 'border-red-500' : ''}
              />
              {errors.date && <p className="text-red-500 text-xs">{errors.date}</p>}
              {form.date && (
                <p className="text-xs text-gray-500">요일: {DAY_NAMES_FULL[recurringDayToIndex(form.recurring_day)]} (자동 계산)</p>
              )}
            </div>
          )}

          {/* Time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="start_time">시작 시간 *</Label>
              <Input
                id="start_time"
                type="time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                className={errors.start_time ? 'border-red-500' : ''}
              />
              {errors.start_time && <p className="text-red-500 text-xs">{errors.start_time}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end_time">종료 시간 *</Label>
              <Input
                id="end_time"
                type="time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                className={errors.end_time ? 'border-red-500' : ''}
              />
              {errors.end_time && <p className="text-red-500 text-xs">{errors.end_time}</p>}
            </div>
          </div>

          {/* Location */}
          <div className="space-y-1.5">
            <Label htmlFor="location">장소 (선택)</Label>
            <Input
              id="location"
              placeholder="장소를 입력하세요"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </div>

          {/* Color */}
          <div className="space-y-2">
            <Label>색상 {isAutoColor && <span className="text-xs font-normal text-gray-400">(제목 기반 자동 — 클릭으로 변경)</span>}</Label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
              {ALL_SCHEDULE_COLORS.map((color) => {
                const selected = form.color === color;
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => { setIsAutoColor(false); setForm({ ...form, color }); }}
                    style={{
                      width: '100%', aspectRatio: '1', borderRadius: 8,
                      background: `linear-gradient(135deg, ${color} 0%, ${color}BB 100%)`,
                      border: selected ? '2.5px solid #181c1e' : '2.5px solid transparent',
                      boxShadow: selected ? `0 0 0 2px #fff, 0 0 0 4px ${color}` : '0 1px 3px rgba(0,0,0,0.15)',
                      cursor: 'pointer',
                      transform: selected ? 'scale(1.12)' : 'scale(1)',
                      transition: 'transform 0.12s, box-shadow 0.12s',
                    }}
                  />
                );
              })}
            </div>
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <Label>우선순위</Label>
            <Select
              value={String(form.priority)}
              onValueChange={(v) => setForm({ ...form, priority: Number(v) as Schedule['priority'] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRIORITY_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Completed */}
          {editingSchedule && (
            <div className="flex items-center gap-2">
              <input
                id="is_completed"
                type="checkbox"
                checked={form.is_completed}
                onChange={(e) => setForm({ ...form, is_completed: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-indigo-600"
              />
              <Label htmlFor="is_completed" className="cursor-pointer">완료 표시</Label>
            </div>
          )}

          {errors.conflict && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
              <span className="text-red-500 mt-0.5">⚠️</span>
              <p className="text-red-600 text-xs leading-relaxed">{errors.conflict}</p>
            </div>
          )}

          <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between gap-2">
            <div>
              {editingSchedule && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={isPending}
                >
                  삭제
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closeClassForm}>
                취소
              </Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700" disabled={isPending}>
                {isPending ? '저장 중...' : editingSchedule ? '수정' : '추가'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
