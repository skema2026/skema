'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import MaterialIcon from '@/components/common/MaterialIcon';

type ScreenKey =
  | 'onboarding'
  | 'home'
  | 'create'
  | 'join'
  | 'today'
  | 'camera'
  | 'clip'
  | 'vlog'
  | 'archive'
  | 'settings'
  | 'privacy';

type ClipStatus = 'ready' | 'missing' | 'mine';

const SCREENS: { key: ScreenKey; label: string; icon: string }[] = [
  { key: 'onboarding', label: '온보딩', icon: 'person' },
  { key: 'home', label: '홈', icon: 'widgets' },
  { key: 'create', label: '방 만들기', icon: 'add' },
  { key: 'join', label: '초대 참여', icon: 'link_off' },
  { key: 'today', label: '오늘', icon: 'schedule' },
  { key: 'camera', label: '촬영', icon: 'photo_camera' },
  { key: 'clip', label: '클립', icon: 'chat' },
  { key: 'vlog', label: '브이로그', icon: 'auto_awesome' },
  { key: 'archive', label: '기록', icon: 'calendar_month' },
  { key: 'settings', label: '설정', icon: 'tune' },
  { key: 'privacy', label: '안전', icon: 'lock' },
];

const MEMBERS = [
  { name: '민서', color: '#2563eb' },
  { name: '지우', color: '#ec4899' },
  { name: '현준', color: '#10b981' },
  { name: '나', color: '#f59e0b' },
];

const SLOTS = [
  { time: '09:00', caption: '등교길 커피', statuses: ['ready', 'ready', 'missing', 'mine'] as ClipStatus[] },
  { time: '10:00', caption: '강의 전 3초', statuses: ['ready', 'missing', 'ready', 'mine'] as ClipStatus[] },
  { time: '11:00', caption: '지금 열림', statuses: ['missing', 'missing', 'missing', 'mine'] as ClipStatus[] },
  { time: '12:00', caption: '곧 열림', statuses: ['missing', 'missing', 'missing', 'missing'] as ClipStatus[] },
];

const API_GROUPS = [
  'POST /log-rooms',
  'POST /log-rooms/join',
  'GET /log-rooms/{room_id}/today',
  'POST /capture-slots/{slot_id}/clips/upload-url',
  'POST /capture-slots/{slot_id}/clips/complete',
  'POST /log-rooms/{room_id}/vlogs/{day_key}/compose',
];

const CHECKLIST = [
  '인증/닉네임 온보딩',
  '그룹 생성/초대코드 참여',
  '2-3초 실시간 촬영',
  'signed URL 영상 업로드',
  '오늘 타임라인',
  '푸시 알림',
  'FFmpeg 공동 브이로그',
  '캘린더 과거 기록',
];

function SectionTitle({ eyebrow, title, desc }: { eyebrow: string; title: string; desc: string }) {
  return (
    <div className="mb-5">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-blue-600">{eyebrow}</p>
      <h2 className="mt-1 text-2xl font-black text-slate-950">{title}</h2>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{desc}</p>
    </div>
  );
}

function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[390px] overflow-hidden rounded-[28px] border border-slate-200 bg-slate-950 p-2 shadow-2xl shadow-blue-950/20">
      <div className="min-h-[650px] overflow-hidden rounded-[22px] bg-[#f7f9ff]">
        {children}
      </div>
    </div>
  );
}

function StatusPill({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'green' | 'amber' | 'slate' }) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    slate: 'bg-slate-100 text-slate-600',
  }[tone];

  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${toneClass}`}>{children}</span>;
}

function ClipTile({ status, member }: { status: ClipStatus; member: typeof MEMBERS[number] }) {
  if (status === 'missing') {
    return (
      <div className="flex aspect-video min-w-0 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-100/70">
        <span className="text-[10px] font-black text-slate-400">{member.name}</span>
      </div>
    );
  }

  return (
    <div
      className="relative aspect-video min-w-0 overflow-hidden rounded-xl"
      style={{ background: `linear-gradient(135deg, ${member.color}, #0f172a)` }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_24%,rgba(255,255,255,0.42),transparent_28%)]" />
      <div className="absolute bottom-1.5 left-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-black text-slate-900">
        {member.name}
      </div>
      {status === 'mine' && (
        <div className="absolute right-1.5 top-1.5 rounded-full bg-amber-300 px-1.5 py-0.5 text-[9px] font-black text-amber-950">
          내 클립
        </div>
      )}
    </div>
  );
}

