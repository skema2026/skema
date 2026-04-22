import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { User } from '@/types';
import { useAuthStore } from '@/store/authStore';

export function useMe() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data } = await api.get<User>('/users/me');
      return data;
    },
    enabled: !!token,
    retry: false,
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const { data } = await api.post<{ access_token: string; token_type: string }>('/auth/login', {
        email,
        password,
      });
      return data;
    },
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: async ({
      email,
      password,
    }: {
      email: string;
      password: string;
    }) => {
      const { data } = await api.post<User>('/auth/signup', { email, password });
      return data;
    },
  });
}
