'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { indexToRecurringDay, recurringDayToIndex } from '@/lib/recurringDay';
import { timeToMinutes } from '@/lib/utils';
import MaterialIcon from '@/components/common/MaterialIcon';
import type { ExamSchedule, Schedule } from '@/types';

function ExamReadinessPanel({ exams, schedules }: { exams: ExamSchedule[]; schedules: Schedule[] }) {
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

function ForgettingCurvePanel({ schedules }: { schedules: Schedule[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);

  const completedClasses = schedules.filter((s) => s.schedule_type === 'class' && s.is_completed);
  const completedClassCount = completedClasses.length;
  const reviewsTomorrow = completedClasses
    .filter((s) => (s.date || todayStr) === todayStr)
    .map((s) => ({ label: s.title.replace(/^[📚📖🔁]\s*/, ''), color: s.color || '#8B5CF6' }));

  const findFreeHourSlot = (dateStr: string): { start_time: string; end_time: string } => {
    const jsDay = new Date(`${dateStr}T00:00:00`).getDay();
    const dow = jsDay === 0 ? 6 : jsDay - 1;
    const daySchedules = schedules.filter((s) =>
      s.date === dateStr || (!s.date && recurringDayToIndex(s.recurring_day) === dow)
    );
    const occupied: [number, number][] = daySchedules
      .filter((s) => s.start_time && s.end_time)
      .map((s) => [timeToMinutes(s.start_time), timeToMinutes(s.end_time)] as [number, number]);
    const isFree = (start: number) => {
      const end = start + 60;
      return start >= 7 * 60 && end <= 23 * 60 && !occupied.some(([s, e]) => s < end && e > start);
    };
    for (const start of [20*60, 19*60, 21*60, 18*60, 22*60, 17*60, 14*60, 15*60, 16*60, 13*60, 10*60, 11*60, 9*60, 8*60, 7*60]) {
      if (isFree(start)) {
        return {
          start_time: `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`,
          end_time: `${String(Math.floor((start + 60) / 60)).padStart(2, '0')}:${String((start + 60) % 60).padStart(2, '0')}`,
        };
      }
    }
    return { start_time: '20:00', end_time: '21:00' };
  };

  const runGenerate = async (silent: boolean) => {
    const classMap = new Map<string, { baseDate: string; title: string; color: string }>();
    for (const s of completedClasses) {
      const baseDate = s.date || todayStr;
      const cur = classMap.get(s.title);
      if (!cur || baseDate > cur.baseDate) {
        classMap.set(s.title, { baseDate, title: s.title, color: s.color || '#8B5CF6' });
      }
    }
    if (classMap.size === 0) return 0;

    let created = 0;
    for (const [, cls] of classMap) {
      const [y, m, d] = cls.baseDate.split('-').map(Number);
      const reviewDate = new Date(y, m - 1, d + 1);
      if (reviewDate <= today) continue;

      const dateStr = `${reviewDate.getFullYear()}-${String(reviewDate.getMonth() + 1).padStart(2, '0')}-${String(reviewDate.getDate()).padStart(2, '0')}`;
      const alreadyExists = schedules.some((s) =>
        s.date === dateStr && s.title.includes(cls.title) && s.schedule_type === 'study'
      );
      if (alreadyExists) continue;

      const dow = reviewDate.getDay() === 0 ? 6 : reviewDate.getDay() - 1;
      const { start_time, end_time } = findFreeHourSlot(dateStr);
      try {
        await api.post('/schedules', {
          title: `🔁 ${cls.title} 복습`,
          schedule_type: 'study',
          date: dateStr,
          recurring_day: indexToRecurringDay(dow),
          start_time,
          end_time,
          color: cls.color,
          priority: 1,
        });
        created++;
      } catch {
        // 충돌 시 해당 복습 일정만 건너뜁니다.
      }
    }
    if (created > 0) {
      await queryClient.invalidateQueries({ queryKey: ['schedules'] });
      toast.success(silent
        ? `수업 완료 감지 — 다음 날 복습 ${created}개 자동 배치!`
        : `복습 일정 ${created}개를 생성했습니다!`);
    } else if (!silent) {
      toast.info('새로 생성할 복습 일정이 없습니다.');
    }
    return created;
  };

  useEffect(() => {
    if (completedClassCount === 0) return;
    const autoKey = `skema_review_auto_${todayStr}_cnt${completedClassCount}`;
    if (localStorage.getItem(autoKey)) return;
    localStorage.setItem(autoKey, '1');
    setGenerating(true);
    runGenerate(true).finally(() => setGenerating(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedClassCount]);

  const handleManualGenerate = async () => {
    setGenerating(true);
    await runGenerate(false);
    setGenerating(false);
  };

  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#3f4b61', marginBottom: 8, letterSpacing: '0.5px' }}>복습 스케줄러</p>
      {reviewsTomorrow.length === 0 ? (
        <p style={{ fontSize: 11, color: '#64748b', textAlign: 'center', padding: '6px 0 8px' }}>오늘 완료된 수업 없음</p>
      ) : (
        <div style={{ padding: '10px 12px', borderRadius: 10, background: '#f5f3ff', border: '1px solid #ddd6fe', marginBottom: 8 }}>
          <p style={{ fontSize: 10, color: '#5b21b6', marginBottom: 6, fontWeight: 600 }}>내일 복습 예정</p>
          <div className="space-y-1.5">
            {reviewsTomorrow.map(({ label, color }, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#3730a3', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: color, borderRadius: 9999, padding: '1px 6px', flexShrink: 0 }}>내일</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={handleManualGenerate}
        disabled={generating}
        style={{
          width: '100%', padding: '7px 0', borderRadius: 8,
          background: generating ? '#e5e7eb' : '#ede9fe',
          color: generating ? '#64748b' : '#5b21b6',
          fontWeight: 700, fontSize: 11,
          border: '1px solid #c4b5fd',
          cursor: generating ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          transition: 'all 0.2s',
        }}
      >
        {generating ? '생성 중...' : '복습 일정 생성'}
      </button>
      <p style={{ fontSize: 9, color: '#64748b', textAlign: 'center', marginTop: 4 }}>수업 완료 시 다음 날 빈 시간 1시간 자동 배치</p>
    </div>
  );
}

function WeeklyAIFeedbackPanel({ schedules, currentWeekStart }: { schedules: Schedule[]; currentWeekStart: Date }) {
  const weekKey = `${currentWeekStart.getFullYear()}-${currentWeekStart.getMonth() + 1}-${currentWeekStart.getDate()}`;
  const cacheKey = `skema_weekly_letter_${weekKey}`;
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const weekEnd = currentWeekStart.getTime() + 7 * 86400000;
  const thisWeek = schedules.filter((s) => {
    if (!s.date) return true;
    const [y, mo, d] = s.date.split('-').map(Number);
    const t = new Date(y, mo - 1, d).getTime();
    return t >= currentWeekStart.getTime() && t < weekEnd;
  });
  const done = thisWeek.filter((s) => s.is_completed).length;
  const total = thisWeek.length;
  const dayStats = ['월', '화', '수', '목', '금', '토', '일'].map((name, dow) => {
    const daySch = thisWeek.filter((s) => {
      if (s.date) {
        const [y, m, d] = s.date.split('-').map(Number);
        const gd = new Date(y, m - 1, d).getDay();
        return (gd === 0 ? 6 : gd - 1) === dow;
      }
      return recurringDayToIndex(s.recurring_day) === dow;
    });
    return { name, done: daySch.filter((s) => s.is_completed).length, total: daySch.length };
  }).filter((d) => d.total > 0);
  const patternStr = dayStats.map((d) => `${d.name}요일 ${d.done}/${d.total}개`).join(', ');
  const sorted = [...dayStats].sort((a, b) => (b.done / Math.max(b.total, 1)) - (a.done / Math.max(a.total, 1)));
  const bestDay = sorted[0];
  const worstDay = sorted[sorted.length - 1];

  useEffect(() => {
    if (total === 0 || done === 0) return;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      setFeedback(cached);
      return;
    }

    const typeCount = ['class', 'study', 'assignment', 'activity', 'personal']
      .map((t) => {
        const n = thisWeek.filter((s) => s.schedule_type === t).length;
        return n > 0 ? `${t} ${n}개` : '';
      })
      .filter(Boolean)
      .join(', ');

    setLoading(true);
    api.post<{ reply: string }>('/ai/chat', {
      message: `이번 주 학습 데이터: 총 ${total}개 중 ${done}개 완료(완료율 ${Math.round(done / total * 100)}%). 요일별: ${patternStr}. 유형별: ${typeCount}. "이번 주의 나에게" 형식의 짧은 AI 편지를 3문장으로 써줘. ${bestDay ? `${bestDay.name}요일에 집중력이 높았고` : ''} ${worstDay && worstDay !== bestDay ? `${worstDay.name}요일에 아쉬운 점이 있었다는 점을 구체적으로 언급하고,` : ''} 다음 주 실천 가능한 제안 1가지를 담아줘. 이모지 없이, 존댓말로.`,
      messages: [],
    }).then(({ data }) => {
      setFeedback(data.reply);
      try {
        localStorage.setItem(cacheKey, data.reply);
      } catch {
        // localStorage 저장 실패는 화면 표시를 막지 않습니다.
      }
    }).catch(() => {}).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, done]);

  const today = new Date();
  const dateLabel = `${today.getMonth() + 1}월 ${today.getDate()}일`;

  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#3f4b61', marginBottom: 8, letterSpacing: '0.5px' }}>주간 AI 편지</p>
      <div style={{ padding: '12px', borderRadius: 10, background: '#faf9ff', border: '1px solid #e0d9ff', minHeight: 72 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #c4b5fd', borderTopColor: '#7c3aed', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
            <p style={{ fontSize: 11, color: '#3f4b61' }}>편지 작성 중...</p>
          </div>
        ) : feedback ? (
          <>
            <p style={{ fontSize: 9, color: '#64748b', marginBottom: 6 }}>To. 이번 주의 나 · {dateLabel}</p>
            <p style={{ fontSize: 12, color: '#3730a3', lineHeight: 1.7 }}>{feedback}</p>
            <p style={{ fontSize: 9, color: '#c4b5fd', marginTop: 6, textAlign: 'right' }}>— AI SKEMA</p>
          </>
        ) : (
          <p style={{ fontSize: 11, color: '#64748b', lineHeight: 1.6 }}>이번 주 일정을 완료하면<br />AI 편지가 자동 작성됩니다.</p>
        )}
      </div>
    </div>
  );
}

function KakaoNotifyButton() {
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<'idle' | 'ok' | 'err' | 'not_connected'>('idle');

  const handleSend = async () => {
    setSending(true);
    try {
      const res = await api.post('/kakao/notify/schedule-summary');
      if (res.data?.success) {
        setStatus('ok');
        toast.success('카카오톡으로 오늘 일정을 보냈습니다!');
      } else if (res.data?.error === 'kakao_not_connected') {
        setStatus('not_connected');
        toast.error('카카오 로그인 후 이용할 수 있습니다');
      } else {
        setStatus('err');
        toast.error('카카오톡 발송에 실패했습니다');
      }
    } catch {
      setStatus('err');
      toast.error('카카오톡 발송에 실패했습니다');
    } finally {
      setSending(false);
      setTimeout(() => setStatus('idle'), 3000);
    }
  };

  const label = status === 'ok' ? '발송 완료!' : status === 'not_connected' ? '카카오 미연결' : '카카오톡으로 일정 알림';

  return (
    <button
      onClick={handleSend}
      disabled={sending}
      style={{
        width: '100%',
        padding: '9px 0',
        borderRadius: 10,
        background: status === 'ok' ? '#16A34A' : status === 'not_connected' ? '#64748b' : '#FEE500',
        color: status === 'ok' || status === 'not_connected' ? '#fff' : '#3C1E1E',
        fontWeight: 700,
        fontSize: 12,
        border: 'none',
        cursor: sending ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        opacity: sending ? 0.7 : 1,
        transition: 'background 0.2s',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
        <ellipse cx="9" cy="8.5" rx="8.5" ry="7.5" fill="currentColor" fillOpacity="0.15"/>
        <path d="M9 2C5.134 2 2 4.686 2 8c0 2.09 1.183 3.93 3 5.07l-.5 2.43 2.78-1.82C7.72 13.89 8.35 14 9 14c3.866 0 7-2.686 7-6S12.866 2 9 2z" fill="#3C1E1E"/>
      </svg>
      {sending ? '발송 중...' : label}
    </button>
  );
}

export function SmartAlertPanel({ exams, schedules, currentWeekStart }: {
  exams: ExamSchedule[];
  schedules: Schedule[];
  currentWeekStart: Date;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const examsTomorrow = exams.filter((e) => e.exam_date === tomorrowStr);

  const alertExamCount = exams.filter((e) => {
    const [y, m, d] = e.exam_date.split('-').map(Number);
    const examDate = new Date(y, m - 1, d);
    if (examDate < today) return false;
    const daysLeft = Math.ceil((examDate.getTime() - today.getTime()) / 86400000);
    const linked = schedules.filter((s) => s.linked_exam_id === e.id);
    const done = linked.filter((s) => s.is_completed).length;
    const pct = linked.length > 0 ? Math.round((done / linked.length) * 100) : 0;
    return (daysLeft <= 3 && pct < 50) || (daysLeft <= 7 && pct < 60);
  }).length;

  const subjectMap = new Map<string, string>();
  for (const s of schedules) {
    if (s.schedule_type !== 'study' || !s.is_completed || !s.date) continue;
    const key = s.linked_exam_id ? `exam:${s.linked_exam_id}` : s.title;
    const cur = subjectMap.get(key);
    if (!cur || s.date > cur) subjectMap.set(key, s.date);
  }

  let reviewCount = 0;
  for (const [, lastDate] of subjectMap) {
    const [y, m, d] = lastDate.split('-').map(Number);
    const base = new Date(y, m - 1, d);
    for (const interval of [1, 3, 7, 21]) {
      const rev = new Date(base);
      rev.setDate(base.getDate() + interval);
      const revStr = `${rev.getFullYear()}-${String(rev.getMonth() + 1).padStart(2, '0')}-${String(rev.getDate()).padStart(2, '0')}`;
      if (revStr === todayStr) {
        reviewCount++;
        break;
      }
    }
  }

  const totalAlerts = alertExamCount + reviewCount + examsTomorrow.length;

  return (
    <div className="flex flex-col gap-4">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <MaterialIcon icon="notifications_active" size={16} color="var(--skema-primary)" filled />
          <span style={{ fontSize: 13, fontWeight: 800, color: '#181c1e' }}>AI 패널</span>
        </div>
        {totalAlerts > 0 && (
          <span style={{
            padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 800,
            background: examsTomorrow.length > 0 || alertExamCount > 0 ? '#DC2626' : '#7c3aed', color: '#fff',
          }}>{totalAlerts}</span>
        )}
      </div>

      {examsTomorrow.length > 0 && (
        <div style={{ padding: '12px', borderRadius: 10, background: '#fef2f2', border: '2px solid #DC2626' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <MaterialIcon icon="warning" size={15} color="#DC2626" filled />
            <p style={{ fontSize: 12, fontWeight: 800, color: '#DC2626' }}>내일 시험!</p>
          </div>
          {examsTomorrow.map((exam) => (
            <div key={exam.id} style={{ marginBottom: 4 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#7f1d1d' }}>{exam.title}</p>
              {exam.exam_time && (
                <p style={{ fontSize: 10, color: '#b91c1c' }}>{exam.exam_time}{exam.location ? ` · ${exam.location}` : ''}</p>
              )}
            </div>
          ))}
          <p style={{ fontSize: 10, color: '#DC2626', marginTop: 6, fontWeight: 600 }}>
            오늘 전날 복습 블록을 완료해주세요
          </p>
        </div>
      )}

      <ExamReadinessPanel exams={exams} schedules={schedules} />
      <div style={{ height: 1, background: '#ebeef1' }} />
      <ForgettingCurvePanel schedules={schedules} />
      <div style={{ height: 1, background: '#ebeef1' }} />
      <WeeklyAIFeedbackPanel schedules={schedules} currentWeekStart={currentWeekStart} />
      <div style={{ height: 1, background: '#ebeef1' }} />
      <KakaoNotifyButton />
    </div>
  );
}

export function TypeAnalysis({ schedules, weekStart }: { schedules: Schedule[]; weekStart: Date }) {
  const typeMeta = [
    { type: 'class', label: '수업', color: '#4F46E5', icon: '📚' },
    { type: 'study', label: '자율학습', color: '#059669', icon: '✏️' },
    { type: 'assignment', label: '과제', color: '#F97316', icon: '📋' },
    { type: 'activity', label: '활동', color: '#A855F7', icon: '🎯' },
    { type: 'personal', label: '개인', color: '#E11D48', icon: '👤' },
  ];
  const weekEnd = weekStart.getTime() + 7 * 24 * 3600 * 1000;
  const thisWeek = schedules.filter((s) => {
    if (!s.date) return true;
    const [y, m, d] = s.date.split('-').map(Number);
    const t = new Date(y, m - 1, d).getTime();
    return t >= weekStart.getTime() && t < weekEnd;
  });
  const stats = typeMeta.map(({ type, label, color, icon }) => {
    const typeSch = thisWeek.filter((s) => s.schedule_type === type);
    const done = typeSch.filter((s) => s.is_completed).length;
    const totalMins = typeSch.reduce((sum, s) => sum + (timeToMinutes(s.end_time) - timeToMinutes(s.start_time)), 0);
    return { type, label, color, icon, count: typeSch.length, done, totalMins };
  });
  const maxMins = Math.max(...stats.map((s) => s.totalMins), 1);
  const totalMinsAll = stats.reduce((s, t) => s + t.totalMins, 0);

  return (
    <div className="space-y-3">
      <div className="rounded-xl p-4" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#181c1e', marginBottom: 4 }}>이번 주 유형별 분석</p>
        <p style={{ fontSize: 11, color: '#3f4b61', marginBottom: 16 }}>
          총 {thisWeek.length}개 일정 · {Math.floor(totalMinsAll / 60)}시간 {totalMinsAll % 60}분
        </p>
        <div className="flex gap-3 flex-wrap mb-4">
          {stats.filter((s) => s.count > 0).map(({ type, label, color, icon, count }) => (
            <div key={type} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 20,
              background: `${color}15`, border: `1.5px solid ${color}40`,
            }}>
              <span style={{ fontSize: 14 }}>{icon}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color }}>{label}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color }}>{count}</span>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {stats.map(({ type, label, color, icon, count, done, totalMins }) => {
            const hrs = Math.floor(totalMins / 60);
            const mins = totalMins % 60;
            const timeStr = hrs > 0 ? `${hrs}시간 ${mins > 0 ? `${mins}분` : ''}` : `${mins}분`;
            const pct = count > 0 ? Math.round((done / count) * 100) : 0;
            return (
              <div key={type}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13 }}>{icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#181c1e' }}>{label}</span>
                    {count > 0 && (
                      <span style={{ fontSize: 10, color: '#3f4b61' }}>· {count}개 · {timeStr}</span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: count > 0 ? color : '#d1d5db' }}>
                    {count > 0 ? `완료 ${pct}%` : '없음'}
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 99, background: '#f1f4f7' }}>
                  <div style={{
                    height: '100%',
                    width: `${totalMins > 0 ? (totalMins / maxMins) * 100 : 0}%`,
                    background: color,
                    borderRadius: 99,
                    transition: 'width 0.5s',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function WeeklyReport({ schedules }: { schedules: Schedule[] }) {
  const now = new Date();
  const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const weekDays = ['월', '화', '수', '목', '금', '토', '일'];
  const weekMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - todayDow);
  const weekStats = weekDays.map((day, i) => {
    const colDate = new Date(weekMonday);
    colDate.setDate(weekMonday.getDate() + i);
    const colStr = `${colDate.getFullYear()}-${String(colDate.getMonth()+1).padStart(2,'0')}-${String(colDate.getDate()).padStart(2,'0')}`;
    const daySch = schedules.filter((s) => {
      if (!s.date) return recurringDayToIndex(s.recurring_day) === i;
      return s.date === colStr;
    });
    const done = daySch.filter((s) => s.is_completed).length;
    return { day, done, total: daySch.length, pct: daySch.length > 0 ? Math.round((done / daySch.length) * 100) : null, isToday: i === todayDow };
  });
  const typeBreakdown = [
    { type: 'class', label: '수업', color: '#4F46E5' },
    { type: 'study', label: '자율학습', color: '#10b981' },
    { type: 'assignment', label: '과제', color: '#F97316' },
    { type: 'activity', label: '활동', color: '#A855F7' },
    { type: 'personal', label: '개인', color: '#E11D48' },
  ].map(({ type, label, color }) => {
    const typeSch = schedules.filter((s) => s.schedule_type === type);
    const done = typeSch.filter((s) => s.is_completed).length;
    return { type, label, color, done, total: typeSch.length };
  }).filter(({ total }) => total > 0);

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#181c1e', marginBottom: 16 }}>요일별 수행률</p>
        <div className="flex items-end gap-2" style={{ height: 80 }}>
          {weekStats.map(({ day, pct, isToday }) => (
            <div key={day} className="flex-1 flex flex-col items-center gap-1">
              <span style={{ fontSize: 10, color: '#3f4b61' }}>{pct !== null ? `${pct}%` : '-'}</span>
              <div style={{ width: '100%', height: 50, background: '#f1f4f7', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'flex-end' }}>
                {pct !== null && (
                  <div style={{
                    width: '100%', height: `${pct}%`,
                    background: isToday ? 'var(--skema-primary)' : '#c3d0ff',
                    borderRadius: 6, transition: 'height 0.5s',
                  }} />
                )}
              </div>
              <span style={{ fontSize: 11, fontWeight: isToday ? 800 : 400, color: isToday ? 'var(--skema-primary)' : '#3f4b61' }}>{day}</span>
            </div>
          ))}
        </div>
      </div>

      {typeBreakdown.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#181c1e', marginBottom: 12 }}>유형별 수행 현황</p>
          <div className="space-y-3">
            {typeBreakdown.map(({ type, label, color, done, total }) => (
              <div key={type}>
                <div className="flex justify-between mb-1">
                  <span style={{ fontSize: 12, color: '#181c1e' }}>{label}</span>
                  <span style={{ fontSize: 12, color: '#3f4b61' }}>{done}/{total}</span>
                </div>
                <div style={{ height: 6, borderRadius: 99, background: '#f1f4f7' }}>
                  <div style={{ height: '100%', width: `${total > 0 ? (done / total) * 100 : 0}%`, background: color, borderRadius: 99, transition: 'width 0.5s' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
