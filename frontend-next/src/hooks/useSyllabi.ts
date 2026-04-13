import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ── 분석 결과 타입 ───────────────────────────────────────────────────────────

export type WeeklyPlanItem = { week: number; topic: string };
export type ExamScheduleItem = { type: string; date: string };
export type AssignmentItem = { title: string; due_date: string };

export type SyllabusAnalysis = {
  id: number;
  syllabus_id: number;
  user_id: number;
  subject_name: string;
  // 구조화 필드
  weekly_plan: WeeklyPlanItem[] | null;
  evaluation: {
    midterm: number | null;
    final: number | null;
    assignment: number | null;
    attendance: number | null;
    presentation: number | null;
  } | null;
  exam_schedule: ExamScheduleItem[] | null;
  assignments: AssignmentItem[] | null;
  presentation: boolean | null;
  important_notes: string[] | null;
  midterm_week: number | null;
  final_week: number | null;
  // 상태
  analysis_status: 'pending' | 'success' | 'partial' | 'failed';
  analyzed_at: string;
};

export type SyllabusItem = {
  id: number;
  user_id: number;
  subject_name: string;
  original_filename: string;
  file_size: number | null;
  content_type: string | null;
  source: string | null;
  uploaded_at: string;
};

export function useSyllabi() {
  return useQuery({
    queryKey: ['syllabi'],
    queryFn: async () => {
      const { data } = await api.get<SyllabusItem[]>('/syllabi');
      return data;
    },
  });
}

export function useUploadSyllabus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      subjectName,
      file,
      source = 'syllabus_upload',
    }: {
      subjectName: string;
      file: File;
      source?: string;
    }) => {
      const form = new FormData();
      form.append('subject_name', subjectName);
      form.append('file', file);
      form.append('source', source);
      const { data } = await api.post<SyllabusItem>('/syllabi/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['syllabi'] }),
  });
}

export function useDeleteSyllabus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/syllabi/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['syllabi'] }),
  });
}

/** 특정 강의계획서의 분석 결과를 조회한다. */
export function useSyllabusAnalysis(syllabusId: number | null, enabled = true) {
  return useQuery({
    queryKey: ['syllabus-analysis', syllabusId],
    queryFn: async () => {
      const { data } = await api.get<SyllabusAnalysis>(`/syllabi/${syllabusId}/analysis`);
      return data;
    },
    enabled: enabled && syllabusId != null,
    retry: false,
  });
}

/** 강의계획서 분석 결과에서 시험 일정을 자동 등록한다. POST /syllabi/{id}/auto-create-exam */
export function useAutoCreateExam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      syllabusId,
      semesterStartDate,
    }: {
      syllabusId: number;
      semesterStartDate?: string; // YYYY-MM-DD
    }) => {
      const { data } = await api.post<{
        created: number;
        skipped: number;
        exams: Array<{ id: number; title: string; exam_date: string; already_existed: boolean }>;
      }>(`/syllabi/${syllabusId}/auto-create-exam`, { semester_start_date: semesterStartDate || null });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exams'] });
    },
  });
}

/** 강의계획서 분석을 (재)시작한다. POST /syllabi/{id}/analyze */
export function useReAnalyzeSyllabus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (syllabusId: number) => {
      const { data } = await api.post(`/syllabi/${syllabusId}/analyze`);
      return data;
    },
    onSuccess: (_data, syllabusId) => {
      // 분석 결과 캐시 무효화 (재조회 유도)
      qc.invalidateQueries({ queryKey: ['syllabus-analysis', syllabusId] });
    },
  });
}
