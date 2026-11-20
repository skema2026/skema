'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { mediaUrl } from '@/lib/media';

export type ReactionOut = { emoji: string; count: number };

/** 공부 인증 규칙 안내 (셋로그처럼, 11/20) */
export const STUDY_LOG_RULE_TEXT = '인증은 한 시간에 한 번 올릴 수 있고, 오늘 올린 것만 보여요';

/** 서버 시각(UTC, 시간대 표기 없음)을 Date로. 'Z'가 없으면 UTC로 보고 붙인다 */
export function parseServerTime(value: string): Date {
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
}

/** 여러 그룹에 나눠 올리고 결과를 모은다 (한 시간 제한으로 일부 그룹만 막힐 수 있어서) */
export async function postToTargets<T>(
  targets: T[],
  send: (target: T) => Promise<unknown>,
): Promise<{ ok: number; failed: number; detail?: string }> {
  const results = await Promise.allSettled(targets.map(send));
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  const detail = (rejected?.reason as { response?: { data?: { detail?: unknown } } } | undefined)
    ?.response?.data?.detail;
  return { ok, failed: results.length - ok, detail: typeof detail === 'string' ? detail : undefined };
}

export type StudyLogItem = {
  id: number;
  user_id: number;
  username: string;
  schedule_id: number | null;
  schedule_title: string | null;
  photo_url: string | null;
  caption: string | null;
  created_at: string;
  reactions: ReactionOut[];
  my_reactions: string[];
};

export type FeedResponse = {
  items: StudyLogItem[];
  total: number;
  has_next: boolean;
};

export const photoUrl = mediaUrl;

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
      const { data } = await api.post<StudyLogItem>('/study-logs', form);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['study-logs'] });
      qc.invalidateQueries({ queryKey: ['groups'] });
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
      qc.invalidateQueries({ queryKey: ['groups'] });
    },
  });
}

// 오늘 통계
export function useTodayStats() {
  return useQuery({
    queryKey: ['study-logs', 'today-stats'],
    queryFn: async () => {
      const { data } = await api.get<{ today_users: number; today_logs: number }>('/study-logs/today-stats');
      return data;
    },
    staleTime: 60_000,
  });
}

// 스트릭
export type StreakInfo = {
  current_streak: number;
  longest_streak: number;
  today_checked: boolean;
};

export function useStreak() {
  return useQuery({
    queryKey: ['study-logs', 'streak'],
    queryFn: async () => {
      const { data } = await api.get<StreakInfo>('/study-logs/streak');
      return data;
    },
    staleTime: 60_000,
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