function OnboardingMock() {
  return (
    <div className="p-5">
      <div className="mb-8 mt-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-200">
        <MaterialIcon icon="photo_camera" size={26} color="#fff" />
      </div>
      <h3 className="text-3xl font-black leading-tight text-slate-950">가까운 친구들과 하루를 짧게 기록하세요</h3>
      <p className="mt-3 text-sm font-bold leading-6 text-slate-500">
        HourRoom은 비공개 그룹 안에서 정해진 시간마다 2-3초 영상을 찍고, 하루 끝에 공동 브이로그를 만드는 MVP입니다.
      </p>
      <div className="mt-8 space-y-3">
        {['닉네임 설정', '알림 권한 요청', '카메라/마이크 권한 요청'].map((item, index) => (
          <div key={item} className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-sm font-black text-blue-700">{index + 1}</span>
            <span className="text-sm font-black text-slate-900">{item}</span>
          </div>
        ))}
      </div>
      <button className="mt-8 h-12 w-full rounded-2xl bg-blue-600 text-sm font-black text-white shadow-lg shadow-blue-200">
        시작하기
      </button>
    </div>
  );
}

function HomeMock() {
  return (
    <div className="p-4">
      <div className="rounded-3xl bg-slate-950 p-5 text-white">
        <p className="text-[11px] font-black text-blue-200">오늘의 룸</p>
        <h3 className="mt-1 text-2xl font-black">캠퍼스 하루</h3>
        <p className="mt-2 text-sm font-bold text-slate-300">4명 참여 중 · 다음 촬영 11:00</p>
        <div className="mt-5 grid grid-cols-4 gap-2">
          {MEMBERS.map((member) => (
            <div key={member.name} className="text-center">
              <div className="mx-auto h-12 w-12 rounded-2xl" style={{ background: member.color }} />
              <p className="mt-1 truncate text-[10px] font-black text-slate-200">{member.name}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button className="rounded-2xl border border-blue-100 bg-white p-4 text-left shadow-sm">
          <MaterialIcon icon="add" size={20} color="#2563eb" />
          <p className="mt-3 text-sm font-black text-slate-950">Log 만들기</p>
          <p className="mt-1 text-xs font-bold text-slate-400">친구 초대</p>
        </button>
        <button className="rounded-2xl border border-blue-100 bg-white p-4 text-left shadow-sm">
          <MaterialIcon icon="link_off" size={20} color="#2563eb" />
          <p className="mt-3 text-sm font-black text-slate-950">코드 참여</p>
          <p className="mt-1 text-xs font-bold text-slate-400">비공개 입장</p>
        </button>
      </div>
    </div>
  );
}

function CreateRoomMock() {
  return (
    <div className="p-4">
      <h3 className="text-xl font-black text-slate-950">새 Log 만들기</h3>
      <div className="mt-4 space-y-3">
        {[
          ['그룹 이름', '캠퍼스 하루'],
          ['시간대', 'Asia/Seoul'],
          ['리셋 시간', '04:00'],
          ['멤버 제한', '최대 12명'],
        ].map(([label, value]) => (
          <label key={label} className="block rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
            <span className="text-[11px] font-black text-slate-400">{label}</span>
            <div className="mt-1 text-base font-black text-slate-950">{value}</div>
          </label>
        ))}
      </div>
      <div className="mt-4 rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
        <p className="text-[11px] font-black text-slate-400">대표 색상</p>
        <div className="mt-2 flex gap-2">
          {['#2563eb', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6'].map((color) => (
            <span key={color} className="h-9 w-9 rounded-full border-4 border-white shadow-sm" style={{ background: color }} />
          ))}
        </div>
      </div>
      <button className="mt-5 h-12 w-full rounded-2xl bg-blue-600 text-sm font-black text-white">초대코드 만들기</button>
    </div>
  );
}

function JoinRoomMock() {
  return (
    <div className="p-5">
      <h3 className="text-xl font-black text-slate-950">초대코드로 참여</h3>
      <div className="mt-5 rounded-3xl border border-dashed border-blue-200 bg-white p-6 text-center shadow-sm">
        <p className="text-[11px] font-black text-slate-400">INVITE CODE</p>
        <p className="mt-2 text-3xl font-black tracking-[0.2em] text-blue-700">HOUR-82</p>
        <p className="mt-3 text-xs font-bold text-slate-400">코드는 서버에서 hash로 저장하고 재생성할 수 있습니다.</p>
      </div>
      <button className="mt-5 h-12 w-full rounded-2xl bg-blue-600 text-sm font-black text-white">참여하기</button>
    </div>
  );
}

function TodayMock() {
  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-black text-blue-600">5월 26일 화요일</p>
          <h3 className="text-xl font-black text-slate-950">오늘 타임라인</h3>
        </div>
        <StatusPill tone="green">11:00 열림</StatusPill>
      </div>
      <div className="space-y-3">
        {SLOTS.map((slot) => (
          <section key={slot.time} className="rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-black text-slate-950">{slot.time}</p>
              <p className="text-xs font-bold text-slate-400">{slot.caption}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {slot.statuses.map((status, index) => (
                <ClipTile key={`${slot.time}-${MEMBERS[index].name}`} status={status} member={MEMBERS[index]} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function CameraMock() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<'idle' | 'ready' | 'blocked'>('idle');
  const [countdown, setCountdown] = useState(3);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraState('ready');
    } catch {
      setCameraState('blocked');
    }
  };

  const startMockCapture = () => {
    setCountdown(3);
    const timer = window.setInterval(() => {
      setCountdown((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return value - 1;
      });
    }, 700);
  };

  return (
    <div className="p-4">
      <div className="overflow-hidden rounded-3xl bg-slate-950">
        <div className="relative aspect-video">
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
          {cameraState !== 'ready' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-center">
              <MaterialIcon icon="photo_camera" size={36} color="#93c5fd" />
              <p className="mt-3 text-sm font-black text-white">실시간 촬영만 허용</p>
              <p className="mt-1 text-xs font-bold text-slate-400">카메라롤 업로드 없음</p>
            </div>
          )}
          {countdown > 0 && cameraState === 'ready' && (
            <div className="absolute right-3 top-3 rounded-full bg-white px-3 py-1 text-sm font-black text-slate-950">{countdown}s</div>
          )}
          {countdown === 0 && (
            <div className="absolute inset-x-3 bottom-3 rounded-2xl bg-emerald-400 px-3 py-2 text-center text-sm font-black text-emerald-950">
              3초 클립 준비 완료
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={openCamera} className="h-12 rounded-2xl bg-slate-900 text-sm font-black text-white">
          권한 확인
        </button>
        <button onClick={startMockCapture} disabled={cameraState !== 'ready'} className="h-12 rounded-2xl bg-blue-600 text-sm font-black text-white disabled:opacity-40">
          3초 촬영
        </button>
      </div>
      {cameraState === 'blocked' && (
        <p className="mt-3 rounded-2xl bg-red-50 p-3 text-xs font-bold text-red-600">브라우저 또는 기기 설정에서 카메라/마이크 권한을 허용해주세요.</p>
      )}
    </div>
  );
}

function ClipDetailMock() {
  return (
    <div className="p-4">
      <ClipTile status="mine" member={MEMBERS[3]} />
      <div className="mt-4 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
        <p className="text-[11px] font-black text-blue-600">10:00 · 나</p>
        <h3 className="mt-1 text-lg font-black text-slate-950">강의실 들어가기 전</h3>
        <div className="mt-4 flex gap-2">
          {['🔥 3', '😂 2', '💙 5'].map((reaction) => (
            <button key={reaction} className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700">{reaction}</button>
          ))}
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {['진짜 3초인데 하루 느낌 난다', '다음 슬롯에서 보자'].map((comment) => (
          <p key={comment} className="rounded-2xl bg-white p-3 text-xs font-bold text-slate-600 shadow-sm">{comment}</p>
        ))}
      </div>
    </div>
  );
}

function VlogMock() {
  return (
    <div className="p-4">
      <div className="rounded-3xl bg-slate-950 p-4 text-white">
        <p className="text-[11px] font-black text-blue-200">자동 생성 완료</p>
        <h3 className="mt-1 text-2xl font-black">5월 26일 공동 브이로그</h3>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {MEMBERS.map((member) => (
            <ClipTile key={member.name} status="ready" member={member} />
          ))}
        </div>
        <div className="mt-4 rounded-2xl bg-white/10 p-3 text-xs font-bold text-slate-300">
          FFmpeg worker가 시간순 슬롯을 합성하고 이름, 시간, 날짜 오버레이를 삽입합니다.
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="h-11 rounded-2xl bg-blue-600 text-sm font-black text-white">미리보기</button>
        <button className="h-11 rounded-2xl bg-white text-sm font-black text-slate-800 shadow-sm">저장/공유</button>
      </div>
    </div>
  );
}

function ArchiveMock() {
  return (
    <div className="p-4">
      <h3 className="text-xl font-black text-slate-950">과거 기록</h3>
      <div className="mt-4 grid grid-cols-7 gap-1">
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
        <p className="text-sm font-black text-slate-950">5월 18일 브이로그</p>
        <p className="mt-1 text-xs font-bold text-slate-400">16개 클립 · 42초 · 저장 가능</p>
      </div>
    </div>
  );
}

function SettingsMock() {
  return (
    <div className="p-4">
      <h3 className="text-xl font-black text-slate-950">그룹 설정</h3>
      <div className="mt-4 space-y-3">
        {[
          ['방장 권한', '멤버 삭제 · 그룹 삭제 · 초대코드 재생성'],
          ['일반 멤버', '탈퇴 · 본인 영상 삭제'],
          ['하루 기준', '04:00 리셋'],
          ['촬영 옵션', '가로 촬영 · 왼손/오른손 방향 전환'],
        ].map(([title, desc]) => (
          <div key={title} className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <p className="text-sm font-black text-slate-950">{title}</p>
            <p className="mt-1 text-xs font-bold text-slate-400">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PrivacyMock() {
  return (
    <div className="p-4">
      <h3 className="text-xl font-black text-slate-950">개인정보와 안전</h3>
      <div className="mt-4 space-y-3">
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
  );
}

function ScreenPreview({ screen }: { screen: ScreenKey }) {
  const screens: Record<ScreenKey, ReactNode> = {
    onboarding: <OnboardingMock />,
    home: <HomeMock />,
    create: <CreateRoomMock />,
    join: <JoinRoomMock />,
    today: <TodayMock />,
    camera: <CameraMock />,
    clip: <ClipDetailMock />,
    vlog: <VlogMock />,
    archive: <ArchiveMock />,
    settings: <SettingsMock />,
    privacy: <PrivacyMock />,
  };

  return <PhoneFrame>{screens[screen]}</PhoneFrame>;
}

export default function SetlogPage() {
  const router = useRouter();
  const [screen, setScreen] = useState<ScreenKey>('today');
  const selectedScreen = useMemo(() => SCREENS.find((item) => item.key === screen), [screen]);

  return (
    <div className="min-h-screen bg-[#f6f8fc]">
      <header className="sticky top-0 z-30 border-b border-blue-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100"
              aria-label="대시보드로 돌아가기"
            >
              <MaterialIcon icon="arrow_back" size={20} color="#475569" />
            </button>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600">
              <MaterialIcon icon="photo_camera" size={20} color="#fff" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-black text-slate-950">HourRoom MVP</p>
              <p className="truncate text-xs font-bold text-slate-500">친구들과 만드는 3초 공동 브이로그</p>
            </div>
          </div>
          <a
            href="#prd"
            className="hidden rounded-xl border border-blue-100 bg-white px-4 py-2 text-xs font-black text-blue-700 shadow-sm sm:inline-flex"
          >
            PRD 보기
          </a>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0 space-y-5">
          <div id="prd" className="rounded-3xl border border-blue-100 bg-white p-5 shadow-[0_10px_30px_-5px_rgba(0,82,255,0.08)]">
            <SectionTitle
              eyebrow="Product"
              title="닫힌 친구 그룹용 시간 기록 앱"
              desc="공개 피드 없이 가까운 친구끼리 같은 시간의 순간을 짧게 찍고, 하루가 끝나면 자동으로 공동 브이로그를 만드는 독자 MVP입니다."
            />
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['Private Rooms', '초대코드 기반 비공개 그룹'],
                ['Live Capture', '2-3초 실시간 촬영만 허용'],
                ['Daily Vlog', 'FFmpeg 자동 합성 설계'],
              ].map(([title, desc]) => (
                <div key={title} className="rounded-2xl bg-blue-50 p-4">
                  <p className="text-sm font-black text-slate-950">{title}</p>
                  <p className="mt-1 text-xs font-bold text-slate-500">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-blue-100 bg-white p-5 shadow-[0_10px_30px_-5px_rgba(0,82,255,0.08)]">
            <SectionTitle
              eyebrow="Screens"
              title="MVP 화면 구조"
              desc="요구한 화면을 모두 넣었고, 오른쪽 휴대폰 프리뷰에서 즉시 확인할 수 있습니다."
            />
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {SCREENS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setScreen(item.key)}
                  className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${
                    screen === item.key
                      ? 'border-blue-500 bg-blue-50 shadow-sm'
                      : 'border-blue-100 bg-white hover:border-blue-300 hover:bg-blue-50'
                  }`}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600">
                    <MaterialIcon icon={item.icon} size={17} color="#fff" />
                  </span>
                  <span className="text-sm font-black text-slate-900">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <section className="rounded-3xl border border-blue-100 bg-white p-5 shadow-[0_10px_30px_-5px_rgba(0,82,255,0.08)]">
              <SectionTitle eyebrow="API" title="핵심 API" desc="현재 FastAPI 백엔드에 추가할 엔드포인트 기준입니다." />
              <div className="space-y-2">
                {API_GROUPS.map((api) => (
                  <code key={api} className="block rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-blue-100">
                    {api}
                  </code>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-blue-100 bg-white p-5 shadow-[0_10px_30px_-5px_rgba(0,82,255,0.08)]">
              <SectionTitle eyebrow="Build" title="구현 순서" desc="MVP 출시까지의 단계별 체크리스트입니다." />
              <div className="space-y-2">
                {CHECKLIST.map((item, index) => (
                  <div key={item} className="flex items-center gap-3 rounded-xl bg-[#fbfdff] p-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-xs font-black text-blue-700">{index + 1}</span>
                    <span className="text-sm font-black text-slate-800">{item}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="mb-3 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-black text-blue-600">PREVIEW</p>
            <h2 className="mt-1 text-lg font-black text-slate-950">{selectedScreen?.label}</h2>
            <p className="mt-1 text-xs font-bold text-slate-400">모바일 앱 화면을 현재 웹앱에서 바로 확인합니다.</p>
          </div>
          <ScreenPreview screen={screen} />
        </aside>
      </main>
    </div>
  );
}
