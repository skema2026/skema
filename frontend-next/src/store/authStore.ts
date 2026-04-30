import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User } from '@/types';

const clearTokenCookie = () => {
  if (typeof document === 'undefined') return;
  document.cookie = 'token=; path=/; max-age=0; SameSite=Lax';
};

const setTokenCookie = (token: string) => {
  if (typeof document === 'undefined') return;
  document.cookie = `token=${token}; path=/; max-age=86400; SameSite=Lax`;
};

const clearStoredAuth = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('token');
  localStorage.removeItem('auth-storage');
  clearTokenCookie();
};

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
          if (typeof window !== 'undefined') {
            localStorage.setItem('token', token);
          }
          setTokenCookie(token);
        } else {
          set({ user: null });
          clearStoredAuth();
        }
      },
      logout: () => {
        set({ user: null, token: null });
        clearStoredAuth();
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
