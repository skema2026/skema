'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Schedule } from '@/types';
import { Timetable } from '@/components/timetable/Timetable';
import MaterialIcon from '@/components/common/MaterialIcon';
import { scheduleVisibleIn } from '@/lib/scheduleViewScope';

interface SharedData {
  schedules: Schedule[];
  username?: string;
}

export function SharedTimetable({ token }: { token: string }) {
  const [data, setData] = useState<SharedData | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<SharedData>(`/share/${token}`)
      .then(({ data }) => {
        setData(data);
      })
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-[#e1eaf6] border-t-[#2a6fe3]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="skema-card mx-auto mt-12 max-w-md p-8 text-center">
        <div className="skema-sticker mx-auto mb-4 h-10 w-10">
          <MaterialIcon icon="link_off" size={18} color="#5f6f88" />
        </div>
        <p className="text-[17px] font-semibold text-[#0f1e3a]">
          시간표를 찾을 수 없어요
        </p>
        <p className="mt-1 text-[14px] leading-[22px] text-[#5f6f88]">
          링크가 만료됐거나 잘못된 링크예요
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.username && (
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-[#0f1e3a]">{data.username}님의 시간표</h1>
      )}
      <div className="overflow-x-auto rounded-2xl border border-[#0f1e3a]/8 bg-white">
        <div style={{ height: 640, minWidth: 600 }}>
          <Timetable schedules={data.schedules.filter((schedule) => scheduleVisibleIn(schedule, 'week'))} readOnly />
        </div>
      </div>
    </div>
  );
}
