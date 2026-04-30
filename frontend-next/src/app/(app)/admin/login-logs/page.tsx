'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { LoginLog } from '@/types';
import MaterialIcon from '@/components/common/MaterialIcon';

const methodLabel = (method: LoginLog['login_method']) => (
  method === 'email' ? '이메일' : '아이디'
);

const formatDate = (value: string) => {
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

export default function AdminLoginLogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<LoginLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<LoginLog[]>('/admin/login-logs?limit=200')
      .then((res) => setLogs(res.data))
      .catch((err) => {
        if (err?.response?.status === 403) {
          setError('관리자 권한이 필요합니다.');
        } else {
          setError('로그를 불러오지 못했습니다.');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="skema-cute-page min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-[#0f172a]">로그인 로그</h1>
            <p className="mt-1 text-sm text-[#3f4b61]">관리자는 로그인에 사용된 아이디/이메일, 성공 여부, 접속 정보를 확인할 수 있습니다.</p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="inline-flex items-center gap-2 rounded-lg border border-[#bfd0ff] bg-white px-4 py-2 text-sm font-bold text-[#2563eb]"
          >
            <MaterialIcon icon="arrow_back" size={16} color="#2563eb" />
            대시보드
          </button>
        </header>

        <section className="overflow-hidden rounded-lg border border-[#d8e2ef] bg-white shadow-sm">
          {loading ? (
            <div className="flex h-48 items-center justify-center text-sm font-bold text-[#3f4b61]">불러오는 중...</div>
          ) : error ? (
            <div className="flex h-48 items-center justify-center text-sm font-bold text-red-600">{error}</div>
          ) : logs.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm font-bold text-[#3f4b61]">로그가 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
                <thead className="bg-[#eaf1ff] text-xs font-extrabold uppercase text-[#0f172a]">
                  <tr>
                    <th className="px-4 py-3">시간</th>
                    <th className="px-4 py-3">결과</th>
                    <th className="px-4 py-3">로그인 방식</th>
                    <th className="px-4 py-3">입력값</th>
                    <th className="px-4 py-3">회원 아이디</th>
                    <th className="px-4 py-3">회원 이메일</th>
                    <th className="px-4 py-3">IP</th>
                    <th className="px-4 py-3">User-Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-t border-[#eef2f7] align-top">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-[#0f172a]">{formatDate(log.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${log.success ? 'bg-[#d1fae5] text-[#047857]' : 'bg-[#fee2e2] text-[#b91c1c]'}`}>
                          {log.success ? '성공' : '실패'}
                        </span>
                        {!log.success && log.failure_reason ? (
                          <div className="mt-1 text-xs text-[#64748b]">{log.failure_reason}</div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#0f172a]">{methodLabel(log.login_method)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[#0f172a]">{log.login_identifier}</td>
                      <td className="px-4 py-3 text-[#0f172a]">{log.user?.username || '-'}</td>
                      <td className="px-4 py-3 text-[#0f172a]">{log.user?.email || '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-[#334155]">{log.ip_address || '-'}</td>
                      <td className="max-w-[320px] px-4 py-3 text-xs text-[#64748b]">{log.user_agent || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
