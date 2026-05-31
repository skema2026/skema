'use client';

import { useRef, useState } from 'react';
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
  useToggleGroupReaction,
} from '@/hooks/useGroups';
import {
  useCreateStudyLog,
  useDeleteStudyLog,
  useMyStudyLogs,
  useStreak,
  useStudyFeed,
  useToggleReaction,
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

// ── 그룹 만들기 / 참여 모달 ───────────────────────────────────────────────────

function GroupSetupModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');
  const [name, setName]         = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const create = useCreateGroup();
  const join   = useJoinGroup();

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      await create.mutateAsync({ name: name.trim(), description: description.trim() || undefined });
      toast.success('그룹이 만들어졌어요!');
      onClose();
    } catch { toast.error('그룹 생성에 실패했습니다.'); }
  };

  const handleJoin = async () => {
    if (!code.trim()) return;
    try {
      await join.mutateAsync(code.trim().toUpperCase());
      toast.success('그룹에 참여했어요!');
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail ?? '코드를 확인해주세요.');
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
            {mode === 'menu' ? '그룹 참여' : mode === 'create' ? '새 그룹 만들기' : '코드로 참여'}
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
                <MaterialIcon icon="link" size={20} color="#fff" />
              </div>
              <div className="text-left">
                <p className="text-sm font-black text-slate-950">코드로 참여</p>
                <p className="text-xs font-bold text-slate-400">친구에게 받은 초대코드를 입력하세요</p>
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
            <input
              autoFocus
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="초대코드 입력"
              className="mb-4 h-12 w-full rounded-2xl border border-blue-100 bg-[#fbfdff] px-4 text-center text-lg font-black tracking-widest text-slate-950 placeholder:text-slate-400 placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <button
              type="button"
              onClick={handleJoin}
              disabled={!code.trim() || join.isPending}
              className="h-12 w-full rounded-2xl bg-blue-600 text-sm font-black text-white disabled:opacity-40"
            >
              {join.isPending ? '참여 중...' : '참여하기'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── 업로드 모달 ───────────────────────────────────────────────────────────────

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
  const create  = useCreateStudyLog();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview]   = useState<string | null>(null);
  const [file, setFile]         = useState<File | null>(null);
  const [caption, setCaption]   = useState('');
  const [groupId, setGroupId]   = useState<number | null>(defaultGroupId ?? (groups[0]?.id ?? null));

  const handleFile = (f: File) => { setFile(f); setPreview(URL.createObjectURL(f)); };

  const handleSubmit = async () => {
    if (!file && !caption.trim()) { toast.error('사진 또는 한 마디를 입력해주세요.'); return; }
    const form = new FormData();
    if (file)          form.append('photo', file);
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
            <MaterialIcon icon="edit" size={16} color="#fff" />
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
            <p className="mb-1.5 text-[11px] font-black text-slate-400">올릴 그룹</p>
            <div className="flex flex-wrap gap-2">
              {groups.map(g => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGroupId(g.id)}
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

        {/* 사진 */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mb-3 flex w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/50 transition hover:bg-blue-50"
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
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

        <textarea
          placeholder="오늘의 공부 한 마디..."
          value={caption}
          onChange={e => setCaption(e.target.value.slice(0, 200))}
          rows={3}
          className="mb-4 w-full resize-none rounded-2xl border border-blue-100 bg-[#fbfdff] px-3 py-2.5 text-sm font-bold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={create.isPending}
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
    const diff = Date.now() - new Date(slot.created_at).getTime();
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

      {/* 사진 또는 미올림 플레이스홀더 */}
      {hasLog ? (
        <>
          {slot.photo_url ? (
            <div className="w-full bg-slate-100" style={{ aspectRatio: '4/3' }}>
              <img src={photoUrl(slot.photo_url)} alt="공부 인증" className="h-full w-full object-cover" />
            </div>
          ) : null}

          {slot.caption && (
            <div className={`px-3 ${slot.photo_url ? 'pt-2.5' : 'pt-0'}`}>
              <p className={`font-bold text-slate-950 ${slot.photo_url ? 'text-sm' : 'text-base leading-relaxed'}`}>
                {slot.caption}
              </p>
            </div>
          )}

          {/* 좋아요 */}
          <div className="px-3 py-2.5">
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
        <div className="flex h-14 items-center justify-center">
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

// ── 글로벌 피드 (그룹 없는 사람용) ───────────────────────────────────────────

function GlobalFeed({ currentUserId }: { currentUserId?: number }) {
  const { data: feedData, isLoading } = useStudyFeed();
  const { data: myData } = useMyStudyLogs();
  const toggle = useToggleReaction();
  const deleteLog = useDeleteStudyLog();
  const [tab, setTab] = useState<'feed' | 'me'>('feed');

  const logs    = tab === 'feed' ? feedData?.items : myData?.items;
  const loading = tab === 'feed' ? isLoading : false;

  const handleDelete = async (id: number) => {
    if (!confirm('이 기록을 삭제할까요?')) return;
    try { await deleteLog.mutateAsync(id); toast.success('삭제됐습니다.'); }
    catch { toast.error('삭제에 실패했습니다.'); }
  };

  return (
    <>
      <div className="sticky top-[57px] z-10 -mx-4 border-b border-blue-100 bg-white/95 px-4 backdrop-blur-sm">
        <div className="flex">
          {([['feed', '모두의 기록'], ['me', '내 기록']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex-1 py-3 text-sm font-black transition ${
                tab === key ? 'border-b-2 border-blue-600 text-blue-600' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-slate-400">불러오는 중...</div>
        ) : !logs?.length ? (
          <div className="mt-6 rounded-2xl border border-blue-100 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50">
              <MaterialIcon icon="edit_note" size={24} color="#93c5fd" />
            </div>
            <p className="text-sm font-black text-slate-700">아직 기록이 없어요</p>
          </div>
        ) : (
          logs.map(log => {
            const liked     = log.my_reactions.includes('👍');
            const likeCount = log.reactions.find(r => r.emoji === '👍')?.count ?? 0;
            const color = avatarColor(log.user_id);
            return (
              <article key={log.id} className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-sm font-black text-white" style={{ background: color }}>
                      {log.username.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-black text-slate-950">{log.username}</p>
                      {log.schedule_title
                        ? <StatusPill tone="blue">{log.schedule_title} 완료</StatusPill>
                        : <span className="text-[11px] text-slate-400">{new Date(log.created_at).toLocaleDateString('ko-KR')}</span>
                      }
                    </div>
                  </div>
                  {tab === 'me' && log.user_id === currentUserId && (
                    <button type="button" onClick={() => handleDelete(log.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-red-50 hover:text-red-400">
                      <MaterialIcon icon="delete" size={16} color="currentColor" />
                    </button>
                  )}
                </div>
                {log.photo_url && (
                  <div className="w-full bg-slate-100" style={{ aspectRatio: '4/3' }}>
                    <img src={`${process.env.NEXT_PUBLIC_API_URL ?? '/proxy'}${log.photo_url}`} alt="공부 인증" className="h-full w-full object-cover" />
                  </div>
                )}
                {log.caption && (
                  <div className={`px-4 ${log.photo_url ? 'pt-3' : 'pt-0'}`}>
                    <p className={`font-bold text-slate-950 ${log.photo_url ? 'text-sm' : 'text-base leading-relaxed'}`}>{log.caption}</p>
                  </div>
                )}
                <div className="px-4 py-3">
                  <button type="button"
                    onClick={() => toggle.mutate({ logId: log.id, emoji: '👍' })}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black transition ${
                      liked ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300'
                    }`}
                  >
                    <MaterialIcon icon="thumb_up" size={12} color={liked ? '#fff' : 'currentColor'} />
                    <span>{likeCount > 0 ? likeCount : '좋아요'}</span>
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

export default function LogPage() {
  const router = useRouter();
  const { data: groups = [], isLoading: groupsLoading } = useMyGroups();
  const { data: streak } = useStreak();
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [showUpload, setShowUpload]   = useState(false);
  const [showGroupSetup, setShowGroupSetup] = useState(false);

  const activeGroup = selectedGroupId
    ? groups.find(g => g.id === selectedGroupId) ?? groups[0]
    : groups[0];

  const hasGroups = groups.length > 0;

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

          {/* 그룹 탭 */}
          {hasGroups && (
            <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-0.5">
              {groups.map(g => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelectedGroupId(g.id)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition ${
                    (activeGroup?.id === g.id)
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
          )}
        </header>

        <main className="px-4 py-4">
          {groupsLoading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">불러오는 중...</div>
          ) : hasGroups && activeGroup ? (
            <GroupFeed group={activeGroup} />
          ) : (
            <>
              {/* 그룹 없을 때 — 참여 유도 + 글로벌 피드 */}
              <div className="mb-4 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
                <p className="text-[11px] font-black text-slate-400">스터디 그룹</p>
                <p className="mt-1 text-sm font-black text-slate-950">함께 공부하는 그룹을 만들어보세요</p>
                <p className="mt-0.5 text-xs font-bold text-slate-400">그룹 안에서 서로의 기록을 확인할 수 있어요</p>
                <button
                  type="button"
                  onClick={() => setShowGroupSetup(true)}
                  className="mt-3 flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white"
                >
                  <MaterialIcon icon="group_add" size={14} color="#fff" />
                  그룹 만들기 / 참여
                </button>
              </div>
              <GlobalFeed />
            </>
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
