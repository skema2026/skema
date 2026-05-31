'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type PostOut = {
  id: number;
  author_id: number;
  username: string;
  content: string;
  image_url: string | null;
  likes_count: number;
  liked: boolean;
  created_at: string;
};

export type PostFeed = {
  items: PostOut[];
  total: number;
  has_next: boolean;
};

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? '/proxy';
export const postImageUrl = (path: string) => `${BACKEND}${path}`;

export function useFeed(offset = 0, limit = 20) {
  return useQuery({
    queryKey: ['posts', offset],
    queryFn: async () => {
      const { data } = await api.get<PostFeed>('/posts', { params: { offset, limit } });
      return data;
    },
    staleTime: 30_000,
  });
}

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: FormData) => {
      const { data } = await api.post<PostOut>('/posts', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['posts'] }),
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (postId: number) => {
      await api.delete(`/posts/${postId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['posts'] }),
  });
}

export function useToggleLike() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (postId: number) => {
      const { data } = await api.post<PostOut>(`/posts/${postId}/like`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['posts'] }),
  });
}
