'use client';

import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import MaterialIcon from '@/components/common/MaterialIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useProfile, useUpdateProfile } from '@/hooks/useProfile';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import type { User } from '@/types';

const USER_TYPES = [
  { value: 'student', label: '학생', detail: '강의·시험·과제 중심' },
  { value: 'exam_prep', label: '시험 준비', detail: 'D-day와 공부 블록 중심' },
  { value: 'worker', label: '직장인', detail: '업무·개인 일정 중심' },
  { value: 'other', label: '기타', detail: '자유로운 시간 관리' },
];

const OCCUPATIONS = ['대학생', '취업 준비', '직장인', '프리랜서', '기타'];

type AccountForm = {
  username: string;
  email: string;
};

type ProfileForm = {
  user_type: string;
  occupation: string;
  goal_tasks: string;
  sleep_start: string;
  sleep_end: string;
  is_college_student: boolean;
  semester_start_date: string;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string') return detail;
  }
  return fallback;
};

export default function ProfileClient() {
  const router = useRouter();
  const { user, setUser, logout } = useAuthStore();
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();



  const [accountForm, setAccountForm] = useState<AccountForm>({ username: '', email: '' });
  const [profileDraft, setProfileDraft] = useState<ProfileForm | null>(null);
  const [accountSaving, setAccountSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setAccountForm({
      username: user.username || '',
      email: user.email || '',
    });
  }, [user]);

  useEffect(() => {
    if (!profile) return;
    setProfileDraft({
      user_type: profile.user_type || 'student',
      occupation: profile.occupation || '',
      goal_tasks: profile.goal_tasks || '',
      sleep_start: profile.sleep_start || '23:00',
      sleep_end: profile.sleep_end || '07:00',
      is_college_student: Boolean(profile.is_college_student),
      semester_start_date: profile.semester_start_date || '',
    });
  }, [profile]);

  const profileForm = profileDraft ?? {
    user_type: 'student',
    occupation: '',
    goal_tasks: '',
    sleep_start: '23:00',
    sleep_end: '07:00',
    is_college_student: false,
    semester_start_date: '',
  };

  const displayName = accountForm.username || accountForm.email.split('@')[0] || '사용자';
  const fallback = displayName[0]?.toUpperCase() || 'U';
  const isSaving = accountSaving || updateProfile.isPending;
  const emailValid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountForm.email.trim()), [accountForm.email]);
  const isCustomOccupation = !!profileForm.occupation && !OCCUPATIONS.includes(profileForm.occupation);

  const updateProfileDraft = (next: Partial<ProfileForm>) => {
    setProfileDraft({ ...profileForm, ...next });
  };

  const saveAccount = async () => {
    if (!emailValid) {
      toast.error('이메일 형식을 확인해 주세요');
      return null;
    }

    setAccountSaving(true);
    try {
      const payload = {
        username: accountForm.username.trim() || null,
        email: accountForm.email.trim(),
      };
      const { data } = await api.put<User>('/users/me', payload);
      setUser(data);
      return data;
    } catch (error) {
      toast.error(getErrorMessage(error, '계정 정보를 저장하지 못했습니다'));
      return null;
    } finally {
      setAccountSaving(false);
    }
  };

  const saveProfile = async () => {
    if (profileForm.sleep_start === profileForm.sleep_end) {
      toast.error('기상 시간과 취침 시간이 같을 수 없습니다');
      return null;
    }

    try {
      return await updateProfile.mutateAsync({
        user_type: profileForm.user_type,
        occupation: profileForm.occupation.trim() || undefined,
        goal_tasks: profileForm.goal_tasks.trim() || undefined,
        sleep_start: profileForm.sleep_start,
        sleep_end: profileForm.sleep_end,
        is_college_student: profileForm.is_college_student,
        semester_start_date: profileForm.semester_start_date || undefined,
      });
    } catch (error) {
      toast.error(getErrorMessage(error, '프로필을 저장하지 못했습니다'));
      return null;
    }
  };

  const handleSaveAll = async () => {
    const account = await saveAccount();
    if (!account) return;
    const nextProfile = await saveProfile();
    if (!nextProfile) return;
    toast.success('프로필이 저장되었습니다');
  };

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  return (
    <div className="min-h-screen bg-[#f8fbff]">
      <header className="sticky top-0 z-20 border-b border-blue-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-2 rounded-xl border border-blue-100 bg-white px-3 py-2 text-sm font-black text-slate-700 shadow-sm transition hover:bg-blue-50"
          >
            <MaterialIcon icon="arrow_back" size={16} color="#2563eb" />
            대시보드
          </button>
          <Button
            onClick={handleSaveAll}
            disabled={isSaving}
            className="h-10 rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-lg shadow-blue-200 hover:bg-blue-700"
          >
            {isSaving ? '저장 중...' : '변경사항 저장'}
          </Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-2xl font-black text-white shadow-lg shadow-blue-100">
                {fallback}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xl font-black text-slate-950">{displayName}</p>
                <p className="mt-1 truncate text-sm font-bold text-slate-500">{accountForm.email}</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-blue-50 p-3">
                <p className="text-xs font-black text-blue-600">기상 기준</p>
                <p className="mt-1 text-lg font-black text-slate-950">{profileForm.sleep_end}</p>
              </div>
              <div className="rounded-xl bg-blue-50 p-3">
                <p className="text-xs font-black text-blue-600">취침 기준</p>
                <p className="mt-1 text-lg font-black text-slate-950">{profileForm.sleep_start}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50">
                <MaterialIcon icon="smart_toy" size={22} color="#2563eb" />
              </div>
              <div>
                <p className="text-sm font-black text-blue-600">AI 개인화 기준</p>
                <h2 className="mt-1 text-xl font-black text-slate-950">시간표가 이 설정을 기준으로 정리됩니다</h2>
                <p className="mt-2 text-sm font-bold leading-6 text-slate-500">
                  기상 시간은 일간·주간·월간 시간표의 시작 기준이고, 목표와 신분은 AI가 빈 시간을 추천할 때 참고합니다.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">계정</h2>
            <div className="mt-4 space-y-2">
              {user?.is_admin && (
                <>
                  <button
                    type="button"
                    onClick={() => router.push('/admin/users')}
                    className="flex w-full items-center justify-between rounded-xl border border-blue-100 px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-blue-50"
                  >
                    관리자 회원 관리
                    <MaterialIcon icon="chevron_right" size={16} color="#64748b" />
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/admin/login-logs')}
                    className="flex w-full items-center justify-between rounded-xl border border-blue-100 px-4 py-3 text-sm font-black text-slate-700 transition hover:bg-blue-50"
                  >
                    관리자 로그인 로그
                    <MaterialIcon icon="chevron_right" size={16} color="#64748b" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center justify-between rounded-xl border border-red-100 px-4 py-3 text-sm font-black text-red-600 transition hover:bg-red-50"
              >
                로그아웃
                <MaterialIcon icon="close" size={16} color="#dc2626" />
              </button>
            </div>
          </section>
        </aside>

        <div className="space-y-5">
          <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600">
                <MaterialIcon icon="person" size={22} color="#fff" />
              </div>
              <div>
                <p className="text-sm font-black text-blue-600">프로필 관리</p>
                <h1 className="text-2xl font-black text-slate-950">내 계정 정보</h1>
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="profile-name" className="font-black text-slate-900">표시 이름</Label>
                <Input
                  id="profile-name"
                  value={accountForm.username}
                  onChange={(event) => setAccountForm({ ...accountForm, username: event.target.value })}
                  placeholder="이름 또는 닉네임"
                  className="h-12 rounded-xl border-blue-100 bg-slate-50 px-4 text-base font-bold"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-email" className="font-black text-slate-900">이메일</Label>
                <Input
                  id="profile-email"
                  type="email"
                  value={accountForm.email}
                  onChange={(event) => setAccountForm({ ...accountForm, email: event.target.value })}
                  placeholder="email@example.com"
                  className="h-12 rounded-xl border-blue-100 bg-slate-50 px-4 text-base font-bold"
                  aria-invalid={!emailValid}
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-blue-600">시간표 개인화</p>
                <h2 className="text-2xl font-black text-slate-950">AI가 참고할 생활 기준</h2>
              </div>
              <div className="rounded-full bg-blue-50 px-4 py-2 text-sm font-black text-blue-600">
                시간표 시작 {profileForm.sleep_end}
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {USER_TYPES.map((type) => {
                const active = profileForm.user_type === type.value;
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => updateProfileDraft({ user_type: type.value })}
                    className={`rounded-2xl border p-4 text-left transition ${
                      active
                        ? 'border-blue-600 bg-blue-50 shadow-sm'
                        : 'border-blue-100 bg-white hover:bg-blue-50'
                    }`}
                  >
                    <p className={`text-base font-black ${active ? 'text-blue-600' : 'text-slate-900'}`}>{type.label}</p>
                    <p className="mt-1 text-xs font-bold leading-5 text-slate-500">{type.detail}</p>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="font-black text-slate-900">직업 / 상태</Label>
                <div className="grid grid-cols-2 gap-2">
                  {OCCUPATIONS.map((occupation) => {
                    const active = occupation === '기타'
                      ? profileForm.occupation === '기타' || isCustomOccupation
                      : profileForm.occupation === occupation;
                    return (
                      <button
                        key={occupation}
                        type="button"
                        onClick={() => updateProfileDraft({ occupation })}
                        className={`rounded-xl border px-3 py-3 text-sm font-black transition ${
                          active
                            ? 'border-blue-600 bg-blue-50 text-blue-600'
                            : 'border-blue-100 bg-white text-slate-600 hover:bg-blue-50'
                        }`}
                      >
                        {occupation}
                      </button>
                    );
                  })}
                </div>
                {(profileForm.occupation === '기타' || isCustomOccupation) && (
                  <Input
                    value={profileForm.occupation === '기타' ? '' : profileForm.occupation}
                    onChange={(event) => updateProfileDraft({ occupation: event.target.value })}
                    placeholder="직접 입력"
                    className="h-11 rounded-xl border-blue-100 bg-slate-50 px-4 font-bold"
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="wake-time" className="font-black text-slate-900">기상 시간</Label>
                  <Input
                    id="wake-time"
                    type="time"
                    step="300"
                    value={profileForm.sleep_end}
                    onChange={(event) => updateProfileDraft({ sleep_end: event.target.value })}
                    className="h-12 rounded-xl border-blue-100 bg-slate-50 px-4 text-base font-black"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sleep-time" className="font-black text-slate-900">취침 시간</Label>
                  <Input
                    id="sleep-time"
                    type="time"
                    step="300"
                    value={profileForm.sleep_start}
                    onChange={(event) => updateProfileDraft({ sleep_start: event.target.value })}
                    className="h-12 rounded-xl border-blue-100 bg-slate-50 px-4 text-base font-black"
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="semester-start" className="font-black text-slate-900">학기 시작일</Label>
                  <Input
                    id="semester-start"
                    type="date"
                    value={profileForm.semester_start_date}
                    onChange={(event) => updateProfileDraft({ semester_start_date: event.target.value })}
                    className="h-12 rounded-xl border-blue-100 bg-slate-50 px-4 text-base font-black"
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-blue-100 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-base font-black text-slate-950">대학생 시간표 모드</p>
                  <p className="mt-1 text-sm font-bold text-slate-500">강의실, 시험, 학기 반복 일정을 우선으로 보여줍니다.</p>
                </div>
                <button
                  type="button"
                  onClick={() => updateProfileDraft({ is_college_student: !profileForm.is_college_student })}
                  className={`h-9 rounded-full px-4 text-sm font-black transition ${
                    profileForm.is_college_student ? 'bg-blue-600 text-white' : 'bg-white text-slate-500'
                  }`}
                >
                  {profileForm.is_college_student ? '켜짐' : '꺼짐'}
                </button>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <Label htmlFor="goal-tasks" className="font-black text-slate-900">AI에게 알려둘 목표</Label>
              <Textarea
                id="goal-tasks"
                value={profileForm.goal_tasks}
                onChange={(event) => updateProfileDraft({ goal_tasks: event.target.value })}
                placeholder="예: 오전에는 집중 과목, 시험 전 주에는 복습 시간을 먼저 잡아줘"
                className="min-h-28 rounded-xl border-blue-100 bg-slate-50 p-4 text-base font-bold leading-7"
              />
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
