/**
 * scheduleColor.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * 결정론적 색상 시스템 (deterministic color system)
 *
 * 원칙:
 *   1. 같은 과목/같은 시험 = 항상 같은 색
 *   2. Math.random / index 순환 완전 금지
 *   3. 일정 유형별 색상 톤 분리 (수업/학습/이벤트)
 *   4. AI 학습 일정은 linked_exam_id 기준 — 같은 시험 = 같은 색
 */

import type { Schedule } from '@/types';

// ── 유형별 색상 팔레트 ─────────────────────────────────────────────────────────
//
// class  → 차분한 cool tones (indigo / blue / teal)
// study  → 선명한 green / teal tones  (학습·성장 느낌)
// event  → warm / vibrant tones       (개인 일정)
//
// 각 팔레트 6개 × 3 = 전체 18색

const CLASS_PALETTE = [
  '#4F46E5', // Indigo
  '#0284C7', // Sky
  '#0891B2', // Cyan
  '#7C3AED', // Violet
  '#0E7490', // Teal
  '#0F766E', // Dark Teal
] as const;

const STUDY_PALETTE = [
  '#059669', // Emerald
  '#10B981', // Green
  '#14B8A6', // Teal-green
  '#06B6D4', // Cyan-blue
  '#22C55E', // Lime Green
  '#65A30D', // Dark Lime
] as const;

const EVENT_PALETTE = [
  '#F59E0B', // Amber
  '#F97316', // Orange
  '#A855F7', // Purple
  '#E11D48', // Rose
  '#DB2777', // Pink
  '#D97706', // Dark Amber
] as const;

/** ClassForm 색상 선택 UI에 표시할 전체 팔레트 (class + study + event 순서) */
export const ALL_SCHEDULE_COLORS: string[] = [
  ...CLASS_PALETTE,
  ...STUDY_PALETTE,
  ...EVENT_PALETTE,
];

// ── 해시 함수 (djb2 variant) ───────────────────────────────────────────────────

function djb2Hash(key: string): number {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash) ^ key.charCodeAt(i);
    hash = hash >>> 0; // unsigned 32-bit
  }
  return hash;
}

function hashToPalette(key: string, palette: readonly string[]): string {
  if (!key || palette.length === 0) return palette[0] ?? '#4F46E5';
  return palette[djb2Hash(key) % palette.length];
}

// ── 색상 key 생성 ─────────────────────────────────────────────────────────────

/**
 * 일정의 '의미 있는' color key를 반환한다.
 *
 * 우선순위:
 *   - class              → title (과목명)
 *   - study + ai + exam  → `exam:${linked_exam_id}`  ← 같은 시험 = 같은 색
 *   - study (기타)       → original_generated_title || cleaned title
 *   - event              → title
 */
export function getScheduleColorKey(schedule: Schedule): string {
  const { schedule_type, schedule_source, linked_exam_id, title, original_generated_title } = schedule;

  if (schedule_type === 'class') {
    return title;
  }

  if (schedule_type === 'study') {
    // AI가 시험을 위해 생성한 학습 세션: 시험 ID를 key로 → 모든 세션 같은 색
    if (schedule_source === 'ai_generated' && linked_exam_id) {
      return `exam:${linked_exam_id}`;
    }
    // 그 외 학습 일정: 이모지 제거 후 기본 제목
    const base = (original_generated_title || title).replace(/^📚\s*/, '').trim();
    return base || title;
  }

  // event / other
  return title;
}

// ── 렌더링용 색상 계산 ─────────────────────────────────────────────────────────

/**
 * 일정의 표시 색상을 반환한다.
 *
 * - class                   : 항상 재계산 (과목명 hash → CLASS_PALETTE)
 * - study + ai_generated     : 항상 재계산 (exam key hash → STUDY_PALETTE)
 * - study + user_created     : 저장된 색상 우선, 없으면 STUDY_PALETTE hash
 * - event                   : 저장된 색상 우선 (사용자 선택 존중), 없으면 EVENT_PALETTE hash
 *
 * 저장된 색상 '#6366F1'은 미설정 기본값이므로 재계산 대상으로 처리한다.
 */
export function getScheduleColor(schedule: Schedule): string {
  const { schedule_type, schedule_source, color } = schedule;
  const key = getScheduleColorKey(schedule);

  if (schedule_type === 'class') {
    // 과목명 hash → cool tone — 같은 과목 항상 같은 색
    return hashToPalette(key, CLASS_PALETTE);
  }

  if (schedule_type === 'study') {
    if (schedule_source === 'ai_generated') {
      // AI 생성 학습: linked_exam_id 기준 → 같은 시험 준비 일정 = 같은 색
      return hashToPalette(key, STUDY_PALETTE);
    }
    // 사용자 생성 학습: 저장된 색상 우선
    if (color && color !== '#6366F1') return color;
    return hashToPalette(key, STUDY_PALETTE);
  }

  // event / personal: 사용자가 선택한 색상 존중
  if (color && color !== '#6366F1') return color;
  return hashToPalette(key, EVENT_PALETTE);
}

/**
 * ClassForm에서 새 일정 생성 시 자동 색상 계산.
 * 일정 유형별로 적절한 sub-palette에서 title hash 기반 결정.
 */
export function getAutoColor(title: string, scheduleType: Schedule['schedule_type']): string {
  const trimmed = title.trim();
  if (!trimmed) return ALL_SCHEDULE_COLORS[0];

  const palette =
    scheduleType === 'class' ? CLASS_PALETTE :
    scheduleType === 'study' ? STUDY_PALETTE :
    EVENT_PALETTE;

  return hashToPalette(trimmed, palette);
}
