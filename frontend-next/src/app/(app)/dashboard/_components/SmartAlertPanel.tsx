'use client';

import MaterialIcon from '@/components/common/MaterialIcon';
import type { ExamSchedule, Schedule } from '@/types';
import { ExamReadinessPanel } from './ExamReadinessPanel';
import { KakaoNotifyButton } from './KakaoNotifyButton';

export function SmartAlertPanel({ exams, schedules }: {
  exams: ExamSchedule[];
  schedules: Schedule[];
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
      <KakaoNotifyButton />
    </div>
  );
}
