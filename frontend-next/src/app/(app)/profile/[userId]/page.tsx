'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import MaterialIcon from '@/components/common/MaterialIcon';
import { isVideoUrl, mediaUrl } from '@/lib/media';

type PublicProfile = {
  user_id: number;
  username: string;
  joined_at: string | null;
  streak: { current_streak: number; longest_streak: number; today_checked: boolean };
  logs:  { id: number; caption: string | null; photo_url: string | null; created_at: string }[];
};

function usePublicProfile(userId: number) {
  return useQuery({
    queryKey: ['users', userId, 'profile'],
    queryFn: async () => {
      const { data } = await api.get<PublicProfile>(`/users/${userId}/profile`);
      return data;
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}

const AVATAR_COLORS = ['#2a6fe3', '#4f46e5', '#0891b2', '#0d9488', '#7c3aed', '#4591fd'];

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60)  return `${Math.max(1, m)}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function PublicProfilePage() {
  const router    = useRouter();
  const { userId } = useParams<{ userId: string }>();
  const uid = Number(userId);
  const { data, isLoading, isError } = usePublicProfile(uid);

  const color = AVATAR_COLORS[uid % AVATAR_COLORS.length];

  return (
    <div className="min-h-dvh bg-[#f5f8fd]">
      <div className="mx-auto min-h-dvh max-w-2xl">

        {/* 헤더 */}
        <header className="sticky top-0 z-20 border-b border-[#0f1e3a]/8 bg-white px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => router.back()}
              aria-label="뒤로"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[#44536b] transition-colors hover:bg-[#edf3fc]">
              <MaterialIcon icon="arrow_back" size={18} color="currentColor" />
            </button>
            <h1 className="text-[17px] font-semibold text-[#0f1e3a]">프로필</h1>
          </div>
        </header>

        <main className="px-4 py-5 sm:px-6">
          {isLoading && (
            <div className="flex h-40 items-center justify-center text-[14px] text-[#5f6f88]">불러오는 중</div>
          )}
          {isError && (
            <div className="mt-8 rounded-2xl border border-[#0f1e3a]/8 bg-white p-8 text-center">
              <p className="text-[14px] font-medium text-[#44536b]">사용자를 찾을 수 없어요</p>
            </div>
          )}

          {data && (
            <>
              {/* 프로필 카드 */}
              <div className="mb-4 rounded-2xl border border-[#0f1e3a]/8 bg-white p-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[22px] font-medium text-white"
                    style={{ background: color }}>
                    {data.username.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-[18px] font-semibold text-[#0f1e3a]">{data.username}</p>
                    {data.joined_at && (
                      <p className="mt-0.5 text-[13px] text-[#5f6f88]">
                        {new Date(data.joined_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })} 가입
                      </p>
                    )}
                  </div>
                </div>

                {/* 스트릭 */}
                {data.streak.current_streak > 0 && (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-[#f5f8fd] p-3">
                      <p className="text-[13px] text-[#5f6f88]">지금 연속</p>
                      <p className={`mt-1 font-mono text-[20px] font-medium tabular-nums ${data.streak.today_checked ? 'text-[#1f63d6]' : 'text-[#0f1e3a]'}`}>
                        {data.streak.current_streak}일
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#f5f8fd] p-3">
                      <p className="text-[13px] text-[#5f6f88]">가장 길게</p>
                      <p className="mt-1 font-mono text-[20px] font-medium tabular-nums text-[#0f1e3a]">{data.streak.longest_streak}일</p>
                    </div>
                  </div>
                )}
              </div>

              {/* 최근 기록 */}
              {data.logs.length > 0 && (
                <div className="mb-4">
                  <p className="mb-2 text-[15px] font-medium text-[#0f1e3a]">최근 기록</p>
                  <div className="space-y-2">
                    {data.logs.map(log => (
                      <div key={log.id} className="flex gap-0 overflow-hidden rounded-xl border border-[#0f1e3a]/8 bg-white">
                        {log.photo_url && (
                          <div className="w-20 shrink-0 bg-[#edf3fc]" style={{ aspectRatio: '1/1' }}>
                            {isVideoUrl(log.photo_url) ? (
                              <video src={mediaUrl(log.photo_url)} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                            ) : (
                              <img src={mediaUrl(log.photo_url)} alt="기록" className="h-full w-full object-cover" />
                            )}
                          </div>
                        )}
                        <div className="flex flex-col justify-between px-3 py-2.5">
                          {log.caption
                            ? <p className="line-clamp-2 text-[14px] text-[#0f1e3a]">{log.caption}</p>
                            : <span />
                          }
                          <p className="text-[12px] text-[#5f6f88]">{relTime(log.created_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.logs.length === 0 && (
                <div className="mt-4 rounded-2xl border border-[#0f1e3a]/8 bg-white p-8 text-center">
                  <p className="text-[14px] font-medium text-[#5f6f88]">아직 공개된 활동이 없어요</p>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
