'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type ReactionOut = { emoji: string; count: number };

export type StudyLogItem = {
  id: number;
  user_id: number;
  username: string;
  schedule_id: number | null;
  schedule_title: string | null;
  photo_url: string;
  caption: string | null;
  is_public: boolean;
  created_at: string;
  reactions: ReactionOut[];
  my_reactions: string[];
};

export type FeedResponse = {
  items: StudyLogItem[];
  total: number;
  has_next: boolean;
};

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? '/proxy';
export const photoUrl = (path: string) => `${BACKEND}${path}`;

// 피드
export function useStudyFeed(offset = 0, limit = 20) {
  return useQuery({
    queryKey: ['study-logs', 'feed', offset],
    queryFn: async () => {
      const { data } = await api.get<FeedResponse>('/study-logs/feed', { params: { offset, limit } });
      return data;
    },
    staleTime: 30_000,
  });
}

// 내 로그
export function useMyStudyLogs() {
  return useQuery({
    queryKey: ['study-logs', 'me'],
    queryFn: async () => {
      const { data } = await api.get<FeedResponse>('/study-logs/me');
      return data;
    },
    staleTime: 0,
  });
}

// 업로드
export function useCreateStudyLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: FormData) => {
      const { data } = await api.post<StudyLogItem>('/study-logs', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['study-logs'] });
    },
  });
}

// 삭제
export function useDeleteStudyLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/study-logs/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['study-logs'] });
    },
  });
}

// 리액션 토글
export function useToggleReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ logId, emoji }: { logId: number; emoji: string }) => {
      const { data } = await api.post<ReactionOut[]>(`/study-logs/${logId}/reactions`, { emoji });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['study-logs'] });
    },
  });
}
