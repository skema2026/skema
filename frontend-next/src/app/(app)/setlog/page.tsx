'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import MaterialIcon from '@/components/common/MaterialIcon';

type ScreenKey = 'onboarding' | 'home' | 'create' | 'join' | 'today' | 'camera' | 'clip' | 'vlog' | 'archive' | 'settings' | 'privacy';
type PermissionState = 'idle' | 'choosing' | 'granted' | 'blocked';
type ClipStatus = 'ready' | 'missing';

type Member = {
  id: string;
  name: string;
  color: string;
  isMe?: boolean;
};

type Room = {
  id: string;
  name: string;
  color: string;
  timezone: string;
  resetHour: string;
  maxMembers: number;
  intervalMinutes: number;
  inviteCode: string;
};

type Slot = {
  id: string;
  time: string;
  label: string;
  isOpen?: boolean;
  isFuture?: boolean;
};

type Clip = {
  id: string;
  slotId: string;
  memberId: string;
  caption: string;
  videoUrl?: string;
  createdAt: string;
  reactions: Record<string, number>;
  comments: string[];
};

const DEFAULT_ROOM: Room = {
  id: 'room-campus',
  name: '캠퍼스 하루',
  color: '#2563eb',
  timezone: 'Asia/Seoul',
  resetHour: '04:00',
  maxMembers: 12,
  intervalMinutes: 60,
  inviteCode: 'HOUR-82',
};

const DEFAULT_MEMBERS: Member[] = [
  { id: 'minseo', name: '민서', color: '#2563eb' },
  { id: 'jiwoo', name: '지우', color: '#ec4899' },
  { id: 'hyunjun', name: '현준', color: '#10b981' },
  { id: 'me', name: '나', color: '#f59e0b', isMe: true },
];

const DEFAULT_SLOTS: Slot[] = [
  { id: 'slot-09', time: '09:00', label: '등교길 커피' },
  { id: 'slot-10', time: '10:00', label: '강의 전 3초' },
  { id: 'slot-11', time: '11:00', label: '지금 열림', isOpen: true },
  { id: 'slot-12', time: '12:00', label: '곧 열림', isFuture: true },
  { id: 'slot-13', time: '13:00', label: '점심 이후', isFuture: true },
];

const DEFAULT_CLIPS: Clip[] = [
  {
    id: 'clip-1',
    slotId: 'slot-09',
    memberId: 'minseo',
    caption: '학교 도착',
    createdAt: '09:01',
    reactions: { '🔥': 2, '💙': 1 },
    comments: ['오늘도 일찍 왔다'],
  },
  {
    id: 'clip-2',
    slotId: 'slot-09',
    memberId: 'jiwoo',
    caption: '커피 챙김',
    createdAt: '09:02',
    reactions: { '😂': 1 },
    comments: [],
  },
  {
    id: 'clip-3',
    slotId: 'slot-10',
    memberId: 'hyunjun',
    caption: '강의실 앞',
    createdAt: '10:00',
    reactions: { '💙': 3 },
    comments: ['짧아서 더 좋다'],
  },
];

const todayLabel = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
}).format(new Date());

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
}

function makeInviteCode() {
  return `HOUR-${Math.floor(10 + Math.random() * 89)}`;
}

function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh w-full max-w-[430px] bg-[#f7f9ff] shadow-2xl shadow-blue-950/10 sm:my-4 sm:min-h-[760px] sm:overflow-hidden sm:rounded-[30px] sm:border sm:border-slate-200">
      <div className="h-dvh overflow-y-auto bg-[#f7f9ff] sm:h-[760px]">
        {children}
      </div>
    </div>
  );
}

function StatusPill({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'green' | 'amber' | 'slate' | 'red' }) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    slate: 'bg-slate-100 text-slate-600',
    red: 'bg-red-50 text-red-600',
  }[tone];

  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${toneClass}`}>{children}</span>;
}

function AppHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack?: () => void }) {
  return (
    <div className="sticky top-0 z-10 border-b border-blue-50 bg-white/95 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        {onBack && (
          <button type="button" onClick={onBack} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100">
            <MaterialIcon icon="arrow_back" size={18} color="#475569" />
          </button>
        )}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600">
          <MaterialIcon icon="photo_camera" size={18} color="#fff" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-lg font-black text-slate-950">{title}</h3>
          {subtitle && <p className="truncate text-xs font-bold text-slate-400">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

function ClipTile({
  clip,
  member,
  status,
  onClick,
}: {
  clip?: Clip;
  member: Member;
  status: ClipStatus;
  onClick?: () => void;
}) {
  if (status === 'missing') {
    return (
      <div className="flex aspect-video min-w-0 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-100/70">
        <span className="text-[10px] font-black text-slate-400">{member.name}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative aspect-video min-w-0 overflow-hidden rounded-xl text-left"
      style={{ background: `linear-gradient(135deg, ${member.color}, #0f172a)` }}
    >
      {clip?.videoUrl ? (
        <video src={clip.videoUrl} muted loop playsInline className="h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_24%,rgba(255,255,255,0.42),transparent_28%)]" />
      )}
      <div className="absolute bottom-1.5 left-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-black text-slate-900">
        {member.name}
      </div>
      {member.isMe && (
        <div className="absolute right-1.5 top-1.5 rounded-full bg-amber-300 px-1.5 py-0.5 text-[9px] font-black text-amber-950">
          내 클립
        </div>
      )}
    </button>
  );
}

