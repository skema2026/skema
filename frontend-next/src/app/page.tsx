'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import MaterialIcon from '@/components/common/MaterialIcon';

const NAV_ITEMS = [
  { label: '소개', href: '#intro' },
  { label: '미리보기', href: '#preview' },
  { label: '기능', href: '#features' },
];

const PRODUCT_DAYS = [
  {
    day: '월',
    items: [
      { title: '알고리즘', time: '09:00', tone: 'blue' },
      { title: '복습 블록', time: '20:00', tone: 'green' },
    ],
  },
  {
    day: '화',
    items: [
      { title: '영어', time: '10:00', tone: 'amber' },
      { title: '스터디', time: '17:00', tone: 'violet' },
    ],
  },
  {
    day: '수',
    items: [
      { title: '자료구조', time: '13:00', tone: 'blue' },
      { title: '시험 준비', time: '19:00', tone: 'red' },
    ],
  },
  {
    day: '목',
    items: [
      { title: '프로젝트', time: '11:00', tone: 'green' },
      { title: '자율학습', time: '15:00', tone: 'blue' },
    ],
  },
  {
    day: '금',
    items: [
      { title: '발표 연습', time: '14:00', tone: 'violet' },
      { title: '주간 정리', time: '21:00', tone: 'amber' },
    ],
  },
];

const toneClass: Record<string, string> = {
  blue: 'border-blue-200 bg-blue-50 text-blue-800',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  violet: 'border-violet-200 bg-violet-50 text-violet-800',
  red: 'border-red-200 bg-red-50 text-red-700',
};

