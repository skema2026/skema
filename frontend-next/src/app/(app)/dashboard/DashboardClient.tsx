'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Timetable, getWeekStart } from '@/components/timetable/Timetable';
import { ClassForm } from '@/components/class-form/ClassForm';
import { ExamList } from '@/components/exam/ExamList';
import { SettingsModal } from '@/components/settings/SettingsModal';
import { useConflicts, useSchedules, useToggleComplete } from '@/hooks/useSchedules';
import { useExams } from '@/hooks/useExams';
import { useProfile } from '@/hooks/useProfile';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { api } from '@/lib/api';
import { timeToMinutes } from '@/lib/utils';
import MaterialIcon from '@/components/common/MaterialIcon';
import { Schedule, UserProfile, ExamSchedule } from '@/types';

const DAILY_QUOTES = {
  exam_prep: '오늘 하루도 목표를 향해 한 걸음씩. 합격은 반드시 옵니다 💪',
  civil_service: '꾸준함이 실력입니다. 오늘의 공부가 내일의 합격을 만듭니다 🔥',
  student: '지금 이 순간의 노력이 미래를 바꿉니다. 화이팅! 📚',
  worker: '성장하는 당신은 이미 앞서가고 있습니다 🌱',
  default: 'SKEMA와 함께 오늘도 계획대로 실천해보세요 ✨',
};

// ── 준비도 경보 시스템 ────────────────────────────────────────────────────────

