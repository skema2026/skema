
'use client';

import { useEffect, useRef, useState } from 'react';
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
import { useExams } from '@/hooks/useExams';
import {
  DAY_NAMES_FULL,
  cn,
  displayTitle,
} from '@/lib/utils';
import { ALL_SCHEDULE_COLORS, getAutoColor } from '@/lib/scheduleColor';
import { dateStringToRecurringDay, recurringDayToIndex, indexToRecurringDay } from '@/lib/recurringDay';
import {
  ScheduleViewTarget,
  scopeToTargets,
  targetsToScope,
} from '@/lib/scheduleViewScope';
import { RecurringDay, Schedule, ScheduleViewScope } from '@/types';
import MaterialIcon from '@/components/common/MaterialIcon';

const SCHEDULE_TYPE_OPTIONS = [
  { value: 'class',      label: '수업',      icon: 'school' },
  { value: 'study',      label: '자율학습',  icon: 'edit_note' },
  { value: 'assignment', label: '과제·시험', icon: 'quiz' },
  { value: 'personal',   label: '개인·활동', icon: 'event' },
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
  view_scope: 'all' as ScheduleViewScope,
  linked_exam_id: null as number | null,
};

// 시험 준비도에 넣을 수 있는 일정: 공부·과제 유형의 특정 날짜 일정 (공부 블록과 같은 조건)
const EXAM_LINKABLE_TYPES: Schedule['schedule_type'][] = ['study', 'assignment'];

