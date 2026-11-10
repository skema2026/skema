'use client';

import Link from 'next/link';
import Image from 'next/image';
import MaterialIcon from '@/components/common/MaterialIcon';

/*
 * 랜딩 — unslop 방향
 * 제품: 에타 시간표 한 장으로 수업을 넣고, 시험 공부를 빈 시간에 배치하고, 밀리면 다시 짜 주는 대학생 시간표
 * 성격: 차분하고, 정확하고, 조금 다정한
 * 세계: 학기 중 책상 — 플래너와 파란 펜. 색은 로고의 하늘색 파랑이 주인공
 * 순간: 히어로의 주간 시간표에서 못 한 공부 블록이 빈 칸으로 옮겨지는 장면
 * 시그니처: 파란 형광펜 밑줄 (헤드라인 핵심 구절) + 로고 타일 같은 파란 띠 하나 (마지막 시작하기)
 */

const NAV_ITEMS = [
  { label: '소개', href: '#intro' },
  { label: '미리보기', href: '#preview' },
  { label: '기능', href: '#features' },
];

// 주간 미리보기: 09시~22시, 1시간 = 36px
const START_H = 9;
const END_H = 22;
const HOUR = 36;
const DAYS = ['월', '화', '수', '목', '금'];
const TODAY_INDEX = 2;
// 휴대폰에서는 화·수만 보여 준다 (옮겨지는 장면만)
const MOBILE_DAYS = [1, 2];

type Block = {
  day: number;
  start: string;
  end: string;
  title: string;
  room?: string;
  kind: 'class' | 'study' | 'missed' | 'moved';
};

const BLOCKS: Block[] = [
  { day: 0, start: '10:30', end: '12:00', title: '인공지능보안', room: '소프트406', kind: 'class' },
  { day: 0, start: '13:00', end: '14:30', title: '스마트카보안', room: '소프트332', kind: 'class' },
  { day: 0, start: '19:00', end: '20:30', title: '클라우드 준비', kind: 'study' },
  { day: 1, start: '10:30', end: '12:00', title: '클라우드플랫폼', room: '소프트102', kind: 'class' },
  { day: 1, start: '13:00', end: '14:30', title: '오픈소스SW', room: '소프트332', kind: 'class' },
  { day: 1, start: '16:00', end: '18:00', title: 'AI비즈니스', room: '사범201', kind: 'class' },
  { day: 1, start: '19:00', end: '20:30', title: '클라우드 준비', kind: 'missed' },
  { day: 2, start: '10:30', end: '12:00', title: '인공지능보안', room: '소프트406', kind: 'class' },
  { day: 2, start: '13:00', end: '14:30', title: '스마트카보안', room: '소프트332', kind: 'class' },
  { day: 2, start: '15:30', end: '17:30', title: '정신건강', room: '상경418', kind: 'class' },
  { day: 2, start: '19:00', end: '20:30', title: '클라우드 준비', kind: 'moved' },
  { day: 3, start: '10:30', end: '12:00', title: '클라우드플랫폼', room: '소프트102', kind: 'class' },
  { day: 3, start: '13:00', end: '14:30', title: '오픈소스SW', room: '소프트332', kind: 'class' },
  { day: 3, start: '16:00', end: '18:50', title: '산학협력', room: '소프트516', kind: 'class' },
  { day: 3, start: '19:00', end: '20:30', title: '클라우드 준비', kind: 'study' },
  { day: 4, start: '16:00', end: '18:50', title: '컴퓨터네트워크', room: '소프트102', kind: 'class' },
];

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const topOf = (t: string) => ((toMin(t) - START_H * 60) / 60) * HOUR;
const heightOf = (s: string, e: string) => ((toMin(e) - toMin(s)) / 60) * HOUR;

const blockStyle: Record<Block['kind'], string> = {
  class: 'bg-[var(--l-raised)] text-[var(--l-text)] border-[#d6e4f8]',
  study: 'bg-[var(--l-brand-100)] text-[var(--l-accent-ink)] border-[var(--l-brand-200)]',
  missed: 'bg-transparent text-[var(--l-muted)] border-dashed border-[var(--l-brand-200)]',
  moved: 'bg-[var(--l-accent)] text-white border-[var(--l-accent)]',
};

