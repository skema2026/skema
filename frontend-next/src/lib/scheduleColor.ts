/**
 * scheduleColor.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * 결정론적 색상 시스템 (deterministic color system)
 *
 * 원칙:
 *   1. 같은 제목 = 항상 같은 색 (유형과 무관)
 *   2. Math.random / index 순환 완전 금지
 *   3. 18가지 다양한 색상으로 전체 색상환 커버
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

// ── 색상 key 생성 ─────────────────────────────────────────────────────────────

export function getScheduleColorKey(schedule: Schedule): string {
  const { schedule_type, schedule_source, linked_exam_id, title, original_generated_title } = schedule;

  // AI가 시험을 위해 생성한 학습 세션: 같은 시험 = 같은 색
  if (schedule_type === 'study' && schedule_source === 'ai_generated' && linked_exam_id) {
    return `exam:${linked_exam_id}`;
  }

  // 이모지 등 앞부분 기호 제거 후 제목 기반 key
  const base = (original_generated_title || title).replace(/^[^\w가-힣a-zA-Z]+/, '').trim();
  return base || title;
}

// ── 렌더링용 색상 계산 ─────────────────────────────────────────────────────────

/**
 * 일정의 표시 색상을 반환한다.
 * - AI 시험 학습 블록: exam key → DIVERSE_PALETTE (같은 시험 = 같은 색)
 * - 사용자가 직접 설정한 색상: 그대로 존중
 * - 나머지: 제목 hash → DIVERSE_PALETTE (유형 무관, 제목이 같으면 색이 같음)
 */
export function getScheduleColor(schedule: Schedule): string {
  const { schedule_source, linked_exam_id, schedule_type, color } = schedule;

  // AI 시험 학습 블록 → exam key 기반
  if (schedule_type === 'study' && schedule_source === 'ai_generated' && linked_exam_id) {
    return hashToPalette(`exam:${linked_exam_id}`, DIVERSE_PALETTE);
  }

  // 사용자가 직접 설정한 색상 (기본값 #6366F1 제외)
  if (color && color !== '#6366F1') return color;

  // 제목 기반 해시
  return hashToPalette(getScheduleColorKey(schedule), DIVERSE_PALETTE);
}

/**
 * ClassForm에서 새 일정 생성 시 자동 색상 계산.
 */
export function getAutoColor(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return DIVERSE_PALETTE[0];
  return hashToPalette(trimmed, DIVERSE_PALETTE);
}

/**
 * 표시 중인 일정 목록에서 고유 colorKey마다 충돌 없이 색상을 배정한다.
 * - 정렬된 key 순서로 인덱스를 매겨 같은 제목이면 항상 같은 색, 다른 제목은 다른 색.
 * - DIVERSE_PALETTE(36개) 초과 시 hsl 골든앵글로 추가 생성.
 */
export function buildTitleColorMap(schedules: Schedule[]): Map<string, string> {
  const keys = new Set<string>();
  for (const s of schedules) keys.add(getScheduleColorKey(s));

  const sorted = Array.from(keys).sort();
  const palette = DIVERSE_PALETTE as readonly string[];
  const map = new Map<string, string>();

  sorted.forEach((key, idx) => {
    if (idx < palette.length) {
      map.set(key, palette[idx]);
    } else {
      // 골든각도(137.5°) 기반 추가 색상
      const hue = Math.round((idx * 137.508) % 360);
      const sat = 65 + (idx % 3) * 7;
      const lig = 42 + (idx % 2) * 8;
      map.set(key, `hsl(${hue},${sat}%,${lig}%)`);
    }
  });

  return map;
}
