'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Schedule, UserProfile } from '@/types';
import DashboardClient from './DashboardClient';

export default function DashboardPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [initialSchedules, setInitialSchedules] = useState<Schedule[]>([]);
  const [initialProfile, setInitialProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.replace('/login');
      return;
    }

    Promise.all([
      api.get<Schedule[]>('/schedules').then(r => r.data).catch(() => null),
      api.get<UserProfile>('/profiles').then(r => r.data).catch(() => null),
    ]).then(([schedules, profile]) => {
      if (!schedules) {
        router.replace('/login');
        return;
      }
      if (!profile || !profile.onboarding_completed) {
        router.replace('/onboarding');
        return;
      }
      setInitialSchedules(schedules);
      setInitialProfile(profile);
      setReady(true);
    });
  }, [router]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#dbe8ff] border-t-[#2563eb]" />
      </div>
    );
  }

  return <DashboardClient initialSchedules={initialSchedules} initialProfile={initialProfile} />;
}
