'use client';

import { displayTitle } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import MaterialIcon from '@/components/common/MaterialIcon';
import { isVideoUrl } from '@/lib/media';
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
    blue:  'bg-[#eaf2ff] text-[#1f63d6]',
    green: 'bg-[#eaf2ff] text-[#1f63d6]',
    slate: 'bg-[#edf3fc] text-[#44536b]',
    fire:  'bg-[#eaf2ff] text-[#1f63d6]',
    red:   'bg-[#fef2f2] text-[#dc2626]',
  }[tone];
  return <span className={`inline-flex h-6 items-center rounded-md px-2 text-[12px] ${cls}`}>{children}</span>;
}

// 프로필 동그라미 색: 로고 파랑과 어울리는 차가운 계열
const AVATAR_COLORS = ['#2a6fe3', '#4f46e5', '#0891b2', '#0d9488', '#7c3aed', '#4591fd'];
function avatarColor(userId: number) { return AVATAR_COLORS[userId % AVATAR_COLORS.length]; }

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
      toast.success('그룹을 만들었어요');
      onClose();
    } catch { toast.error('그룹을 만들지 못했어요'); }
  };

  const handleJoin = async (inviteCode: string) => {
    try {
      await join.mutateAsync(inviteCode.trim().toUpperCase());
      toast.success('그룹에 참여했어요');
      onClose();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err?.response?.data?.detail ?? '초대코드를 확인해 주세요');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0f1e3a]/30 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-[0_12px_32px_rgba(15,30,58,0.12)] sm:rounded-2xl">
        <div className="mb-4 flex items-center gap-3">
          <p className="flex-1 text-[17px] font-semibold text-[#0f1e3a]">
            {mode === 'menu' ? '그룹' : mode === 'create' ? '새 그룹 만들기' : '그룹 참여'}
          </p>
          <button type="button" onClick={onClose} aria-label="닫기" className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5f6f88] transition-colors hover:bg-[#edf3fc]">
            <MaterialIcon icon="close" size={18} color="currentColor" />
          </button>
        </div>

        {mode === 'menu' && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setMode('create')}
              className="flex w-full items-center gap-4 rounded-xl border border-[#0f1e3a]/8 bg-white p-4 transition-colors hover:bg-[#f5f8fd]"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#eaf2ff] text-[#2a6fe3]">
                <MaterialIcon icon="add" size={18} color="currentColor" />
              </div>
              <div className="text-left">
                <p className="text-[14px] font-medium text-[#0f1e3a]">새 그룹 만들기</p>
                <p className="text-[12px] text-[#5f6f88]">초대코드를 만들어 친구를 불러요</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMode('join')}
              className="flex w-full items-center gap-4 rounded-xl border border-[#0f1e3a]/8 bg-white p-4 transition-colors hover:bg-[#f5f8fd]"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#eaf2ff] text-[#2a6fe3]">
                <MaterialIcon icon="search" size={18} color="currentColor" />
              </div>
              <div className="text-left">
                <p className="text-[14px] font-medium text-[#0f1e3a]">그룹 찾기</p>
                <p className="text-[12px] text-[#5f6f88]">그룹 이름이나 초대코드로 찾아요</p>
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
              className="mb-2 h-11 w-full rounded-[10px] border border-[#0f1e3a]/10 bg-white px-3 text-[15px] text-[#0f1e3a] transition-colors placeholder:text-[#98a6ba] focus:border-[#2a6fe3] focus:outline-none focus:ring-3 focus:ring-[#2a6fe3]/15"
            />
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value.slice(0, 200))}
              placeholder="그룹 설명 (선택사항) — 어떤 그룹인지 간단히 적어주세요"
              rows={2}
              className="mb-4 w-full resize-none rounded-[10px] border border-[#0f1e3a]/10 bg-white px-3 py-2.5 text-[15px] text-[#0f1e3a] transition-colors placeholder:text-[#98a6ba] focus:border-[#2a6fe3] focus:outline-none focus:ring-3 focus:ring-[#2a6fe3]/15"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={!name.trim() || create.isPending}
              className="h-11 w-full rounded-[10px] bg-[#2a6fe3] text-[15px] font-medium text-white transition-colors hover:bg-[#1f63d6] disabled:opacity-40"
            >
              {create.isPending ? '만드는 중' : '그룹 만들기'}
            </button>
          </>
        )}

        {mode === 'join' && (
          <>
            {/* 탭 */}
            <div className="mb-3 grid grid-cols-2 gap-1 rounded-[10px] bg-[#e6effc] p-1">
              {(['search', 'code'] as const).map(t => (
                <button key={t} type="button" onClick={() => setJoinTab(t)}
                  className={`h-8 rounded-lg text-[13px] transition-colors ${joinTab === t ? 'bg-[#2a6fe3] font-medium text-white' : 'text-[#44536b] hover:text-[#1f63d6]'}`}>
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
                  className="mb-3 h-11 w-full rounded-[10px] border border-[#0f1e3a]/10 bg-white px-3 text-[15px] text-[#0f1e3a] transition-colors placeholder:text-[#98a6ba] focus:border-[#2a6fe3] focus:outline-none focus:ring-3 focus:ring-[#2a6fe3]/15"
                />
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {searching && <p className="py-2 text-center text-[12px] text-[#5f6f88]">검색하는 중</p>}
                  {!searching && searchQ.trim() && searchResults.length === 0 && (
                    <p className="py-2 text-center text-[12px] text-[#5f6f88]">결과가 없어요</p>
                  )}
                  {searchResults.map(g => (
                    <div key={g.id} className="flex items-center justify-between rounded-xl border border-[#0f1e3a]/8 bg-white px-4 py-3">
                      <div>
                        <p className="text-[14px] font-medium text-[#0f1e3a]">{g.name}</p>
                        {g.description && <p className="text-[12px] text-[#5f6f88] line-clamp-1">{g.description}</p>}
                        <p className="text-[11px] text-[#5f6f88]">{g.member_count}명</p>
                      </div>
                      <button type="button" onClick={() => handleJoin(g.invite_code)} disabled={join.isPending}
                        className="h-8 rounded-lg bg-[#2a6fe3] px-3 text-[13px] text-white transition-colors hover:bg-[#1f63d6] disabled:opacity-40">
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
                  className="mb-4 h-12 w-full rounded-[10px] border border-[#0f1e3a]/10 bg-white px-4 text-center font-mono text-[18px] tabular-nums text-[#0f1e3a] transition-colors placeholder:font-sans placeholder:text-[15px] placeholder:text-[#98a6ba] focus:border-[#2a6fe3] focus:outline-none focus:ring-3 focus:ring-[#2a6fe3]/15"
                />
                <button type="button" onClick={() => handleJoin(code)} disabled={!code.trim() || join.isPending}
                  className="h-11 w-full rounded-[10px] bg-[#2a6fe3] text-[15px] font-medium text-white transition-colors hover:bg-[#1f63d6] disabled:opacity-40">
                  {join.isPending ? '참여하는 중' : '참여하기'}
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

type RecordState = 'idle' | 'requesting' | 'preview' | 'recording' | 'done';

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
  const [groupIds, setGroupIds]       = useState<number[]>(defaultGroupId ? [defaultGroupId] : []);
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [countdown, setCountdown]     = useState(RECORD_SECS);
  const [facingMode, setFacingMode]   = useState<'user' | 'environment'>('user');
  const [audioEnabled, setAudioEnabled] = useState(true);

  // video 요소가 마운트되는 즉시 stream 연결 (콜백 ref → useEffect 타이밍 문제 해결)
  const liveVideoCallbackRef = useCallback((node: HTMLVideoElement | null) => {
    liveVideoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  const handleFile = (f: File) => { setFile(f); setPreview(URL.createObjectURL(f)); setRecordState('done'); };

  // 1단계: 카메라만 켜서 라이브 프리뷰
  const startPreview = async (facing: 'user' | 'environment' = facingMode) => {
    setRecordState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing } },
        audio: audioEnabled,
      });
      streamRef.current = stream;
      setRecordState('preview');
    } catch (err: unknown) {
      const name = (err as { name?: string }).name;
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        toast.error('카메라를 찾지 못했어요. 파일에서 올려 주세요');
      } else {
        toast.error('카메라와 마이크 권한을 허용해 주세요');
      }
      setRecordState('idle');
    }
  };

  // 2단계: 이미 켜진 카메라로 녹화 시작
  const beginRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;

    const mimeType =
      MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' :
      MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' :
      MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' :
      MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;
    const chunks: BlobPart[] = [];

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const baseType = mimeType.split(';')[0];
      const blob = new Blob(chunks, { type: baseType });
      handleFile(new File([blob], `recording.${ext}`, { type: baseType }));
      stream.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };

    setRecordState('recording');
    setCountdown(RECORD_SECS);
    recorder.start(100);

    let count = RECORD_SECS;
    const timer = setInterval(() => {
      count--;
      setCountdown(count);
      if (count <= 0) { clearInterval(timer); recorder.stop(); }
    }, 1000);
  };

  const flipCamera = async () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setRecordState('idle');
    await startPreview(next);
  };

  const resetVideo = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setFile(null);
    setPreview(null);
    setRecordState('idle');
  };

  const handleSubmit = async () => {
    if (!file && !caption.trim()) { toast.error('영상이나 한마디를 넣어 주세요'); return; }

    const makeForm = (gid?: number) => {
      const form = new FormData();
      if (file)           form.append('video', file);
      if (caption.trim()) form.append('caption', caption);
      if (gid)            form.append('group_id', String(gid));
      if (scheduleId)     form.append('schedule_id', String(scheduleId));
      return form;
    };

    try {
      // 그룹 미선택: 내 기록에만 1번 업로드
      // 그룹 선택: 그룹마다 1번씩 업로드 (내 기록에도 자동으로 뜸)
      const targets = groupIds.length > 0 ? groupIds : [undefined];
      await Promise.all(targets.map(gid => create.mutateAsync(makeForm(gid))));
      toast.success('기록을 남겼어요');
      onClose();
    } catch { toast.error('기록을 올리지 못했어요'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0f1e3a]/30 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-[0_12px_32px_rgba(15,30,58,0.12)] sm:rounded-2xl">
        <div className="mb-4 flex items-center gap-3">
          <p className="flex-1 text-[17px] font-semibold text-[#0f1e3a]">기록 남기기</p>
          <button type="button" onClick={onClose} aria-label="닫기" className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5f6f88] transition-colors hover:bg-[#edf3fc]">
            <MaterialIcon icon="close" size={18} color="currentColor" />
          </button>
        </div>

        {scheduleTitle && (
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-[#eaf2ff] px-3 py-2.5">
            <MaterialIcon icon="check_circle" size={14} color="#2a6fe3" />
            <p className="text-[13px] text-[#1f63d6]">{displayTitle(scheduleTitle)} 완료</p>
          </div>
        )}

        {/* 그룹 선택 (복수 선택 가능) */}
        {groups.length > 0 && (
          <div className="mb-3">
            <p className="mb-2 text-[13px] text-[#44536b]">
              올릴 그룹 <span className="text-[#5f6f88]">· 여러 개 고를 수 있어요</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {groups.map(g => {
                const selected = groupIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setGroupIds(prev =>
                      selected ? prev.filter(id => id !== g.id) : [...prev, g.id]
                    )}
                    className={`h-8 rounded-lg border px-3 text-[13px] transition-colors ${
                      selected
                        ? 'border-[#2a6fe3] bg-[#2a6fe3] text-white'
                        : 'border-[#0f1e3a]/10 bg-white text-[#44536b] hover:border-[#bcd8fe]'
                    }`}
                  >
                    {g.name}
                  </button>
                );
              })}
            </div>
            {groupIds.length === 0 && (
              <p className="mt-1 text-[11px] text-[#5f6f88]">그룹 미선택 → 내 기록에만 저장</p>
            )}
          </div>
        )}

        {/* 영상 촬영 영역 */}
        <div className="mb-4 overflow-hidden rounded-xl bg-[#0f1e3a]" style={{ aspectRatio: '4/3' }}>
          {/* 대기 — 카메라 켜기 버튼 */}
          {recordState === 'idle' && (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <button type="button" onClick={() => startPreview(facingMode)}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-[#2a6fe3] transition-transform active:scale-95">
                <MaterialIcon icon="videocam" size={28} color="#fff" />
              </button>
              <p className="text-[13px] text-[#5f6f88]">카메라 켜기</p>
              <button type="button" onClick={() => fileRef.current?.click()}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-[13px] text-white/80 transition-colors hover:bg-white/20">
                <MaterialIcon icon="upload_file" size={14} color="currentColor" />
                파일에서 올리기
              </button>
            </div>
          )}

          {/* 권한 요청 중 */}
          {recordState === 'requesting' && (
            <div className="flex h-full items-center justify-center">
              <p className="text-[14px] font-medium text-white">카메라 권한을 요청하는 중</p>
            </div>
          )}

          {/* 라이브 프리뷰 — 녹화 전 */}
          {recordState === 'preview' && (
            <div className="relative h-full">
              <video ref={liveVideoCallbackRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              {/* 상단 버튼들 */}
              <div className="absolute top-2 right-2 flex gap-2">
                <button type="button" onClick={flipCamera}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white">
                  <MaterialIcon icon="flip_camera_ios" size={16} color="currentColor" />
                </button>
                <button type="button" onClick={() => setAudioEnabled(v => !v)}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${audioEnabled ? 'bg-[#2a6fe3]' : 'bg-white/15'} text-white`}>
                  <MaterialIcon icon={audioEnabled ? 'videocam' : 'videocam_off'} size={16} color="currentColor" />
                </button>
              </div>
              <p className="absolute bottom-12 inset-x-0 text-center text-[12px] text-white/70">
                {audioEnabled ? '소리 켜짐' : '소리 꺼짐'}
              </p>
              {/* 녹화 시작 버튼 */}
              <div className="absolute bottom-3 inset-x-0 flex justify-center">
                <button type="button" onClick={beginRecording}
                  className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-[#dc2626] transition-transform active:scale-95">
                  <span className="h-6 w-6 rounded-full bg-white" />
                </button>
              </div>
            </div>
          )}

          {/* 녹화 중 — 카운트다운 */}
          {recordState === 'recording' && (
            <div className="relative h-full">
              <video ref={liveVideoCallbackRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="font-mono text-[80px] font-medium tabular-nums text-white">{countdown}</span>
              </div>
              <div className="absolute top-3 left-3 flex h-6 items-center gap-1.5 rounded-md bg-[#dc2626] px-2">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                <span className="text-[12px] text-white">녹화 중</span>
              </div>
            </div>
          )}

          {/* 촬영 완료 — 미리보기 */}
          {recordState === 'done' && preview && (
            <div className="relative h-full">
              <video src={preview} controls playsInline className="h-full w-full object-cover" />
              <button type="button" onClick={resetVideo}
                className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg bg-black/50 text-white transition-colors hover:bg-black/70">
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
          className="mb-3 w-full resize-none rounded-[10px] border border-[#0f1e3a]/10 bg-white px-3 py-2.5 text-[15px] text-[#0f1e3a] transition-colors placeholder:text-[#98a6ba] focus:border-[#2a6fe3] focus:outline-none focus:ring-3 focus:ring-[#2a6fe3]/15"
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={create.isPending || recordState === 'recording' || recordState === 'requesting'}
          className="h-11 w-full rounded-[10px] bg-[#2a6fe3] text-[15px] font-medium text-white transition-colors hover:bg-[#1f63d6] disabled:opacity-40"
        >
          {create.isPending ? '등록하는 중' : '기록 남기기'}
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
    <div className={`overflow-hidden rounded-2xl border ${hasLog ? 'border-[#0f1e3a]/8 bg-white' : 'border-[#0f1e3a]/10 bg-[#f5f8fd]'}`}>
      {/* 멤버 헤더 */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-medium text-white"
            style={{ background: hasLog ? color : '#cbd5e1' }}
          >
            {slot.username.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className={`text-[14px] font-medium ${hasLog ? 'text-[#0f1e3a]' : 'text-[#5f6f88]'}`}>
              {slot.username}
            </p>
            {slot.schedule_title && (
              <p className="text-[12px] text-[#1f63d6]">{slot.schedule_title} 완료</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {relTime && <span className="text-[11px] text-[#5f6f88]">{relTime}</span>}
          {isMe && hasLog && onDelete && slot.log_id && (
            <button
              type="button"
              onClick={() => onDelete(slot.log_id!)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#98a6ba] transition-colors hover:bg-[#fef2f2] hover:text-[#dc2626]"
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
                  onError={e => { (e.target as HTMLVideoElement).style.display = 'none'; }}
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
                  <p className="text-[12px] text-white line-clamp-2">{slot.caption}</p>
                </div>
              )}
            </div>
          )}

          {/* 사진 없고 캡션만 있는 경우 */}
          {!slot.photo_url && slot.caption && (
            <div className="px-3 pb-1">
              <p className="text-[14px] leading-[22px] text-[#0f1e3a]">{slot.caption}</p>
            </div>
          )}

          {/* 좋아요 */}
          <div className="flex items-center justify-between px-3 py-2">
            <button
              type="button"
              onClick={() => slot.log_id && toggle.mutate({ logId: slot.log_id, emoji: '👍' })}
              className={`flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] transition-colors ${
                liked
                  ? 'border-[#2a6fe3] bg-[#eaf2ff] text-[#1f63d6]'
                  : 'border-[#0f1e3a]/10 bg-white text-[#5f6f88] hover:bg-[#f5f8fd]'
              }`}
            >
              <MaterialIcon icon="thumb_up" size={16} color="currentColor" />
              <span>{likeCount > 0 ? likeCount : '좋아요'}</span>
            </button>
          </div>
        </>
      ) : (
        <div className="flex h-10 items-center justify-center">
          <p className="text-[12px] text-[#98a6ba]">아직 기록을 올리지 않았어요</p>
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
  const { data: feed, isLoading, isError, refetch } = useGroupFeed(group.id);
  const deleteLog = useDeleteStudyLog();
  const leave = useLeaveGroup();
  const [showInfo, setShowInfo] = useState(false);

  const handleDelete = async (id: number) => {
    if (!confirm('이 기록을 삭제할까요?')) return;
    try { await deleteLog.mutateAsync(id); toast.success('삭제했어요'); }
    catch { toast.error('삭제하지 못했어요'); }
  };

  const handleLeave = async () => {
    if (!confirm(`'${group.name}' 그룹에서 나갈까요?`)) return;
    try { await leave.mutateAsync(group.id); toast.success('그룹에서 나왔어요'); }
    catch { toast.error('나가지 못했어요'); }
  };

  if (isLoading) return <div className="flex h-40 items-center justify-center text-[14px] text-[#5f6f88]">불러오는 중</div>;
  if (isError) return (
    <div className="flex h-40 flex-col items-center justify-center gap-3">
      <p className="text-[14px] text-[#5f6f88]">피드를 불러오지 못했어요</p>
      <button type="button" onClick={() => refetch()} className="h-9 rounded-lg bg-[#2a6fe3] px-4 text-[13px] text-white transition-colors hover:bg-[#1f63d6]">다시 시도</button>
    </div>
  );

  return (
    <div>
      {/* 그룹 정보 바 */}
      <div className="mb-3 rounded-xl border border-[#0f1e3a]/8 bg-white px-4 py-3">
        {group.description && (
          <p className="mb-2 text-[12px] text-[#5f6f88]">{group.description}</p>
        )}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[12px] text-[#5f6f88]">초대코드</p>
            <div className="flex items-center gap-2">
              <p className="font-mono text-[16px] font-medium tabular-nums text-[#1f63d6]">{group.invite_code}</p>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(group.invite_code);
                  toast.success('초대코드를 복사했어요');
                }}
                className="flex items-center gap-1 rounded-lg bg-[#eaf2ff] px-2 py-1 text-[12px] text-[#1f63d6] transition-colors hover:bg-[#dcebff]"
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
              className="h-8 rounded-lg px-3 text-[13px] text-[#dc2626] transition-colors hover:bg-[#fef2f2]"
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
        // 올린 사람 수 (중복 제거), 전체 멤버 수 (빈 슬롯 포함 유니크 user_id)
        const postedUsers = new Set(day.slots.filter(s => s.log_id).map(s => s.user_id)).size;
        const totalUsers  = new Set(day.slots.map(s => s.user_id)).size;

        return (
          <div key={day.date} className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <p className="text-[14px] font-medium text-[#0f1e3a]">{dateLabel}</p>
              <StatusPill tone={postedUsers === totalUsers ? 'green' : 'slate'}>
                {postedUsers}/{totalUsers}명
              </StatusPill>
            </div>
            <div className="space-y-3">
              {day.slots.map((slot, idx) => (
                <MemberCard
                  key={slot.log_id ?? `empty-${slot.user_id}-${idx}`}
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
    try { await deleteLog.mutateAsync(id); toast.success('삭제했어요'); }
    catch { toast.error('삭제하지 못했어요'); }
  };

  return (
    <div className="min-h-dvh bg-[#f5f8fd]">
      <div className="mx-auto min-h-dvh max-w-2xl">

        {/* 헤더 */}
        <header className="sticky top-0 z-20 border-b border-[#0f1e3a]/8 bg-white px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => router.back()}
                aria-label="뒤로"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#44536b] transition-colors hover:bg-[#edf3fc]"
              >
                <MaterialIcon icon="arrow_back" size={18} color="currentColor" />
              </button>
              <h1 className="text-[17px] font-semibold text-[#0f1e3a]">기록</h1>
            </div>
            <div className="flex items-center gap-2">
              {streak && streak.current_streak > 0 && (
                <StatusPill tone={streak.today_checked ? 'fire' : 'slate'}>
                  연속 {streak.current_streak}일
                </StatusPill>
              )}
              <button
                type="button"
                onClick={() => setShowUpload(true)}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-[#2a6fe3] px-3 text-[14px] font-medium text-white transition-colors hover:bg-[#1f63d6]"
              >
                <MaterialIcon icon="add" size={16} color="#fff" />
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
              className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] transition-colors ${
                mainTab === 'me'
                  ? 'bg-[#2a6fe3] font-medium text-white'
                  : 'bg-[#edf3fc] text-[#44536b] hover:bg-[#e1eaf6]'
              }`}
            >
              <MaterialIcon icon="person" size={16} color={mainTab === 'me' ? '#fff' : 'currentColor'} />
              내 기록
            </button>

            {/* 그룹 탭들 */}
            {groups.map(g => (
              <button
                key={g.id}
                type="button"
                onClick={() => { setSelectedGroupId(g.id); setMainTab('group'); }}
                className={`h-8 shrink-0 rounded-lg px-3 text-[13px] transition-colors ${
                  mainTab === 'group' && activeGroup?.id === g.id
                    ? 'bg-[#2a6fe3] font-medium text-white'
                    : 'bg-[#edf3fc] text-[#44536b] hover:bg-[#e1eaf6]'
                }`}
              >
                {g.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowGroupSetup(true)}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] text-[#5f6f88] transition-colors hover:bg-[#edf3fc]"
            >
              <MaterialIcon icon="add" size={16} color="currentColor" />
              그룹 추가
            </button>
          </div>
        </header>

        <main className="px-4 py-5 sm:px-6">
          {groupsLoading ? (
            <div className="flex h-40 items-center justify-center text-[14px] text-[#5f6f88]">불러오는 중</div>
          ) : mainTab === 'me' ? (
            /* ── 내 기록 탭 ── */
            <div>
              {myLoading ? (
                <div className="flex h-40 items-center justify-center text-[14px] text-[#5f6f88]">불러오는 중</div>
              ) : !myData?.items.length ? (
                <div className="mt-8 rounded-2xl border border-[#0f1e3a]/8 bg-white p-8 text-center">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#eaf2ff]">
                    <MaterialIcon icon="edit_note" size={18} color="#2a6fe3" />
                  </div>
                  <p className="text-[15px] font-medium text-[#0f1e3a]">아직 내 기록이 없어요</p>
                  <p className="mt-1 text-[13px] text-[#5f6f88]">공부 블록을 끝내고 3초 영상이나 한마디를 남겨 보세요</p>
                  <button type="button" onClick={() => setShowUpload(true)}
                    className="mt-5 h-10 rounded-[10px] bg-[#2a6fe3] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#1f63d6]">
                    기록 남기기
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {myData.items.map(log => {
                    const color = avatarColor(log.user_id);
                    return (
                      <article key={log.id} className="overflow-hidden rounded-2xl border border-[#0f1e3a]/8 bg-white">
                        <div className="flex items-center justify-between px-4 py-3">
                          <div className="flex items-center gap-2">
                            {log.schedule_title
                              ? <span className="text-[13px] text-[#44536b]">{displayTitle(log.schedule_title)} 완료</span>
                              : <span className="font-mono text-[12px] tabular-nums text-[#5f6f88]">{new Date(log.created_at).toLocaleDateString('ko-KR')}</span>
                            }
                          </div>
                          <button type="button" onClick={() => handleDeleteMyLog(log.id)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#98a6ba] transition-colors hover:bg-[#fef2f2] hover:text-[#dc2626]">
                            <MaterialIcon icon="delete" size={16} color="currentColor" />
                          </button>
                        </div>
                        {log.photo_url && (
                          <div className="relative w-full overflow-hidden bg-slate-900" style={{ aspectRatio: '16/9' }}>
                            {isVideoUrl(log.photo_url) ? (
                              <video
                                src={photoUrl(log.photo_url)}
                                controls
                                playsInline
                                className="h-full w-full object-cover"
                                onError={e => { (e.target as HTMLVideoElement).style.display = 'none'; }}
                              />
                            ) : (
                              <>
                                <img src={photoUrl(log.photo_url)} alt="기록" className="h-full w-full object-cover" />
                                {log.caption && (
                                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-2 pt-6">
                                    <p className="text-[12px] text-white line-clamp-2">{log.caption}</p>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                        {!log.photo_url && log.caption && (
                          <div className="px-4 pb-3">
                            <p className="text-[14px] leading-[22px] text-[#0f1e3a]">{log.caption}</p>
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
            <div className="mt-8 rounded-2xl border border-[#0f1e3a]/8 bg-white p-8 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#eaf2ff]">
                <MaterialIcon icon="group" size={18} color="#2a6fe3" />
              </div>
              <p className="text-[15px] font-medium text-[#0f1e3a]">그룹에 참여해 보세요</p>
              <p className="mt-1 text-[13px] text-[#5f6f88]">같은 그룹 사람들의 공부 기록을 서로 볼 수 있어요</p>
              <button type="button" onClick={() => setShowGroupSetup(true)}
                className="mx-auto mt-5 flex h-10 items-center gap-1.5 rounded-[10px] bg-[#2a6fe3] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#1f63d6]">
                <MaterialIcon icon="group_add" size={16} color="#fff" />
                그룹 만들기 · 참여
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
