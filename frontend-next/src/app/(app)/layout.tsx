'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';

import { api } from '@/lib/api';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token, _hasHydrated, setUser, logout } = useAuthStore();
  const [checking, setChecking] = useState(true);
  const isInitialized = useRef(false);

  useEffect(() => {
    // Zustand persist가 localStorage에서 token을 복원할 때까지 대기
    if (!_hasHydrated || isInitialized.current) return;

    isInitialized.current = true;

    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChecking(false);
      router.replace('/login');
      return;
    }

    api
      .get('/users/me')
      .then(({ data }) => {
        setUser(data);
      })
      .catch(() => {
        logout();
        router.replace('/login');
      })
      .finally(() => {
        setChec4king(false);
      });
  }, [_hasHydrated, token, router, setUser, logout]);

  if (checking) {
    return (
      <div className="skema-cute-page min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-11 w-11 animate-spin rounded-full border-4 border-[#e8f3ff] border-t-[#2563eb]" />
          <p className="text-sm font-bold text-[#3f4b61]">SKEMA를 준비하고 있습니다</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
