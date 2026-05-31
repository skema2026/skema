'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import MaterialIcon from '@/components/common/MaterialIcon';

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? '/proxy';

type PublicProfile = {
  user_id: number;
  username: string;
  joined_at: string | null;
  streak: { current_streak: number; longest_streak: number; today_checked: boolean };
  posts: { id: number; content: string; image_url: string | null; likes_count: number; created_at: string }[];
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

const AVATAR_COLORS = ['#2563eb', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];

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
    <div className="min-h-dvh bg-[#eaf1ff]">
      <div className="mx-auto max-w-lg min-h-dvh bg-[#f7f9ff]">

        {/* 헤더 */}
        <header className="sticky top-0 z-20 border-b border-blue-100 bg-white/95 px-4 py-3 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => router.back()}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 transition hover:bg-slate-200">
              <MaterialIcon icon="arrow_back" size={18} color="#475569" />
            </button>
            <h1 className="text-base font-black text-slate-950">프로필</h1>
          </div>
        </header>

        <main className="px-4 py-4">
          {isLoading && (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">불러오는 중...</div>
          )}
          {isError && (
            <div className="mt-8 rounded-2xl border border-red-100 bg-white p-8 text-center shadow-sm">
              <p className="text-sm font-black text-slate-700">사용자를 찾을 수 없어요</p>
            </div>
          )}

          {data && (
            <>
              {/* 프로필 카드 */}
              <div className="mb-4 rounded-2xl border border-blue-100 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-2xl font-black text-white"
                    style={{ background: color }}>
                    {data.username.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-lg font-black text-slate-950">{data.username}</p>
                    {data.joined_at && (
                      <p className="text-xs font-bold text-slate-400">
                        {new Date(data.joined_at).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })} 가입
                      </p>
                    )}
                  </div>
                </div>

                {/* 스트릭 */}
                {data.streak.current_streak > 0 && (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-blue-50 px-3 py-2.5 text-center">
                      <p className={`text-xl font-black ${data.streak.today_checked ? 'text-blue-600' : 'text-slate-400'}`}>
                        {data.streak.current_streak}
                      </p>
                      <p className="text-[11px] font-black text-slate-400">현재 연속</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-center">
                      <p className="text-xl font-black text-slate-600">{data.streak.longest_streak}</p>
                      <p className="text-[11px] font-black text-slate-400">최장 연속</p>
                    </div>
                  </div>
                )}
              </div>

              {/* 최근 기록 */}
              {data.logs.length > 0 && (
                <div className="mb-4">
                  <p className="mb-2 text-[11px] font-black text-slate-400">최근 기록</p>
                  <div className="space-y-2">
                    {data.logs.map(log => (
                      <div key={log.id} className="flex gap-0 overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm">
                        {log.photo_url && (
                          <div className="w-20 shrink-0 bg-slate-100" style={{ aspectRatio: '1/1' }}>
                            <img src={`${BACKEND}${log.photo_url}`} alt="기록" className="h-full w-full object-cover" />
                          </div>
                        )}
                        <div className="flex flex-col justify-between px-3 py-2.5">
                          {log.caption
                            ? <p className="text-sm font-bold text-slate-950 line-clamp-2">{log.caption}</p>
                            : <span />
                          }
                          <p className="text-[11px] text-slate-400">{relTime(log.created_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 최근 게시글 */}
              {data.posts.length > 0 && (
                <div className="mb-4">
                  <p className="mb-2 text-[11px] font-black text-slate-400">최근 게시글</p>
                  <div className="space-y-2">
                    {data.posts.map(post => (
                      <div key={post.id} className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm">
                        {post.image_url && (
                          <div className="w-full bg-slate-100" style={{ aspectRatio: '16/9' }}>
                            <img src={`${BACKEND}${post.image_url}`} alt="게시글" className="h-full w-full object-cover" />
                          </div>
                        )}
                        <div className="flex items-center justify-between px-4 py-3">
                          <p className="flex-1 text-sm font-bold text-slate-950 line-clamp-2">{post.content}</p>
                          <div className="ml-3 flex shrink-0 items-center gap-1 text-[11px] font-black text-slate-400">
                            <MaterialIcon icon="thumb_up" size={12} color="#94a3b8" />
                            {post.likes_count}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.logs.length === 0 && data.posts.length === 0 && (
                <div className="mt-4 rounded-2xl border border-blue-100 bg-white p-8 text-center shadow-sm">
                  <p className="text-sm font-black text-slate-500">아직 공개된 활동이 없어요</p>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
