'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Schedule } from '@/types';
import { Timetable } from '@/components/timetable/Timetable';
import MaterialIcon from '@/components/common/MaterialIcon';

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
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#dbe8ff] border-t-[#2563eb]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="skema-card mx-auto mt-12 max-w-md p-8 text-center">
        <div className="skema-sticker mx-auto mb-4 h-12 w-12 bg-red-50">
          <MaterialIcon icon="link_off" size={24} color="#dc2626" filled />
        </div>
        <p className="mb-2 text-xl font-extrabold text-slate-800">
          시간표를 찾을 수 없습니다
        </p>
        <p className="text-sm leading-6 text-slate-500">
          링크가 만료되었거나 잘못된 링크입니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.username && (
        <div className="skema-card p-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#0ea5e9]">Shared Timetable</p>
          <p className="mt-1 text-lg font-extrabold text-slate-950">{data.username}님의 시간표</p>
        </div>
      )}
      <Timetable schedules={data.schedules} readOnly />
    </div>
  );
}
