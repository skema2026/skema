'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { recurringDayToIndex } from '@/lib/recurringDay';
import { timeToMinutes } from '@/lib/utils';
import type { ExamSchedule, Schedule } from '@/types';

export function ExamReadinessPanel({ exams, schedules }: { exams: ExamSchedule[]; schedules: Schedule[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [summaryMap, setSummaryMap] = useState<Record<number, string>>({});
  const [loadingMap, setLoadingMap] = useState<Record<number, boolean>>({});

  const fetchSummary = async (
    exam: ExamSchedule,
    readinessPct: number,
    daysLeft: number,
    availableHrs: number,
    remaining: number,
  ) => {
    setLoadingMap((m) => ({ ...m, [exam.id]: true }));
    try {
      const res = await api.post('/ai/readiness-summary', {
        exam_title: exam.title,
        readiness_pct: readinessPct,
        days_left: daysLeft,
        available_hrs: availableHrs,
        remaining,
      });
      setSummaryMap((m) => ({ ...m, [exam.id]: res.data.summary }));
    } catch {
      setSummaryMap((m) => ({ ...m, [exam.id]: 'AI 진단을 불러오지 못했습니다.' }));
    } finally {
      setLoadingMap((m) => ({ ...m, [exam.id]: false }));
    }
  };

  const upcoming = exams
    .filter((e) => {
      const [y, m, d] = e.exam_date.split('-').map(Number);
      return new Date(y, m - 1, d) >= today;
    })
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date))
    .slice(0, 3);

  if (upcoming.length === 0) {
    return (
      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#3f4b61', marginBottom: 6, letterSpacing: '0.5px' }}>준비도 경보</p>
        <p style={{ fontSize: 11, color: '#64748b', textAlign: 'center', padding: '12px 0' }}>등록된 시험이 없습니다</p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#3f4b61', marginBottom: 8, letterSpacing: '0.5px' }}>준비도 경보</p>
      <div className="space-y-2">
        {upcoming.map((exam) => {
          const [y, m, d] = exam.exam_date.split('-').map(Number);
          const daysLeft = Math.ceil((new Date(y, m - 1, d).getTime() - today.getTime()) / 86400000);
          const linked = schedules.filter((s) => s.linked_exam_id === exam.id);
          const completed = linked.filter((s) => s.is_completed);
          const calcMins = (s: Schedule) => timeToMinutes(s.end_time) - timeToMinutes(s.start_time);
          const readinessPct = linked.length > 0 ? Math.round((completed.length / linked.length) * 100) : 0;
          const remaining = linked.length - completed.length;

          let availableHrs = 0;
          for (let i = 1; i <= daysLeft; i++) {
            const day = new Date(today);
            day.setDate(day.getDate() + i);
            const dow = day.getDay() === 0 ? 6 : day.getDay() - 1;
            const busyHrs = schedules
              .filter((s) => !s.date && recurringDayToIndex(s.recurring_day) === dow)
              .reduce((sum, s) => sum + calcMins(s) / 60, 0);
            availableHrs += Math.max(0, 24 - 8 - busyHrs);
          }
          availableHrs = Math.round(availableHrs * 10) / 10;

          const level = daysLeft <= 3 && readinessPct < 50 ? 'danger'
            : daysLeft <= 7 && readinessPct < 70 ? 'warn' : 'ok';
          const col = level === 'danger' ? '#DC2626' : level === 'warn' ? '#F97316' : '#059669';
          const bg = level === 'danger' ? '#fef2f2' : level === 'warn' ? '#f6f8fc' : '#f0fdf4';

          return (
            <div key={exam.id} style={{ padding: '10px 12px', borderRadius: 10, background: bg, border: `1px solid ${col}30` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#181c1e', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exam.title}</p>
                <span style={{ fontSize: 11, fontWeight: 800, color: col, marginLeft: 8, flexShrink: 0 }}>D-{daysLeft}</span>
              </div>
              {linked.length > 0 ? (
                <>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <div style={{ flex: 1, padding: '4px 6px', borderRadius: 6, background: `${col}15`, textAlign: 'center' }}>
                      <p style={{ fontSize: 9, color: '#3f4b61' }}>수행률</p>
                      <p style={{ fontSize: 11, fontWeight: 800, color: col }}>{readinessPct}%</p>
                    </div>
                    <div style={{ flex: 1, padding: '4px 6px', borderRadius: 6, background: '#dbeafe', textAlign: 'center' }}>
                      <p style={{ fontSize: 9, color: '#1e40af' }}>남은 일정</p>
                      <p style={{ fontSize: 11, fontWeight: 800, color: '#1d4ed8' }}>{remaining}개</p>
                    </div>
                    <div style={{ flex: 1, padding: '4px 6px', borderRadius: 6, background: 'rgba(0,0,0,0.04)', textAlign: 'center' }}>
                      <p style={{ fontSize: 9, color: '#3f4b61' }}>확보 가능</p>
                      <p style={{ fontSize: 11, fontWeight: 800, color: '#181c1e' }}>{availableHrs}h</p>
                    </div>
                  </div>
                  <div style={{ height: 4, borderRadius: 99, background: '#e5e7eb' }}>
                    <div style={{ height: '100%', width: `${readinessPct}%`, background: col, borderRadius: 99, transition: 'width 0.5s' }} />
                  </div>
                  {level !== 'ok' && (
                    <p style={{ fontSize: 10, color: col, marginTop: 4, fontWeight: 600 }}>
                      {level === 'danger' ? '위험 — 지금 바로 공부 시작!' : '주의 — 매일 1시간 추가 권장'}
                    </p>
                  )}
                  <button
                    onClick={() => fetchSummary(exam, readinessPct, daysLeft, availableHrs, remaining)}
                    disabled={loadingMap[exam.id]}
                    style={{ marginTop: 8, width: '100%', padding: '5px 0', borderRadius: 7, border: `1px solid ${col}40`, background: `${col}10`, color: col, fontSize: 10, fontWeight: 700, cursor: loadingMap[exam.id] ? 'wait' : 'pointer' }}
                  >
                    {loadingMap[exam.id] ? 'AI 분석 중...' : 'AI 진단 받기'}
                  </button>
                  {summaryMap[exam.id] && (
                    <p style={{ marginTop: 6, fontSize: 10, color: '#374151', lineHeight: 1.6, padding: '6px 8px', background: 'rgba(0,0,0,0.03)', borderRadius: 7 }}>
                      {summaryMap[exam.id]}
                    </p>
                  )}
                </>
              ) : (
                <p style={{ fontSize: 10, color: '#64748b' }}>AI 공부 계획 생성 후 경보가 활성화됩니다</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

