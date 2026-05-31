'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import MaterialIcon from '@/components/common/MaterialIcon';
import {
  PostOut,
  postImageUrl,
  useCreatePost,
  useDeletePost,
  useFeed,
  useToggleLike,
} from '@/hooks/useCommunity';
import { useAuth } from '@/hooks/useAuth';

// ── 공통 ─────────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#2563eb', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];
const avatarColor = (id: number) => AVATAR_COLORS[id % AVATAR_COLORS.length];

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

// ── 게시글 카드 ───────────────────────────────────────────────────────────────

function PostCard({
  post,
  currentUserId,
}: {
  post: PostOut;
  currentUserId?: number;
}) {
  const router = useRouter();
  const toggle = useToggleLike();
  const del    = useDeletePost();
  const color  = avatarColor(post.author_id);

  const handleDelete = async () => {
    if (!confirm('게시글을 삭제할까요?')) return;
    try { await del.mutateAsync(post.id); toast.success('삭제됐습니다.'); }
    catch { toast.error('삭제에 실패했습니다.'); }
  };

  return (
    <article className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => router.push(`/profile/${post.author_id}`)}
          className="flex items-center gap-3 text-left"
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-sm font-black text-white"
            style={{ background: color }}
          >
            {post.username.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-black text-slate-950">{post.username}</p>
            <p className="text-[11px] font-bold text-slate-400">{relativeTime(post.created_at)}</p>
          </div>
        </button>
        {currentUserId === post.author_id && (
          <button
            type="button"
            onClick={handleDelete}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-red-50 hover:text-red-400"
          >
            <MaterialIcon icon="delete" size={16} color="currentColor" />
          </button>
        )}
      </div>

      {/* 이미지 */}
      {post.image_url && (
        <div className="w-full bg-slate-100" style={{ aspectRatio: '4/3' }}>
          <img
            src={postImageUrl(post.image_url)}
            alt="게시글 이미지"
            className="h-full w-full object-cover"
          />
        </div>
      )}

      {/* 본문 */}
      <div className={`px-4 ${post.image_url ? 'pt-3' : 'pt-0'}`}>
        <p className="text-sm font-bold leading-relaxed text-slate-950">{post.content}</p>
      </div>

      {/* 좋아요 */}
      <div className="px-4 py-3">
        <button
          type="button"
          onClick={() => toggle.mutate(post.id)}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black transition ${
            post.liked
              ? 'border-blue-500 bg-blue-600 text-white'
              : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-600'
          }`}
        >
          <MaterialIcon icon="thumb_up" size={13} color={post.liked ? '#fff' : 'currentColor'} />
          <span>{post.likes_count > 0 ? post.likes_count : '좋아요'}</span>
        </button>
      </div>
    </article>
  );
}

// ── 작성 모달 ─────────────────────────────────────────────────────────────────

function CreatePostModal({ onClose }: { onClose: () => void }) {
  const create  = useCreatePost();
  const fileRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile]       = useState<File | null>(null);

  const handleFile = (f: File) => { setFile(f); setPreview(URL.createObjectURL(f)); };

  const handleSubmit = async () => {
    if (!content.trim()) { toast.error('내용을 입력해주세요.'); return; }
    const form = new FormData();
    form.append('content', content);
    if (file) form.append('image', file);
    try {
      await create.mutateAsync(form);
      toast.success('게시글이 등록됐습니다!');
      onClose();
    } catch { toast.error('등록에 실패했습니다.'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600">
            <MaterialIcon icon="edit" size={16} color="#fff" />
          </div>
          <p className="flex-1 text-base font-black text-slate-950">새 게시글</p>
          <button type="button" onClick={onClose} className="text-slate-400">
            <MaterialIcon icon="close" size={20} color="currentColor" />
          </button>
        </div>

        <textarea
          autoFocus
          placeholder="무슨 생각을 하고 있나요?"
          value={content}
          onChange={e => setContent(e.target.value.slice(0, 1000))}
          rows={4}
          className="mb-3 w-full resize-none rounded-2xl border border-blue-100 bg-[#fbfdff] px-3 py-2.5 text-sm font-bold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <div className="mb-1 text-right text-[11px] text-slate-400">{content.length}/1000</div>

        {/* 이미지 */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mb-4 flex w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/50 transition hover:bg-blue-50"
          style={{ minHeight: preview ? undefined : '60px', aspectRatio: preview ? '4/3' : undefined }}
        >
          {preview ? (
            <img src={preview} alt="preview" className="h-full w-full object-cover" />
          ) : (
            <div className="flex items-center gap-2 py-3 text-slate-400">
              <MaterialIcon icon="add_photo_alternate" size={18} color="currentColor" />
              <p className="text-xs font-black">이미지 추가 (선택사항)</p>
            </div>
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={create.isPending || !content.trim()}
          className="h-12 w-full rounded-2xl bg-blue-600 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-40"
        >
          {create.isPending ? '등록 중...' : '게시하기'}
        </button>
      </div>
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

export default function FeedPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [offset, setOffset] = useState(0);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useFeed(offset, PAGE_SIZE);

  return (
    <div className="min-h-dvh bg-[#eaf1ff]">
      <div className="mx-auto max-w-lg min-h-dvh bg-[#f7f9ff]">

        {/* 헤더 */}
        <header className="sticky top-0 z-20 border-b border-blue-100 bg-white/95 px-4 py-3 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => router.back()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 transition hover:bg-slate-200"
              >
                <MaterialIcon icon="arrow_back" size={18} color="#475569" />
              </button>
              <div>
                <p className="text-[11px] font-black text-blue-600">SKEMA</p>
                <h1 className="text-base font-black leading-none text-slate-950">커뮤니티</h1>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"
            >
              <MaterialIcon icon="add" size={15} color="#fff" />
              글쓰기
            </button>
          </div>
        </header>

        <main className="px-4 py-4">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">불러오는 중...</div>
          ) : !data?.items.length ? (
            <div className="mt-8 rounded-2xl border border-blue-100 bg-white p-8 text-center shadow-sm">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50">
                <MaterialIcon icon="forum" size={24} color="#93c5fd" />
              </div>
              <p className="text-sm font-black text-slate-700">아직 게시글이 없어요</p>
              <p className="mt-1 text-xs font-bold text-slate-400">첫 번째로 글을 남겨보세요</p>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="mt-4 rounded-xl bg-blue-600 px-5 py-2 text-sm font-black text-white"
              >
                글쓰기
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {data.items.map(post => (
                  <PostCard key={post.id} post={post} currentUserId={user?.id} />
                ))}
              </div>

              {/* 페이지네이션 */}
              <div className="mt-4 flex items-center justify-center gap-3">
                {offset > 0 && (
                  <button
                    type="button"
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    className="rounded-xl border border-blue-100 bg-white px-4 py-2 text-sm font-black text-slate-600 shadow-sm transition hover:bg-blue-50"
                  >
                    이전
                  </button>
                )}
                {data.has_next && (
                  <button
                    type="button"
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                    className="rounded-xl border border-blue-100 bg-white px-4 py-2 text-sm font-black text-slate-600 shadow-sm transition hover:bg-blue-50"
                  >
                    더 보기
                  </button>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {showCreate && <CreatePostModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