function WeekPreview() {
  const hours = Array.from({ length: END_H - START_H }, (_, i) => START_H + i);
  return (
    <figure className="landing-rise overflow-hidden rounded-2xl border border-[var(--l-line)] bg-[var(--l-card)] shadow-[0_8px_24px_rgba(15, 30, 58,0.06)]">
      <figcaption className="flex items-center justify-between border-b border-[var(--l-line)] px-5 py-4">
        <div>
          <p className="text-[15px] font-medium text-[var(--l-text)]">11월 2주차</p>
          <p className="mt-1 text-[13px] text-[var(--l-muted)]">수업 12개 · 공부 3개</p>
        </div>
        <span className="inline-flex h-8 items-center gap-2 rounded-lg bg-[var(--l-brand-100)] px-3 text-[13px] font-medium text-[var(--l-accent-ink)]">
          <MaterialIcon icon="autorenew" size={16} color="currentColor" />
          다시 짜기
        </span>
      </figcaption>

      <div className="grid grid-cols-[36px_repeat(2,minmax(0,1fr))] px-3 pt-3 sm:grid-cols-[44px_repeat(5,minmax(0,1fr))]">
        <div />
        {DAYS.map((d, i) => (
          <div key={d} className={`pb-2 text-center text-[13px] text-[var(--l-secondary)] ${MOBILE_DAYS.includes(i) ? '' : 'hidden sm:block'}`}>
            <span className={i === TODAY_INDEX ? 'inline-flex h-6 items-center rounded-md bg-[var(--l-accent)] px-2 font-medium text-white' : ''}>{d}</span>
          </div>
        ))}
      </div>

      <div className="relative grid grid-cols-[36px_repeat(2,minmax(0,1fr))] px-3 pb-4 sm:grid-cols-[44px_repeat(5,minmax(0,1fr))]">
        <div className="relative" style={{ height: (END_H - START_H) * HOUR }}>
          {hours.map((h) => (
            <span
              key={h}
              className="absolute right-2 -translate-y-1/2 font-mono text-[11px] tabular-nums text-[var(--l-muted)]"
              style={{ top: (h - START_H) * HOUR }}
            >
              {h}
            </span>
          ))}
        </div>
        {DAYS.map((d, dayIndex) => (
          <div
            key={d}
            className={`relative border-l border-[var(--l-line)] ${MOBILE_DAYS.includes(dayIndex) ? '' : 'hidden sm:block'}`}
            style={{ height: (END_H - START_H) * HOUR }}
          >
            {hours.map((h) => (
              <div
                key={h}
                className="absolute inset-x-0 border-t border-[var(--l-line)]"
                style={{ top: (h - START_H) * HOUR }}
              />
            ))}
            {BLOCKS.filter((b) => b.day === dayIndex).map((b) => (
              <div
                key={`${b.day}-${b.start}`}
                className={`absolute inset-x-1 overflow-hidden rounded-md border px-2 py-1.5 ${blockStyle[b.kind]}`}
                style={{ top: topOf(b.start) + 1, height: heightOf(b.start, b.end) - 2 }}
              >
                <p className={`truncate text-[12px] leading-4 ${b.kind === 'missed' ? 'line-through' : ''}`}>{b.title}</p>
                <p className={`truncate font-mono text-[11px] leading-4 tabular-nums ${b.kind === 'moved' ? 'text-white/80' : 'opacity-70'}`}>
                  {b.kind === 'missed' ? '못 함' : b.room ?? `${b.start}–${b.end}`}
                </p>
              </div>
            ))}
            {dayIndex === 1 && (
              /* 화요일 못 한 블록 → 수요일 빈 칸 */
              <svg
                className="pointer-events-none absolute left-1/2 w-full overflow-visible"
                style={{ top: topOf('20:30') + 2, height: 28 }}
                viewBox="0 0 100 28"
                preserveAspectRatio="none"
                aria-hidden
              >
                <path d="M0 0 C 20 30, 80 30, 100 0" fill="none" stroke="var(--l-accent)" strokeWidth="1.5" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
                <path d="M100 0 l -6 5 M100 0 l 1 7" fill="none" stroke="var(--l-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              </svg>
            )}
          </div>
        ))}

      </div>

      <div className="flex items-center gap-4 border-t border-[var(--l-line)] px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-[13px] text-[var(--l-text)]">클라우드플랫폼 기말 · D-10</p>
            <p className="font-mono text-[13px] tabular-nums text-[var(--l-text)]">준비도 33%</p>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--l-raised)]">
            <div className="h-full w-1/3 rounded-full bg-[var(--l-accent)]" />
          </div>
        </div>
      </div>
    </figure>
  );
}

