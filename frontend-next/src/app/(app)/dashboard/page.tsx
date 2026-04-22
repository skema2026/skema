import { redirect } from 'next/navigation';
import { serverFetch } from '@/lib/server-api';
import { Schedule, UserProfile } from '@/types';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const [schedules, profile] = await Promise.all([
    serverFetch<Schedule[]>('/schedules'),
    serverFetch<UserProfile>('/profiles'),
  ]);

  // 토큰 없음 → 로그인 페이지로
  if (schedules === null) {
    redirect('/login');
  }

  // 프로필 없음(신규 유저) 또는 온보딩 미완료 → 온보딩으로
  if (!profile || !profile.onboarding_completed) {
    redirect('/onboarding');
  }

  return (
    <DashboardClient
      initialSchedules={schedules ?? []}
      initialProfile={profile}
    />
  );
}
