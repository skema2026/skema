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
        setChecking(false);
      });
  }, [_hasHydrated, token, router, setUser, logout]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-500 dark:text-gray-400">로딩 중...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
