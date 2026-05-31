/**
 * scheduleColor.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * 결정론적 색상 시스템 (deterministic color system)
 *
 * 원칙:
 *   1. 같은 제목 = 항상 같은 색 (유형과 무관)
 *   2. Math.random / index 순환 완전 금지
 *   3. 40가지 다양한 색상으로 전체 색상환 커버
 *   4. AI 학습 일정은 linked_exam_id 기준 — 같은 시험 = 같은 색
 */

import type { Schedule } from '@/types';

// ── 다양한 색상 팔레트 (전체 색상환) ──────────────────────────────────────────

// 빨간색 계열은 시험 블록 전용 — 일반 일정 자동 색상에서 제외
// Tailwind 600–700 단계 기반 — 흰 텍스트와 대비 확보 + 선명하고 예쁜 색
const DIVERSE_PALETTE = [
  // 🟠 Warm
  '#F97316', // orange-500  — 비비드 오렌지
  '#EA580C', // orange-600  — 딥 오렌지
  '#D97706', // amber-600   — 황금 호박
  '#B45309', // amber-700   — 짙은 황금

  // 🟢 Green
  '#65A30D', // lime-600    — 라임
  '#16A34A', // green-600   — 클래식 그린
  '#059669', // emerald-600 — 에메랄드
  '#0D9488', // teal-600    — 틸

  // 🔵 Blue
  '#0891B2', // cyan-600    — 사이언
  '#0284C7', // sky-600     — 스카이 블루
  '#2563EB', // blue-600    — 로열 블루
  '#1D4ED8', // blue-700    — 딥 블루

  // 🟣 Purple
  '#4F46E5', // indigo-600  — 인디고
  '#7C3AED', // violet-600  — 바이올렛
  '#9333EA', // purple-600  — 퍼플
  '#7E22CE', // purple-700  — 딥 퍼플

  // 🩷 Pink
  '#C026D3', // fuchsia-600 — 퓨시아
  '#DB2777', // pink-600    — 핫 핑크
  '#BE185D', // pink-700    — 딥 핑크
  '#9D174D', // pink-800    — 로즈 핑크

  // 🌊 Extended
  '#0F766E', // teal-700    — 딥 틸
  '#0369A1', // sky-700     — 스틸 블루
  '#4338CA', // indigo-700  — 딥 인디고
  '#6D28D9', // violet-700  — 딥 바이올렛

  // 🎨 Manual palette extension
  '#CA8A04', // yellow-600   — 머스터드
  '#A16207', // yellow-700   — 딥 머스터드
  '#4D7C0F', // lime-700     — 올리브 라임
  '#15803D', // green-700    — 딥 그린
  '#047857', // emerald-700  — 딥 에메랄드
  '#115E59', // teal-800     — 네이비 틸
  '#155E75', // cyan-800     — 네이비 사이언
  '#075985', // sky-800      — 네이비 스카이
  '#1E40AF', // blue-800     — 네이비 블루
  '#3730A3', // indigo-800   — 네이비 인디고
  '#5B21B6', // violet-800   — 네이비 바이올렛
  '#6B21A8', // purple-800   — 네이비 퍼플
  '#86198F', // fuchsia-800  — 딥 퓨시아
  '#A21CAF', // fuchsia-700  — 바이브런트 퓨시아
  '#BE123C', // rose-700     — 로즈
  '#9F1239', // rose-800     — 딥 로즈
] as const;

/** ClassForm 색상 선택 UI에 표시할 전체 팔레트 */
export const ALL_SCHEDULE_COLORS: string[] = [...DIVERSE_PALETTE];

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

// ── 유형별 고정색 ─────────────────────────────────────────────────────────────

export const SCHEDULE_TYPE_COLORS: Record<string, string> = {
  class:      '#3b82f6',
  study:      '#059669',
  assignment: '#f59e0b',
  activity:   '#ec4899',
  personal:   '#ec4899',
  event:      '#f97316',
};

// ── 렌더링용 색상 계산 ─────────────────────────────────────────────────────────

/**
 * ETA(OCR) 시간표 → 유형별 고정색 (수업은 모두 파랑으로 통일)
 * AI 시험 학습 블록 → exam key 기반 색
 * 사용자가 직접 추가한 일정 → 사용자가 선택한 색
 */
export function getDisplayColor(schedule: Schedule): string {
  const { schedule_source, linked_exam_id, schedule_type, color } = schedule;

  if (schedule_source === 'eta_import') {
    return SCHEDULE_TYPE_COLORS[schedule_type] ?? '#3b82f6';
  }
  if (schedule_type === 'study' && schedule_source === 'ai_generated' && linked_exam_id) {
    return hashToPalette(`exam:${linked_exam_id}`, DIVERSE_PALETTE);
  }
  return color || '#6366f1';
}

/**
 * ClassForm에서 새 일정 생성 시 자동 색상 계산.
 */
export function getAutoColor(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return DIVERSE_PALETTE[0];
  return hashToPalette(trimmed, DIVERSE_PALETTE);
}

