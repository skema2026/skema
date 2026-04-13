import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  _hasHydrated: boolean;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setHasHydrated: (v: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),
      setUser: (user) => set({ user }),
      setToken: (token) => {
        set({ token });
        if (token) {
          localStorage.setItem('token', token);
          document.cookie = `token=${token}; path=/; max-age=86400; SameSite=Lax`;
        } else {
          localStorage.removeItem('token');
          document.cookie = 'token=; path=/; max-age=0';
        }
      },
      logout: () => {
        set({ user: null, token: null });
        localStorage.removeItem('token');
        document.cookie = 'token=; path=/; max-age=0';
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
