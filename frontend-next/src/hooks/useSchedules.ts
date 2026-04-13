import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ConflictItem, Schedule } from '@/types';

// ── 전체 일정 ─────────────────────────────────────────────────────────────────

export function useSchedules(initialData?: Schedule[]) {
  return useQuery({
    queryKey: ['schedules'],
    queryFn: async () => {
      const { data } = await api.get<Schedule[]>('/schedules');
      return data;
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
      const { data } = await api.get<Schedule[]>('/schedules/today');
      return data;
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
    mutationFn: async (schedule: Omit<Schedule, 'id' | 'user_id'>) => {
      const { data } = await api.post<Schedule>('/schedules', schedule);
      return data;
    },
    onMutate: async (newSchedule) => {
      await qc.cancelQueries({ queryKey: ['schedules'] });
      const prev = qc.getQueryData<Schedule[]>(['schedules']);
      // 임시 ID로 낙관적 삽입
      const optimistic: Schedule = {
        ...newSchedule,
        id: -Date.now(),
        user_id: 0,
        color: newSchedule.color ?? '#6366F1',
        priority: newSchedule.priority ?? 0,
        is_completed: newSchedule.is_completed ?? false,
        schedule_type: newSchedule.schedule_type ?? 'class',
      };
      qc.setQueryData<Schedule[]>(['schedules'], (old) => [...(old ?? []), optimistic]);
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
      const { data } = await api.put<Schedule>(`/schedules/${id}`, schedule);
      return data;
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
