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

const REACTIONS = ['👍', '🔥', '💪', '✅', '🎉'];

type Tab = 'feed' | 'me';

// ── 개별 카드 ──────────────────────────────────────────────────────────────────

function LogCard({
  log,
  isMe = false,
  onDelete,
}: {
  log: import('@/hooks/useStudyLogs').StudyLogItem;
  isMe?: boolean;
  onDelete?: (id: number) => void;
}) {
  const toggleReaction = useToggleReaction();
  const [showReactions, setShowReactions] = useState(false);

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
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">
            {log.username.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-black text-slate-950">{log.username}</p>
            {log.schedule_title && (
              <p className="text-[11px] font-bold text-blue-600">{log.schedule_title}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">{relTime}</span>
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
      <div className="relative w-full bg-slate-100" style={{ aspectRatio: '4/3' }}>
        <img
          src={photoUrl(log.photo_url)}
          alt="공부 인증"
          className="h-full w-full object-cover"
        />
      </div>

      {/* 캡션 + 리액션 */}
      <div className="px-4 py-3">
        {log.caption && (
          <p className="mb-2 text-sm font-bold text-slate-950">{log.caption}</p>
        )}

        {/* 리액션 현황 */}
        <div className="flex flex-wrap items-center gap-1.5">
          {log.reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              onClick={() => toggleReaction.mutate({ logId: log.id, emoji: r.emoji })}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-black transition ${
                log.my_reactions.includes(r.emoji)
                  ? 'border-blue-400 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'
              }`}
            >
              <span>{r.emoji}</span>
              <span>{r.count}</span>
            </button>
          ))}

          {/* 리액션 추가 버튼 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowReactions((v) => !v)}
              className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-400 transition hover:border-blue-300"
            >
              +
            </button>
            {showReactions && (
              <div className="absolute bottom-full left-0 mb-1 flex gap-1 rounded-xl border border-blue-100 bg-white p-1.5 shadow-lg">
                {REACTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      toggleReaction.mutate({ logId: log.id, emoji: e });
                      setShowReactions(false);
                    }}
                    className="rounded-lg p-1 text-lg transition hover:bg-blue-50"
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
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
    const url = URL.createObjectURL(f);
    setPreview(url);
  };

  const handleSubmit = async () => {
    if (!file) { toast.error('사진을 선택해주세요.'); return; }
    const form = new FormData();
    form.append('photo', file);
    form.append('caption', caption);
    form.append('is_public', String(isPublic));
    if (scheduleId) form.append('schedule_id', String(scheduleId));
    try {
      await create.mutateAsync(form);
      toast.success('공부 인증이 등록됐습니다!');
      onClose();
    } catch {
      toast.error('업로드에 실패했습니다.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-base font-black text-slate-950">공부 인증 올리기</p>
          <button type="button" onClick={onClose} className="text-slate-400">
            <MaterialIcon icon="close" size={20} color="currentColor" />
          </button>
        </div>

        {scheduleTitle && (
          <p className="mb-3 text-xs font-bold text-blue-600">연결 일정: {scheduleTitle}</p>
        )}

        {/* 사진 선택 */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mb-3 flex w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 transition hover:bg-blue-50"
          style={{ aspectRatio: '4/3' }}
        >
          {preview ? (
            <img src={preview} alt="preview" className="h-full w-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-blue-400">
              <MaterialIcon icon="add_photo_alternate" size={32} color="currentColor" />
              <p className="text-sm font-black">사진 선택</p>
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

        {/* 캡션 */}
        <textarea
          placeholder="한 마디 남기기 (선택)"
          value={caption}
          onChange={(e) => setCaption(e.target.value.slice(0, 200))}
          rows={2}
          className="mb-3 w-full resize-none rounded-xl border border-blue-100 bg-[#fbfdff] px-3 py-2 text-sm font-bold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />

        {/* 공개 여부 */}
        <div className="mb-4 flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/50 px-3 py-2.5">
          <p className="text-sm font-black text-slate-950">전체 공개</p>
          <button
            type="button"
            onClick={() => setIsPublic((v) => !v)}
            style={{
              width: 44, height: 26, borderRadius: 99,
              background: isPublic ? '#2563eb' : '#e2e8f0',
              border: 'none', cursor: 'pointer', padding: 0, position: 'relative', transition: 'background .2s',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: isPublic ? 20 : 2,
              width: 22, height: 22, borderRadius: '50%',
              background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,.18)', transition: 'left .2s',
            }} />
          </button>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={create.isPending || !file}
          className="w-full rounded-xl bg-blue-600 py-3 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-40"
        >
          {create.isPending ? '업로드 중...' : '등록하기'}
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
  const { data: myData, isLoading: myLoading } = useMyStudyLogs();
  const { data: streak } = useStreak();
  const { data: todayStats } = useTodayStats();
  const deleteLog = useDeleteStudyLog();

  const handleDelete = async (id: number) => {
    if (!confirm('이 인증을 삭제할까요?')) return;
    try {
      await deleteLog.mutateAsync(id);
      toast.success('삭제됐습니다.');
    } catch {
      toast.error('삭제에 실패했습니다.');
    }
  };

  const logs = tab === 'feed' ? feedData?.items : myData?.items;
  const loading = tab === 'feed' ? feedLoading : myLoading;

  return (
    <div className="min-h-dvh bg-[#f8faff]">
      {/* 헤더 */}
      <header className="sticky top-0 z-20 border-b border-blue-100 bg-white/95 px-4 py-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <div>
            <p className="text-[11px] font-black text-blue-600">SKEMA</p>
            <h1 className="text-lg font-black text-slate-950">기록</h1>
          </div>
          {streak && (
            <div className="flex items-center gap-3">
              <div className="text-center">
                <p className={`text-xl font-black ${streak.today_checked ? 'text-blue-600' : 'text-slate-300'}`}>
                  {streak.current_streak}
                </p>
                <p className="text-[10px] font-black text-slate-400">연속</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-black text-slate-400">{streak.longest_streak}</p>
                <p className="text-[10px] font-black text-slate-400">최장</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"
          >
            <MaterialIcon icon="add_photo_alternate" size={16} color="#fff" />
            인증하기
          </button>
        </div>
      </header>

      {/* 탭 */}
      <div className="sticky top-[57px] z-10 border-b border-blue-100 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-lg">
          {([['feed', '피드'], ['me', '내 인증']] as const).map(([key, label]) => (
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

      {/* 오늘 현황 배너 */}
      {todayStats && todayStats.today_users > 0 && tab === 'feed' && (
        <div className="border-b border-blue-50 bg-blue-600 px-4 py-2.5">
          <p className="mx-auto max-w-lg text-center text-sm font-black text-white">
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
            <MaterialIcon icon="photo_camera" size={40} color="#cbd5e1" />
            <p className="text-sm font-black text-slate-500">
              {tab === 'feed' ? '아직 공유된 인증이 없어요' : '아직 올린 인증이 없어요'}
            </p>
            <button
              type="button"
              onClick={() => setShowUpload(true)}
              className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-black text-white"
            >
              첫 인증 올리기
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

      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} />
      )}
    </div>
  );
}
