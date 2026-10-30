import type { ExamSchedule, Schedule } from '@/types';

/**
 * 시험 준비도
 *
 * 준비도 = 그 시험에 연결된(linked_exam_id) 공부 블록 중 완료한 블록의 비율.
 * 1학기 ExamReadinessPanel(74c28d0 에서 삭제)의 계산식과 경고 기준을 그대로 쓴다.
 *   - D-3 이하이고 50% 미만 → danger (빨강)
 *   - D-7 이하이고 70% 미만 → warn   (주황)
 *   - 그 외                → ok     (초록)
 *   - 연결된 블록이 없으면   → none   (준비도 표시 안 함)
 */
export type ReadinessLevel = 'danger' | 'warn' | 'ok' | 'none';

export type ExamReadiness = {
  total: number;
  completed: number;
  remaining: number;
  pct: number;
  level: ReadinessLevel;
};

export function getExamReadiness(
  exam: Pick<ExamSchedule, 'id'>,
  schedules: Pick<Schedule, 'linked_exam_id' | 'is_completed'>[],
  daysLeft: number,
): ExamReadiness {
  const linked = schedules.filter((s) => s.linked_exam_id === exam.id);
  const total = linked.length;
  const completed = linked.filter((s) => s.is_completed).length;
  const remaining = total - completed;

  if (total === 0) {
    return { total, completed, remaining, pct: 0, level: 'none' };
  }

  const pct = Math.round((completed / total) * 100);
  const level: ReadinessLevel =
    daysLeft <= 3 && pct < 50 ? 'danger' : daysLeft <= 7 && pct < 70 ? 'warn' : 'ok';

  return { total, completed, remaining, pct, level };
}
