import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { UserProfile } from '@/types';

export function useProfile(initialData?: UserProfile) {
  return useQuery({
    queryKey: ['profile'],
    queryFn: async () => {
      const { data } = await api.get<UserProfile>('/profile');
      return data;
    },
    initialData,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (profile: Partial<UserProfile>) => {
      const { data } = await api.put<UserProfile>('/profile', profile);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });
}