function todayKST(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

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
  const { data: exams = [] } = useExams();
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
        view_scope: editingSchedule.view_scope ?? 'all',
        linked_exam_id: editingSchedule.linked_exam_id ?? null,
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

  // 모달 열릴 때 body 스크롤 잠금 (모바일 배경 스크롤 방지)
  const scrollYRef = useRef(0);
  useEffect(() => {
    if (isClassFormOpen) {
      scrollYRef.current = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollYRef.current}px`;
      document.body.style.width = '100%';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, scrollYRef.current);
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
    };
  }, [isClassFormOpen]);

  // 겹침 안내는 폼 맨 아래에 있어 휴대폰에서는 화면 밖일 수 있다 → 생기면 그 위치로 스크롤 (11/14 테스트)
  const conflictRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (errors.conflict) conflictRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [errors.conflict]);

  const isLinkableType = EXAM_LINKABLE_TYPES.includes(form.schedule_type);
  const canLinkExam = isLinkableType && !isRecurring;
  const linkedExam = exams.find((exam) => exam.id === form.linked_exam_id) ?? null;
  // 고를 수 있는 시험: 지나지 않은 시험 + (수정 중이면) 이미 연결된 시험
  const examOptions = exams
    .filter((exam) => exam.exam_date >= todayKST() || exam.id === form.linked_exam_id)
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date));

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!form.title.trim()) newErrors.title = '제목을 입력해주세요';
    if (isRecurring && selectedDays.length === 0) newErrors.days = '요일을 최소 1개 이상 선택해주세요';
    if (!isRecurring && !form.date) newErrors.date = '날짜를 선택해주세요';
    if (!form.start_time) newErrors.start_time = '시작 시간을 입력해주세요';
    if (!form.end_time) newErrors.end_time = '종료 시간을 입력해주세요';
    if (scopeToTargets(form.view_scope).length === 0) newErrors.view_scope = '표시 위치를 선택해주세요';
    if (form.start_time >= form.end_time) newErrors.end_time = '종료 시간은 시작 시간 이후여야 합니다';
    if (canLinkExam && linkedExam && form.date && form.date > linkedExam.exam_date) {
      newErrors.linked_exam_id = '시험 날짜 이후의 일정은 연결할 수 없어요';
    }
    setErrors(newErrors);
    const first = Object.values(newErrors)[0];
    if (first) toast.error(first); // 입력 칸이 화면 밖이어도 무엇이 문제인지 보이게
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const allSchedules = qc.getQueryData<Schedule[]>(['schedules']) ?? [];
    const conflicting = findConflict(form, isRecurring, selectedDays, allSchedules, editingSchedule?.id);
    if (conflicting) {
      const message = `"${displayTitle(conflicting.title)}"과(와) 시간이 겹칩니다 (${conflicting.start_time}–${conflicting.end_time})`;
      setErrors((prev) => ({ ...prev, conflict: message }));
      toast.error(message);
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
      // 공부·과제의 특정 날짜 일정만 시험에 연결 (그 외로 바꾸면 연결 해제)
      linked_exam_id: canLinkExam ? form.linked_exam_id : null,
    };

    if (editingSchedule) {
      updateSchedule.mutate(
        { id: editingSchedule.id, ...payload },
        {
          onSuccess: () => {
            toast.success('일정을 수정했어요');
            closeClassForm();
          },
          onError: () => toast.error('일정을 수정하지 못했어요'),
        }
      );
    } else {
      createSchedule.mutate(payload, {
        onSuccess: (created) => {
          toast.success(created.length > 1 ? `일정 ${created.length}개를 추가했어요` : '일정을 추가했어요');
          closeClassForm();
        },
        onError: () => toast.error('일정을 추가하지 못했어요'),
      });
    }
  };

  const isPending = createSchedule.isPending || updateSchedule.isPending || deleteSchedule.isPending;
  const fieldClassName = 'h-11 rounded-[10px] border-[#0f1e3a]/10 bg-white px-3 text-[15px] text-[#0f1e3a] placeholder:text-[#98a6ba] focus-visible:border-[#2a6fe3] focus-visible:ring-3 focus-visible:ring-[#2a6fe3]/15 focus-visible:ring-offset-0';
  const selectedViewTargets = scopeToTargets(form.view_scope);

  const handleDelete = () => {
    if (!editingSchedule) return;
    deleteSchedule.mutate(editingSchedule.id, {
      onSuccess: () => {
        toast.success('일정을 삭제했어요');
        closeClassForm();
      },
      onError: () => toast.error('일정을 삭제하지 못했어요'),
    });
  };

  return (
    <Dialog open={isClassFormOpen} onOpenChange={(open) => !open && closeClassForm()}>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-2rem)] max-w-[520px] gap-0 overflow-hidden bg-white p-0 sm:max-w-[520px]">
        <DialogHeader className="border-b border-[#0f1e3a]/8 px-5 py-4 text-left sm:px-6">
          <DialogTitle>{editingSchedule ? '일정 수정' : '일정 추가'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex max-h-[calc(88vh-72px)] min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="title" className="text-[13px] font-normal text-[#44536b]">제목</Label>
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
            {errors.title && <p className="text-[12px] text-[#dc2626]">{errors.title}</p>}
          </div>

          {/* Schedule Type */}
          <div className="space-y-1.5">
            <Label className="text-[13px] font-normal text-[#44536b]">유형</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {SCHEDULE_TYPE_OPTIONS.map(({ value, label, icon }) => {
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
                      'flex flex-col items-center justify-center gap-1 rounded-[10px] border px-1 py-2 text-center transition-colors',
                      selected
                        ? 'border-[#2a6fe3] bg-[#eaf2ff]'
                        : 'border-[#0f1e3a]/10 bg-white hover:bg-[#f5f8fd]'
                    )}
                  >
                    <MaterialIcon icon={icon} size={18} color={selected ? '#2a6fe3' : '#5f6f88'} />
                    <span className={cn('text-[13px]', selected ? 'text-[#1f63d6]' : 'text-[#0f1e3a]')}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 반복 방식 토글 */}
          <div className="space-y-1.5">
            <Label className="text-[13px] font-normal text-[#44536b]">일정 방식</Label>
            <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-[#e6effc] p-1">
              <button
                type="button"
                onClick={() => {
                  setIsRecurring(true);
                  setSelectedDays((days) => days.length ? days : [form.recurring_day]);
                  setForm((f) => ({ ...f, date: '', view_scope: 'all' }));
                }}
                className={cn(
                  'h-8 rounded-lg px-3 text-[14px] transition-colors',
                  isRecurring
                    ? 'bg-[#2a6fe3] font-medium text-white'
                    : 'text-[#44536b] hover:text-[#1f63d6]'
                )}
              >
                매주 반복
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsRecurring(false);
                  setForm((f) => ({ ...f, view_scope: 'all' }));
                }}
                className={cn(
                  'h-8 rounded-lg px-3 text-[14px] transition-colors',
                  !isRecurring
                    ? 'bg-[#2a6fe3] font-medium text-white'
                    : 'text-[#44536b] hover:text-[#1f63d6]'
                )}
              >
                특정 날짜
              </button>
            </div>
          </div>

          {/* View scope */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[13px] font-normal text-[#44536b]">표시 위치</Label>
              <span className="text-[12px] text-[#5f6f88]">기본은 전체</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
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
                      'flex flex-col items-center justify-center gap-1 rounded-[10px] border px-1 py-2 text-center transition-colors',
                      selected
                        ? 'border-[#2a6fe3] bg-[#eaf2ff]'
                        : 'border-[#0f1e3a]/10 bg-white hover:bg-[#f5f8fd]'
                    )}
                  >
                    <MaterialIcon icon={option.icon} size={18} color={selected ? '#2a6fe3' : '#5f6f88'} />
                    <span className={cn('text-[13px]', selected ? 'text-[#1f63d6]' : 'text-[#0f1e3a]')}>
                      {option.label}
                    </span>
                    <span className="text-[12px] text-[#5f6f88]">{option.desc}</span>
                  </button>
                );
              })}
            </div>
            {errors.view_scope && <p className="text-[12px] text-[#dc2626]">{errors.view_scope}</p>}
          </div>

          {/* 매주 반복 → 요일 선택 / 특정 날짜 → 날짜 입력 */}
          {isRecurring ? (
            <div className="space-y-1.5">
              <Label className="text-[13px] font-normal text-[#44536b]">요일</Label>
              <div className="grid grid-cols-7 gap-1">
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
                        'h-10 rounded-[10px] border text-[14px] transition-colors',
                        selected
                          ? 'border-[#2a6fe3] bg-[#2a6fe3] font-medium text-white'
                          : 'border-[#0f1e3a]/10 bg-white text-[#44536b] hover:bg-[#f5f8fd]'
                      )}
                    >
                      {day.slice(0, 1)}
                    </button>
                  );
                })}
              </div>
              {errors.days && <p className="text-[12px] text-[#dc2626]">{errors.days}</p>}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="date" className="text-[13px] font-normal text-[#44536b]">날짜</Label>
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
              {errors.date && <p className="text-[12px] text-[#dc2626]">{errors.date}</p>}
              {form.date && (
                <p className="text-[12px] text-[#5f6f88]">{DAY_NAMES_FULL[recurringDayToIndex(form.recurring_day)]}</p>
              )}
            </div>
          )}

          {/* Time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="start_time" className="text-[13px] font-normal text-[#44536b]">시작 시간</Label>
              <Input
                id="start_time"
                type="time"
                step="300"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                className={cn(fieldClassName, errors.start_time && 'border-red-500 focus-visible:ring-red-100')}
              />
              {errors.start_time && <p className="text-[12px] text-[#dc2626]">{errors.start_time}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="end_time" className="text-[13px] font-normal text-[#44536b]">종료 시간</Label>
              <Input
                id="end_time"
                type="time"
                step="300"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                className={cn(fieldClassName, errors.end_time && 'border-red-500 focus-visible:ring-red-100')}
              />
              {errors.end_time && <p className="text-[12px] text-[#dc2626]">{errors.end_time}</p>}
            </div>
          </div>

          {/* 시험 연결 → 준비도에 반영 (공부·과제 유형일 때만) */}
          {isLinkableType && (
            <div className="space-y-1.5">
              <Label htmlFor="linked_exam" className="text-[13px] font-normal text-[#44536b]">
                시험 준비도에 넣기 · 선택
              </Label>
              {isRecurring ? (
                <p className="rounded-[10px] bg-[#f5f8fd] px-3 py-2.5 text-[13px] leading-[19px] text-[#5f6f88]">
                  매주 반복 일정은 시험에 연결할 수 없어요. <b className="font-medium text-[#44536b]">특정 날짜</b>로 바꾸면 고를 수 있어요.
                </p>
              ) : examOptions.length === 0 ? (
                <p className="rounded-[10px] bg-[#f5f8fd] px-3 py-2.5 text-[13px] leading-[19px] text-[#5f6f88]">
                  다가오는 시험이 없어요. 사이드바의 [시험 추가]로 먼저 시험을 넣어 주세요.
                </p>
              ) : (
                <>
                  <select
                    id="linked_exam"
                    value={form.linked_exam_id ?? ''}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : null;
                      const exam = exams.find((x) => x.id === id);
                      setForm((f) => {
                        // 제목이 비어 있으면 '과목 공부'로 채워 줌
                        const title = !f.title.trim() && exam ? `${exam.subject || exam.title} 공부` : f.title;
                        const color = isAutoColor && title.trim() ? getAutoColor(title) : f.color;
                        return { ...f, linked_exam_id: id, title, color };
                      });
                      setErrors((prev) => ({ ...prev, linked_exam_id: '' }));
                    }}
                    className={cn(
                      fieldClassName,
                      'w-full appearance-none border outline-none',
                      errors.linked_exam_id && 'border-red-500',
                    )}
                  >
                    <option value="">연결 안 함</option>
                    {examOptions.map((exam) => (
                      <option key={exam.id} value={exam.id}>
                        {exam.title} · {exam.exam_date.slice(5).replace('-', '/')}
                      </option>
                    ))}
                  </select>
                  {errors.linked_exam_id ? (
                    <p className="text-[12px] text-[#dc2626]">{errors.linked_exam_id}</p>
                  ) : (
                    <p className="text-[12px] text-[#5f6f88]">
                      {linkedExam
                        ? '완료하면 이 시험의 준비도가 올라가요. 다시 짜기에서도 시험 전날까지 옮겨져요.'
                        : '시험을 고르면 이 일정을 끝냈을 때 준비도에 반영돼요.'}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Location */}
          <div className="space-y-1.5">
            <Label htmlFor="location" className="text-[13px] font-normal text-[#44536b]">장소 · 선택</Label>
            <Input
              id="location"
              placeholder="예: 소프트웨어관 406"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className={fieldClassName}
            />
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <Label className="text-[13px] font-normal text-[#44536b]">
              색 {isAutoColor && <span className="text-[12px] text-[#5f6f88]">· 제목에 맞춰 자동</span>}
            </Label>
            <div className="grid grid-cols-10 gap-1.5 rounded-xl bg-[#f5f8fd] p-2">
              {ALL_SCHEDULE_COLORS.map((color) => {
                const selected = form.color === color;
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => { setIsAutoColor(false); setForm({ ...form, color }); }}
                    className={cn(
                      'aspect-square rounded-md border transition-colors',
                      selected ? 'border-white ring-2 ring-[#0f1e3a]' : 'border-transparent'
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
                className="h-4 w-4 rounded border-[#bcd8fe] text-[#1f63d6]"
              />
              <Label htmlFor="is_completed" className="cursor-pointer">완료 표시</Label>
            </div>
          )}

          {errors.conflict && (
            <p ref={conflictRef} role="alert" className="rounded-xl bg-[#fef2f2] px-4 py-3 text-[13px] leading-[20px] text-[#b91c1c]">{errors.conflict}</p>
          )}

          </div>

          <DialogFooter className="mx-0 mb-0 mt-0 flex-row justify-between gap-2 rounded-none border-t border-[#0f1e3a]/8 bg-white px-5 py-4 sm:px-6">
            <div>
              {editingSchedule && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleDelete}
                  disabled={isPending}
                  className="h-10 rounded-[10px] px-3 text-[14px] text-[#dc2626] hover:bg-[#fef2f2] hover:text-[#dc2626]"
                >
                  삭제
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closeClassForm} className="h-10 rounded-[10px] border-[#0f1e3a]/10 px-4 text-[14px] text-[#0f1e3a] hover:bg-[#edf3fc]">
                취소
              </Button>
              <Button type="submit" className="h-10 rounded-[10px] bg-[#2a6fe3] px-5 text-[14px] font-medium text-white hover:bg-[#1f63d6]" disabled={isPending}>
                {isPending ? '저장하는 중' : editingSchedule ? '수정' : '추가'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
