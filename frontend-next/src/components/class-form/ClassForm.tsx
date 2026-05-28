
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
  cn,
} from '@/lib/utils';
import { ALL_SCHEDULE_COLORS, getAutoColor } from '@/lib/scheduleColor';
import { dateStringToRecurringDay, recurringDayToIndex, indexToRecurringDay } from '@/lib/recurringDay';
import {
  defaultScopeForMode,
  ScheduleViewTarget,
  scopeToTargets,
  targetsToScope,
} from '@/lib/scheduleViewScope';
import { RecurringDay, Schedule, ScheduleViewScope } from '@/types';
import MaterialIcon from '@/components/common/MaterialIcon';

const SCHEDULE_TYPE_OPTIONS = [
  { value: 'class',      label: '수업',     icon: 'school', desc: '강의·실습' },
  { value: 'study',      label: '자율학습', icon: 'edit_note', desc: '공부·학습' },
  { value: 'assignment', label: '과제',     icon: 'assignment', desc: '제출·마감' },
  { value: 'activity',   label: '활동',     icon: 'directions_run', desc: '동아리·알바' },
  { value: 'personal',   label: '개인',     icon: 'event', desc: '약속·기타' },
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
  is_completed: false,
  view_scope: 'day_week' as ScheduleViewScope,
};

