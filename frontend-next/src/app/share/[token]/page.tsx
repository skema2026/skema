import { Suspense } from 'react';
import { SharedTimetable } from './SharedTimetable';
import Image from 'next/image';

interface Props {
  params: Promise<{ token: string }>;
}

export default async function SharePage({ params }: Props) {
  const { token } = await params;
  return (
    <div className="min-h-screen bg-[#f5f8fd] text-[#0f1e3a]">
      <header className="sticky top-0 z-20 border-b border-[#0f1e3a]/8 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Image src="/icon-192.png" alt="" width={28} height={28} className="rounded-md" />
            <span className="text-[17px] font-semibold">SKEMA</span>
          </div>
          <span className="text-[13px] text-[#5f6f88]">공유 시간표 · 읽기 전용</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-64">
              <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-[#e1eaf6] border-t-[#2a6fe3]" />
            </div>
          }
        >
          <SharedTimetable token={token} />
        </Suspense>
      </main>
    </div>
  );
}
