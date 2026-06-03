'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import MaterialIcon from '@/components/common/MaterialIcon';
import {
  GroupFeedDay,
  GroupOut,
  MemberSlot,
  photoUrl,
  useCreateGroup,
  useGroupFeed,
  useJoinGroup,
  useLeaveGroup,
  useMyGroups,
  useSearchGroups,
  useToggleGroupReaction,
} from '@/hooks/useGroups';
import {
  useCreateStudyLog,
  useDeleteStudyLog,
  useMyStudyLogs,
  useStreak,
} from '@/hooks/useStudyLogs';

// ── 공통 ─────────────────────────────────────────────────────────────────────

function StatusPill({
  children,
  tone = 'blue',
}: {
  children: React.ReactNode;
  tone?: 'blue' | 'green' | 'slate' | 'fire' | 'red';
}) {
  const cls = {
    blue:  'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    slate: 'bg-slate-100 text-slate-600',
    fire:  'bg-blue-600 text-white',
    red:   'bg-red-50 text-red-600',
  }[tone];
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${cls}`}>{children}</span>;
}

const AVATAR_COLORS = ['#2563eb', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];
function avatarColor(userId: number) { return AVATAR_COLORS[userId % AVATAR_COLORS.length]; }
const isVideoUrl = (url: string) => /\.(webm|mp4|mov|mkv)$/i.test(url);

// ── 그룹 만들기 / 참여 모달 ───────────────────────────────────────────────────

function GroupSetupModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode]               = useState('');
  const [searchQ, setSearchQ]         = useState('');
  const [joinTab, setJoinTab]         = useState<'search' | 'code'>('search');
  const create = useCreateGroup();
  const join   = useJoinGroup();
  const { data: searchResults = [], isFetching: searching } = useSearchGroups(searchQ);

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      await create.mutateAsync({ name: name.trim(), description: description.trim() || undefined });
      toast.success('그룹이 만들어졌어요!');
      onClose();
    } catch { toast.error('그룹 생성에 실패했습니다.'); }
  };

  const handleJoin = async (inviteCode: string) => {
    try {
      await join.mutateAsync(inviteCode.trim().toUpperCase());
      toast.success('그룹에 참여했어요!');
      onClose();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err?.response?.data?.detail ?? '코드를 확인해주세요.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600">
            <MaterialIcon icon="group" size={16} color="#fff" />
          </div>
          <p className="flex-1 text-base font-black text-slate-950">
            {mode === 'menu' ? '그룹' : mode === 'create' ? '새 그룹 만들기' : '그룹 참여'}
          </p>
          <button type="button" onClick={onClose} className="text-slate-400">
            <MaterialIcon icon="close" size={20} color="currentColor" />
          </button>
        </div>

        {mode === 'menu' && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setMode('create')}
              className="flex w-full items-center gap-4 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm transition hover:bg-blue-50"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
                <MaterialIcon icon="add" size={20} color="#fff" />
              </div>
              <div className="text-left">
                <p className="text-sm font-black text-slate-950">새 그룹 만들기</p>
                <p className="text-xs font-bold text-slate-400">초대코드를 생성해 친구를 초대하세요</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMode('join')}
              className="flex w-full items-center gap-4 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm transition hover:bg-blue-50"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800">
                <MaterialIcon icon="search" size={20} color="#fff" />
              </div>
              <div className="text-left">
                <p className="text-sm font-black text-slate-950">그룹 찾기</p>
                <p className="text-xs font-bold text-slate-400">이름 검색 또는 초대코드로 참여</p>
              </div>
            </button>
          </div>
        )}

        {mode === 'create' && (
          <>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value.slice(0, 100))}
              placeholder="그룹 이름 (예: CS 스터디)"
              className="mb-2 h-12 w-full rounded-2xl border border-blue-100 bg-[#fbfdff] px-4 text-sm font-black text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value.slice(0, 200))}
              placeholder="그룹 설명 (선택사항) — 어떤 그룹인지 간단히 적어주세요"
              rows={2}
              className="mb-4 w-full resize-none rounded-2xl border border-blue-100 bg-[#fbfdff] px-4 py-3 text-sm font-bold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={!name.trim() || create.isPending}
              className="h-12 w-full rounded-2xl bg-blue-600 text-sm font-black text-white disabled:opacity-40"
            >
              {create.isPending ? '만드는 중...' : '그룹 만들기'}
            </button>
          </>
        )}

        {mode === 'join' && (
          <>
            {/* 탭 */}
            <div className="mb-3 flex rounded-xl bg-slate-100 p-1">
              {(['search', 'code'] as const).map(t => (
                <button key={t} type="button" onClick={() => setJoinTab(t)}
                  className={`flex-1 rounded-lg py-2 text-xs font-black transition ${joinTab === t ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-400'}`}>
                  {t === 'search' ? '이름으로 검색' : '초대코드 입력'}
                </button>
              ))}
            </div>

            {joinTab === 'search' ? (
              <>
                <input
                  autoFocus
                  value={searchQ}
                  onChange={e => setSearchQ(e.target.value)}
                  placeholder="그룹 이름 검색..."
                  className="mb-3 h-11 w-full rounded-2xl border border-blue-100 bg-[#fbfdff] px-4 text-sm font-black text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {searching && <p className="py-2 text-center text-xs text-slate-400">검색 중...</p>}
                  {!searching && searchQ.trim() && searchResults.length === 0 && (
                    <p className="py-2 text-center text-xs text-slate-400">결과가 없어요</p>
                  )}
                  {searchResults.map(g => (
                    <div key={g.id} className="flex items-center justify-between rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-sm">
                      <div>
                        <p className="text-sm font-black text-slate-950">{g.name}</p>
                        {g.description && <p className="text-xs font-bold text-slate-400 line-clamp-1">{g.description}</p>}
                        <p className="text-[11px] text-slate-400">{g.member_count}명</p>
                      </div>
                      <button type="button" onClick={() => handleJoin(g.invite_code)} disabled={join.isPending}
                        className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-black text-white disabled:opacity-40">
                        참여
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <input
                  autoFocus
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  placeholder="초대코드 입력"
                  className="mb-4 h-12 w-full rounded-2xl border border-blue-100 bg-[#fbfdff] px-4 text-center text-lg font-black tracking-widest text-slate-950 placeholder:text-slate-400 placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
                <button type="button" onClick={() => handleJoin(code)} disabled={!code.trim() || join.isPending}
                  className="h-12 w-full rounded-2xl bg-blue-600 text-sm font-black text-white disabled:opacity-40">
                  {join.isPending ? '참여 중...' : '참여하기'}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── 업로드 모달 ───────────────────────────────────────────────────────────────

type RecordState = 'idle' | 'requesting' | 'recording' | 'done';

function UploadModal({
  groups,
  defaultGroupId,
  onClose,
  scheduleId,
  scheduleTitle,
}: {
  groups: GroupOut[];
  defaultGroupId?: number;
  onClose: () => void;
  scheduleId?: number;
  scheduleTitle?: string;
}) {
  const RECORD_SECS = 3;

  const create       = useCreateStudyLog();
  const fileRef      = useRef<HTMLInputElement>(null);
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const recorderRef  = useRef<MediaRecorder | null>(null);
  const streamRef    = useRef<MediaStream | null>(null);

  const [preview, setPreview]         = useState<string | null>(null);
  const [file, setFile]               = useState<File | null>(null);
  const [caption, setCaption]         = useState('');
  const [groupId, setGroupId]         = useState<number | null>(null);
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [countdown, setCountdown]     = useState(RECORD_SECS);

  // recording 상태로 전환된 뒤 video 요소가 마운트되면 stream 연결
  useEffect(() => {
    if (recordState === 'recording' && liveVideoRef.current && streamRef.current) {
      liveVideoRef.current.srcObject = streamRef.current;
      liveVideoRef.current.play().catch(() => {});
    }
  }, [recordState]);

  useEffect(() => {
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  const handleFile = (f: File) => { setFile(f); setPreview(URL.createObjectURL(f)); setRecordState('done'); };

  const startRecording = async () => {
    setRecordState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
      streamRef.current = stream;

      const mimeType = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4']
        .find(t => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: mimeType });
        handleFile(new File([blob], `recording.${ext}`, { type: mimeType }));
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      };

      // 상태 변경 → useEffect에서 video에 stream 연결
      setRecordState('recording');
      setCountdown(RECORD_SECS);
      recorder.start();

      let count = RECORD_SECS;
      const timer = setInterval(() => {
        count--;
        setCountdown(count);
        if (count <= 0) { clearInterval(timer); recorder.stop(); }
      }, 1000);
    } catch {
      toast.error('카메라/마이크 권한을 허용해주세요.');
      setRecordState('idle');
    }
  };

  const resetVideo = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setFile(null);
    setPreview(null);
    setRecordState('idle');
  };

  const handleSubmit = async () => {
    if (!file && !caption.trim()) { toast.error('영상 또는 한 마디를 입력해주세요.'); return; }
    const form = new FormData();
    if (file)           form.append('video', file);
    if (caption.trim()) form.append('caption', caption);
    if (groupId)        form.append('group_id', String(groupId));
    if (scheduleId)     form.append('schedule_id', String(scheduleId));
    try {
      await create.mutateAsync(form);
      toast.success('기록이 등록됐습니다!');
      onClose();
    } catch { toast.error('업로드에 실패했습니다.'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600">
            <MaterialIcon icon="videocam" size={16} color="#fff" />
          </div>
          <p className="flex-1 text-base font-black text-slate-950">기록 남기기</p>
          <button type="button" onClick={onClose} className="text-slate-400">
            <MaterialIcon icon="close" size={20} color="currentColor" />
          </button>
        </div>

        {scheduleTitle && (
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2.5">
            <MaterialIcon icon="check_circle" size={14} color="#2563eb" />
            <p className="text-xs font-black text-blue-700">{scheduleTitle} 완료</p>
          </div>
        )}

        {/* 그룹 선택 */}
        {groups.length > 0 && (
          <div className="mb-3">
            <p className="mb-1.5 text-[11px] font-black text-slate-400">올릴 그룹 <span className="text-slate-300">(선택 안 하면 내 기록에만 저장)</span></p>
            <div className="flex flex-wrap gap-2">
              {/* 내 기록에만 */}
              <button
                type="button"
                onClick={() => setGroupId(null)}
                className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${
                  groupId === null
                    ? 'border-slate-700 bg-slate-800 text-white'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400'
                }`}
              >
                내 기록에만
              </button>
              {groups.map(g => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGroupId(prev => prev === g.id ? null : g.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${
                    groupId === g.id
                      ? 'border-blue-500 bg-blue-600 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'
                  }`}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 영상 촬영 영역 */}
        <div className="mb-3 overflow-hidden rounded-2xl bg-slate-900" style={{ aspectRatio: '4/3' }}>
          {recordState === 'idle' && (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <button type="button" onClick={startRecording}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 shadow-lg transition active:scale-95">
                <MaterialIcon icon="videocam" size={28} color="#fff" />
              </button>
              <p className="text-xs font-black text-slate-400">3초 촬영하기</p>
              <button type="button" onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 rounded-full bg-slate-800 px-4 py-2 text-xs font-black text-slate-300 transition hover:bg-slate-700">
                <MaterialIcon icon="upload_file" size={14} color="currentColor" />
                파일에서 올리기
              </button>
            </div>
          )}

          {recordState === 'requesting' && (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm font-black text-white">카메라 권한 요청 중...</p>
            </div>
          )}

          {recordState === 'recording' && (
            <div className="relative h-full">
              <video ref={liveVideoRef} muted playsInline className="h-full w-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[80px] font-black text-white drop-shadow-lg">{countdown}</span>
              </div>
              <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-red-500 px-2.5 py-1">
                <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                <span className="text-[11px] font-black text-white">REC</span>
              </div>
            </div>
          )}

          {recordState === 'done' && preview && (
            <div className="relative h-full">
              <video src={preview} controls playsInline className="h-full w-full object-cover" />
              <button type="button" onClick={resetVideo}
                className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80">
                <MaterialIcon icon="refresh" size={14} color="currentColor" />
              </button>
            </div>
          )}
        </div>

        <input ref={fileRef} type="file" accept="video/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

        <textarea
          placeholder="오늘의 공부 한 마디..."
          value={caption}
          onChange={e => setCaption(e.target.value.slice(0, 200))}
          rows={2}
          className="mb-3 w-full resize-none rounded-2xl border border-blue-100 bg-[#fbfdff] px-3 py-2.5 text-sm font-bold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={create.isPending || recordState === 'recording' || recordState === 'requesting'}
          className="h-12 w-full rounded-2xl bg-blue-600 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-40"
        >
          {create.isPending ? '등록 중...' : '기록 남기기'}
        </button>
      </div>
    </div>
  );
}

// ── BeReal 스타일 멤버 슬롯 카드 ──────────────────────────────────────────────

function MemberCard({
  slot,
  isMe,
  onDelete,
}: {
  slot: MemberSlot;
  isMe: boolean;
  onDelete?: (id: number) => void;
}) {
  const toggle = useToggleGroupReaction();
  const liked    = slot.my_reactions.includes('👍');
  const likeCount = slot.reactions.find(r => r.emoji === '👍')?.count ?? 0;

  const relTime = slot.created_at ? (() => {
    const diff = new Date().getTime() - new Date(slot.created_at).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return '방금';
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    return `${Math.floor(h / 24)}일 전`;
  })() : null;

  const color = avatarColor(slot.user_id);
  const hasLog = slot.log_id !== null;

  return (
    <div className={`overflow-hidden rounded-2xl border shadow-sm ${hasLog ? 'border-blue-100 bg-white' : 'border-slate-100 bg-slate-50'}`}>
      {/* 멤버 헤더 */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-sm font-black text-white"
            style={{ background: hasLog ? color : '#cbd5e1' }}
          >
            {slot.username.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className={`text-sm font-black ${hasLog ? 'text-slate-950' : 'text-slate-400'}`}>
              {slot.username}
            </p>
            {slot.schedule_title && (
              <p className="text-[11px] font-bold text-blue-600">{slot.schedule_title} 완료</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {relTime && <span className="text-[11px] text-slate-400">{relTime}</span>}
          {isMe && hasLog && onDelete && slot.log_id && (
            <button
              type="button"
              onClick={() => onDelete(slot.log_id!)}
              className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-300 transition hover:bg-red-50 hover:text-red-400"
            >
              <MaterialIcon icon="delete" size={14} color="currentColor" />
            </button>
          )}
        </div>
      </div>

      {/* 영상/미올림 플레이스홀더 */}
      {hasLog ? (
        <>
          {/* 영상 — 전체 너비, 16:9 비율 */}
          {slot.photo_url && (
            <div className="relative w-full overflow-hidden bg-slate-900" style={{ aspectRatio: '16/9' }}>
              {isVideoUrl(slot.photo_url) ? (
                <video
                  src={photoUrl(slot.photo_url)}
                  controls
                  playsInline
                  className="h-full w-full object-cover"
                />
              ) : (
                <img
                  src={photoUrl(slot.photo_url)}
                  alt="공부 인증"
                  className="h-full w-full object-cover"
                />
              )}
              {/* 캡션 오버레이 (영상+텍스트 둘 다 있을 때) */}
              {slot.caption && !isVideoUrl(slot.photo_url) && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2 pt-6">
                  <p className="text-xs font-bold text-white line-clamp-2">{slot.caption}</p>
                </div>
              )}
            </div>
          )}

          {/* 사진 없고 캡션만 있는 경우 */}
          {!slot.photo_url && slot.caption && (
            <div className="px-3 pb-1">
              <p className="text-sm font-bold leading-relaxed text-slate-950">{slot.caption}</p>
            </div>
          )}

          {/* 좋아요 */}
          <div className="flex items-center justify-between px-3 py-2">
            <button
              type="button"
              onClick={() => slot.log_id && toggle.mutate({ logId: slot.log_id, emoji: '👍' })}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black transition ${
                liked
                  ? 'border-blue-500 bg-blue-600 text-white'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              <MaterialIcon icon="thumb_up" size={12} color={liked ? '#fff' : 'currentColor'} />
              <span>{likeCount > 0 ? likeCount : '좋아요'}</span>
            </button>
          </div>
        </>
      ) : (
        <div className="flex h-10 items-center justify-center">
          <p className="text-xs font-bold text-slate-300">아직 기록을 올리지 않았어요</p>
        </div>
      )}
    </div>
  );
}

// ── BeReal 피드 (그룹) ────────────────────────────────────────────────────────

function GroupFeed({
  group,
  currentUserId,
}: {
  group: GroupOut;
  currentUserId?: number;
}) {
  const { data: feed, isLoading } = useGroupFeed(group.id);
  const deleteLog = useDeleteStudyLog();
  const leave = useLeaveGroup();
  const [showInfo, setShowInfo] = useState(false);

  const handleDelete = async (id: number) => {
    if (!confirm('이 기록을 삭제할까요?')) return;
    try { await deleteLog.mutateAsync(id); toast.success('삭제됐습니다.'); }
    catch { toast.error('삭제에 실패했습니다.'); }
  };

  const handleLeave = async () => {
    if (!confirm(`'${group.name}' 그룹에서 나갈까요?`)) return;
    try { await leave.mutateAsync(group.id); toast.success('그룹에서 나왔습니다.'); }
    catch { toast.error('실패했습니다.'); }
  };

  if (isLoading) return <div className="flex h-40 items-center justify-center text-sm text-slate-400">불러오는 중...</div>;

  return (
    <div>
      {/* 그룹 정보 바 */}
      <div className="mb-3 rounded-2xl border border-blue-100 bg-white px-4 py-3 shadow-sm">
        {group.description && (
          <p className="mb-2 text-xs font-bold text-slate-500">{group.description}</p>
        )}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black text-slate-400">초대코드</p>
            <div className="flex items-center gap-2">
              <p className="text-base font-black tracking-widest text-blue-700">{group.invite_code}</p>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(group.invite_code);
                  toast.success('초대코드가 복사됐습니다!');
                }}
                className="flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-600 transition hover:bg-blue-100"
              >
                <MaterialIcon icon="content_copy" size={12} color="currentColor" />
                복사
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill tone="slate">{group.member_count}명</StatusPill>
            <button
              type="button"
              onClick={handleLeave}
              className="rounded-xl bg-red-50 px-3 py-1.5 text-xs font-black text-red-500 transition hover:bg-red-100"
            >
              나가기
            </button>
          </div>
        </div>
      </div>

      {/* 날짜별 피드 */}
      {feed?.map(day => {
        const isToday = day.date === new Date().toISOString().slice(0, 10);
        const dateLabel = isToday ? '오늘' : day.date.slice(5).replace('-', '/');
        const postedCount = day.slots.filter(s => s.log_id).length;

        return (
          <div key={day.date} className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <p className="text-sm font-black text-slate-950">{dateLabel}</p>
              <StatusPill tone={postedCount === day.slots.length ? 'green' : 'slate'}>
                {postedCount}/{day.slots.length}명
              </StatusPill>
            </div>
            <div className="space-y-3">
              {day.slots.map(slot => (
                <MemberCard
                  key={slot.user_id}
                  slot={slot}
                  isMe={slot.user_id === currentUserId}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

type MainTab = 'group' | 'me';

export default function LogPage() {
  const router = useRouter();
  const { data: groups = [], isLoading: groupsLoading } = useMyGroups();
  const { data: streak } = useStreak();
  const { data: myData, isLoading: myLoading } = useMyStudyLogs();
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [mainTab, setMainTab]               = useState<MainTab>('group');
  const [showUpload, setShowUpload]         = useState(false);
  const [showGroupSetup, setShowGroupSetup] = useState(false);
  const deleteLog = useDeleteStudyLog();

  const activeGroup = selectedGroupId
    ? groups.find(g => g.id === selectedGroupId) ?? groups[0]
    : groups[0];

  const hasGroups = groups.length > 0;

  const handleDeleteMyLog = async (id: number) => {
    if (!confirm('이 기록을 삭제할까요?')) return;
    try { await deleteLog.mutateAsync(id); toast.success('삭제됐습니다.'); }
    catch { toast.error('삭제에 실패했습니다.'); }
  };

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
                <h1 className="text-base font-black leading-none text-slate-950">기록</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {streak && streak.current_streak > 0 && (
                <StatusPill tone={streak.today_checked ? 'fire' : 'slate'}>
                  🔥 {streak.current_streak}일
                </StatusPill>
              )}
              <button
                type="button"
                onClick={() => setShowUpload(true)}
                className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"
              >
                <MaterialIcon icon="add" size={15} color="#fff" />
                기록하기
              </button>
            </div>
          </div>

          {/* 그룹 탭 + 내 기록 탭 */}
          <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-0.5">
            {/* 내 기록 탭 */}
            <button
              type="button"
              onClick={() => setMainTab('me')}
              className={`shrink-0 flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-black transition ${
                mainTab === 'me'
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <MaterialIcon icon="person" size={12} color={mainTab === 'me' ? '#fff' : 'currentColor'} />
              내 기록
            </button>

            {/* 그룹 탭들 */}
            {groups.map(g => (
              <button
                key={g.id}
                type="button"
                onClick={() => { setSelectedGroupId(g.id); setMainTab('group'); }}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition ${
                  mainTab === 'group' && activeGroup?.id === g.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {g.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowGroupSetup(true)}
              className="shrink-0 flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-500 transition hover:bg-slate-200"
            >
              <MaterialIcon icon="add" size={12} color="currentColor" />
              그룹 추가
            </button>
          </div>
        </header>

        <main className="px-4 py-4">
          {groupsLoading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">불러오는 중...</div>
          ) : mainTab === 'me' ? (
            /* ── 내 기록 탭 ── */
            <div>
              {myLoading ? (
                <div className="flex h-40 items-center justify-center text-sm text-slate-400">불러오는 중...</div>
              ) : !myData?.items.length ? (
                <div className="mt-8 rounded-2xl border border-blue-100 bg-white p-8 text-center shadow-sm">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50">
                    <MaterialIcon icon="edit_note" size={24} color="#93c5fd" />
                  </div>
                  <p className="text-sm font-black text-slate-700">아직 내 기록이 없어요</p>
                  <button type="button" onClick={() => setShowUpload(true)}
                    className="mt-4 rounded-xl bg-blue-600 px-5 py-2 text-sm font-black text-white">
                    기록 남기기
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {myData.items.map(log => {
                    const color = avatarColor(log.user_id);
                    return (
                      <article key={log.id} className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm">
                        <div className="flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-2">
                            {log.schedule_title
                              ? <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-700">{log.schedule_title} 완료</span>
                              : <span className="text-[11px] text-slate-400">{new Date(log.created_at).toLocaleDateString('ko-KR')}</span>
                            }
                          </div>
                          <button type="button" onClick={() => handleDeleteMyLog(log.id)}
                            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-red-50 hover:text-red-400">
                            <MaterialIcon icon="delete" size={16} color="currentColor" />
                          </button>
                        </div>
                        {log.photo_url && (
                          <div className="relative w-full overflow-hidden bg-slate-900" style={{ aspectRatio: '16/9' }}>
                            {isVideoUrl(log.photo_url) ? (
                              <video
                                src={`${process.env.NEXT_PUBLIC_API_URL ?? '/proxy'}${log.photo_url}`}
                                controls
                                playsInline
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <>
                                <img src={`${process.env.NEXT_PUBLIC_API_URL ?? '/proxy'}${log.photo_url}`} alt="기록" className="h-full w-full object-cover" />
                                {log.caption && (
                                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2 pt-6">
                                    <p className="text-xs font-bold text-white line-clamp-2">{log.caption}</p>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                        {!log.photo_url && log.caption && (
                          <div className="px-4 pb-3">
                            <p className="text-sm font-bold leading-relaxed text-slate-950">{log.caption}</p>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          ) : hasGroups && activeGroup ? (
            <GroupFeed group={activeGroup} />
          ) : (
            /* 그룹 없을 때 — 참여 유도 카드만 */
            <div className="mt-8 rounded-2xl border border-blue-100 bg-white p-6 text-center shadow-sm">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50">
                <MaterialIcon icon="group" size={24} color="#93c5fd" />
              </div>
              <p className="text-sm font-black text-slate-700">그룹에 참여해보세요</p>
              <p className="mt-1 text-xs font-bold text-slate-400">그룹 안에서 서로의 기록을 확인할 수 있어요</p>
              <button type="button" onClick={() => setShowGroupSetup(true)}
                className="mt-4 flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white mx-auto">
                <MaterialIcon icon="group_add" size={14} color="#fff" />
                그룹 만들기 / 참여
              </button>
            </div>
          )}
        </main>
      </div>

      {showUpload && (
        <UploadModal
          groups={groups}
          defaultGroupId={activeGroup?.id}
          onClose={() => setShowUpload(false)}
        />
      )}
      {showGroupSetup && <GroupSetupModal onClose={() => setShowGroupSetup(false)} />}
    </div>
  );
}
