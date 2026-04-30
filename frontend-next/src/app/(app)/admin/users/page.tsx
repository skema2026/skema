'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { AdminUser } from '@/types';
import MaterialIcon from '@/components/common/MaterialIcon';

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const providerLabel = (provider?: string | null) => {
  if (!provider) return '이메일 가입';
  if (provider === 'naver') return '네이버';
  if (provider === 'kakao') return '카카오';
  if (provider === 'google') return 'Google';
  return provider;
};

export default function AdminUsersPage() {
  const router = useRouter();
  const currentUser = useAuthStore((state) => state.user);
  const hasHydrated = useAuthStore((state) => state._hasHydrated);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!currentUser?.is_admin) {
      router.replace('/dashboard');
      return;
    }
    api
      .get<AdminUser[]>('/admin/users?limit=500')
      .then((res) => setUsers(res.data))
      .catch((err) => {
        if (err?.response?.status === 403) {
          router.replace('/dashboard');
        } else {
          setError('회원 목록을 불러오지 못했습니다.');
        }
      })
      .finally(() => setLoading(false));
  }, [hasHydrated, currentUser, router]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return users;
    return users.filter((user) => (
      user.username?.toLowerCase().includes(keyword) ||
      user.email.toLowerCase().includes(keyword) ||
      user.social_provider?.toLowerCase().includes(keyword)
    ));
  }, [query, users]);

  const handleDelete = async (user: AdminUser) => {
    if (currentUser?.id === user.id) {
      toast.error('현재 로그인한 계정은 삭제할 수 없습니다.');
      return;
    }

    const label = user.username ? `${user.username} (${user.email})` : user.email;
    if (!window.confirm(`${label} 회원을 삭제할까요?\n삭제하면 해당 회원의 일정과 프로필도 함께 삭제됩니다.`)) {
      return;
    }

    setDeletingId(user.id);
    try {
      await api.delete(`/admin/users/${user.id}`);
      setUsers((prev) => prev.filter((item) => item.id !== user.id));
      toast.success('회원을 삭제했습니다.');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      toast.error(error?.response?.data?.detail || '회원 삭제에 실패했습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main className="skema-cute-page min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-[#0f172a]">회원 관리</h1>
            <p className="mt-1 text-sm text-[#3f4b61]">DB에 등록된 회원의 아이디와 이메일을 확인합니다. 비밀번호는 표시하지 않습니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => router.push('/admin/login-logs')}
              className="inline-flex items-center gap-2 rounded-lg border border-[#d8e2ef] bg-white px-4 py-2 text-sm font-bold text-[#334155]"
            >
              로그인 로그
            </button>
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              className="inline-flex items-center gap-2 rounded-lg border border-[#bfd0ff] bg-white px-4 py-2 text-sm font-bold text-[#2563eb]"
            >
              <MaterialIcon icon="arrow_back" size={16} color="#2563eb" />
              대시보드
            </button>
          </div>
        </header>

        <section className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-[#3f4b61]">검색</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="아이디, 이메일, 가입 방식으로 검색"
              className="h-11 w-full rounded-lg border border-[#d8e2ef] bg-white px-4 text-sm outline-none focus:border-[#2563eb]"
            />
          </label>
          <div className="flex items-end">
            <div className="rounded-lg border border-[#d8e2ef] bg-white px-4 py-2 text-sm font-bold text-[#0f172a]">
              전체 {users.length}명 · 표시 {filtered.length}명
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-[#d8e2ef] bg-white shadow-sm">
          {loading ? (
            <div className="flex h-48 items-center justify-center text-sm font-bold text-[#3f4b61]">불러오는 중...</div>
          ) : error ? (
            <div className="flex h-48 items-center justify-center text-sm font-bold text-red-600">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm font-bold text-[#3f4b61]">회원이 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                <thead className="bg-[#eaf1ff] text-xs font-extrabold uppercase text-[#0f172a]">
                  <tr>
                    <th className="px-4 py-3">ID</th>
                    <th className="px-4 py-3">아이디</th>
                    <th className="px-4 py-3">이메일</th>
                    <th className="px-4 py-3">가입 방식</th>
                    <th className="px-4 py-3">상태</th>
                    <th className="px-4 py-3">가입일</th>
                    <th className="px-4 py-3">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => {
                    const isCurrentUser = currentUser?.id === user.id;
                    return (
                      <tr key={user.id} className="border-t border-[#eef2f7]">
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[#64748b]">{user.id}</td>
                        <td className="px-4 py-3 font-bold text-[#0f172a]">{user.username || '-'}</td>
                        <td className="px-4 py-3 text-[#0f172a]">{user.email}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-[#f1f5f9] px-2.5 py-1 text-xs font-bold text-[#334155]">
                            {providerLabel(user.social_provider)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${user.is_active === false ? 'bg-[#fee2e2] text-[#b91c1c]' : 'bg-[#d1fae5] text-[#047857]'}`}>
                            {user.is_active === false ? '비활성' : '활성'}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-[#334155]">{formatDate(user.created_at)}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {isCurrentUser ? (
                            <span className="rounded-lg border border-[#dbeafe] bg-[#eff6ff] px-3 py-1.5 text-xs font-extrabold text-[#2563eb]">
                              현재 로그인 중
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={deletingId === user.id}
                              onClick={() => handleDelete(user)}
                              className="rounded-lg border border-[#fecaca] bg-[#fff1f2] px-3 py-1.5 text-xs font-extrabold text-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {deletingId === user.id ? '삭제 중...' : '삭제'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
