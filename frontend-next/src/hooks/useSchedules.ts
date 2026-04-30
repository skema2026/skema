import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { indexToRecurringDay } from '@/lib/recurringDay';
import { ConflictItem, RecurringDay, Schedule } from '@/types';

type RawSchedule = Partial<Schedule> & {
  course_name?: string;
  recurring_day?: string;
  day_of_week?: number;
  color_code?: string;
};

export type ScheduleCreateInput = Omit<Schedule, 'id' | 'user_id'> & {
  days?: RecurringDay[];
};

function normalizeSchedule(schedule: RawSchedule): Schedule {
  return {
    id: schedule.id ?? 0,
    user_id: schedule.user_id ?? 0,
    title: schedule.title ?? schedule.course_name ?? '',
    recurring_day: (schedule.recurring_day ?? indexToRecurringDay(schedule.day_of_week ?? 0)) as RecurringDay,
    date: schedule.date ?? undefined,
    start_time: schedule.start_time ?? '09:00',
    end_time: schedule.end_time ?? '10:00',
    location: schedule.location ?? undefined,
    color: schedule.color ?? schedule.color_code ?? '#6366F1',
    priority: schedule.priority ?? 0,
    is_completed: schedule.is_completed ?? false,
    schedule_type: schedule.schedule_type ?? 'class',
    schedule_source: schedule.schedule_source,
    linked_exam_id: schedule.linked_exam_id,
    user_override: schedule.user_override,
    deleted_by_user: schedule.deleted_by_user,
    original_generated_title: schedule.original_generated_title,
  };
}

function toCreatePayload(schedule: ScheduleCreateInput) {
  const days = schedule.days?.length ? schedule.days : [schedule.recurring_day];
  return {
    course_name: schedule.title,
    days,
    date: schedule.date,
    start_time: schedule.start_time,
    end_time: schedule.end_time,
    location: schedule.location,
    color_code: schedule.color,
    priority: schedule.priority,
    is_completed: schedule.is_completed,
    schedule_type: schedule.schedule_type,
  };
}

// ── 전체 일정 ─────────────────────────────────────────────────────────────────

export function useSchedules(initialData?: Schedule[]) {
  return useQuery({
    queryKey: ['schedules'],
    queryFn: async () => {
      const { data } = await api.get<RawSchedule[]>('/schedules');
      return data.map(normalizeSchedule);
    },
    placeholderData: initialData,
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

// ── 오늘 할 일 (서버 계산, 반복 + 특정 날짜 합산) ────────────────────────────

export function useTodaySchedules() {
  return useQuery({
    queryKey: ['schedules', 'today'],
    queryFn: async () => {
      const { data } = await api.get<RawSchedule[]>('/schedules/today');
      return data.map(normalizeSchedule);
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

// ── 충돌 감지 ─────────────────────────────────────────────────────────────────

export function useConflicts() {
  return useQuery({
    queryKey: ['schedules', 'conflicts'],
    queryFn: async () => {
      const { data } = await api.get<ConflictItem[]>('/schedules/conflicts');
      return data;
    },
    staleTime: 30_000, // 30초 캐시
  });
}

// ── 일정 생성 (optimistic) ────────────────────────────────────────────────────

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (schedule: ScheduleCreateInput) => {
      const { data } = await api.post<RawSchedule[] | RawSchedule>('/schedules', toCreatePayload(schedule));
      return (Array.isArray(data) ? data : [data]).map(normalizeSchedule);
    },
    onMutate: async (newSchedule) => {
      await qc.cancelQueries({ queryKey: ['schedules'] });
      const prev = qc.getQueryData<Schedule[]>(['schedules']);
      const days = newSchedule.days?.length ? newSchedule.days : [newSchedule.recurring_day];
      const optimistic = days.map((day, idx): Schedule => ({
        ...newSchedule,
        id: -Date.now() - idx,
        user_id: 0,
        recurring_day: day,
        date: newSchedule.date,
        color: newSchedule.color ?? '#6366F1',
        priority: newSchedule.priority ?? 0,
        is_completed: newSchedule.is_completed ?? false,
        schedule_type: newSchedule.schedule_type ?? 'class',
      }));
      qc.setQueryData<Schedule[]>(['schedules'], (old) => [...(old ?? []), ...optimistic]);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['schedules'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['schedules', 'today'] });
      qc.invalidateQueries({ queryKey: ['schedules', 'conflicts'] });
    },
  });
}

// ── 일정 수정 (optimistic) ────────────────────────────────────────────────────

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...schedule }: Partial<Schedule> & { id: number }) => {
      const { data } = await api.put<RawSchedule>(`/schedules/${id}`, schedule);
      return normalizeSchedule(data);
    },
    onMutate: async ({ id, ...updates }) => {
      await qc.cancelQueries({ queryKey: ['schedules'] });
      const prev = qc.getQueryData<Schedule[]>(['schedules']);
      qc.setQueryData<Schedule[]>(['schedules'], (old) =>
        old?.map((s) => (s.id === id ? { ...s, ...updates } : s)) ?? []
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['schedules'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['schedules', 'today'] });
      qc.invalidateQueries({ queryKey: ['schedules', 'conflicts'] });
    },
  });
}

