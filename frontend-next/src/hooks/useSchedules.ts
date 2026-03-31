import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Schedule } from '@/types';

export function useSchedules(initialData?: Schedule[]) {
  return useQuery({
    queryKey: ['schedules'],
    queryFn: async () => {
      const { data } = await api.get<Schedule[]>('/schedules');
      return data;
    },
    initialData,
  });
}

export function useCreateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (schedule: Omit<Schedule, 'id' | 'user_id'>) => {
      const { data } = await api.post<Schedule>('/schedules', schedule);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  });
}

export function useUpdateSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...schedule }: Partial<Schedule> & { id: number }) => {
      const { data } = await api.put<Schedule>(`/schedules/${id}`, schedule);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  });
}

export function useDeleteSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/schedules/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  });
}

export function useToggleComplete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_completed }: { id: number; is_completed: boolean }) => {
      const { data } = await api.put<Schedule>(`/schedules/${id}`, { is_completed });
      return data;
    },
    onMutate: async ({ id, is_completed }) => {
      await qc.cancelQueries({ queryKey: ['schedules'] });
      const prev = qc.getQueryData<Schedule[]>(['schedules']);
      qc.setQueryData<Schedule[]>(['schedules'], (old) =>
        old?.map((s) => (s.id === id ? { ...s, is_completed } : s)) ?? []
      );
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) qc.setQueryData(['schedules'], context.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
  });
}
