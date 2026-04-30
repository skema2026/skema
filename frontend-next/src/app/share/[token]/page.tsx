import { Suspense } from 'react';
import { SharedTimetable } from './SharedTimetable';
import MaterialIcon from '@/components/common/MaterialIcon';

interface Props {
  params: Promise<{ token: string }>;
}

export default async function SharePage({ params }: Props) {
  const { token } = await params;
  return (
    <div className="skema-cute-page min-h-screen text-[#0f172a]">
      <header className="sticky top-0 z-20 border-b border-[#d8e2ef] bg-white/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2563eb] shadow-sm">
              <MaterialIcon icon="schedule" size={18} color="#fff" filled />
            </div>
            <div>
              <h1 className="skema-headline text-lg font-extrabold text-slate-950">SKEMA</h1>
              <p className="text-xs font-medium text-slate-500">공유 시간표</p>
            </div>
          </div>
          <span className="rounded-lg border border-[#bae6fd] bg-[#e8f3ff] px-3 py-1 text-xs font-bold text-[#075985]">
            읽기 전용
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-64">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#dbe8ff] border-t-[#2563eb]" />
            </div>
          }
        >
          <SharedTimetable token={token} />
        </Suspense>
      </main>
    </div>
  );
}