// ── 일정 삭제 (optimistic) ────────────────────────────────────────────────────

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/schedules/${id}`);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['schedules'] });
      const prev = qc.getQueryData<Schedule[]>(['schedules']);
      qc.setQueryData<Schedule[]>(['schedules'], (old) =>
        old?.filter((s) => s.id !== id) ?? []
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['schedules'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['schedules', 'today'] });
      qc.invalidateQueries({ queryKey: ['schedules', 'conflicts'] });
    },
  });
}

// ── 일정 완료 처리 (POST /schedules/{id}/complete) ────────────────────────────

export function useCompleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.post<Schedule>(`/schedules/${id}/complete`);
      return data;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['schedules'] });
      await qc.cancelQueries({ queryKey: ['schedules', 'today'] });
      const prev = qc.getQueryData<Schedule[]>(['schedules']);
      const prevToday = qc.getQueryData<Schedule[]>(['schedules', 'today']);
      const patch = (old: Schedule[] | undefined) =>
        old?.map((s) => (s.id === id ? { ...s, is_completed: true } : s)) ?? [];
      qc.setQueryData<Schedule[]>(['schedules'], patch);
      qc.setQueryData<Schedule[]>(['schedules', 'today'], patch);
      return { prev, prevToday };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['schedules'], ctx.prev);
      if (ctx?.prevToday) qc.setQueryData(['schedules', 'today'], ctx.prevToday);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['schedules', 'today'] });
    },
  });
}

// ── 일정 연기 (POST /schedules/{id}/postpone) ─────────────────────────────────

export function usePostponeSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, days = 1 }: { id: number; days?: number }) => {
      const { data } = await api.post<Schedule>(`/schedules/${id}/postpone`, null, {
        params: { days },
      });
      return data;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['schedules', 'today'] });
    },
  });
}

// ── 완료 토글 (optimistic) ────────────────────────────────────────────────────

export function useToggleComplete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_completed }: { id: number; is_completed: boolean }) => {
      const { data } = await api.put<Schedule>(`/schedules/${id}`, { is_completed });
      return data;
    },
    onMutate: async ({ id, is_completed }) => {
      await qc.cancelQueries({ queryKey: ['schedules'] });
      await qc.cancelQueries({ queryKey: ['schedules', 'today'] });
      const prev = qc.getQueryData<Schedule[]>(['schedules']);
      const prevToday = qc.getQueryData<Schedule[]>(['schedules', 'today']);
      const patch = (old: Schedule[] | undefined) =>
        old?.map((s) => (s.id === id ? { ...s, is_completed } : s)) ?? [];
      qc.setQueryData<Schedule[]>(['schedules'], patch);
      qc.setQueryData<Schedule[]>(['schedules', 'today'], patch);
      return { prev, prevToday };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['schedules'], ctx.prev);
      if (ctx?.prevToday) qc.setQueryData(['schedules', 'today'], ctx.prevToday);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['schedules'] });
      qc.invalidateQueries({ queryKey: ['schedules', 'today'] });
    },
  });
}