export default function LandingPage() {
  const [activeSection, setActiveSection] = useState('intro');
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
            entry.target.classList.add('is-visible');
          }
        });
      },
      { rootMargin: '-25% 0px -55% 0px', threshold: 0.05 }
    );

    NAV_ITEMS.forEach(({ href }) => {
      const node = document.querySelector(href);
      if (node) observer.observe(node);
    });
    document.querySelectorAll('.landing-reveal').forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    event.preventDefault();
    document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <main className="skema-cute-page min-h-screen text-[#0f172a]">
      <style>{`
        .landing-reveal {
          opacity: 0;
          transform: translateY(18px);
          transition: opacity .65s cubic-bezier(.16,1,.3,1), transform .65s cubic-bezier(.16,1,.3,1);
        }
        .landing-reveal.is-visible { opacity: 1; transform: translateY(0); }
      `}</style>

      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
          scrolled ? 'border-b border-[#d8e2ef] bg-white/92 shadow-sm backdrop-blur-xl' : 'bg-white/55 backdrop-blur-sm'
        }`}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2" aria-label="SKEMA 홈">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2563eb] shadow-sm">
              <MaterialIcon icon="schedule" size={18} color="#fff" filled />
            </span>
            <span className="skema-headline text-lg font-extrabold tracking-normal">SKEMA</span>
          </Link>

          <nav className="hidden items-center gap-1 rounded-lg border border-[#d8e2ef] bg-white/85 p-1 shadow-sm backdrop-blur md:flex">
            {NAV_ITEMS.map(({ label, href }) => {
              const id = href.slice(1);
              const active = activeSection === id;
              return (
                <a
                  key={href}
                  href={href}
                  onClick={(event) => scrollTo(event, href)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    active ? 'bg-[#2563eb] text-white' : 'text-[#3f4b61] hover:bg-[#eef6ff] hover:text-[#0f172a]'
                  }`}
                >
                  {label}
                </a>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-[#2563eb] hover:bg-[#eaf1ff] sm:inline-flex"
            >
              로그인
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-1 rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-bold text-white shadow-sm shadow-blue-900/20 transition hover:bg-[#1d4ed8]"
            >
              시작하기
              <MaterialIcon icon="arrow_forward" size={16} color="#fff" />
            </Link>
          </div>
        </div>
      </header>

      <section className="relative isolate min-h-[92vh] overflow-hidden pt-16 text-[#0f172a]">
        <div className="absolute inset-0 -z-10 bg-[url('/register-bg.jpg')] bg-cover bg-center" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(246,248,252,.96),rgba(246,248,252,.88)_48%,rgba(232,243,255,.74))]" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(37,99,235,.08)_1px,transparent_1px),linear-gradient(rgba(14,165,233,.07)_1px,transparent_1px)] bg-[length:28px_28px]" />

        <div className="mx-auto grid min-h-[calc(92vh-4rem)] max-w-7xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(520px,1.1fr)] lg:px-8">
          <div className="max-w-2xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-lg border border-[#bae6fd] bg-white px-3 py-1.5 text-sm font-bold text-[#075985] shadow-sm">
              <MaterialIcon icon="auto_awesome" size={16} color="#0ea5e9" filled />
              AI 기반 스마트 시간표
            </div>
            <h1 className="skema-headline text-5xl font-extrabold leading-[1.04] tracking-normal sm:text-6xl lg:text-7xl">
              SKEMA
            </h1>
            <p className="mt-5 max-w-xl text-lg font-medium leading-8 text-[#334155]">
              수업, 시험, 공부 블록, 개인 일정을 한 화면에서 정리하고 AI로 빈 시간을 재배치합니다.
              계획을 입력하는 시간을 줄이고 실행에 집중하세요.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/register"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#2563eb] px-6 text-sm font-extrabold text-white shadow-lg shadow-blue-900/20 transition hover:bg-[#1d4ed8]"
              >
                무료로 시작하기
                <MaterialIcon icon="arrow_forward" size={17} color="#fff" />
              </Link>
              <a
                href="#preview"
                onClick={(event) => scrollTo(event, '#preview')}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-[#c7d2e2] bg-white px-6 text-sm font-bold text-[#2563eb] shadow-sm transition hover:bg-[#eaf1ff]"
              >
                화면 미리보기
                <MaterialIcon icon="expand_more" size={18} color="#2563eb" />
              </a>
            </div>
          </div>

          <div className="landing-reveal hidden lg:block">
            <div className="rounded-lg border border-[#d8e2ef] bg-white/94 p-4 text-[#0f172a] shadow-2xl shadow-[#0f172a]/15 backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#2563eb]">Live Preview</p>
                  <h2 className="mt-1 text-xl font-extrabold">이번 주 시간표</h2>
                </div>
                <div className="rounded-lg bg-emerald-50 px-3 py-2 text-right">
                  <p className="text-[11px] font-semibold text-emerald-700">오늘 수행률</p>
                  <p className="text-lg font-extrabold text-emerald-800">78%</p>
                </div>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {PRODUCT_DAYS.map((column) => (
                  <div key={column.day} className="min-h-[330px] rounded-xl border border-slate-200 bg-slate-50 p-2">
                    <div className="mb-2 rounded-lg bg-white py-2 text-center text-sm font-extrabold text-slate-700 shadow-sm">
                      {column.day}
                    </div>
                    <div className="space-y-2">
                      {column.items.map((item) => (
                        <div key={`${column.day}-${item.title}`} className={`rounded-lg border p-3 ${toneClass[item.tone]}`}>
                          <p className="text-sm font-extrabold">{item.title}</p>
                          <p className="mt-1 text-xs font-semibold opacity-75">{item.time}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                {[
                  ['시험 경보', 'D-5', 'warning', 'text-red-700 bg-red-50'],
                  ['복습 자동화', '3개', 'history', 'text-violet-700 bg-violet-50'],
                  ['충돌 확인', '정상', 'check_circle', 'text-emerald-700 bg-emerald-50'],
                ].map(([label, value, icon, klass]) => (
                  <div key={label} className={`rounded-xl p-3 ${klass}`}>
                    <MaterialIcon icon={icon} size={18} filled />
                    <p className="mt-2 text-xs font-bold opacity-75">{label}</p>
                    <p className="text-lg font-extrabold">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="intro" className="landing-reveal scroll-mt-24 bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
          <div>
            <p className="mb-3 text-sm font-extrabold uppercase tracking-[0.2em] text-[#0ea5e9]">소개</p>
            <h2 className="skema-headline text-3xl font-extrabold leading-tight text-slate-950 sm:text-5xl">
              계획을 세우는 앱이 아니라, 계획을 실행하게 만드는 작업 공간.
            </h2>
          </div>
          <p className="text-base leading-8 text-slate-600">
            SKEMA는 반복 수업과 단기 시험, 개인 일정을 같은 시간 축에서 다룹니다.
            시간 충돌을 줄이고, 완료 여부와 시험 준비도를 함께 보여주어 오늘 무엇을 해야 하는지 빠르게 판단할 수 있습니다.
          </p>
        </div>
      </section>

      <section id="preview" className="landing-reveal scroll-mt-24 bg-[#eef6ff] px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="mb-3 text-sm font-extrabold uppercase tracking-[0.2em] text-[#0ea5e9]">미리보기</p>
              <h2 className="skema-headline text-3xl font-extrabold text-slate-950 sm:text-4xl">대시보드의 핵심만 먼저 보입니다</h2>
            </div>
            <p className="max-w-lg text-sm leading-7 text-slate-600">
              오늘 할 일, 주간 시간표, 시험 경보, 리포트를 탭과 패널로 분리해 반복 사용에 맞췄습니다.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
            <div className="rounded-lg border border-[#d8e2ef] bg-white p-4 shadow-sm">
              <p className="mb-3 text-sm font-extrabold text-slate-950">오늘 할 일</p>
              {['자료구조 수업', '중간고사 복습', '프로젝트 회의'].map((item, idx) => (
                <div key={item} className="mb-2 flex items-center gap-3 rounded-lg bg-slate-50 p-3">
                  <span className={`h-4 w-4 rounded ${idx === 0 ? 'bg-emerald-500' : 'border-2 border-slate-300 bg-white'}`} />
                  <div>
                    <p className="text-sm font-bold text-slate-900">{item}</p>
                    <p className="text-xs text-slate-500">{idx === 0 ? '완료' : `${14 + idx}:00`}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-[#d8e2ef] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-extrabold text-slate-950">주간 시간표</p>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-[#2563eb]">이번 주</span>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {PRODUCT_DAYS.map((column) => (
                  <div key={column.day} className="rounded-lg bg-slate-50 p-2">
                    <p className="mb-2 text-center text-xs font-extrabold text-slate-500">{column.day}</p>
                    <div className="space-y-2">
                      {column.items.map((item) => (
                        <div key={item.title} className={`rounded-lg border px-2 py-3 text-xs font-bold ${toneClass[item.tone]}`}>
                          {item.title}
                          <p className="mt-1 font-semibold opacity-70">{item.time}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-[#d8e2ef] bg-white p-4 shadow-sm">
              <p className="mb-3 text-sm font-extrabold text-slate-950">AI 패널</p>
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
                <p className="text-xs font-bold">준비도 경보</p>
                <p className="mt-1 text-lg font-extrabold">D-5 · 42%</p>
              </div>
              <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-violet-800">
                <p className="text-xs font-bold">복습 스케줄러</p>
                <p className="mt-1 text-sm font-semibold">내일 복습 2개 자동 배치</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="landing-reveal scroll-mt-24 bg-white px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="mb-3 text-sm font-extrabold uppercase tracking-[0.2em] text-[#0ea5e9]">기능</p>
          <h2 className="skema-headline mb-10 text-3xl font-extrabold text-slate-950 sm:text-4xl">실사용 흐름에 맞춘 기능</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[
              ['자연어 일정 관리', 'AI 채팅으로 일정을 추가하고 미완료 일정을 재배치합니다.', 'chat'],
              ['시험 준비도', '시험일까지 남은 일정, 수행률, 확보 가능한 시간을 함께 계산합니다.', 'quiz'],
              ['공유 시간표', '읽기 전용 링크로 주간 시간표를 빠르게 공유합니다.', 'ios_share'],
              ['주간 리포트', '요일별 수행률과 유형별 시간을 확인해 다음 주 계획을 조정합니다.', 'bar_chart'],
            ].map(([title, desc, icon]) => (
              <article key={title} className="rounded-lg border border-[#d8e2ef] bg-[#f8fbff] p-5 shadow-sm">
                <div className="skema-sticker mb-5 h-11 w-11">
                  <MaterialIcon icon={icon} size={22} color="#2563eb" filled />
                </div>
                <h3 className="text-base font-extrabold text-slate-950">{title}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-600">{desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#2563eb] px-4 py-16 text-white sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <h2 className="skema-headline text-3xl font-extrabold">오늘의 계획부터 정리해보세요</h2>
            <p className="mt-2 text-sm text-blue-100">가입 후 온보딩에서 수업, 시험, 수면 패턴을 바로 설정할 수 있습니다.</p>
          </div>
          <Link
            href="/register"
            className="inline-flex h-12 items-center justify-center rounded-lg bg-white px-6 text-sm font-extrabold text-[#2563eb]"
          >
            시작하기
          </Link>
        </div>
      </section>
    </main>
  );
}
