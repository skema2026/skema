'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type GroupOut = {
  id: number;
  name: string;
  invite_code: string;
  member_count: number;
  created_at: string;
};

export type MemberOut = {
  user_id: number;
  username: string;
  joined_at: string;
};

export type GroupDetail = GroupOut & { members: MemberOut[] };

export type MemberSlot = {
  user_id: number;
  username: string;
  log_id: number | null;
  photo_url: string | null;
  caption: string | null;
  schedule_title: string | null;
  created_at: string | null;
  reactions: { emoji: string; count: number }[];
  my_reactions: string[];
};

export type GroupFeedDay = {
  date: string;
  slots: MemberSlot[];
};

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? '/proxy';
export const photoUrl = (path: string) => `${BACKEND}${path}`;

export function useMyGroups() {
  return useQuery({
    queryKey: ['groups', 'me'],
    queryFn: async () => {
      const { data } = await api.get<GroupOut[]>('/groups/me');
      return data;
    },
    staleTime: 30_000,
  });
}

export function useGroupDetail(groupId: number | null) {
  return useQuery({
    queryKey: ['groups', groupId],
    queryFn: async () => {
      const { data } = await api.get<GroupDetail>(`/groups/${groupId}`);
      return data;
    },
    enabled: groupId !== null,
    staleTime: 30_000,
  });
}

export function useGroupFeed(groupId: number | null, days = 7) {
  return useQuery({
    queryKey: ['groups', groupId, 'feed', days],
    queryFn: async () => {
      const { data } = await api.get<GroupFeedDay[]>(`/groups/${groupId}/feed`, { params: { days } });
      return data;
    },
    enabled: groupId !== null,
    staleTime: 30_000,
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data } = await api.post<GroupOut>('/groups', { name });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  });
}

export function useJoinGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invite_code: string) => {
      const { data } = await api.post<GroupOut>('/groups/join', { invite_code });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  });
}

export function useLeaveGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (groupId: number) => {
      await api.delete(`/groups/${groupId}/leave`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  });
}

export function useToggleGroupReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ logId, emoji }: { logId: number; emoji: string }) => {
      const { data } = await api.post<{ emoji: string; count: number }[]>(
        `/study-logs/${logId}/reactions`,
        { emoji },
      );
      return data;
    },
    onSuccess: (_data, { logId }) => {
      qc.invalidateQueries({ queryKey: ['groups'] });
    },
  });
}
