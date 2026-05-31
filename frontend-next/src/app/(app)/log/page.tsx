'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import MaterialIcon from '@/components/common/MaterialIcon';
import {
  photoUrl,
  useCreateStudyLog,
  useDeleteStudyLog,
  useMyStudyLogs,
  useStreak,
  useStudyFeed,
  useTodayStats,
  useToggleReaction,
} from '@/hooks/useStudyLogs';

type Tab = 'feed' | 'me';

// ── 좋아요/싫어요 버튼 ─────────────────────────────────────────────────────────

function LikeButtons({
  logId,
  reactions,
  myReactions,
}: {
  logId: number;
  reactions: { emoji: string; count: number }[];
  myReactions: string[];
}) {
  const toggle = useToggleReaction();

  const likeCount  = reactions.find(r => r.emoji === '👍')?.count ?? 0;
  const dislikeCount = reactions.find(r => r.emoji === '👎')?.count ?? 0;
  const liked    = myReactions.includes('👍');
  const disliked = myReactions.includes('👎');

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => toggle.mutate({ logId, emoji: '👍' })}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-black transition ${
          liked
            ? 'border-blue-500 bg-blue-600 text-white'
            : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-600'
        }`}
      >
        <MaterialIcon icon="thumb_up" size={14} color={liked ? '#fff' : 'currentColor'} />
        <span>{likeCount > 0 ? likeCount : '좋아요'}</span>
      </button>
      <button
        type="button"
        onClick={() => toggle.mutate({ logId, emoji: '👎' })}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-black transition ${
          disliked
            ? 'border-slate-500 bg-slate-700 text-white'
            : 'border-slate-200 bg-white text-slate-400 hover:border-slate-400'
        }`}
      >
        <MaterialIcon icon="thumb_down" size={14} color={disliked ? '#fff' : 'currentColor'} />
        <span>{dislikeCount > 0 ? dislikeCount : '싫어요'}</span>
      </button>
    </div>
  );
}

// ── 게시글 카드 ────────────────────────────────────────────────────────────────