const VIEW_SCOPE_OPTIONS: { value: ScheduleViewTarget; label: string; desc: string; icon: string }[] = [
  { value: 'day', label: '일간', desc: '하루 화면', icon: 'today' },
  { value: 'week', label: '주간', desc: '주간 시간표', icon: 'view_week' },
  { value: 'month', label: '월간', desc: '월간 달력', icon: 'calendar_month' },
];


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
        is_completed: editingSchedule.is_completed,
        view_scope: editingSchedule.view_scope ?? defaultScopeForMode(!hasDate),
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
    if (scopeToTargets(form.view_scope).length === 0) newErrors.view_scope = '표시 위치를 선택해주세요';
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
      priority: editingSchedule?.priority ?? 0,
      is_completed: form.is_completed,
      view_scope: form.view_scope,
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
  const fieldClassName = 'h-14 rounded-lg border-blue-100 bg-[#fbfdff] px-4 text-base font-bold text-slate-950 placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-0';
  const selectedViewTargets = scopeToTargets(form.view_scope);

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
      <DialogContent className="max-h-[94vh] w-[calc(100vw-2rem)] max-w-[820px] overflow-hidden border border-blue-100 bg-white p-0 shadow-2xl sm:max-w-[820px] sm:rounded-lg">
        <DialogHeader className="border-b border-blue-50 bg-[#fbfdff] px-6 py-5 text-left sm:px-8">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-blue-600">
              <MaterialIcon icon={editingSchedule ? 'edit_calendar' : 'add'} size={28} color="#fff" />
            </span>
            <div>
              <p className="text-sm font-black text-blue-600">시간표 관리</p>
              <DialogTitle className="text-3xl font-black text-slate-950">
                {editingSchedule ? '일정 수정' : '일정 추가'}
              </DialogTitle>
            </div>
          </div>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex max-h-[calc(94vh-106px)] min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-6 py-6 sm:px-8">
          {/* Title */}
          <div className="space-y-3">
            <Label htmlFor="title" className="text-base font-black text-slate-950">제목 *</Label>
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
              className={cn(fieldClassName, errors.title && 'border-red-500 focus-visible:ring-red-100')}
            />
            {errors.title && <p className="text-red-500 text-xs">{errors.title}</p>}
          </div>

          {/* Schedule Type */}
          <div className="space-y-3">
            <Label className="text-base font-black text-slate-950">유형</Label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
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
                      'flex min-h-[116px] flex-col items-center justify-center gap-2 rounded-lg border p-3 text-center transition',
                      selected
                        ? 'border-blue-600 bg-blue-50 shadow-sm'
                        : 'border-blue-100 bg-white hover:border-blue-300 hover:bg-blue-50/60'
                    )}
                  >
                    <MaterialIcon icon={icon} size={25} color={selected ? '#2563eb' : '#64748b'} />
                    <span className={cn('text-base font-black', selected ? 'text-blue-700' : 'text-slate-950')}>{label}</span>
                    <span className="text-xs font-bold leading-4 text-slate-500">{desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 반복 방식 토글 */}
          <div className="space-y-3">
            <Label className="text-base font-black text-slate-950">일정 방식</Label>
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-blue-100 bg-blue-50/70 p-1.5">
              <button
                type="button"
                onClick={() => {
                  setIsRecurring(true);
                  setSelectedDays((days) => days.length ? days : [form.recurring_day]);
                  setForm((f) => ({ ...f, date: '', view_scope: defaultScopeForMode(true) }));
                }}
                className={cn(
                  'rounded-md px-4 py-3 text-base font-black transition',
                  isRecurring
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-white'
                )}
              >
                매주 반복
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsRecurring(false);
                  setForm((f) => ({ ...f, view_scope: defaultScopeForMode(false) }));
                }}
                className={cn(
                  'rounded-md px-4 py-3 text-base font-black transition',
                  !isRecurring
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-white'
                )}
              >
                특정 날짜
              </button>
            </div>
          </div>

          {/* View scope */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-base font-black text-slate-950">표시 위치</Label>
              <span className="text-xs font-bold text-slate-400">
                {isRecurring ? '반복 일정 기본: 일간+주간' : '특정 날짜 기본: 일간+월간'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {VIEW_SCOPE_OPTIONS.map((option) => {
                const selected = selectedViewTargets.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      const next = selected
                        ? selectedViewTargets.filter((target) => target !== option.value)
                        : [...selectedViewTargets, option.value];
                      setForm((prev) => ({
                        ...prev,
                        view_scope: targetsToScope(next.length ? next : [option.value]),
                      }));
                    }}
                    className={cn(
                      'flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-lg border p-3 text-center transition',
                      selected
                        ? 'border-blue-600 bg-blue-50 shadow-sm'
                        : 'border-blue-100 bg-white hover:border-blue-300 hover:bg-blue-50/60'
                    )}
                  >
                    <MaterialIcon icon={option.icon} size={25} color={selected ? '#2563eb' : '#64748b'} />
                    <span className={cn('text-base font-black', selected ? 'text-blue-700' : 'text-slate-950')}>
                      {option.label}
                    </span>
                    <span className="text-xs font-bold text-slate-500">{option.desc}</span>
                  </button>
                );
              })}
            </div>
            {errors.view_scope && <p className="text-red-500 text-xs">{errors.view_scope}</p>}
          </div>

          {/* 매주 반복 → 요일 선택 / 특정 날짜 → 날짜 입력 */}
          {isRecurring ? (
            <div className="space-y-3">
              <Label className="text-base font-black text-slate-950">요일</Label>
              <div className="grid grid-cols-7 gap-2">
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
                        'h-12 rounded-lg border text-base font-black transition',
                        selected
                          ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                          : 'border-blue-100 bg-white text-slate-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700'
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
            <div className="space-y-3">
              <Label htmlFor="date" className="text-base font-black text-slate-950">날짜 *</Label>
              <Input
                id="date"
                type="date"
                value={form.date}
                onChange={(e) => {
                  const dateVal = e.target.value;
                  const recurringDay = dateVal ? dateStringToRecurringDay(dateVal) : form.recurring_day;
                  setForm((f) => ({ ...f, date: dateVal, recurring_day: recurringDay }));
                }}
                className={cn(fieldClassName, errors.date && 'border-red-500 focus-visible:ring-red-100')}
              />
              {errors.date && <p className="text-red-500 text-xs">{errors.date}</p>}
              {form.date && (
                <p className="text-xs text-gray-500">요일: {DAY_NAMES_FULL[recurringDayToIndex(form.recurring_day)]} (자동 계산)</p>
              )}
            </div>
          )}

          {/* Time */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <Label htmlFor="start_time" className="text-base font-black text-slate-950">시작 시간 *</Label>
              <Input
                id="start_time"
                type="time"
                step="300"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                className={cn(fieldClassName, errors.start_time && 'border-red-500 focus-visible:ring-red-100')}
              />
              {errors.start_time && <p className="text-red-500 text-xs">{errors.start_time}</p>}
            </div>
            <div className="space-y-3">
              <Label htmlFor="end_time" className="text-base font-black text-slate-950">종료 시간 *</Label>
              <Input
                id="end_time"
                type="time"
                step="300"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                className={cn(fieldClassName, errors.end_time && 'border-red-500 focus-visible:ring-red-100')}
              />
              {errors.end_time && <p className="text-red-500 text-xs">{errors.end_time}</p>}
            </div>
          </div>

          {/* Location */}
          <div className="space-y-3">
            <Label htmlFor="location" className="text-base font-black text-slate-950">장소 (선택)</Label>
            <Input
              id="location"
              placeholder="장소를 입력하세요"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className={fieldClassName}
            />
          </div>

          {/* Color */}
          <div className="space-y-3">
            <Label className="text-base font-black text-slate-950">
              색상 {isAutoColor && <span className="text-xs font-bold text-slate-400">(제목 기반 자동)</span>}
            </Label>
            <div className="grid grid-cols-6 gap-3 rounded-lg border border-blue-50 bg-[#fbfdff] p-3 sm:grid-cols-10">
              {ALL_SCHEDULE_COLORS.map((color) => {
                const selected = form.color === color;
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => { setIsAutoColor(false); setForm({ ...form, color }); }}
                    className={cn(
                      'aspect-square min-h-10 rounded-lg border transition sm:min-h-11',
                      selected ? 'scale-105 border-slate-950 shadow-sm ring-2 ring-blue-200' : 'border-transparent hover:scale-105'
                    )}
                    aria-label={`색상 ${color}`}
                    style={{ background: color }}
                  />
                );
              })}
            </div>
          </div>

          {/* Completed */}
          {editingSchedule && (
            <div className="flex items-center gap-2">
              <input
                id="is_completed"
                type="checkbox"
                checked={form.is_completed}
                onChange={(e) => setForm({ ...form, is_completed: e.target.checked })}
                className="h-4 w-4 rounded border-blue-200 text-blue-600"
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

          </div>

          <DialogFooter className="mx-0 mb-0 mt-0 flex-col-reverse gap-2 rounded-none border-t border-blue-50 bg-white px-6 py-4 sm:flex-row sm:justify-between sm:px-8">
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
              <Button type="button" variant="outline" onClick={closeClassForm} className="h-11 rounded-lg border-blue-100 px-5 font-black text-slate-700 hover:bg-blue-50">
                취소
              </Button>
              <Button type="submit" className="h-11 rounded-lg bg-blue-600 px-6 font-black hover:bg-blue-700" disabled={isPending}>
                {isPending ? '저장 중...' : editingSchedule ? '수정' : '추가'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
