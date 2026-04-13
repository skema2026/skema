'use client';

import { useEffect, useRef, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUIStore } from '@/store/uiStore';
import { useCreateSchedule, useUpdateSchedule } from '@/hooks/useSchedules';
import {
  DAY_NAMES_FULL,
  PRIORITY_LABELS,
  SCHEDULE_TYPE_LABELS,
  cn,
} from '@/lib/utils';
import { ALL_SCHEDULE_COLORS, getAutoColor } from '@/lib/scheduleColor';
import { Schedule } from '@/types';

const defaultForm = {
  title: '',
  schedule_type: 'class' as Schedule['schedule_type'],
  day_of_week: 0,
  date: '',
  start_time: '09:00',
  end_time: '10:00',
  location: '',
  color: '#6366F1',
  priority: 0 as Schedule['priority'],
  is_completed: false,
};

/** YYYY-MM-DD 문자열 → day_of_week (0=월…6=일, 로컬 시간 기준) */
function dateStringToDow(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay(); // 0=Sun
  return day === 0 ? 6 : day - 1;
}

export function ClassForm() {
  const { isClassFormOpen, editingSchedule, closeClassForm } = useUIStore();
  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();

  const [form, setForm] = useState(defaultForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // true = color was not manually overridden by the user; auto-follows title hash
  const autoColorRef = useRef(true);
  // true = 매주 반복(요일 기반), false = 특정 날짜 1회
  const [isRecurring, setIsRecurring] = useState(true);

  useEffect(() => {
    if (editingSchedule) {
      autoColorRef.current = false; // editing: keep stored color as-is
      const hasDate = !!editingSchedule.date;
      setIsRecurring(!hasDate);
      setForm({
        title: editingSchedule.title,
        schedule_type: editingSchedule.schedule_type,
        day_of_week: editingSchedule.day_of_week,
        date: editingSchedule.date || '',
        start_time: editingSchedule.start_time,
        end_time: editingSchedule.end_time,
        location: editingSchedule.location || '',
        color: editingSchedule.color,
        priority: editingSchedule.priority,
        is_completed: editingSchedule.is_completed,
      });
    } else {
      autoColorRef.current = true; // new schedule: auto-derive from title
      setIsRecurring(true);
      setForm(defaultForm);
    }
    setErrors({});
  }, [editingSchedule, isClassFormOpen]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!form.title.trim()) newErrors.title = '제목을 입력해주세요';
    if (!form.start_time) newErrors.start_time = '시작 시간을 입력해주세요';
    if (!form.end_time) newErrors.end_time = '종료 시간을 입력해주세요';
    if (form.start_time >= form.end_time) newErrors.end_time = '종료 시간은 시작 시간 이후여야 합니다';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const payload = {
      title: form.title,
      schedule_type: form.schedule_type,
      day_of_week: form.day_of_week,
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
        onSuccess: () => {
          toast.success('일정이 추가되었습니다');
          closeClassForm();
        },
        onError: () => toast.error('추가 중 오류가 발생했습니다'),
      });
    }
  };

  const isPending = createSchedule.isPending || updateSchedule.isPending;

  return (
    <Dialog open={isClassFormOpen} onOpenChange={(open) => !open && closeClassForm()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
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
                if (autoColorRef.current) {
                  setForm({ ...form, title, color: title.trim() ? getAutoColor(title, form.schedule_type) : defaultForm.color });
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
            <Select
              value={form.schedule_type}
              onValueChange={(v) => setForm({ ...form, schedule_type: v as Schedule['schedule_type'] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SCHEDULE_TYPE_LABELS).map(([val, label]) => (
                  <SelectItem key={val} value={val}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 반복 방식 토글 */}
          <div className="space-y-1.5">
            <Label>일정 방식</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setIsRecurring(true); setForm((f) => ({ ...f, date: '' })); }}
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
              <Select
                value={String(form.day_of_week)}
                onValueChange={(v) => setForm({ ...form, day_of_week: Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_NAMES_FULL.map((day, idx) => (
                    <SelectItem key={idx} value={String(idx)}>{day}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                  const dow = dateVal ? dateStringToDow(dateVal) : form.day_of_week;
                  setForm((f) => ({ ...f, date: dateVal, day_of_week: dow }));
                }}
              />
              {form.date && (
                <p className="text-xs text-gray-500">요일: {DAY_NAMES_FULL[form.day_of_week]} (자동 계산)</p>
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
          <div className="space-y-1.5">
            <Label>색상 {autoColorRef.current && <span className="text-xs font-normal text-gray-400">(제목 기반 자동 선택 — 클릭으로 변경)</span>}</Label>
            <div className="flex flex-wrap gap-2">
              {ALL_SCHEDULE_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={cn(
                    'w-8 h-8 rounded-full border-2 transition-transform hover:scale-110',
                    form.color === color ? 'border-gray-900 dark:border-white scale-110' : 'border-transparent'
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => {
                    autoColorRef.current = false; // 수동 선택 시 자동 파생 중단
                    setForm({ ...form, color });
                  }}
                />
              ))}
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeClassForm}>
              취소
            </Button>
            <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700" disabled={isPending}>
              {isPending ? '저장 중...' : editingSchedule ? '수정' : '추가'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