function LogCard({
  log,
  isMe = false,
  onDelete,
}: {
  log: import('@/hooks/useStudyLogs').StudyLogItem;
  isMe?: boolean;
  onDelete?: (id: number) => void;
}) {
  const relTime = (() => {
    const diff = Date.now() - new Date(log.created_at).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return '방금 전';
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    return `${Math.floor(h / 24)}일 전`;
  })();

  return (
    <article className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-sm font-black text-white shadow-sm">
            {log.username.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-black text-slate-950">{log.username}</p>
            {log.schedule_title ? (
              <p className="text-[11px] font-bold text-blue-600">{log.schedule_title} 완료</p>
            ) : (
              <p className="text-[11px] font-bold text-slate-400">{relTime}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {log.schedule_title && (
            <span className="text-[11px] text-slate-400">{relTime}</span>
          )}
          {isMe && onDelete && (
            <button
              type="button"
              onClick={() => onDelete(log.id)}
              className="rounded-lg p-1 text-slate-300 transition hover:text-red-400"
            >
              <MaterialIcon icon="delete" size={16} color="currentColor" />
            </button>
          )}
        </div>
      </div>

      {/* 사진 */}
      {log.photo_url && (
        <div className="w-full bg-slate-100" style={{ aspectRatio: '4/3' }}>
          <img
            src={photoUrl(log.photo_url)}
            alt="공부 인증"
            className="h-full w-full object-cover"
          />
        </div>
      )}

      {/* 캡션 */}
      {log.caption && (
        <div className={`px-4 ${log.photo_url ? 'pt-3' : 'pt-0'}`}>
          <p className={`font-bold text-slate-950 ${log.photo_url ? 'text-sm' : 'text-base leading-relaxed'}`}>
            {log.caption}
          </p>
        </div>
      )}

      {/* 좋아요/싫어요 */}
      <div className="px-4 py-3">
        <LikeButtons logId={log.id} reactions={log.reactions} myReactions={log.my_reactions} />
      </div>
    </article>
  );
}

// ── 업로드 모달 ────────────────────────────────────────────────────────────────

function UploadModal({
  onClose,
  scheduleId,
  scheduleTitle,
}: {
  onClose: () => void;
  scheduleId?: number;
  scheduleTitle?: string;
}) {
  const create = useCreateStudyLog();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [isPublic, setIsPublic] = useState(true);

  const handleFile = (f: File) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleSubmit = async () => {
    if (!file && !caption.trim()) {
      toast.error('사진 또는 한 마디를 입력해주세요.');
      return;
    }
    const form = new FormData();
    if (file) form.append('photo', file);
    if (caption.trim()) form.append('caption', caption);
    form.append('is_public', String(isPublic));
    if (scheduleId) form.append('schedule_id', String(scheduleId));
    try {
      await create.mutateAsync(form);
      toast.success('기록이 등록됐습니다!');
      onClose();
    } catch {
      toast.error('업로드에 실패했습니다.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-base font-black text-slate-950">기록 남기기</p>
          <button type="button" onClick={onClose} className="text-slate-400">
            <MaterialIcon icon="close" size={20} color="currentColor" />
          </button>
        </div>

        {scheduleTitle && (
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2">
            <MaterialIcon icon="check_circle" size={14} color="#2563eb" />
            <p className="text-xs font-black text-blue-700">{scheduleTitle} 완료</p>
          </div>
        )}

        {/* 사진 선택 (선택사항) */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mb-3 flex w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 transition hover:bg-blue-50"
          style={{ minHeight: preview ? undefined : '80px', aspectRatio: preview ? '4/3' : undefined }}
        >
          {preview ? (
            <img src={preview} alt="preview" className="h-full w-full object-cover" />
          ) : (
            <div className="flex items-center gap-2 py-4 text-slate-400">
              <MaterialIcon icon="add_photo_alternate" size={20} color="currentColor" />
              <p className="text-xs font-black">사진 추가 (선택사항)</p>
            </div>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />

        {/* 텍스트 */}
        <textarea
          placeholder="오늘의 공부 한 마디..."
          value={caption}
          onChange={(e) => setCaption(e.target.value.slice(0, 200))}
          rows={3}
          className="mb-3 w-full resize-none rounded-xl border border-blue-100 bg-[#fbfdff] px-3 py-2.5 text-sm font-bold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />

        {/* 공개 여부 */}
        <div className="mb-4 flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2.5">
          <p className="text-sm font-black text-slate-950">전체 공개</p>
          <button
            type="button"
            onClick={() => setIsPublic(v => !v)}
            style={{
              width: 44, height: 26, borderRadius: 99,
              background: isPublic ? '#2563eb' : '#e2e8f0',
              border: 'none', cursor: 'pointer', padding: 0,
              position: 'relative', transition: 'background .2s',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: isPublic ? 20 : 2,
              width: 22, height: 22, borderRadius: '50%',
              background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.18)',
              transition: 'left .2s',
            }} />
          </button>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={create.isPending}
          className="w-full rounded-xl bg-blue-600 py-3 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-40"
        >
          {create.isPending ? '등록 중...' : '기록 남기기'}
        </button>
      </div>
    </div>
  );
}

// ── 메인 페이지 ────────────────────────────────────────────────────────────────

export default function SetlogPage() {
  const [tab, setTab] = useState<Tab>('feed');
  const [showUpload, setShowUpload] = useState(false);

  const { data: feedData, isLoading: feedLoading } = useStudyFeed();
  const { data: myData,  isLoading: myLoading  } = useMyStudyLogs();
  const { data: streak   } = useStreak();
  const { data: todayStats } = useTodayStats();
  const deleteLog = useDeleteStudyLog();

  const handleDelete = async (id: number) => {
    if (!confirm('이 기록을 삭제할까요?')) return;
    try {
      await deleteLog.mutateAsync(id);
      toast.success('삭제됐습니다.');
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  const logs    = tab === 'feed' ? feedData?.items : myData?.items;
  const loading = tab === 'feed' ? feedLoading : myLoading;

  return (
    <div className="min-h-dvh bg-[#f8faff]">

      {/* 헤더 */}
      <header className="sticky top-0 z-20 border-b border-blue-100 bg-white/95 px-4 py-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-[11px] font-black text-blue-600">SKEMA</p>
              <h1 className="text-lg font-black text-slate-950">기록</h1>
            </div>
            {/* 스트릭 */}
            {streak && streak.current_streak > 0 && (
              <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black ${
                streak.today_checked ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'
              }`}>
                <MaterialIcon icon="local_fire_department" size={13} color={streak.today_checked ? '#fff' : '#94a3b8'} />
                {streak.current_streak}일 연속
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"
          >
            <MaterialIcon icon="edit" size={15} color="#fff" />
            기록하기
          </button>
        </div>
      </header>

      {/* 탭 */}
      <div className="sticky top-[57px] z-10 border-b border-blue-100 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-lg">
          {([['feed', '모두의 기록'], ['me', '내 기록']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex-1 py-3 text-sm font-black transition ${
                tab === key
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 오늘 현황 */}
      {todayStats && todayStats.today_users > 0 && tab === 'feed' && (
        <div className="bg-blue-600 px-4 py-2.5">
          <p className="mx-auto max-w-lg text-center text-xs font-black text-white/90">
            오늘 {todayStats.today_users}명이 함께 기록하고 있어요
          </p>
        </div>
      )}

      {/* 피드 */}
      <main className="mx-auto max-w-lg px-4 py-4">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-slate-400">불러오는 중...</div>
        ) : !logs?.length ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <MaterialIcon icon="edit_note" size={40} color="#cbd5e1" />
            <p className="text-sm font-black text-slate-500">
              {tab === 'feed' ? '아직 기록이 없어요' : '아직 내 기록이 없어요'}
            </p>
            <button
              type="button"
              onClick={() => setShowUpload(true)}
              className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-black text-white"
            >
              첫 기록 남기기
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {logs.map((log) => (
              <LogCard
                key={log.id}
                log={log}
                isMe={tab === 'me'}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} />}
    </div>
  );
}