function ExamReadinessPanel({ exams, schedules }: { exams: ExamSchedule[]; schedules: Schedule[] }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [summaryMap, setSummaryMap] = useState<Record<number, string>>({});
  const [loadingMap, setLoadingMap] = useState<Record<number, boolean>>({});

  const fetchSummary = async (exam: ExamSchedule, readinessPct: number, daysLeft: number, availableHrs: number, remaining: number) => {
    setLoadingMap(m => ({ ...m, [exam.id]: true }));
    try {
      const res = await api.post('/ai/readiness-summary', {
        exam_title: exam.title,
        readiness_pct: readinessPct,
        days_left: daysLeft,
        available_hrs: availableHrs,
        remaining,
      });
      setSummaryMap(m => ({ ...m, [exam.id]: res.data.summary }));
    } catch {
      setSummaryMap(m => ({ ...m, [exam.id]: 'AI 진단을 불러오지 못했습니다.' }));
    } finally {
      setLoadingMap(m => ({ ...m, [exam.id]: false }));
    }
  };

  const upcoming = exams
    .filter(e => { const [y, m, d] = e.exam_date.split('-').map(Number); return new Date(y, m - 1, d) >= today; })
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date))
    .slice(0, 3);

  if (upcoming.length === 0) return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#747684', marginBottom: 6, letterSpacing: '0.5px' }}>준비도 경보</p>
      <p style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', padding: '12px 0' }}>등록된 시험이 없습니다</p>
    </div>
  );

  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#747684', marginBottom: 8, letterSpacing: '0.5px' }}>준비도 경보</p>
      <div className="space-y-2">
        {upcoming.map(exam => {
          const [y, m, d] = exam.exam_date.split('-').map(Number);
          const daysLeft = Math.ceil((new Date(y, m - 1, d).getTime() - today.getTime()) / 86400000);

          const linked = schedules.filter(s => s.linked_exam_id === exam.id);
          const completed = linked.filter(s => s.is_completed);
          const calcMins = (s: Schedule) => timeToMinutes(s.end_time) - timeToMinutes(s.start_time);
          const readinessPct = linked.length > 0 ? Math.round(completed.length / linked.length * 100) : 0;
          const remaining = linked.length - completed.length;

          // 시험일까지 시간표 기준 확보 가능한 공부 시간 계산
          const SLEEP_HRS = 8;
          let availableHrs = 0;
          for (let i = 1; i <= daysLeft; i++) {
            const day = new Date(today); day.setDate(day.getDate() + i);
            const dow = day.getDay() === 0 ? 6 : day.getDay() - 1;
            const busyHrs = schedules
              .filter(s => !s.date && s.day_of_week === dow)
              .reduce((sum, s) => sum + calcMins(s) / 60, 0);
            availableHrs += Math.max(0, 24 - SLEEP_HRS - busyHrs);
          }
          availableHrs = Math.round(availableHrs * 10) / 10;

          const level = daysLeft <= 3 && readinessPct < 50 ? 'danger'
            : daysLeft <= 7 && readinessPct < 70 ? 'warn' : 'ok';
          const col = level === 'danger' ? '#DC2626' : level === 'warn' ? '#F97316' : '#059669';
          const bg  = level === 'danger' ? '#fef2f2' : level === 'warn' ? '#fff7ed' : '#f0fdf4';

          return (
            <div key={exam.id} style={{ padding: '10px 12px', borderRadius: 10, background: bg, border: `1px solid ${col}30` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#181c1e', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exam.title}</p>
                <span style={{ fontSize: 11, fontWeight: 800, color: col, marginLeft: 8, flexShrink: 0 }}>D-{daysLeft}</span>
              </div>
              {linked.length > 0 ? (
                <>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <div style={{ flex: 1, padding: '4px 6px', borderRadius: 6, background: col + '15', textAlign: 'center' }}>
                      <p style={{ fontSize: 9, color: '#747684' }}>수행률</p>
                      <p style={{ fontSize: 11, fontWeight: 800, color: col }}>{readinessPct}%</p>
                    </div>
                    <div style={{ flex: 1, padding: '4px 6px', borderRadius: 6, background: '#dbeafe', textAlign: 'center' }}>
                      <p style={{ fontSize: 9, color: '#1e40af' }}>남은 일정</p>
                      <p style={{ fontSize: 11, fontWeight: 800, color: '#1d4ed8' }}>{remaining}개</p>
                    </div>
                    <div style={{ flex: 1, padding: '4px 6px', borderRadius: 6, background: 'rgba(0,0,0,0.04)', textAlign: 'center' }}>
                      <p style={{ fontSize: 9, color: '#747684' }}>확보 가능</p>
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
                    style={{ marginTop: 8, width: '100%', padding: '5px 0', borderRadius: 7, border: `1px solid ${col}40`, background: col + '10', color: col, fontSize: 10, fontWeight: 700, cursor: loadingMap[exam.id] ? 'wait' : 'pointer' }}
                  >
                    {loadingMap[exam.id] ? 'AI 분석 중...' : '✦ AI 진단 받기'}
                  </button>
                  {summaryMap[exam.id] && (
                    <p style={{ marginTop: 6, fontSize: 10, color: '#374151', lineHeight: 1.6, padding: '6px 8px', background: 'rgba(0,0,0,0.03)', borderRadius: 7 }}>
                      {summaryMap[exam.id]}
                    </p>
                  )}
                </>
              ) : (
                <p style={{ fontSize: 10, color: '#9ca3af' }}>AI 공부 계획 생성 후 경보가 활성화됩니다</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 에빙하우스 복습 스케줄러 ─────────────────────────────────────────────────

function ForgettingCurvePanel({ schedules }: { schedules: Schedule[] }) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);

  const completedClasses = schedules.filter(s => s.schedule_type === 'class' && s.is_completed);
  const completedClassCount = completedClasses.length;

  // 오늘 완료된 수업 → 내일 복습 예정 표시용
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const reviewsTomorrow = completedClasses
    .filter(s => (s.date || todayStr) === todayStr)
    .map(s => ({ label: s.title.replace(/^[📚📖🔁]\s*/, ''), color: s.color || '#8B5CF6' }));

  // 기존 일정을 피해 비어있는 1시간 슬롯 탐색 (07:00~23:00, 수면 시간 제외)
  const findFreeHourSlot = (dateStr: string): { start_time: string; end_time: string } => {
    const jsDay = new Date(dateStr + 'T00:00:00').getDay();
    const dow = jsDay === 0 ? 6 : jsDay - 1;
    const daySchedules = schedules.filter(s =>
      s.date === dateStr || (!s.date && s.day_of_week === dow)
    );
    const occupied: [number, number][] = daySchedules
      .filter(s => s.start_time && s.end_time)
      .map(s => {
        const [sh, sm] = s.start_time.split(':').map(Number);
        const [eh, em] = s.end_time.split(':').map(Number);
        return [(sh ?? 0) * 60 + (sm ?? 0), (eh ?? 0) * 60 + (em ?? 0)] as [number, number];
      });
    const isFree = (start: number) => {
      const end = start + 60;
      return start >= 7 * 60 && end <= 23 * 60 && !occupied.some(([s, e]) => s < end && e > start);
    };
    // 저녁 → 오후 → 오전 순 우선 탐색
    for (const start of [20*60, 19*60, 21*60, 18*60, 22*60, 17*60, 14*60, 15*60, 16*60, 13*60, 10*60, 11*60, 9*60, 8*60, 7*60]) {
      if (isFree(start)) {
        const sh = Math.floor(start / 60);
        const sm = start % 60;
        return {
          start_time: `${String(sh).padStart(2, '0')}:${String(sm).padStart(2, '0')}`,
          end_time:   `${String(sh + 1).padStart(2, '0')}:${String(sm).padStart(2, '0')}`,
        };
      }
    }
    return { start_time: '20:00', end_time: '21:00' };
  };

  // 복습 일정 생성 — 수업 완료 다음 날 1시간만
  const runGenerate = async (silent: boolean) => {
    const classMap = new Map<string, { baseDate: string; title: string; color: string }>();
    for (const s of completedClasses) {
      const baseDate = s.date || todayStr;
      const cur = classMap.get(s.title);
      if (!cur || baseDate > cur.baseDate)
        classMap.set(s.title, { baseDate, title: s.title, color: s.color || '#8B5CF6' });
    }
    if (classMap.size === 0) return 0;

    let created = 0;
    for (const [, cls] of classMap) {
      const [y, m, d] = cls.baseDate.split('-').map(Number);
      const reviewDate = new Date(y, m - 1, d + 1); // 다음 날
      if (reviewDate <= today) continue;

      const dateStr = `${reviewDate.getFullYear()}-${String(reviewDate.getMonth() + 1).padStart(2, '0')}-${String(reviewDate.getDate()).padStart(2, '0')}`;
      const alreadyExists = schedules.some(
        s => s.date === dateStr && s.title.includes(cls.title) && s.schedule_type === 'study'
      );
      if (alreadyExists) continue;

      const dow = reviewDate.getDay() === 0 ? 6 : reviewDate.getDay() - 1;
      const { start_time, end_time } = findFreeHourSlot(dateStr);
      try {
        await api.post('/schedules', {
          title: `🔁 ${cls.title} 복습`,
          schedule_type: 'study',
          date: dateStr,
          day_of_week: dow,
          start_time,
          end_time,
          color: cls.color,
          priority: 1,
        });
        created++;
      } catch { /* 충돌 시 스킵 */ }
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

  // 수업 완료 감지 → 자동 트리거
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
      <p style={{ fontSize: 11, fontWeight: 700, color: '#747684', marginBottom: 8, letterSpacing: '0.5px' }}>복습 스케줄러</p>

      {reviewsTomorrow.length === 0 ? (
        <p style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', padding: '6px 0 8px' }}>오늘 완료된 수업 없음</p>
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
          color: generating ? '#9ca3af' : '#5b21b6',
          fontWeight: 700, fontSize: 11,
          border: '1px solid #c4b5fd',
          cursor: generating ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          transition: 'all 0.2s',
        }}
      >
        {generating ? '생성 중...' : '복습 일정 생성'}
      </button>
      <p style={{ fontSize: 9, color: '#9ca3af', textAlign: 'center', marginTop: 4 }}>수업 완료 시 다음 날 빈 시간 1시간 자동 배치</p>
    </div>
  );
}

// ── 주간 AI 편지 ─────────────────────────────────────────────────────────────

function WeeklyAIFeedbackPanel({ schedules, currentWeekStart }: { schedules: Schedule[]; currentWeekStart: Date }) {
  const weekKey = `${currentWeekStart.getFullYear()}-${currentWeekStart.getMonth() + 1}-${currentWeekStart.getDate()}`;
  const cacheKey = `skema_weekly_letter_${weekKey}`;
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const weekEnd = currentWeekStart.getTime() + 7 * 86400000;
  const thisWeek = schedules.filter(s => {
    if (!s.date) return true;
    const [y, mo, d] = s.date.split('-').map(Number);
    const t = new Date(y, mo - 1, d).getTime();
    return t >= currentWeekStart.getTime() && t < weekEnd;
  });
  const done = thisWeek.filter(s => s.is_completed).length;
  const total = thisWeek.length;

  // 요일별 완료율 분석 (월~일)
  const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'];
  const dayStats = DAY_NAMES.map((name, dow) => {
    const daySch = thisWeek.filter(s => {
      if (s.date) {
        const [y, m, d] = s.date.split('-').map(Number);
        const gd = new Date(y, m - 1, d).getDay();
        return (gd === 0 ? 6 : gd - 1) === dow;
      }
      return s.day_of_week === dow;
    });
    return { name, done: daySch.filter(s => s.is_completed).length, total: daySch.length };
  }).filter(d => d.total > 0);

  const patternStr = dayStats.map(d => `${d.name}요일 ${d.done}/${d.total}개`).join(', ');
  const sorted = [...dayStats].sort((a, b) => (b.done / Math.max(b.total, 1)) - (a.done / Math.max(a.total, 1)));
  const bestDay = sorted[0];
  const worstDay = sorted[sorted.length - 1];

  useEffect(() => {
    if (total === 0 || done === 0) return;
    const cached = localStorage.getItem(cacheKey);
    if (cached) { setFeedback(cached); return; }

    const typeCount = ['class', 'study', 'assignment', 'activity', 'personal']
      .map(t => { const n = thisWeek.filter(s => s.schedule_type === t).length; return n > 0 ? `${t} ${n}개` : ''; })
      .filter(Boolean).join(', ');

    setLoading(true);
    api.post<{ reply: string }>('/ai/chat', {
      message: `이번 주 학습 데이터: 총 ${total}개 중 ${done}개 완료(완료율 ${Math.round(done / total * 100)}%). 요일별: ${patternStr}. 유형별: ${typeCount}. "이번 주의 나에게" 형식의 짧은 AI 편지를 3문장으로 써줘. ${bestDay ? `${bestDay.name}요일에 집중력이 높았고` : ''} ${worstDay && worstDay !== bestDay ? `${worstDay.name}요일에 아쉬운 점이 있었다는 점을 구체적으로 언급하고,` : ''} 다음 주 실천 가능한 제안 1가지를 담아줘. 이모지 없이, 존댓말로.`,
      messages: [],
    }).then(({ data }) => {
      setFeedback(data.reply);
      try { localStorage.setItem(cacheKey, data.reply); } catch { /* ignore */ }
    }).catch(() => {}).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, done]);

  const today = new Date();
  const dateLabel = `${today.getMonth() + 1}월 ${today.getDate()}일`;

  return (
    <div>
      <p style={{ fontSize: 11, fontWeight: 700, color: '#747684', marginBottom: 8, letterSpacing: '0.5px' }}>주간 AI 편지</p>
      <div style={{ padding: '12px', borderRadius: 10, background: '#faf9ff', border: '1px solid #e0d9ff', minHeight: 72 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #c4b5fd', borderTopColor: '#7c3aed', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
            <p style={{ fontSize: 11, color: '#747684' }}>편지 작성 중...</p>
          </div>
        ) : feedback ? (
          <>
            <p style={{ fontSize: 9, color: '#9ca3af', marginBottom: 6 }}>To. 이번 주의 나 · {dateLabel}</p>
            <p style={{ fontSize: 12, color: '#3730a3', lineHeight: 1.7 }}>{feedback}</p>
            <p style={{ fontSize: 9, color: '#c4b5fd', marginTop: 6, textAlign: 'right' }}>— AI SKEMA</p>
          </>
        ) : (
          <p style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>이번 주 일정을 완료하면<br />AI 편지가 자동 작성됩니다.</p>
        )}
      </div>
    </div>
  );
}

// ── 스마트 알림 통합 패널 ───────────────────────────────────────────────────────

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
        background: status === 'ok' ? '#16A34A' : status === 'not_connected' ? '#9ca3af' : '#FEE500',
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

function SmartAlertPanel({ exams, schedules, currentWeekStart }: {
  exams: ExamSchedule[];
  schedules: Schedule[];
  currentWeekStart: Date;
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // 내일 시험
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const examsTomorrow = exams.filter(e => e.exam_date === tomorrowStr);

  // 경보 대상 시험 수 (위험·주의)
  const alertExamCount = exams.filter(e => {
    const [y, m, d] = e.exam_date.split('-').map(Number);
    const examDate = new Date(y, m - 1, d);
    if (examDate < today) return false;
    const daysLeft = Math.ceil((examDate.getTime() - today.getTime()) / 86400000);
    const linked = schedules.filter(s => s.linked_exam_id === e.id);
    const done = linked.filter(s => s.is_completed).length;
    const total = linked.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return (daysLeft <= 3 && pct < 50) || (daysLeft <= 7 && pct < 60);
  }).length;

  // 오늘 망각곡선 복습 항목 수 (에빙하우스 주기: 1·3·7·21일)
  const INTERVALS = [1, 3, 7, 21];
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
    for (const interval of INTERVALS) {
      const rev = new Date(base); rev.setDate(base.getDate() + interval);
      const revStr = `${rev.getFullYear()}-${String(rev.getMonth() + 1).padStart(2, '0')}-${String(rev.getDate()).padStart(2, '0')}`;
      if (revStr === todayStr) { reviewCount++; break; }
    }
  }

  const totalAlerts = alertExamCount + reviewCount + examsTomorrow.length;

  return (
    <div className="flex flex-col gap-4">
      {/* 헤더 */}
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

      {/* 내일 시험 경보 */}
      {examsTomorrow.length > 0 && (
        <div style={{ padding: '12px', borderRadius: 10, background: '#fef2f2', border: '2px solid #DC2626' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <MaterialIcon icon="warning" size={15} color="#DC2626" filled />
            <p style={{ fontSize: 12, fontWeight: 800, color: '#DC2626' }}>내일 시험!</p>
          </div>
          {examsTomorrow.map(exam => (
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

      {/* 시험 준비도 */}
      <ExamReadinessPanel exams={exams} schedules={schedules} />

      <div style={{ height: 1, background: '#ebeef1' }} />

      {/* 에빙하우스 복습 스케줄러 */}
      <ForgettingCurvePanel schedules={schedules} />

      <div style={{ height: 1, background: '#ebeef1' }} />

      {/* 주간 AI 편지 */}
      <WeeklyAIFeedbackPanel schedules={schedules} currentWeekStart={currentWeekStart} />

      <div style={{ height: 1, background: '#ebeef1' }} />

      {/* 카카오톡 일정 알림 */}
      <KakaoNotifyButton />
    </div>
  );
}

function TypeAnalysis({ schedules, weekStart }: { schedules: Schedule[]; weekStart: Date }) {
  const TYPE_META = [
    { type: 'class',      label: '수업',     color: '#4F46E5', icon: '📚' },
    { type: 'study',      label: '자율학습', color: '#059669', icon: '✏️' },
    { type: 'assignment', label: '과제',     color: '#F97316', icon: '📋' },
    { type: 'activity',   label: '활동',     color: '#A855F7', icon: '🎯' },
    { type: 'personal',   label: '개인',     color: '#E11D48', icon: '👤' },
  ];

  const weekEnd = weekStart.getTime() + 7 * 24 * 3600 * 1000;
  const inWeek = (s: Schedule) => {
    if (!s.date) return true;
    const [y, m, d] = s.date.split('-').map(Number);
    const t = new Date(y, m - 1, d).getTime();
    return t >= weekStart.getTime() && t < weekEnd;
  };
  const thisWeek = schedules.filter(inWeek);

  const stats = TYPE_META.map(({ type, label, color, icon }) => {
    const typeSch = thisWeek.filter(s => s.schedule_type === type);
    const done = typeSch.filter(s => s.is_completed).length;
    const totalMins = typeSch.reduce((sum, s) => {
      return sum + (timeToMinutes(s.end_time) - timeToMinutes(s.start_time));
    }, 0);
    return { type, label, color, icon, count: typeSch.length, done, totalMins };
  });

  const maxMins = Math.max(...stats.map(s => s.totalMins), 1);
  const totalMinsAll = stats.reduce((s, t) => s + t.totalMins, 0);

  return (
    <div className="space-y-3">
      <div className="rounded-xl p-4" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#181c1e', marginBottom: 4 }}>이번 주 유형별 분석</p>
        <p style={{ fontSize: 11, color: '#747684', marginBottom: 16 }}>
          총 {thisWeek.length}개 일정 · {Math.floor(totalMinsAll / 60)}시간 {totalMinsAll % 60}분
        </p>
        {/* 원형 분포 */}
        <div className="flex gap-3 flex-wrap mb-4">
          {stats.filter(s => s.count > 0).map(({ type, label, color, icon, count }) => (
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
        {/* 막대 그래프 */}
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
                      <span style={{ fontSize: 10, color: '#747684' }}>· {count}개 · {timeStr}</span>
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

function WeeklyReport({ schedules }: { schedules: Schedule[] }) {
  const now = new Date();
  const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const weekDays = ['월', '화', '수', '목', '금', '토', '일'];

  // 이번 주 월요일 기준
  const weekMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - todayDow);
  const weekStats = weekDays.map((day, i) => {
    const colDate = new Date(weekMonday);
    colDate.setDate(weekMonday.getDate() + i);
    const colStr = `${colDate.getFullYear()}-${String(colDate.getMonth()+1).padStart(2,'0')}-${String(colDate.getDate()).padStart(2,'0')}`;
    const daySch = schedules.filter((s) => {
      if (!s.date) return s.day_of_week === i;           // 반복 일정
      return s.date === colStr;                           // 특정 날짜 일정
    });
    const done = daySch.filter((s) => s.is_completed).length;
    const total = daySch.length;
    return { day, done, total, pct: total > 0 ? Math.round((done / total) * 100) : null, isToday: i === todayDow };
  });

  const totalDone = schedules.filter((s) => s.is_completed).length;
  const totalAll = schedules.length;
  const TYPE_META = [
    { type: 'class',      label: '수업',     color: '#4F46E5' },
    { type: 'study',      label: '자율학습', color: '#10b981' },
    { type: 'assignment', label: '과제',     color: '#F97316' },
    { type: 'activity',   label: '활동',     color: '#A855F7' },
    { type: 'personal',   label: '개인',     color: '#E11D48' },
  ];
  const typeBreakdown = TYPE_META.map(({ type, label, color }) => {
    const typeSch = schedules.filter((s) => s.schedule_type === type);
    const done = typeSch.filter((s) => s.is_completed).length;
    return { type, label, color, done, total: typeSch.length };
  }).filter(({ total }) => total > 0);

  return (
    <div className="space-y-4">
      {/* 요일별 수행률 */}
      <div className="rounded-xl p-4" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#181c1e', marginBottom: 16 }}>요일별 수행률</p>
        <div className="flex items-end gap-2" style={{ height: 80 }}>
          {weekStats.map(({ day, done, total, pct, isToday }) => (
            <div key={day} className="flex-1 flex flex-col items-center gap-1">
              <span style={{ fontSize: 10, color: '#747684' }}>{pct !== null ? `${pct}%` : '-'}</span>
              <div style={{ width: '100%', height: 50, background: '#f1f4f7', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'flex-end' }}>
                {pct !== null && (
                  <div style={{
                    width: '100%', height: `${pct}%`,
                    background: isToday ? 'var(--skema-primary)' : '#c3d0ff',
                    borderRadius: 6, transition: 'height 0.5s',
                  }} />
                )}
              </div>
              <span style={{ fontSize: 11, fontWeight: isToday ? 800 : 400, color: isToday ? 'var(--skema-primary)' : '#747684' }}>{day}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 유형별 수행률 */}
      {typeBreakdown.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#181c1e', marginBottom: 12 }}>유형별 수행 현황</p>
          <div className="space-y-3">
            {typeBreakdown.map(({ type, label, color, done, total }) => (
              <div key={type}>
                <div className="flex justify-between mb-1">
                  <span style={{ fontSize: 12, color: '#181c1e' }}>{label}</span>
                  <span style={{ fontSize: 12, color: '#747684' }}>{done}/{total}</span>
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


interface Props {
  initialSchedules: Schedule[];
  initialProfile: UserProfile | null;
}

export default function DashboardClient({ initialSchedules, initialProfile }: Props) {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { openClassForm, isShareModalOpen, openShareModal, closeShareModal } = useUIStore();
  const { data: schedules = [] } = useSchedules(initialSchedules);
  const { data: exams = [] } = useExams();
  const { data: profile } = useProfile(initialProfile ?? undefined);
  const { data: conflicts = [] } = useConflicts();
  const toggleComplete = useToggleComplete();

  const schedulesRef = useRef(schedules);
  useEffect(() => { schedulesRef.current = schedules; }, [schedules]);

  const [shareToken, setShareToken] = useState<string | null>(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [notification, setNotification] = useState<Schedule | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const ALL_TYPES = ['class', 'study', 'assignment', 'activity', 'personal'] as const;
  type ScheduleTypeTuple = typeof ALL_TYPES;
  type ScheduleTypeFilter = ScheduleTypeTuple[number];
  const [activeTypes, setActiveTypes] = useState<Set<ScheduleTypeFilter>>(new Set(ALL_TYPES));
  const toggleType = (t: ScheduleTypeFilter) =>
    setActiveTypes(prev => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  const filteredSchedules = schedules.filter(s =>
    activeTypes.has((s.schedule_type as ScheduleTypeFilter) ?? 'personal')
  );
  const queryClient = useQueryClient();

  // 온보딩 미완료 시 온보딩 페이지로 이동 (SSR에서 처리 안된 경우 fallback)
  useEffect(() => {
    if (profile && !profile.onboarding_completed) {
      router.replace('/onboarding');
    }
  }, [profile, router]);

  // Notification system
  const checkNotifications = useCallback(() => {
    if (typeof window === 'undefined') return;
    const notifEnabled = localStorage.getItem('skema_notif_enabled') !== 'false';
    if (!notifEnabled || !schedules.length) return;
    const notifMinutes = parseInt(localStorage.getItem('skema_notif_minutes') || '30', 10);
    const now = new Date();
    const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const upcoming = schedules.find((s) => {
      if (s.is_completed) return false;
      const matchDay = s.date ? s.date === todayStr : s.day_of_week === todayDow;
      if (!matchDay) return false;
      const startMin = timeToMinutes(s.start_time);
      const diff = startMin - nowMin;
      return diff > 0 && diff <= notifMinutes;
    });
    if (upcoming) {
      setNotification(upcoming);
      setTimeout(() => setNotification(null), 8000);
    }
  }, [schedules]);

  useEffect(() => {
    checkNotifications();
    const interval = setInterval(checkNotifications, 60000);
    return () => clearInterval(interval);
  }, [checkNotifications]);

  // 시험 전날 복습 자동 생성
  useEffect(() => {
    if (!exams.length) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    for (const exam of exams) {
      const [y, m, d] = exam.exam_date.split('-').map(Number);
      const examDate = new Date(y, m - 1, d); examDate.setHours(0, 0, 0, 0);
      if (examDate <= today) continue;

      const preExamDate = new Date(y, m - 1, d - 1); preExamDate.setHours(0, 0, 0, 0);
      if (preExamDate < today) continue;

      const preExamStr = `${preExamDate.getFullYear()}-${String(preExamDate.getMonth() + 1).padStart(2, '0')}-${String(preExamDate.getDate()).padStart(2, '0')}`;
      const lsKey = `skema_pre_exam_${exam.id}_${preExamStr}`;
      if (localStorage.getItem(lsKey)) continue;

      const alreadyExists = schedulesRef.current.some(
        s => s.date === preExamStr && s.linked_exam_id === exam.id,
      );
      if (alreadyExists) { localStorage.setItem(lsKey, '1'); continue; }

      const dow = preExamDate.getDay() === 0 ? 6 : preExamDate.getDay() - 1;
      api.post('/schedules', {
        title: `📝 ${exam.title} 전날 복습`,
        schedule_type: 'study',
        date: preExamStr,
        day_of_week: dow,
        start_time: '20:00',
        end_time: '22:00',
        color: '#DC2626',
        priority: 2,
        linked_exam_id: exam.id,
      }).then(() => {
        localStorage.setItem(lsKey, '1');
        queryClient.invalidateQueries({ queryKey: ['schedules'] });
        toast.info(`${exam.title} 전날 복습 일정이 자동으로 추가되었습니다`, { duration: 6000 });
      }).catch(() => {
        localStorage.setItem(lsKey, '1'); // 충돌 등 실패 시 재시도 방지
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exams]);

  // 시험 전날 경보 토스트
  useEffect(() => {
    if (!exams.length) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    const examsTomorrow = exams.filter(e => e.exam_date === tomorrowStr);
    if (!examsTomorrow.length) return;

    const warnKey = `skema_exam_warn_${tomorrowStr}`;
    if (localStorage.getItem(warnKey)) return;
    localStorage.setItem(warnKey, '1');

    examsTomorrow.forEach(exam => {
      toast.warning(
        `내일 "${exam.title}" 시험! 오늘 전날 복습을 꼭 완료하세요`,
        { duration: 15000 },
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exams]);

  // 오늘 할 일
  const now = new Date();
  const todayDow = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekStart = getWeekStart(new Date(now.getFullYear(), now.getMonth(), now.getDate() + weekOffset * 7));
  // 서버의 get_today_schedules와 동일한 중복 제거:
  // 반복 일정 + 오늘 날짜 일정을 합치되, 같은 title+start_time의 dated 인스턴스가 있으면 반복 일정은 제외
  const todaySpecific = schedules.filter((s) => s.date === todayStr);
  const todayRecurring = schedules.filter((s) => !s.date && s.day_of_week === todayDow);
  const todaySpecificKeys = new Set(todaySpecific.map((s) => `${s.title}|${s.start_time}`));
  const todaySchedules = [
    ...todaySpecific,
    ...todayRecurring.filter((s) => !todaySpecificKeys.has(`${s.title}|${s.start_time}`)),
  ].sort((a, b) => a.start_time.localeCompare(b.start_time));

  // 오늘 수행률
  const todayTotal = todaySchedules.length;
  const todayDone  = todaySchedules.filter((s) => s.is_completed).length;
  const todayPct   = todayTotal > 0 ? Math.round((todayDone / todayTotal) * 100) : null;

  // 이번 주 수행률 (현재 실제 주, weekOffset 무관)
  const currentWeekStart = getWeekStart(now);
  const currentWeekEnd   = currentWeekStart.getTime() + 7 * 24 * 3600 * 1000;
  const weekSchedules = schedules.filter((s) => {
    if (!s.date) return true; // 반복 일정: 요일 기준으로 이번 주에 존재
    const [y, m, d] = s.date.split('-').map(Number);
    const t = new Date(y, m - 1, d).getTime();
    return t >= currentWeekStart.getTime() && t < currentWeekEnd;
  });
  const weekTotal = weekSchedules.length;
  const weekDone  = weekSchedules.filter((s) => s.is_completed).length;
  const weekPct   = weekTotal > 0 ? Math.round((weekDone / weekTotal) * 100) : null;

  // 헤더 뱃지용 (오늘 기준)
  const total = schedules.length;
  const done  = schedules.filter((s) => s.is_completed).length;
  const pct   = todayPct;

  // 미달성 일정 (오늘 + 이미 지난 시간 + 미완료)
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const unachievedSchedules = todaySchedules.filter((s) => {
    if (s.is_completed) return false;
    return timeToMinutes(s.end_time) < nowMin;
  });

  // 완료 토글 — optimistic update (useToggleComplete 훅 사용)
  const handleToggleComplete = (s: Schedule) => {
    toggleComplete.mutate(
      { id: s.id, is_completed: !s.is_completed },
      { onError: () => toast.error('업데이트 중 오류가 발생했습니다') },
    );
  };

  /** AI 액션 후 관련 모든 쿼리 무효화 */
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['schedules'] });
    queryClient.invalidateQueries({ queryKey: ['schedules', 'today'] });
    queryClient.invalidateQueries({ queryKey: ['schedules', 'conflicts'] });
    queryClient.invalidateQueries({ queryKey: ['exams'] });
  };

  const handleReschedule = async () => {
    setIsRegenerating(true);
    try {
      const { data } = await api.post<{ reply: string }>('/ai/chat', {
        message: '미완료 일정을 오늘 이후 빈 시간에 자동으로 재배치해줘',
        messages: [],
      });
      invalidateAll();
      toast.success(data.reply.includes('재배치했습니다') ? '일정이 재배치되었습니다' : '재배치 완료');
    } catch {
      toast.error('재배치 중 오류가 발생했습니다');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
    toast.success('로그아웃 되었습니다');
  };

  const handleShare = async () => {
    openShareModal();
    if (shareToken) return;
    setIsGeneratingShare(true);
    try {
      const { data } = await api.post<{ token: string }>('/share-tokens');
      setShareToken(data.token);
    } catch {
      toast.error('공유 링크 생성 중 오류가 발생했습니다');
    } finally {
      setIsGeneratingShare(false);
    }
  };

  const shareUrl = shareToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/share/${shareToken}`
    : '';

  const copyShareUrl = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      toast.success('링크가 복사되었습니다');
    }
  };

  return (
    <>
      <style>{`
        .hide-mobile { display: none; }
        @media (min-width: 640px) { .hide-mobile { display: inline; } }
      `}</style>
      <div className="flex flex-col h-screen" style={{ background: 'var(--skema-surface)' }}>

        {/* Notification Banner */}
        {notification && (
          <div
            style={{
              position: 'fixed', top: 64, right: 16, zIndex: 200,
              background: '#fff', border: '1px solid rgba(195,198,213,0.25)',
              borderLeft: '4px solid var(--skema-primary)',
              borderRadius: 14, padding: '12px 16px',
              boxShadow: '0 8px 32px rgba(24,28,30,0.12)',
              maxWidth: 300, display: 'flex', gap: 10, alignItems: 'flex-start',
              cursor: 'pointer',
            }}
            onClick={() => { openClassForm(notification); setNotification(null); }}
          >
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#dae1ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <MaterialIcon icon="notifications_active" size={18} color="var(--skema-primary)" filled />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#181c1e' }}>곧 시작! (클릭하면 일정 확인)</div>
              <div style={{ fontSize: 12, color: '#434653', marginTop: 2 }}>{notification.title} — {notification.start_time}</div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setNotification(null); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#747684', fontSize: 16, padding: 0, lineHeight: 1 }}
            >×</button>
          </div>
        )}

        {/* Header */}
        <header style={{
          height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 20px', borderBottom: '1px solid var(--skema-container)',
          background: '#fff', position: 'sticky', top: 0, zIndex: 30, flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: 'var(--skema-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MaterialIcon icon="schedule" size={15} color="#fff" filled />
            </div>
            <span className="skema-headline" style={{ fontWeight: 800, fontSize: '18px', color: 'var(--skema-on-surface)' }}>SKEMA</span>
            {todayPct !== null && (
              <span style={{
                padding: '2px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 700,
                background: todayPct >= 80 ? '#d1fae5' : todayPct >= 40 ? '#fef9c3' : 'var(--skema-surface-low)',
                color: todayPct >= 80 ? '#059669' : todayPct >= 40 ? '#d97706' : 'var(--skema-on-surface-variant)',
              }}>
                오늘 {todayPct}% ({todayDone}/{todayTotal})
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button onClick={() => openClassForm()} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--skema-primary)', color: '#fff', border: 'none', borderRadius: '10px', padding: '7px 14px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              <MaterialIcon icon="add" size={16} color="#fff" />
              수업 추가
            </button>

            <button
              onClick={handleShare}
              title="공유"
              style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'var(--skema-surface-low)', border: 'none', borderRadius: '10px', padding: '7px 12px', fontSize: '13px', fontWeight: 600, color: 'var(--skema-on-surface-variant)', cursor: 'pointer' }}
            >
              <MaterialIcon icon="share" size={16} color="var(--skema-on-surface-variant)" />
              <span className="hide-mobile">공유</span>
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-full transition-all outline-none">
                <Avatar className="w-8 h-8">
                  <AvatarFallback className="text-xs font-bold" style={{ background: 'var(--skema-secondary-container)', color: 'var(--skema-primary)' }}>
                    {user?.email?.[0]?.toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <p className="font-semibold">{user?.email}</p>
                    <p className="text-xs text-gray-500 font-normal">{user?.email}</p>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => setIsSettingsOpen(true)}>
                    설정
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
                    로그아웃
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* ── 오늘 할 일 사이드바 ── */}
          <div className="w-60 flex-shrink-0 overflow-y-auto border-r p-3 flex flex-col gap-3 min-h-0" style={{ background: '#fff' }}>

            {/* 동기부여 카드 */}
            <div className="rounded-xl p-3" style={{ background: 'var(--skema-primary)' }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <MaterialIcon icon="auto_awesome" size={14} color="#c3d0ff" filled />
                <span style={{ fontSize: 10, fontWeight: 700, color: '#c3d0ff', letterSpacing: '1px' }}>AI 인사이트</span>
              </div>
              <p style={{ fontSize: 12, color: '#fff', lineHeight: 1.6 }}>
                {DAILY_QUOTES[profile?.user_type as keyof typeof DAILY_QUOTES] ?? DAILY_QUOTES.default}
              </p>
            </div>

            {/* 수행률 — 오늘 / 이번 주 */}
            <div className="rounded-xl p-3" style={{ background: 'var(--skema-surface-low)' }}>
              <div style={{ display: 'flex', gap: 10 }}>

                {/* 오늘 */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#747684' }}>오늘</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: todayPct === null ? '#9ca3af' : todayPct >= 80 ? '#10b981' : todayPct >= 40 ? '#f59e0b' : 'var(--skema-primary)' }}>
                      {todayPct !== null ? `${todayPct}%` : '-'}
                    </span>
                  </div>
                  <div style={{ height: 5, borderRadius: 99, background: '#ebeef1', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${todayPct ?? 0}%`, borderRadius: 99, transition: 'width 0.5s', background: todayPct !== null && todayPct >= 80 ? '#10b981' : todayPct !== null && todayPct >= 40 ? '#f59e0b' : 'var(--skema-primary)' }} />
                  </div>
                  <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>{todayDone}/{todayTotal}개</p>
                </div>

                <div style={{ width: 1, background: '#e5e7eb' }} />

                {/* 이번 주 */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#747684' }}>이번 주</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: weekPct === null ? '#9ca3af' : weekPct >= 80 ? '#10b981' : weekPct >= 40 ? '#f59e0b' : 'var(--skema-primary)' }}>
                      {weekPct !== null ? `${weekPct}%` : '-'}
                    </span>
                  </div>
                  <div style={{ height: 5, borderRadius: 99, background: '#ebeef1', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${weekPct ?? 0}%`, borderRadius: 99, transition: 'width 0.5s', background: weekPct !== null && weekPct >= 80 ? '#10b981' : weekPct !== null && weekPct >= 40 ? '#f59e0b' : 'var(--skema-primary)' }} />
                  </div>
                  <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>{weekDone}/{weekTotal}개</p>
                </div>

              </div>
            </div>

            {/* 충돌 경고 배너 */}
            {conflicts.length > 0 && (
              <div
                style={{
                  padding: '8px 10px', borderRadius: 10,
                  background: '#fff7ed', border: '1px solid #fed7aa',
                  display: 'flex', alignItems: 'flex-start', gap: 6,
                }}
              >
                <MaterialIcon icon="warning" size={13} color="#f59e0b" filled />
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#92400e' }}>
                    시간 충돌 {conflicts.length}건
                  </p>
                  {conflicts.slice(0, 2).map((c, i) => (
                    <p key={i} style={{ fontSize: 10, color: '#92400e', marginTop: 1, lineHeight: 1.4 }}>
                      {c.schedule_a.title} ↔ {c.schedule_b.title}
                      <br />
                      <span style={{ opacity: 0.7 }}>{c.day_label}</span>
                    </p>
                  ))}
                  {conflicts.length > 2 && (
                    <p style={{ fontSize: 10, color: '#92400e', marginTop: 1 }}>외 {conflicts.length - 2}건...</p>
                  )}
                </div>
              </div>
            )}

            {/* 오늘 할 일 */}
            <div className="flex-1">
              <div className="flex items-center gap-1.5 mb-2">
                <MaterialIcon icon="today" size={14} color="var(--skema-primary)" filled />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#181c1e' }}>오늘 할 일</span>
              </div>
              {todaySchedules.length === 0 ? (
                <div className="text-center py-4">
                  <MaterialIcon icon="check_circle" size={24} color="#10b981" filled />
                  <p style={{ fontSize: 11, color: '#747684', marginTop: 4 }}>오늘 일정이 없습니다</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {todaySchedules.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors"
                      style={{ background: s.is_completed ? '#f0fdf4' : '#f7fafd' }}
                      onClick={() => handleToggleComplete(s)}
                    >
                      <div style={{
                        width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 1,
                        background: s.is_completed ? '#10b981' : '#fff',
                        border: `2px solid ${s.is_completed ? '#10b981' : '#d1d5db'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {s.is_completed && <MaterialIcon icon="check" size={10} color="#fff" />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontSize: 12, fontWeight: 600, color: s.is_completed ? '#6b7280' : '#181c1e',
                          textDecoration: s.is_completed ? 'line-through' : 'none',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{s.title}</p>
                        <p style={{ fontSize: 10, color: '#747684' }}>{s.start_time} – {s.end_time}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 미달성 제안 */}
              {unachievedSchedules.length > 0 && (
                <div className="mt-3 p-2.5 rounded-xl" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
                  <div className="flex items-center gap-1 mb-1">
                    <MaterialIcon icon="warning" size={13} color="#f59e0b" filled />
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#92400e' }}>미완료 일정 {unachievedSchedules.length}개</span>
                  </div>
                  <p style={{ fontSize: 10, color: '#92400e', lineHeight: 1.5 }}>AI에게 재배치를 요청해보세요</p>
                  <button
                    onClick={handleReschedule}
                    disabled={isRegenerating}
                    className="mt-1.5 w-full py-1 rounded-lg text-xs font-bold transition-colors"
                    style={{ background: '#f59e0b', color: '#fff', border: 'none', cursor: 'pointer' }}
                  >
                    자동 재배치
                  </button>
                </div>
              )}
            </div>

            {/* 빠른 일정 추가 */}
            <button
              onClick={() => openClassForm()}
              className="w-full py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-colors"
              style={{ background: '#eef1ff', color: 'var(--skema-primary)', border: 'none', cursor: 'pointer' }}
            >
              <MaterialIcon icon="add" size={14} color="var(--skema-primary)" />
              일정 추가
            </button>
          </div>

          {/* ── 메인 콘텐츠 ── */}
          <div className="flex-1 overflow-auto p-4 min-h-0">
            <Tabs defaultValue="timetable">
              <TabsList className="mb-4">
                <TabsTrigger value="timetable">시간표</TabsTrigger>
                <TabsTrigger value="exams">시험 일정</TabsTrigger>
                <TabsTrigger value="report">주간 리포트</TabsTrigger>
                <TabsTrigger value="type-analysis">유형별 분석</TabsTrigger>
              </TabsList>
              <TabsContent value="timetable">
                {/* 주간 네비게이션 + 유형 필터 */}
                <div className="flex flex-col gap-2 mb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setWeekOffset((o) => o - 1)}
                        style={{ display: 'flex', alignItems: 'center', background: 'var(--skema-surface-low)', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', color: 'var(--skema-on-surface-variant)' }}
                      >
                        <MaterialIcon icon="chevron_left" size={16} color="var(--skema-on-surface-variant)" />
                      </button>
                      <button
                        onClick={() => setWeekOffset(0)}
                        style={{ fontSize: '12px', fontWeight: 600, padding: '6px 10px', background: weekOffset === 0 ? 'var(--skema-primary)' : 'var(--skema-surface-low)', color: weekOffset === 0 ? '#fff' : 'var(--skema-on-surface-variant)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
                      >
                        이번 주
                      </button>
                      <button
                        onClick={() => setWeekOffset((o) => o + 1)}
                        style={{ display: 'flex', alignItems: 'center', background: 'var(--skema-surface-low)', border: 'none', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer', color: 'var(--skema-on-surface-variant)' }}
                      >
                        <MaterialIcon icon="chevron_right" size={16} color="var(--skema-on-surface-variant)" />
                      </button>
                    </div>
                    {/* 전체 토글 */}
                    <button
                      onClick={() => setActiveTypes(activeTypes.size === ALL_TYPES.length ? new Set() : new Set(ALL_TYPES))}
                      style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 8, border: '1px solid var(--skema-container)', background: 'var(--skema-surface-low)', color: 'var(--skema-on-surface-variant)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      {activeTypes.size === ALL_TYPES.length ? '전체 해제' : '전체 선택'}
                    </button>
                  </div>
                  {/* 유형 필터 칩 */}
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { type: 'class',      label: '수업',     color: '#4F46E5' },
                        { type: 'study',      label: '자율학습', color: '#10b981' },
                        { type: 'assignment', label: '과제',     color: '#F97316' },
                        { type: 'activity',   label: '활동',     color: '#A855F7' },
                        { type: 'personal',   label: '개인',     color: '#E11D48' },
                      ] as { type: ScheduleTypeFilter; label: string; color: string }[]
                    ).map(({ type, label, color }) => {
                      const active = activeTypes.has(type);
                      const weekEnd = weekStart.getTime() + 7 * 24 * 3600 * 1000;
                      const cnt = schedules.filter(s => {
                        if (s.schedule_type !== type) return false;
                        if (!s.date) return true;
                        const [y, mo, d] = s.date.split('-').map(Number);
                        const t = new Date(y, mo - 1, d).getTime();
                        return t >= weekStart.getTime() && t < weekEnd;
                      }).length;
                      return (
                        <button
                          key={type}
                          onClick={() => toggleType(type)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                            cursor: 'pointer', transition: 'all 0.15s',
                            border: `1.5px solid ${active ? color : 'var(--skema-container)'}`,
                            background: active ? `${color}18` : 'var(--skema-surface-low)',
                            color: active ? color : 'var(--skema-on-surface-variant)',
                          }}
                        >
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: active ? color : 'var(--skema-container)', flexShrink: 0 }} />
                          {label}
                          {cnt > 0 && (
                            <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.75 }}>{cnt}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Timetable schedules={filteredSchedules} exams={exams} weekStart={weekStart} />
              </TabsContent>
              <TabsContent value="exams">
                <ExamList />
              </TabsContent>
              <TabsContent value="report">
                <WeeklyReport schedules={schedules} />
              </TabsContent>
              <TabsContent value="type-analysis">
                <TypeAnalysis schedules={schedules} weekStart={weekStart} />
              </TabsContent>
            </Tabs>
          </div>

          {/* ── 스마트 알림 우측 사이드바 ── */}
          <div
            className="flex-shrink-0 overflow-y-auto border-l p-3 min-h-0 hidden xl:flex xl:flex-col"
            style={{ width: 320, background: '#fff' }}
          >
            <SmartAlertPanel exams={exams} schedules={schedules} currentWeekStart={weekStart} />
          </div>

        </div>

        <ClassForm />
        <SettingsModal open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

        {/* Share Modal */}
        <Dialog open={isShareModalOpen} onOpenChange={(open) => !open && closeShareModal()}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>시간표 공유</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              {isGeneratingShare ? (
                <div className="flex items-center justify-center py-4">
                  <div className="w-6 h-6 border-4 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--skema-secondary-container)', borderTopColor: 'transparent' }} />
                </div>
              ) : shareUrl ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    아래 링크를 공유하면 누구나 내 시간표를 볼 수 있습니다.
                  </p>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={shareUrl}
                      className="flex-1 px-3 py-2 text-xs border rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                    />
                    <Button size="sm" onClick={copyShareUrl} className="flex-shrink-0" style={{ background: 'var(--skema-primary)', color: '#fff' }}>
                      복사
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-red-500">공유 링크를 생성할 수 없습니다.</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeShareModal}>닫기</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