function DayPreview() {
  const rows = [
    { time: '10:30', end: '12:00', title: '인공지능보안응용', meta: '소프트406', done: true, kind: 'class' },
    { time: '13:00', end: '14:30', title: '스마트카소프트웨어보안', meta: '소프트332', done: true, kind: 'class' },
    { time: '15:30', end: '17:30', title: '정신건강', meta: '상경418', done: false, kind: 'class' },
    { time: '19:00', end: '20:30', title: '클라우드플랫폼 준비', meta: '화요일에서 옮김', done: false, kind: 'study' },
  ];
  return (
    <div className="rounded-2xl border border-[var(--l-line)] bg-[var(--l-card)]">
      <div className="flex items-center justify-between border-b border-[var(--l-line)] px-5 py-4">
        <p className="text-[15px] font-medium text-[var(--l-text)]">11월 11일 수요일</p>
        <p className="font-mono text-[13px] tabular-nums text-[var(--l-muted)]">2 / 4 완료</p>
      </div>
      <ul className="divide-y divide-[var(--l-line)]">
        {rows.map((r) => (
          <li key={r.time} className="flex items-center gap-4 px-5 py-3">
            <span className="w-24 shrink-0 font-mono text-[13px] tabular-nums text-[var(--l-secondary)]">
              {r.time}–{r.end}
            </span>
            <span
              className={`h-8 w-1 shrink-0 rounded-full ${r.kind === 'study' ? 'bg-[var(--l-brand)]' : 'bg-[var(--l-brand-200)]'}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className={`truncate text-[15px] ${r.done ? 'text-[var(--l-muted)] line-through' : 'text-[var(--l-text)]'}`}>{r.title}</p>
              <p className="mt-0.5 truncate text-[13px] text-[var(--l-muted)]">{r.meta}</p>
            </div>
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                r.done ? 'border-[var(--l-accent)] bg-[var(--l-accent)]' : 'border-[var(--l-brand-200)]'
              }`}
              aria-label={r.done ? '완료' : '미완료'}
            >
              {r.done && <MaterialIcon icon="check" size={12} color="#fff" />}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const FEATURES = [
  {
    icon: 'upload_file',
    title: '시간표 캡처 인식',
    desc: '에브리타임 캡처 한 장에서 요일, 시간, 과목명, 강의실을 읽습니다. 확인 화면에서 고친 뒤 저장해요',
  },
  {
    icon: 'event_available',
    title: '시험 공부 자동 배치',
    desc: '시험 날짜를 넣으면 시험 전날까지 빈 30분 칸에 공부 블록이 들어갑니다. 저녁 시간부터 채워요',
  },
  {
    icon: 'autorenew',
    title: '다시 짜기',
    desc: '못 한 블록만 골라 남은 빈 시간으로 옮깁니다. 수업과 시험은 그대로 두고, 미리보기를 본 뒤 적용해요',
  },
  {
    icon: 'notifications',
    title: '시작 전 알림',
    desc: '블록이 시작하기 10분 전에 휴대폰으로 알려 줍니다. 못 한 블록은 알림을 눌러 바로 다시 짤 수 있어요',
  },
];

export default function LandingPage() {
  const scrollTo = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    event.preventDefault();
    document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <main className="landing min-h-screen bg-[var(--l-bg)] text-[var(--l-text)]">
      <style>{`
        .landing {
          --l-bg: #f3f7fe;
          --l-card: #ffffff;
          --l-raised: #e6effc;
          --l-line: rgba(15, 30, 58, 0.09);
          --l-text: #0f1e3a;
          --l-secondary: #44536b;
          --l-muted: #5f6f88;
          --l-accent: #2a6fe3;
          --l-brand: #4591fd;
          --l-brand-100: #e3efff;
          --l-brand-200: #bcd8fe;
          --l-accent-ink: #1f63d6;
          --ease: cubic-bezier(0.22, 1, 0.36, 1);
          word-break: keep-all;
        }
        .l-highlight {
          background-image: linear-gradient(transparent 58%, rgba(105, 176, 251, 0.32) 60%, rgba(105, 176, 251, 0.32) 94%, transparent 92%);
        }
        @keyframes l-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .landing-rise { animation: l-rise 420ms var(--ease) both; }
        .landing-rise-2 { animation: l-rise 420ms var(--ease) 60ms both; }
        @media (prefers-reduced-motion: reduce) { .landing-rise, .landing-rise-2 { animation: none; } }
      `}</style>

      <header className="sticky top-0 z-50 border-b border-[var(--l-line)] bg-[#e4efff]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2" aria-label="SKEMA 홈">
            <Image src="/icon-192.png" alt="" width={28} height={28} className="rounded-md" />
            <span className="text-[17px] font-semibold tracking-[-0.01em]">SKEMA</span>
          </Link>

          <nav className="hidden items-center gap-8 md:flex">
            {NAV_ITEMS.map(({ label, href }) => (
              <a
                key={href}
                href={href}
                onClick={(event) => scrollTo(event, href)}
                className="text-[14px] text-[var(--l-secondary)] transition-colors duration-150 hover:text-[var(--l-text)]"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-4">
            <Link href="/login" className="hidden text-[14px] text-[var(--l-secondary)] transition-colors hover:text-[var(--l-text)] sm:inline">
              로그인
            </Link>
            <Link
              href="/register"
              className="inline-flex h-9 items-center rounded-lg bg-[var(--l-accent)] px-4 text-[14px] font-medium text-white transition-colors duration-150 hover:bg-[var(--l-accent-ink)] active:scale-[0.98]"
            >
              시작하기
            </Link>
          </div>
        </div>
      </header>

      {/* 히어로 */}
      <div className="bg-[linear-gradient(180deg,#e4efff_0%,var(--l-bg)_100%)]">
      <section className="mx-auto grid max-w-[1200px] items-center gap-12 px-6 pb-20 pt-12 lg:min-h-[calc(100vh-64px)] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16 lg:py-16">
        <div className="landing-rise max-w-xl">
          <p className="text-[14px] font-medium text-[var(--l-accent-ink)]">대학생 시간표 · 단국대학교 2026 졸업작품</p>
          <h1 className="mt-5 text-[40px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[56px] sm:leading-[1.1] sm:tracking-[-0.03em]">
            하루 밀려도
            <br />
            <span className="l-highlight text-[var(--l-accent)]">다시 짜 주는</span> 시간표
          </h1>
          <p className="mt-6 max-w-[34rem] text-[18px] leading-[30px] text-[var(--l-secondary)]">
            에타 시간표 캡처 한 장으로 수업을 넣고, 시험 날짜를 넣으면 빈 시간에 공부 블록이 들어갑니다.
            못 한 블록은 버튼 한 번으로 시험 전날까지 다시 배치해요.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/register"
              className="inline-flex h-12 items-center gap-2 rounded-[10px] bg-[var(--l-accent)] px-5 text-[15px] font-medium text-white transition-colors duration-150 hover:bg-[var(--l-accent-ink)] active:scale-[0.98]"
            >
              무료로 시작하기
              <MaterialIcon icon="arrow_forward" size={16} color="currentColor" />
            </Link>
            <a
              href="#preview"
              onClick={(event) => scrollTo(event, '#preview')}
              className="inline-flex h-12 items-center rounded-[10px] border border-[var(--l-line)] bg-[var(--l-card)] px-5 text-[15px] text-[var(--l-text)] transition-colors duration-150 hover:bg-[var(--l-raised)]"
            >
              화면 미리보기
            </a>
          </div>
        </div>

        <WeekPreview />
      </section>
      </div>

      {/* 소개 */}
      <section id="intro" className="scroll-mt-16 border-t border-[var(--l-line)]">
        <div className="mx-auto max-w-[1200px] px-6 py-24">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
            <div>
              <p className="text-[14px] font-medium text-[var(--l-accent-ink)]">소개</p>
              <h2 className="mt-3 text-[32px] font-semibold leading-[1.2] tracking-[-0.02em]">
                수업은 그대로,
                <br />
                공부는 빈 칸으로
              </h2>
              <p className="mt-5 max-w-md text-[16px] leading-[26px] text-[var(--l-secondary)]">
                매주 반복되는 수업과 시험 공부, 알바 같은 개인 일정을 같은 시간 축에 놓고, 비어 있는 30분 칸만 계산해 씁니다.
              </p>
            </div>
            <ol className="grid gap-px overflow-hidden rounded-2xl border border-[var(--l-line)] bg-[var(--l-line)] sm:grid-cols-3">
              {[
                ['시간표 캡처 올리기', '수업과 개인 일정을 읽어 매주 반복 일정으로 저장'],
                ['시험 날짜 넣기', '시험 전날까지 빈 시간에 공부 블록 배치'],
                ['밀리면 다시 짜기', '못 한 블록만 남은 빈 시간으로 이동'],
              ].map(([title, desc], i) => (
                <li key={title} className="bg-[var(--l-card)] p-6">
                  <span className="font-mono text-[13px] font-medium tabular-nums text-[var(--l-accent)]">0{i + 1}</span>
                  <p className="mt-6 text-[16px] font-medium">{title}</p>
                  <p className="mt-2 text-[14px] leading-[22px] text-[var(--l-secondary)]">{desc}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* 미리보기 */}
      <section id="preview" className="scroll-mt-16 border-t border-[var(--l-line)] bg-[var(--l-card)]">
        <div className="mx-auto max-w-[1200px] px-6 py-24">
          <p className="text-[14px] font-medium text-[var(--l-accent-ink)]">미리보기</p>
          <h2 className="mt-3 text-[32px] font-semibold leading-[1.2] tracking-[-0.02em]">오늘 할 일은 하루 타임라인 한 장에</h2>
          <p className="mt-4 max-w-xl text-[16px] leading-[26px] text-[var(--l-secondary)]">
            주간 보기에서 날짜를 누르면 그날의 수업과 공부 블록이 시간순으로 나옵니다. 끝낸 블록을 체크하면 시험 준비도가 올라가요.
          </p>

          <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <DayPreview />
            <div className="rounded-2xl border border-[var(--l-line)] bg-[var(--l-bg)] p-5">
              <p className="text-[15px] font-medium">시험 일정 · 준비도</p>
              <ul className="mt-5 space-y-5">
                {[
                  ['클라우드플랫폼 기말', 'D-10', 33],
                  ['컴퓨터네트워크 기말', 'D-14', 10],
                  ['오픈소스SW분석 발표', 'D-17', 0],
                ].map(([name, dday, pct], i) => (
                  <li key={name as string}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate text-[14px]">{name}</p>
                      <p className="shrink-0 font-mono text-[13px] tabular-nums text-[var(--l-muted)]">
                        {dday} · {pct}%
                      </p>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--l-raised)]">
                      <div
                        className={`h-full rounded-full ${i === 0 ? 'bg-[var(--l-accent)]' : 'bg-[var(--l-brand)]'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 기능 */}
      <section id="features" className="scroll-mt-16 border-t border-[var(--l-line)]">
        <div className="mx-auto max-w-[1200px] px-6 py-24">
          <p className="text-[14px] font-medium text-[var(--l-accent-ink)]">기능</p>
          <h2 className="mt-3 text-[32px] font-semibold leading-[1.2] tracking-[-0.02em]">밀린 계획을 되돌리는 네 가지</h2>
          <div className="mt-12 grid gap-x-12 gap-y-10 md:grid-cols-2">
            {FEATURES.map((f) => (
              <article key={f.title} className="flex gap-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--l-brand-100)] text-[var(--l-accent)]">
                  <MaterialIcon icon={f.icon} size={18} color="currentColor" />
                </span>
                <div>
                  <h3 className="text-[16px] font-medium">{f.title}</h3>
                  <p className="mt-2 max-w-md text-[14px] leading-[22px] text-[var(--l-secondary)]">{f.desc}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 시작 */}
      <section className="px-6 pb-24">
        <div className="mx-auto flex max-w-[1200px] flex-col justify-between gap-6 rounded-3xl bg-[linear-gradient(160deg,#5aa6fd_0%,#3d8bfd_55%,#2f7cf0_100%)] px-8 py-12 text-white sm:flex-row sm:items-center sm:px-12">
          <div>
            <h2 className="text-[24px] font-semibold leading-[1.3] tracking-[-0.02em] [text-wrap:balance] sm:text-[28px]">에타 시간표 캡처 한 장이면 시작할 수 있어요</h2>
            <p className="mt-3 text-[16px] text-white/85">가입하면 온보딩에서 수업, 시험, 수면 시간을 바로 설정합니다</p>
          </div>
          <Link
            href="/register"
            className="inline-flex h-12 shrink-0 items-center justify-center rounded-[10px] bg-white px-6 text-[15px] font-semibold text-[var(--l-accent-ink)] transition-colors duration-150 hover:bg-[#eef5ff] active:scale-[0.98]"
          >
            시작하기
          </Link>
        </div>
      </section>

      <footer className="border-t border-[var(--l-line)]">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-2 px-6 py-6 text-[13px] text-[var(--l-muted)]">
          <span>© 2026 SKEMA · 단국대학교 졸업작품</span>
          <Link href="/privacy" className="transition-colors hover:text-[var(--l-text)]">
            개인정보처리방침
          </Link>
        </div>
      </footer>
    </main>
  );
}