type MockProps = {
  screen: ScreenKey;
  setScreen: (screen: ScreenKey) => void;
  nickname: string;
  setNickname: (value: string) => void;
  notifPermission: PermissionState;
  cameraPermission: PermissionState;
  requestNotification: () => void;
  requestCamera: () => void;
  chooseNotificationPermission: (state: Exclude<PermissionState, 'choosing'>) => void;
  chooseCameraPermission: (state: Exclude<PermissionState, 'choosing'>) => void;
  members: Member[];
  rooms: Room[];
  activeRoom: Room;
  roomDraft: Pick<Room, 'name' | 'color' | 'timezone' | 'resetHour' | 'maxMembers' | 'intervalMinutes'>;
  setRoomDraft: (draft: Pick<Room, 'name' | 'color' | 'timezone' | 'resetHour' | 'maxMembers' | 'intervalMinutes'>) => void;
  createRoom: () => void;
  joinCode: string;
  setJoinCode: (value: string) => void;
  joinRoom: () => void;
  regenerateInvite: () => void;
  removeMember: (memberId: string) => void;
  clips: Clip[];
  slots: Slot[];
  openCameraForSlot: (slotId: string) => void;
  selectedSlotId: string;
  selectedClip?: Clip;
  selectClip: (clipId: string) => void;
  addReaction: (clipId: string, emoji: string) => void;
  addComment: (clipId: string, comment: string) => void;
  addCapturedClip: (payload: { videoUrl?: string; caption: string }) => void;
};

function PermissionChoices({ onChoose }: { onChoose: (state: Exclude<PermissionState, 'choosing'>) => void }) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-2">
      {[
        ['granted', '허용'],
        ['idle', '나중에'],
        ['blocked', '차단'],
      ].map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => onChoose(value as Exclude<PermissionState, 'choosing'>)}
          className="h-10 rounded-xl border border-blue-100 bg-white text-xs font-black text-slate-700 shadow-sm"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function OnboardingMock({
  nickname,
  setNickname,
  notifPermission,
  cameraPermission,
  requestNotification,
  requestCamera,
  chooseNotificationPermission,
  chooseCameraPermission,
  setScreen,
}: MockProps) {
  const permissionLabel = (state: PermissionState) => {
    if (state === 'granted') return '허용됨';
    if (state === 'blocked') return '차단됨';
    if (state === 'choosing') return '선택 중';
    return '대기';
  };

  const permissionTone = (state: PermissionState): 'green' | 'red' | 'amber' | 'slate' => {
    if (state === 'granted') return 'green';
    if (state === 'blocked') return 'red';
    if (state === 'choosing') return 'amber';
    return 'slate';
  };

  return (
    <div>
      <AppHeader title="HourRoom 시작" subtitle="비공개 3초 공동 브이로그" />
      <div className="p-5">
        <div className="mb-8 mt-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-200">
          <MaterialIcon icon="photo_camera" size={26} color="#fff" />
        </div>
        <h3 className="text-3xl font-black leading-tight text-slate-950">가까운 친구들과 하루를 짧게 기록하세요</h3>
        <p className="mt-3 text-sm font-bold leading-6 text-slate-500">
          공개 피드 없이 친구 그룹 안에서만 매시간 2-3초 영상을 찍고, 하루 끝에 공동 브이로그를 만듭니다.
        </p>
        <label className="mt-6 block rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <span className="text-[11px] font-black text-slate-400">닉네임</span>
          <input
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            className="mt-1 h-10 w-full bg-transparent text-lg font-black text-slate-950 outline-none"
            placeholder="닉네임 입력"
          />
        </label>
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <button type="button" onClick={requestNotification} className="flex w-full items-center justify-between">
              <span className="text-left text-sm font-black text-slate-900">
                알림 권한 요청
                <span className="mt-1 block text-xs font-bold text-slate-400">누를 때마다 다시 선택할 수 있어요</span>
              </span>
              <StatusPill tone={permissionTone(notifPermission)}>
                {permissionLabel(notifPermission)}
              </StatusPill>
            </button>
            {notifPermission === 'choosing' && <PermissionChoices onChoose={chooseNotificationPermission} />}
          </div>
          <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <button type="button" onClick={requestCamera} className="flex w-full items-center justify-between">
              <span className="text-left text-sm font-black text-slate-900">
                카메라/마이크 권한
                <span className="mt-1 block text-xs font-bold text-slate-400">누를 때마다 다시 선택할 수 있어요</span>
              </span>
              <StatusPill tone={permissionTone(cameraPermission)}>
                {permissionLabel(cameraPermission)}
              </StatusPill>
            </button>
            {cameraPermission === 'choosing' && <PermissionChoices onChoose={chooseCameraPermission} />}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setScreen('home')}
          className="mt-8 h-12 w-full rounded-2xl bg-blue-600 text-sm font-black text-white shadow-lg shadow-blue-200"
        >
          앱 둘러보기
        </button>
      </div>
    </div>
  );
}

