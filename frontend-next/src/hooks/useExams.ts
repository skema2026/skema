import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ExamSchedule, Schedule } from '@/types';

export function useExams() {
  return useQuery({
    queryKey: ['exams'],
    queryFn: async () => {
      const { data } = await api.get<ExamSchedule[]>('/exam-schedules');
      return data;
    },
  });
}

// 시험은 학습 일정(linked_exam_id)과 연결돼 있으므로 시험이 바뀌면
// 일간·주간·월간이 공유하는 schedules 캐시도 항상 함께 갱신한다.
function invalidateExamLinked(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['exams'] });
  qc.invalidateQueries({ queryKey: ['schedules'] });
}

export function useCreateExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (exam: Omit<ExamSchedule, 'id' | 'user_id'>) => {
      const { data } = await api.post<ExamSchedule>('/exam-schedules', exam);
      return data;
    },
    onSuccess: () => invalidateExamLinked(qc),
  });
}

export function useUpdateExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: Partial<ExamSchedule> & { id: number }) => {
      const { data: res } = await api.put<ExamSchedule>(`/exam-schedules/${id}`, data);
      return res;
    },
    onSuccess: () => invalidateExamLinked(qc),
  });
}

export function useDeleteExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/exam-schedules/${id}`);
    },
    // 시험을 삭제하면 그 시험을 위해 생성된 학습 일정도 일간·주간·월간 모두에서
    // 즉시 사라지도록 schedules 캐시에서 linked_exam_id가 일치하는 항목을 함께 제거한다.
    onMutate: async (id) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ['exams'] }),
        qc.cancelQueries({ queryKey: ['schedules'] }),
      ]);
      const prevExams = qc.getQueryData<ExamSchedule[]>(['exams']);
      const prevSchedules = qc.getQueryData<Schedule[]>(['schedules']);
      qc.setQueryData<ExamSchedule[]>(['exams'], (old) => old?.filter((e) => e.id !== id) ?? []);
      qc.setQueryData<Schedule[]>(['schedules'], (old) => old?.filter((s) => s.linked_exam_id !== id) ?? []);
      return { prevExams, prevSchedules };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prevExams) qc.setQueryData(['exams'], ctx.prevExams);
      if (ctx?.prevSchedules) qc.setQueryData(['schedules'], ctx.prevSchedules);
    },
    onSettled: () => invalidateExamLinked(qc),
  });
}
