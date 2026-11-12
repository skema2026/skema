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
import { useDeleteAccount } from '@/hooks/useAuth';
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
  const deleteAccount = useDeleteAccount();

  const [accountForm, setAccountForm] = useState<AccountForm>({ username: '', email: '' });
  const [isDeleteConfirm, setIsDeleteConfirm] = useState(false);
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
      toast.error(getErrorMessage(error, '계정 정보를 저장하지 못했어요'));
      return null;
    } finally {
      setAccountSaving(false);
    }
  };

  const saveProfile = async () => {
    if (profileForm.sleep_start === profileForm.sleep_end) {
      toast.error('일어나는 시간과 자는 시간이 같을 수 없어요');
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
      toast.error(getErrorMessage(error, '프로필을 저장하지 못했어요'));
      return null;
    }
  };

  const handleSaveAll = async () => {
    const account = await saveAccount();
    if (!account) return;
    const nextProfile = await saveProfile();
    if (!nextProfile) return;
    toast.success('저장했어요');
  };

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  const handleDeleteAccount = () => {
    deleteAccount.mutate(undefined, {
      onSuccess: () => {
        logout();
        router.replace('/login');
        toast.success('계정을 삭제했어요');
      },
      onError: () => toast.error('계정을 삭제하지 못했어요'),
    });
  };

  return (
    <div className="min-h-screen bg-[#f5f8fd] text-[#0f1e3a]">
      <header className="sticky top-0 z-20 border-b border-[#0f1e3a]/8 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="flex h-9 items-center gap-2 rounded-lg px-2 text-[14px] text-[#44536b] transition-colors hover:bg-[#edf3fc]"
          >
            <MaterialIcon icon="arrow_back" size={18} color="currentColor" />
            <span className="text-[16px] font-semibold text-[#0f1e3a]">프로필</span>
          </button>
          <Button
            onClick={handleSaveAll}
            disabled={isSaving}
            className="h-9 rounded-lg bg-[#2a6fe3] px-4 text-[14px] font-medium text-white hover:bg-[#1f63d6]"
          >
            {isSaving ? '저장하는 중' : '저장'}
          </Button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="rounded-2xl border border-[#0f1e3a]/8 bg-white p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#2a6fe3] text-[22px] font-medium text-white">
                {fallback}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[18px] font-semibold text-[#0f1e3a]">{displayName}</p>
                <p className="mt-0.5 truncate text-[13px] text-[#5f6f88]">{accountForm.email}</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-[#f5f8fd] p-3">
                <p className="text-[13px] text-[#5f6f88]">일어나는 시간</p>
                <p className="mt-1 font-mono text-[18px] font-medium tabular-nums text-[#0f1e3a]">{profileForm.sleep_end}</p>
              </div>
              <div className="rounded-xl bg-[#f5f8fd] p-3">
                <p className="text-[13px] text-[#5f6f88]">자는 시간</p>
                <p className="mt-1 font-mono text-[18px] font-medium tabular-nums text-[#0f1e3a]">{profileForm.sleep_start}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-[#0f1e3a]/8 bg-white p-5">
            <h2 className="text-[15px] font-medium text-[#0f1e3a]">이 설정이 쓰이는 곳</h2>
            <p className="mt-2 text-[14px] leading-[22px] text-[#44536b]">
              일어나는 시간은 하루·주간·월간 시간표가 시작하는 시각이에요. 자는 시간에는 공부 블록도, 다시 짜기도 일정을 넣지 않아요
            </p>
          </section>

          <section className="rounded-2xl border border-[#0f1e3a]/8 bg-white p-5">
            <h2 className="text-[15px] font-medium text-[#0f1e3a]">계정</h2>
            <div className="mt-4 space-y-2">
              {user?.is_admin && (
                <>
                  <button
                    type="button"
                    onClick={() => router.push('/admin/users')}
                    className="flex h-11 w-full items-center justify-between rounded-[10px] border border-[#0f1e3a]/10 px-4 text-[14px] text-[#0f1e3a] transition-colors hover:bg-[#edf3fc]"
                  >
                    관리자 회원 관리
                    <MaterialIcon icon="chevron_right" size={16} color="#5f6f88" />
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/admin/login-logs')}
                    className="flex h-11 w-full items-center justify-between rounded-[10px] border border-[#0f1e3a]/10 px-4 text-[14px] text-[#0f1e3a] transition-colors hover:bg-[#edf3fc]"
                  >
                    관리자 로그인 로그
                    <MaterialIcon icon="chevron_right" size={16} color="#5f6f88" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="h-11 w-full rounded-[10px] border border-[#0f1e3a]/10 px-4 text-[14px] text-[#0f1e3a] transition-colors hover:bg-[#edf3fc]"
              >
                로그아웃
              </button>
              {!isDeleteConfirm ? (
                <button
                  type="button"
                  onClick={() => setIsDeleteConfirm(true)}
                  className="h-11 w-full rounded-[10px] px-4 text-[14px] text-[#dc2626] transition-colors hover:bg-[#fef2f2]"
                >
                  회원탈퇴
                </button>
              ) : (
                <div className="rounded-xl bg-[#fef2f2] p-4">
                  <p className="mb-3 text-[13px] leading-[20px] text-[#b91c1c]">탈퇴하면 시간표·시험·기록이 모두 지워지고 되돌릴 수 없어요</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setIsDeleteConfirm(false)}
                      className="h-10 flex-1 rounded-[10px] border border-[#0f1e3a]/10 bg-white text-[14px] text-[#0f1e3a] transition-colors hover:bg-[#edf3fc]"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteAccount}
                      disabled={deleteAccount.isPending}
                      className="h-10 flex-1 rounded-[10px] bg-[#dc2626] text-[14px] font-medium text-white transition-colors hover:bg-[#b91c1c] disabled:opacity-50"
                    >
                      {deleteAccount.isPending ? '탈퇴하는 중' : '탈퇴'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </aside>

        <div className="space-y-5">
          <section className="rounded-2xl border border-[#0f1e3a]/8 bg-white p-5 sm:p-6">
            <h1 className="text-[18px] font-semibold text-[#0f1e3a]">계정 정보</h1>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="profile-name" className="text-[13px] font-normal text-[#44536b]">표시 이름</Label>
                <Input
                  id="profile-name"
                  value={accountForm.username}
                  onChange={(event) => setAccountForm({ ...accountForm, username: event.target.value })}
                  placeholder="이름 또는 닉네임"
                  className="h-11 rounded-[10px] border-[#0f1e3a]/10 bg-white px-3 text-[15px] text-[#0f1e3a] focus-visible:border-[#2a6fe3] focus-visible:ring-3 focus-visible:ring-[#2a6fe3]/15"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-email" className="text-[13px] font-normal text-[#44536b]">이메일</Label>
                <Input
                  id="profile-email"
                  type="email"
                  value={accountForm.email}
                  onChange={(event) => setAccountForm({ ...accountForm, email: event.target.value })}
                  placeholder="email@example.com"
                  className="h-11 rounded-[10px] border-[#0f1e3a]/10 bg-white px-3 text-[15px] text-[#0f1e3a] focus-visible:border-[#2a6fe3] focus-visible:ring-3 focus-visible:ring-[#2a6fe3]/15"
                  aria-invalid={!emailValid}
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-[#0f1e3a]/8 bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[18px] font-semibold text-[#0f1e3a]">생활 기준</h2>
              <span className="font-mono text-[13px] tabular-nums text-[#5f6f88]">
                시간표 시작 {profileForm.sleep_end}
              </span>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {USER_TYPES.map((type) => {
                const active = profileForm.user_type === type.value;
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => updateProfileDraft({ user_type: type.value })}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      active
                        ? 'border-[#2a6fe3] bg-[#eaf2ff]'
                        : 'border-[#0f1e3a]/10 bg-white hover:bg-[#f5f8fd]'
                    }`}
                  >
                    <p className={`text-[15px] font-medium ${active ? 'text-[#1f63d6]' : 'text-[#0f1e3a]'}`}>{type.label}</p>
                    <p className="mt-1 text-[12px] leading-[18px] text-[#5f6f88]">{type.detail}</p>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-[13px] font-normal text-[#44536b]">직업·상태</Label>
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
                        className={`h-10 rounded-[10px] border px-3 text-[14px] transition-colors ${
                          active
                            ? 'border-[#2a6fe3] bg-[#eaf2ff] font-medium text-[#1f63d6]'
                            : 'border-[#0f1e3a]/10 bg-white text-[#44536b] hover:bg-[#f5f8fd]'
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
                    className="h-11 rounded-[10px] border-[#0f1e3a]/10 bg-white px-3 text-[15px] text-[#0f1e3a] focus-visible:border-[#2a6fe3] focus-visible:ring-3 focus-visible:ring-[#2a6fe3]/15"
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="wake-time" className="text-[13px] font-normal text-[#44536b]">기상 시간</Label>
                  <Input
                    id="wake-time"
                    type="time"
                    step="300"
                    value={profileForm.sleep_end}
                    onChange={(event) => updateProfileDraft({ sleep_end: event.target.value })}
                    className="h-11 rounded-[10px] border-[#0f1e3a]/10 bg-white px-3 text-[15px] text-[#0f1e3a] focus-visible:border-[#2a6fe3] focus-visible:ring-3 focus-visible:ring-[#2a6fe3]/15"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sleep-time" className="text-[13px] font-normal text-[#44536b]">취침 시간</Label>
                  <Input
                    id="sleep-time"
                    type="time"
                    step="300"
                    value={profileForm.sleep_start}
                    onChange={(event) => updateProfileDraft({ sleep_start: event.target.value })}
                    className="h-11 rounded-[10px] border-[#0f1e3a]/10 bg-white px-3 text-[15px] text-[#0f1e3a] focus-visible:border-[#2a6fe3] focus-visible:ring-3 focus-visible:ring-[#2a6fe3]/15"
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="semester-start" className="text-[13px] font-normal text-[#44536b]">학기 시작일</Label>
                  <Input
                    id="semester-start"
                    type="date"
                    value={profileForm.semester_start_date}
                    onChange={(event) => updateProfileDraft({ semester_start_date: event.target.value })}
                    className="h-11 rounded-[10px] border-[#0f1e3a]/10 bg-white px-3 text-[15px] text-[#0f1e3a] focus-visible:border-[#2a6fe3] focus-visible:ring-3 focus-visible:ring-[#2a6fe3]/15"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-xl bg-[#f5f8fd] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[15px] font-medium text-[#0f1e3a]">대학생 시간표 모드</p>
                  <p className="mt-0.5 text-[13px] text-[#5f6f88]">강의실, 시험, 학기 반복 일정을 먼저 보여 줘요</p>
                </div>
                <button
                  type="button"
                  onClick={() => updateProfileDraft({ is_college_student: !profileForm.is_college_student })}
                  role="switch"
                  aria-checked={profileForm.is_college_student}
                  className={`h-9 rounded-lg px-4 text-[14px] transition-colors ${
                    profileForm.is_college_student ? 'bg-[#2a6fe3] font-medium text-white' : 'border border-[#0f1e3a]/10 bg-white text-[#44536b]'
                  }`}
                >
                  {profileForm.is_college_student ? '켜짐' : '꺼짐'}
                </button>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <Label htmlFor="goal-tasks" className="text-[13px] font-normal text-[#44536b]">목표 메모</Label>
              <Textarea
                id="goal-tasks"
                value={profileForm.goal_tasks}
                onChange={(event) => updateProfileDraft({ goal_tasks: event.target.value })}
                placeholder="예: 이번 학기 목표, 시험 전 주에는 복습 먼저"
                className="min-h-28 rounded-[10px] border-[#0f1e3a]/10 bg-white p-3 text-[15px] leading-[24px] focus-visible:border-[#2a6fe3] focus-visible:ring-3 focus-visible:ring-[#2a6fe3]/15"
              />
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