function HomeMock({ activeRoom, rooms, members, setScreen, clips, slots }: MockProps) {
  const openSlot = slots.find((slot) => slot.isOpen) ?? slots[0];
  const readyCount = clips.length;

  return (
    <div>
      <AppHeader title="HourRoom" subtitle={todayLabel} />
      <div className="p-4">
        <div className="rounded-3xl p-5 text-white shadow-xl" style={{ background: `linear-gradient(135deg, ${activeRoom.color}, #0f172a)` }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-black text-blue-100">오늘의 룸</p>
              <h3 className="mt-1 text-2xl font-black">{activeRoom.name}</h3>
              <p className="mt-2 text-sm font-bold text-slate-200">{members.length}명 참여 중 · 다음 촬영 {openSlot.time}</p>
            </div>
            <StatusPill tone="green">비공개</StatusPill>
          </div>
          <div className="mt-5 grid grid-cols-4 gap-2">
            {members.map((member) => (
              <div key={member.id} className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-black text-white" style={{ background: member.color }}>
                  {member.name[0]}
                </div>
                <p className="mt-1 truncate text-[10px] font-black text-slate-200">{member.name}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setScreen('create')} className="rounded-2xl border border-blue-100 bg-white p-4 text-left shadow-sm">
            <MaterialIcon icon="add" size={20} color="#2563eb" />
            <p className="mt-3 text-sm font-black text-slate-950">Log 만들기</p>
            <p className="mt-1 text-xs font-bold text-slate-400">친구 초대</p>
          </button>
          <button type="button" onClick={() => setScreen('join')} className="rounded-2xl border border-blue-100 bg-white p-4 text-left shadow-sm">
            <MaterialIcon icon="link_off" size={20} color="#2563eb" />
            <p className="mt-3 text-sm font-black text-slate-950">코드 참여</p>
            <p className="mt-1 text-xs font-bold text-slate-400">비공개 입장</p>
          </button>
        </div>

        <button type="button" onClick={() => setScreen('today')} className="mt-4 w-full rounded-2xl border border-blue-100 bg-white p-4 text-left shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black text-slate-950">오늘 타임라인</p>
              <p className="mt-1 text-xs font-bold text-slate-400">{readyCount}개 클립 · 현재 슬롯 {openSlot.time}</p>
            </div>
            <MaterialIcon icon="chevron_right" size={18} color="#2563eb" />
          </div>
        </button>

        <div className="mt-4 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black text-slate-400">내 Rooms</p>
          <div className="mt-3 space-y-2">
            {rooms.map((room) => (
              <div key={room.id} className="flex items-center justify-between rounded-xl bg-[#fbfdff] p-3">
                <div className="flex items-center gap-3">
                  <span className="h-8 w-8 rounded-xl" style={{ background: room.color }} />
                  <span className="text-sm font-black text-slate-900">{room.name}</span>
                </div>
                <span className="text-xs font-black text-slate-400">{room.inviteCode}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateRoomMock({ roomDraft, setRoomDraft, createRoom, setScreen }: MockProps) {
  return (
    <div>
      <AppHeader title="새 Log 만들기" subtitle="방장은 멤버/초대코드를 관리합니다" onBack={() => setScreen('home')} />
      <div className="p-4">
        <div className="space-y-3">
          <label className="block rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
            <span className="text-[11px] font-black text-slate-400">그룹 이름</span>
            <input
              value={roomDraft.name}
              onChange={(event) => setRoomDraft({ ...roomDraft, name: event.target.value })}
              className="mt-1 h-10 w-full bg-transparent text-base font-black text-slate-950 outline-none"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
              <span className="text-[11px] font-black text-slate-400">리셋 시간</span>
              <input
                type="time"
                value={roomDraft.resetHour}
                onChange={(event) => setRoomDraft({ ...roomDraft, resetHour: event.target.value })}
                className="mt-1 h-10 w-full bg-transparent text-base font-black text-slate-950 outline-none"
              />
            </label>
            <label className="block rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
              <span className="text-[11px] font-black text-slate-400">멤버 제한</span>
              <input
                type="number"
                min={2}
                max={12}
                value={roomDraft.maxMembers}
                onChange={(event) => setRoomDraft({ ...roomDraft, maxMembers: Math.min(12, Number(event.target.value)) })}
                className="mt-1 h-10 w-full bg-transparent text-base font-black text-slate-950 outline-none"
              />
            </label>
          </div>
          <label className="block rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
            <span className="text-[11px] font-black text-slate-400">시간대</span>
            <input
              value={roomDraft.timezone}
              onChange={(event) => setRoomDraft({ ...roomDraft, timezone: event.target.value })}
              className="mt-1 h-10 w-full bg-transparent text-base font-black text-slate-950 outline-none"
            />
          </label>
        </div>
        <div className="mt-4 rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
          <p className="text-[11px] font-black text-slate-400">대표 색상</p>
          <div className="mt-2 flex gap-2">
            {['#2563eb', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6'].map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setRoomDraft({ ...roomDraft, color })}
                className="h-9 w-9 rounded-full border-4 border-white shadow-sm ring-offset-2"
                style={{ background: color, outline: roomDraft.color === color ? `2px solid ${color}` : 'none' }}
              />
            ))}
          </div>
        </div>
        <button type="button" onClick={createRoom} className="mt-5 h-12 w-full rounded-2xl bg-blue-600 text-sm font-black text-white">
          초대코드 만들고 시작
        </button>
      </div>
    </div>
  );
}

function JoinRoomMock({ joinCode, setJoinCode, joinRoom, activeRoom, setScreen }: MockProps) {
  return (
    <div>
      <AppHeader title="초대코드로 참여" subtitle="초대코드 없이는 접근할 수 없습니다" onBack={() => setScreen('home')} />
      <div className="p-5">
        <div className="rounded-3xl border border-dashed border-blue-200 bg-white p-6 text-center shadow-sm">
          <p className="text-[11px] font-black text-slate-400">SAMPLE INVITE CODE</p>
          <p className="mt-2 text-3xl font-black tracking-[0.18em] text-blue-700">{activeRoom.inviteCode}</p>
          <p className="mt-3 text-xs font-bold text-slate-400">코드는 서버에서 hash로 저장하고 재생성할 수 있습니다.</p>
        </div>
        <label className="mt-4 block rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <span className="text-[11px] font-black text-slate-400">초대코드 입력</span>
          <input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            className="mt-1 h-11 w-full bg-transparent text-center text-2xl font-black tracking-[0.12em] text-slate-950 outline-none"
            placeholder={activeRoom.inviteCode}
          />
        </label>
        <button type="button" onClick={joinRoom} className="mt-5 h-12 w-full rounded-2xl bg-blue-600 text-sm font-black text-white">
          참여하기
        </button>
      </div>
    </div>
  );
}

function TodayMock({ slots, members, clips, openCameraForSlot, selectClip, setScreen }: MockProps) {
  const clipFor = (slotId: string, memberId: string) => clips.find((clip) => clip.slotId === slotId && clip.memberId === memberId);

  return (
    <div>
      <AppHeader title="오늘 타임라인" subtitle={todayLabel} onBack={() => setScreen('home')} />
      <div className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black text-blue-600">실시간 공유</p>
            <h3 className="text-xl font-black text-slate-950">시간 슬롯</h3>
          </div>
          <StatusPill tone="green">11:00 열림</StatusPill>
        </div>
        <div className="space-y-3">
          {slots.map((slot) => (
            <section key={slot.id} className="rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-slate-950">{slot.time}</p>
                  <p className="text-xs font-bold text-slate-400">{slot.label}</p>
                </div>
                {slot.isOpen ? (
                  <button type="button" onClick={() => openCameraForSlot(slot.id)} className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white">
                    촬영
                  </button>
                ) : (
                  <StatusPill tone={slot.isFuture ? 'slate' : 'blue'}>{slot.isFuture ? '예정' : '마감'}</StatusPill>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {members.map((member) => {
                  const clip = clipFor(slot.id, member.id);
                  return (
                    <ClipTile
                      key={`${slot.id}-${member.id}`}
                      clip={clip}
                      member={member}
                      status={clip ? 'ready' : 'missing'}
                      onClick={clip ? () => selectClip(clip.id) : undefined}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function CameraMock({ selectedSlotId, slots, addCapturedClip, setScreen }: MockProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [cameraState, setCameraState] = useState<PermissionState>('idle');
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [caption, setCaption] = useState('');
  const [capturedUrl, setCapturedUrl] = useState<string | undefined>();
  const slot = slots.find((item) => item.id === selectedSlotId) ?? slots.find((item) => item.isOpen) ?? slots[0];

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraState('granted');
    } catch {
      setCameraState('blocked');
    }
  };

  const startCapture = async () => {
    if (!streamRef.current) {
      await openCamera();
    }
    if (!streamRef.current) {
      addCapturedClip({ caption: caption.trim() || `${slot.time} 기록` });
      setScreen('today');
      return;
    }

    if (!('MediaRecorder' in window)) {
      addCapturedClip({ caption: caption.trim() || `${slot.time} 기록` });
      setScreen('today');
      return;
    }

    chunksRef.current = [];
    const recorder = new MediaRecorder(streamRef.current);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      setCapturedUrl(url);
      setRecording(false);
    };
    recorder.start();
    setRecording(true);
    setCountdown(3);

    const timer = window.setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          recorder.stop();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
  };

  const submitClip = () => {
    addCapturedClip({ videoUrl: capturedUrl, caption: caption.trim() || `${slot.time} 기록` });
    setCaption('');
    setCapturedUrl(undefined);
    setScreen('today');
  };

  return (
    <div>
      <AppHeader title="실시간 촬영" subtitle={`${slot.time} 슬롯 · 2-3초 제한`} onBack={() => setScreen('today')} />
      <div className="p-4">
        <div className="overflow-hidden rounded-3xl bg-slate-950">
          <div className="relative aspect-video">
            {capturedUrl ? (
              <video src={capturedUrl} controls playsInline className="h-full w-full object-cover" />
            ) : (
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
            )}
            {cameraState !== 'granted' && !capturedUrl && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-center">
                <MaterialIcon icon="photo_camera" size={36} color="#93c5fd" />
                <p className="mt-3 text-sm font-black text-white">실시간 촬영만 허용</p>
                <p className="mt-1 text-xs font-bold text-slate-400">카메라롤 업로드 없음</p>
              </div>
            )}
            {recording && (
              <div className="absolute right-3 top-3 rounded-full bg-red-500 px-3 py-1 text-sm font-black text-white">REC {countdown}s</div>
            )}
          </div>
        </div>
        <label className="mt-4 block rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
          <span className="text-[11px] font-black text-slate-400">짧은 캡션</span>
          <input
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            maxLength={80}
            className="mt-1 h-10 w-full bg-transparent text-sm font-black text-slate-950 outline-none"
            placeholder="예: 강의실 들어가기 전"
          />
        </label>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={openCamera} className="h-12 rounded-2xl bg-slate-900 text-sm font-black text-white">
            권한 확인
          </button>
          <button type="button" onClick={capturedUrl ? submitClip : startCapture} disabled={recording} className="h-12 rounded-2xl bg-blue-600 text-sm font-black text-white disabled:opacity-40">
            {capturedUrl ? '업로드 완료' : recording ? '촬영 중' : '3초 촬영'}
          </button>
        </div>
        {cameraState === 'blocked' && (
          <p className="mt-3 rounded-2xl bg-red-50 p-3 text-xs font-bold text-red-600">브라우저 또는 기기 설정에서 카메라/마이크 권한을 허용해주세요.</p>
        )}
      </div>
    </div>
  );
}

function ClipDetailMock({ selectedClip, members, addReaction, addComment, setScreen }: MockProps) {
  const [comment, setComment] = useState('');
  const member = members.find((item) => item.id === selectedClip?.memberId) ?? members[0];

  if (!selectedClip) {
    return (
      <div>
        <AppHeader title="클립 상세" subtitle="선택된 클립이 없습니다" onBack={() => setScreen('today')} />
        <div className="p-4">
          <button type="button" onClick={() => setScreen('today')} className="h-12 w-full rounded-2xl bg-blue-600 text-sm font-black text-white">
            타임라인으로 이동
          </button>
        </div>
      </div>
    );
  }

  const submitComment = () => {
    if (!comment.trim()) return;
    addComment(selectedClip.id, comment.trim());
    setComment('');
  };

  return (
    <div>
      <AppHeader title="클립 상세" subtitle={`${selectedClip.createdAt} · ${member.name}`} onBack={() => setScreen('today')} />
      <div className="p-4">
        <ClipTile clip={selectedClip} status="ready" member={member} />
        <div className="mt-4 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black text-blue-600">{member.name}</p>
          <h3 className="mt-1 text-lg font-black text-slate-950">{selectedClip.caption}</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {['🔥', '😂', '💙', '👏'].map((emoji) => (
              <button key={emoji} type="button" onClick={() => addReaction(selectedClip.id, emoji)} className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700">
                {emoji} {selectedClip.reactions[emoji] ?? 0}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {selectedClip.comments.map((item, index) => (
            <p key={`${item}-${index}`} className="rounded-2xl bg-white p-3 text-xs font-bold text-slate-600 shadow-sm">{item}</p>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            className="h-11 min-w-0 flex-1 rounded-2xl border border-blue-100 bg-white px-3 text-sm font-bold outline-none"
            placeholder="짧은 댓글"
          />
          <button type="button" onClick={submitComment} className="h-11 rounded-2xl bg-blue-600 px-4 text-xs font-black text-white">
            등록
          </button>
        </div>
      </div>
    </div>
  );
}

function VlogMock({ clips, members, slots, setScreen }: MockProps) {
  const [status, setStatus] = useState<'idle' | 'processing' | 'ready'>('idle');
  const readyClips = clips.slice(0, 8);

  const compose = () => {
    setStatus('processing');
    window.setTimeout(() => setStatus('ready'), 1200);
  };

  return (
    <div>
      <AppHeader title="공동 브이로그" subtitle="하루 종료 후 자동 생성" onBack={() => setScreen('today')} />
      <div className="p-4">
        <div className="rounded-3xl bg-slate-950 p-4 text-white">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-black text-blue-200">FFmpeg Worker</p>
              <h3 className="mt-1 text-2xl font-black">오늘 공동 브이로그</h3>
            </div>
            <StatusPill tone={status === 'ready' ? 'green' : status === 'processing' ? 'amber' : 'slate'}>
              {status === 'ready' ? '완료' : status === 'processing' ? '합성 중' : '대기'}
            </StatusPill>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {(readyClips.length ? readyClips : slots.slice(0, 4)).map((item, index) => {
              const clip = 'memberId' in item ? item : undefined;
              const member = clip ? members.find((m) => m.id === clip.memberId) ?? members[0] : members[index % members.length];
              return <ClipTile key={clip?.id ?? item.id} clip={clip} status="ready" member={member} />;
            })}
          </div>
          <div className="mt-4 rounded-2xl bg-white/10 p-3 text-xs font-bold text-slate-300">
            시간순 슬롯을 이어 붙이고, 누락 멤버는 빈 칸으로 처리하며 이름/시간/날짜를 오버레이합니다.
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={compose} className="h-11 rounded-2xl bg-blue-600 text-sm font-black text-white">
            자동 합성
          </button>
          <button type="button" disabled={status !== 'ready'} className="h-11 rounded-2xl bg-white text-sm font-black text-slate-800 shadow-sm disabled:opacity-40">
            저장/공유
          </button>
        </div>
      </div>
    </div>
  );
}

function ArchiveMock({ clips, setScreen }: MockProps) {
  return (
    <div>
      <AppHeader title="과거 기록" subtitle="날짜별 로그와 브이로그" onBack={() => setScreen('home')} />
      <div className="p-4">
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }, (_, index) => {
            const hasLog = [2, 5, 9, 13, 18, 25, 29].includes(index);
            return (
              <button key={index} className={`aspect-square rounded-xl text-xs font-black ${hasLog ? 'bg-blue-600 text-white' : 'bg-white text-slate-400'}`}>
                {index + 1}
              </button>
            );
          })}
        </div>
        <div className="mt-4 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-black text-slate-950">오늘 브이로그</p>
          <p className="mt-1 text-xs font-bold text-slate-400">{clips.length}개 클립 · 미리보기 가능 · 저장 가능</p>
        </div>
      </div>
    </div>
  );
}

function SettingsMock({ activeRoom, members, regenerateInvite, removeMember, setScreen }: MockProps) {
  return (
    <div>
      <AppHeader title="그룹 설정" subtitle={activeRoom.name} onBack={() => setScreen('home')} />
      <div className="p-4">
        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black text-slate-400">초대코드</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-2xl font-black tracking-[0.16em] text-blue-700">{activeRoom.inviteCode}</p>
            <button type="button" onClick={regenerateInvite} className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">
              재생성
            </button>
          </div>
        </div>
        <div className="mt-3 space-y-3">
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-between rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="h-9 w-9 rounded-xl" style={{ background: member.color }} />
                <div>
                  <p className="text-sm font-black text-slate-950">{member.name}</p>
                  <p className="text-xs font-bold text-slate-400">{member.isMe ? '방장' : '멤버'}</p>
                </div>
              </div>
              {!member.isMe && (
                <button type="button" onClick={() => removeMember(member.id)} className="rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-600">
                  삭제
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <p className="text-sm font-black text-slate-950">촬영 옵션</p>
          <p className="mt-1 text-xs font-bold text-slate-400">가로 촬영 기본 · 왼손/오른손 방향 전환 지원 예정</p>
        </div>
      </div>
    </div>
  );
}

function PrivacyMock({ setScreen }: MockProps) {
  return (
    <div>
      <AppHeader title="개인정보와 안전" subtitle="닫힌 공간을 기본값으로 설계" onBack={() => setScreen('home')} />
      <div className="p-4">
        <div className="space-y-3">
          {[
            '모든 그룹은 기본 비공개',
            '초대코드 없이는 접근 불가',
            'Storage는 signed URL만 사용',
            '그룹 멤버만 읽기/쓰기 가능',
            '신고/차단/계정 삭제 지원',
            '13세 미만 제한 및 약관/개인정보 페이지 준비',
          ].map((item) => (
            <div key={item} className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
              <MaterialIcon icon="check_circle" size={18} color="#059669" />
              <p className="text-sm font-black text-slate-800">{item}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BottomNav({ screen, setScreen }: { screen: ScreenKey; setScreen: (screen: ScreenKey) => void }) {
  const items: { key: ScreenKey; label: string; icon: string }[] = [
    { key: 'home', label: '홈', icon: 'widgets' },
    { key: 'today', label: '오늘', icon: 'schedule' },
    { key: 'camera', label: '촬영', icon: 'photo_camera' },
    { key: 'archive', label: '기록', icon: 'calendar_month' },
    { key: 'settings', label: '설정', icon: 'tune' },
  ];

  if (screen === 'onboarding') return null;

  return (
    <nav className="sticky bottom-0 z-20 border-t border-blue-50 bg-white/95 px-2 py-2 backdrop-blur">
      <div className="grid grid-cols-5 gap-1">
        {items.map((item) => {
          const active = screen === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setScreen(item.key)}
              className={`flex flex-col items-center justify-center rounded-2xl px-1 py-2 text-[10px] font-black transition ${
                active ? 'bg-blue-600 text-white' : 'text-slate-400'
              }`}
            >
              <MaterialIcon icon={item.icon} size={18} color={active ? '#fff' : '#94a3b8'} />
              <span className="mt-1">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function ScreenPreview(props: MockProps) {
  const screens: Record<ScreenKey, ReactNode> = {
    onboarding: <OnboardingMock {...props} />,
    home: <HomeMock {...props} />,
    create: <CreateRoomMock {...props} />,
    join: <JoinRoomMock {...props} />,
    today: <TodayMock {...props} />,
    camera: <CameraMock {...props} />,
    clip: <ClipDetailMock {...props} />,
    vlog: <VlogMock {...props} />,
    archive: <ArchiveMock {...props} />,
    settings: <SettingsMock {...props} />,
    privacy: <PrivacyMock {...props} />,
  };

  return (
    <PhoneFrame>
      <div className="flex min-h-full flex-col">
        <div className="min-h-0 flex-1">
          {screens[props.screen]}
        </div>
        <BottomNav screen={props.screen} setScreen={props.setScreen} />
      </div>
    </PhoneFrame>
  );
}

export default function SetlogPage() {
  const [screen, setScreen] = useState<ScreenKey>('onboarding');
  const [nickname, setNickname] = useState('나');
  const [notifPermission, setNotifPermission] = useState<PermissionState>('idle');
  const [cameraPermission, setCameraPermission] = useState<PermissionState>('idle');
  const [rooms, setRooms] = useState<Room[]>([DEFAULT_ROOM]);
  const [activeRoomId, setActiveRoomId] = useState(DEFAULT_ROOM.id);
  const [members, setMembers] = useState<Member[]>(DEFAULT_MEMBERS);
  const [clips, setClips] = useState<Clip[]>(DEFAULT_CLIPS);
  const [selectedSlotId, setSelectedSlotId] = useState('slot-11');
  const [selectedClipId, setSelectedClipId] = useState(DEFAULT_CLIPS[0].id);
  const [joinCode, setJoinCode] = useState('');
  const [roomDraft, setRoomDraft] = useState<Pick<Room, 'name' | 'color' | 'timezone' | 'resetHour' | 'maxMembers' | 'intervalMinutes'>>({
    name: '우리 하루',
    color: '#2563eb',
    timezone: 'Asia/Seoul',
    resetHour: '04:00',
    maxMembers: 12,
    intervalMinutes: 60,
  });

  const activeRoom = rooms.find((room) => room.id === activeRoomId) ?? rooms[0];
  const selectedClip = clips.find((clip) => clip.id === selectedClipId);

  const requestNotification = () => {
    setNotifPermission('choosing');
  };

  const requestCamera = () => {
    setCameraPermission('choosing');
  };

  const chooseNotificationPermission = async (state: Exclude<PermissionState, 'choosing'>) => {
    setNotifPermission(state);
    if (state !== 'granted' || !('Notification' in window)) return;
    try {
      await Notification.requestPermission();
    } catch {
      // Browser-level permission may already be fixed; the demo selection remains editable.
    }
  };

  const chooseCameraPermission = async (state: Exclude<PermissionState, 'choosing'>) => {
    setCameraPermission(state);
    if (state !== 'granted') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      // Browser-level permission may already be fixed; the demo selection remains editable.
    }
  };

  const createRoom = () => {
    const room: Room = {
      id: makeId('room'),
      inviteCode: makeInviteCode(),
      ...roomDraft,
    };
    setRooms((prev) => [room, ...prev]);
    setActiveRoomId(room.id);
    setScreen('home');
  };

  const joinRoom = () => {
    const normalized = joinCode.trim() || activeRoom.inviteCode;
    const joined: Room = {
      ...DEFAULT_ROOM,
      id: makeId('joined'),
      name: `${normalized} 친구방`,
      inviteCode: normalized,
      color: '#8b5cf6',
    };
    setRooms((prev) => [joined, ...prev]);
    setActiveRoomId(joined.id);
    setJoinCode('');
    setScreen('home');
  };

  const regenerateInvite = () => {
    setRooms((prev) => prev.map((room) => room.id === activeRoom.id ? { ...room, inviteCode: makeInviteCode() } : room));
  };

  const removeMember = (memberId: string) => {
    setMembers((prev) => prev.filter((member) => member.id !== memberId));
  };

  const openCameraForSlot = (slotId: string) => {
    setSelectedSlotId(slotId);
    setScreen('camera');
  };

  const selectClip = (clipId: string) => {
    setSelectedClipId(clipId);
    setScreen('clip');
  };

  const addReaction = (clipId: string, emoji: string) => {
    setClips((prev) => prev.map((clip) => (
      clip.id === clipId
        ? { ...clip, reactions: { ...clip.reactions, [emoji]: (clip.reactions[emoji] ?? 0) + 1 } }
        : clip
    )));
  };

  const addComment = (clipId: string, comment: string) => {
    setClips((prev) => prev.map((clip) => (
      clip.id === clipId
        ? { ...clip, comments: [...clip.comments, comment] }
        : clip
    )));
  };

  const addCapturedClip = ({ videoUrl, caption }: { videoUrl?: string; caption: string }) => {
    const existing = clips.find((clip) => clip.slotId === selectedSlotId && clip.memberId === 'me');
    const nextClip: Clip = {
      id: existing?.id ?? makeId('clip'),
      slotId: selectedSlotId,
      memberId: 'me',
      caption,
      videoUrl,
      createdAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }),
      reactions: existing?.reactions ?? {},
      comments: existing?.comments ?? [],
    };
    setClips((prev) => existing ? prev.map((clip) => clip.id === existing.id ? nextClip : clip) : [...prev, nextClip]);
    setSelectedClipId(nextClip.id);
  };

  const mockProps: MockProps = {
    screen,
    setScreen,
    nickname,
    setNickname,
    notifPermission,
    cameraPermission,
    requestNotification,
    requestCamera,
    chooseNotificationPermission,
    chooseCameraPermission,
    members,
    rooms,
    activeRoom,
    roomDraft,
    setRoomDraft,
    createRoom,
    joinCode,
    setJoinCode,
    joinRoom,
    regenerateInvite,
    removeMember,
    clips,
    slots: DEFAULT_SLOTS,
    openCameraForSlot,
    selectedSlotId,
    selectedClip,
    selectClip,
    addReaction,
    addComment,
    addCapturedClip,
  };

  return (
    <div className="min-h-dvh bg-[#eaf1ff] sm:flex sm:items-center sm:justify-center sm:p-4">
      <ScreenPreview {...mockProps} />
    </div>
  );
}
