import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'];
export const DAY_NAMES_FULL = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];

export const SCHEDULE_COLORS = [
  '#4F46E5', // Indigo
  '#0891B2', // Cyan
  '#059669', // Emerald
  '#D97706', // Amber
  '#DC2626', // Red
  '#7C3AED', // Violet
  '#DB2777', // Pink
  '#0284C7', // Sky
  '#16A34A', // Green
  '#EA580C', // Orange
  '#9333EA', // Purple
  '#0E7490', // Teal
  '#B45309', // Warm Brown
  '#0F766E', // Dark Teal
  '#C026D3', // Fuchsia
];

/**
 * 과목명/제목 기반 결정론적 색상 반환 (같은 이름 = 항상 같은 색)
 * djb2-style hash → 12개 단순 합산보다 충돌 훨씬 적음
 */
export function getSubjectColor(title: string): string {
  if (!title) return SCHEDULE_COLORS[0];
  let hash = 5381;
  for (let i = 0; i < title.length; i++) {
    hash = ((hash << 5) + hash) ^ title.charCodeAt(i);
    hash = hash >>> 0; // unsigned 32-bit
  }
  return SCHEDULE_COLORS[hash % SCHEDULE_COLORS.length];
}

export const PRIORITY_LABELS = {
  0: '보통',
  1: '높음',
  2: '긴급',
} as const;

export const SCHEDULE_TYPE_LABELS = {
  class: '수업',
  event: '이벤트',
  study: '자율학습',
} as const;

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDate(dateStr: string): string {
  // "2026-04-15" 형식 직접 파싱 → 타임존 오프셋으로 인한 날짜 오차 방지
  const [year, month, day] = dateStr.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}
