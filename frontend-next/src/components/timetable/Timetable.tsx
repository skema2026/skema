'use client';

/**
 * Timetable — custom CSS grid, up to 7 columns (Mon–Sun).
 *
 * Rendering rules (deterministic, no legacy hacks):
 *   left   = colIndex × colWidth         (weekday column ONLY)
 *   top    = (startSlot) × SLOT_H        (time ONLY)
 *   height = durationSlots × SLOT_H − 1
 *
 * Drag-and-drop:
 *   - Pointer events (pointerdown / pointermove / pointerup) on document.
 *   - Vertical snap: nearest 30-min slot  → Math.round(relY / SLOT_H)
 *   - Horizontal snap: nearest column     → Math.floor(relX / colWidth)
 *   - Duration is preserved across the whole drag.
 *   - Ghost block shows the snapped target position; original block fades.
 *   - On drop: PATCH /schedules/{id} with new day_of_week + start_time + end_time.
 *   - Date-based schedules (s.date ≠ null): horizontal movement locked.
 *
 * Timezone fix:
 *   new Date("2026-04-07") → UTC midnight → wrong .getDay() in UTC+9.
 *   dateStringToDow() parses components as local time.
 */

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import type { Schedule, ExamSchedule } from '@/types';
import { useUIStore } from '@/store/uiStore';
import { useUpdateSchedule } from '@/hooks/useSchedules';
import { getScheduleColor, buildTitleColorMap, getScheduleColorKey } from '@/lib/scheduleColor';
import { timeToMinutes, minutesToTime, dateStringToDow } from '@/lib/timetableParser';

// ── Grid constants ────────────────────────────────────────────────────────────

const ALL_DAYS = ['월', '화', '수', '목', '금', '토', '일'] as const;

const START_HOUR  = 0;
const END_HOUR    = 24;
const SLOT_H      = 24;   // px per 30-min slot
const GUTTER_W    = 44;   // time-label column width (px)
const MIN_BLOCK_H = 18;   // minimum rendered block height (px)
const DRAG_THRESHOLD = 5; // px — below this, treat as click not drag

const TOTAL_SLOTS = (END_HOUR - START_HOUR) * 2;
const GRID_H      = TOTAL_SLOTS * SLOT_H;

// ── Pure grid helpers ─────────────────────────────────────────────────────────

/** "HH:MM" → slot index measured from START_HOUR. "08:00" → 0, "08:30" → 1 */
function timeToSlot(time: string): number {
  const mins = timeToMinutes(time);
  if (mins < 0) return 0;
  return (mins - START_HOUR * 60) / 30;
}

/** Slot index → "HH:MM" */
function slotToTime(slot: number): string {
  return minutesToTime(START_HOUR * 60 + slot * 30);
}

/** Clamp a number to [lo, hi] */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Resolve effective day_of_week for a schedule.
 * For date-based schedules, compute from date string in LOCAL time.
 */
function effectiveDow(s: Schedule): number {
  if (s.date) return dateStringToDow(s.date);
  return s.day_of_week;
}

// ── Drag state types ──────────────────────────────────────────────────────────

interface DragState {
  schedule:      Schedule;
  durationSlots: number;   // preserved throughout
  grabPx:        number;   // px from block top where pointer landed
  initialDowIdx: number;   // column index at drag-start (for locked date schedules)
  isDateBased:   boolean;  // if true, horizontal movement is locked
  startClientX:  number;   // for "did the user actually move?" detection
  startClientY:  number;
  didMove:       boolean;  // set true once threshold exceeded
}

interface DragSnap {
  scheduleId: number;
  slot:       number;   // snapped start slot
  dowIdx:     number;   // snapped column index into visibleDays
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface BlockProps {
  schedule:     Schedule;
  isConflict:   boolean;
  readOnly:     boolean;
  isFaded:      boolean;   // true while this block is being dragged
  colorMap:     Map<string, string>;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>, s: Schedule, blockTopClientY: number) => void;
}

function EventBlock({ schedule: s, isConflict, readOnly, isFaded, colorMap, onPointerDown }: BlockProps) {
  const startSlot   = timeToSlot(s.start_time);
  const endSlot     = timeToSlot(s.end_time);
  const top         = startSlot * SLOT_H;
  const rawH        = (endSlot - startSlot) * SLOT_H - 1;
  const height      = Math.max(MIN_BLOCK_H, rawH);
  const durationMin = timeToMinutes(s.end_time) - timeToMinutes(s.start_time);
  const isCompact   = durationMin < 45;
  const color       = colorMap.get(getScheduleColorKey(s)) ?? getScheduleColor(s);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    onPointerDown(e, s, rect.top);
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      tabIndex={readOnly ? undefined : 0}
      style={{
        position:      'absolute',
        top,
        left:          2,
        right:         2,
        height,
        background:    `linear-gradient(160deg, ${color} 0%, ${color}CC 100%)`,
        borderRadius:  7,
        borderLeft:    `3px solid rgba(255,255,255,0.45)`,
        padding:       isCompact ? '1px 5px' : '4px 7px',
        overflow:      'hidden',
        cursor:        readOnly ? 'default' : isFaded ? 'grabbing' : 'grab',
        opacity:       isFaded ? 0.3 : s.is_completed ? 0.45 : 1,
        outline:       isConflict ? '2px solid #f87171' : 'none',
        outlineOffset: -2,
        userSelect:    'none',
        touchAction:   'none',
        zIndex:        isFaded ? 0 : 1,
        boxSizing:     'border-box',
        boxShadow:     isFaded ? 'none' : '0 1px 3px rgba(0,0,0,0.18)',
        transition:    isFaded ? 'none' : 'opacity 0.1s',
      }}
    >
      <div style={{
        fontSize:       isCompact ? 9 : 10,
        fontWeight:     700,
        color:          '#fff',
        overflow:       'hidden',
        textOverflow:   'ellipsis',
        whiteSpace:     'nowrap',
        textDecoration: s.is_completed ? 'line-through' : 'none',
        lineHeight:     1.3,
        textShadow:     '0 1px 2px rgba(0,0,0,0.15)',
      }}>
        {s.title}
      </div>
      {!isCompact && (
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.85)', marginTop: 1 }}>
          {s.start_time}–{s.end_time}
        </div>
      )}
      {!isCompact && s.location && (
        <div style={{
          fontSize:     9,
          color:        'rgba(255,255,255,0.75)',
          marginTop:    1,
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}>
          📍 {s.location}
        </div>
      )}
    </div>
  );
}

/** Ghost block — shown at the snapped drop target while dragging */
function GhostBlock({ schedule: s, slot, durationSlots, colorMap }: {
  schedule: Schedule;
  slot: number;
  durationSlots: number;
  colorMap: Map<string, string>;
}) {
  const top    = slot * SLOT_H;
  const height = Math.max(MIN_BLOCK_H, durationSlots * SLOT_H - 1);
  const color  = colorMap.get(getScheduleColorKey(s)) ?? getScheduleColor(s);
  const durationMin = durationSlots * 30;
  const isCompact   = durationMin < 45;

  return (
    <div
      style={{
        position:      'absolute',
        top,
        left:          2,
        right:         2,
        height,
        background:    color,
        borderRadius:  5,
        opacity:       0.75,
        border:        `2px dashed rgba(255,255,255,0.7)`,
        outline:       `2px solid ${color}`,
        outlineOffset: 1,
        boxSizing:     'border-box',
        pointerEvents: 'none',
        zIndex:        20,
        padding:       isCompact ? '1px 4px' : '3px 6px',
      }}
    >
      <div style={{
        fontSize:   isCompact ? 9 : 10,
        fontWeight: 700,
        color:      '#fff',
        overflow:   'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        lineHeight: 1.2,
      }}>
        {s.title}
      </div>
      {!isCompact && (
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.9)', marginTop: 1 }}>
          {slotToTime(slot)}–{slotToTime(slot + durationSlots)}
        </div>
      )}
    </div>
  );
}

// ── Week helpers ──────────────────────────────────────────────────────────────

/** Returns the Monday (00:00:00 local) of the week containing `ref` */
export function getWeekStart(ref: Date = new Date()): Date {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

/** True if dateStr (YYYY-MM-DD) falls within [weekStart, weekStart+6] (local) */
function isDateInWeek(dateStr: string, weekStart: Date): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(y, m - 1, d).getTime();
  const ws = weekStart.getTime();
  return t >= ws && t < ws + 7 * 24 * 3600 * 1000;
}

/** Local date string YYYY-MM-DD for a Date */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Public component ──────────────────────────────────────────────────────────

interface TimetableProps {
  schedules:  Schedule[];
  exams?:     ExamSchedule[];
  readOnly?:  boolean;
  weekStart?: Date;   // Monday of the displayed week (default: current week)
}

export function Timetable({ schedules, exams = [], readOnly = false, weekStart: weekStartProp }: TimetableProps) {
  const weekStart = weekStartProp ?? getWeekStart();
  const openClassForm = useUIStore((s) => s.openClassForm);
  const { mutate: updateSchedule } = useUpdateSchedule();

  // ── Drag state ──────────────────────────────────────────────────────────────
  // dragStateRef: stable data captured at drag-start (no stale closures in effect)
  // dragSnapRef:  latest snapped position (read inside effect handlers)
  // dragSnap:     drives re-renders for ghost + faded block
  const gridRef      = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const dragSnapRef  = useRef<DragSnap | null>(null);
  const [dragSnap, setDragSnapState] = useState<DragSnap | null>(null);
  const visibleDaysRef = useRef<number[]>([0, 1, 2, 3, 4, 5, 6]);

  // Stable refs for callbacks used inside the pointer-event effect
  const openClassFormRef = useRef(openClassForm);
  const updateScheduleRef = useRef(updateSchedule);
  useEffect(() => { openClassFormRef.current = openClassForm; }, [openClassForm]);
  useEffect(() => { updateScheduleRef.current = updateSchedule; }, [updateSchedule]);

  const updateDragSnap = useCallback((snap: DragSnap | null) => {
    dragSnapRef.current = snap;
    setDragSnapState(snap);
  }, []);

  // ── 1. Deduplicate by id ────────────────────────────────────────────────────
  const unique = useMemo<Schedule[]>(() => {
    const seen = new Set<number>();
    return schedules.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }, [schedules]);

  // ── 1b. Title-based color map (no hash collisions) ──────────────────────────
  const titleColorMap = useMemo(() => buildTitleColorMap(unique), [unique]);

  // ── 2. Conflict detection ───────────────────────────────────────────────────
  const conflictIds = useMemo<Set<number>>(() => {
    const ids = new Set<number>();
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i], b = unique[j];
        if (effectiveDow(a) !== effectiveDow(b)) continue;
        const aS = timeToMinutes(a.start_time), aE = timeToMinutes(a.end_time);
        const bS = timeToMinutes(b.start_time), bE = timeToMinutes(b.end_time);
        if (aS < bE && bS < aE) { ids.add(a.id); ids.add(b.id); }
      }
    }
    return ids;
  }, [unique]);

  // ── 3. Group by dow — date-based schedules filtered to current week ─────────
  const byDow = useMemo<Record<number, Schedule[]>>(() => {
    const g: Record<number, Schedule[]> = { 0:[], 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] };

    // 이번 주에 속한 dated 인스턴스의 (dow, title, start_time) 집합
    // → 같은 슬롯의 반복 일정이 중복 표시되지 않도록 우선 처리
    const datedSlots = new Set<string>();
    for (const s of unique) {
      if (s.date && isDateInWeek(s.date, weekStart)) {
        datedSlots.add(`${effectiveDow(s)}|${s.title}|${s.start_time}`);
      }
    }

    for (const s of unique) {
      if (s.date) {
        if (!isDateInWeek(s.date, weekStart)) continue;
      } else {
        // 반복 일정: 이번 주에 dated 완료 인스턴스가 있으면 렌더링 생략
        const dow = effectiveDow(s);
        if (datedSlots.has(`${dow}|${s.title}|${s.start_time}`)) continue;
      }
      const dow = effectiveDow(s);
      if (dow >= 0 && dow <= 6) g[dow].push(s);
    }
    return g;
  }, [unique, weekStart]);

  // ── 4. Group exams by dow — filtered to current week ───────────────────────
  const examByDow = useMemo<Record<number, ExamSchedule[]>>(() => {
    const g: Record<number, ExamSchedule[]> = { 0:[], 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] };
    for (const e of exams) {
      if (!isDateInWeek(e.exam_date, weekStart)) continue;
      const dow = dateStringToDow(e.exam_date);
      if (dow >= 0 && dow <= 6) g[dow].push(e);
    }
    return g;
  }, [exams, weekStart]);

  // ── 4b. Pre-exam days (day before an exam) in current week ─────────────────
  const preExamDows = useMemo<Set<number>>(() => {
    const s = new Set<number>();
    for (const e of exams) {
      const [y, m, d] = e.exam_date.split('-').map(Number);
      const preDate = new Date(y, m - 1, d - 1);
      const preStr = localDateStr(preDate);
      if (isDateInWeek(preStr, weekStart)) s.add(dateStringToDow(preStr));
    }
    return s;
  }, [exams, weekStart]);

  // ── 5. Always show all 7 days ───────────────────────────────────────────────
  const visibleDays = [0, 1, 2, 3, 4, 5, 6] as const;

  // Keep visibleDays ref in sync (read inside pointer event handlers)
  useEffect(() => { visibleDaysRef.current = [...visibleDays]; }, [visibleDays]);

  // Auto-scroll to 7:00 on mount so morning classes are visible
  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.scrollTop = 7 * 2 * SLOT_H;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 6. Drag start ───────────────────────────────────────────────────────────
  const handleBlockPointerDown = useCallback((
    e: React.PointerEvent<HTMLDivElement>,
    schedule: Schedule,
    blockTopClientY: number,
  ) => {
    if (readOnly) return;

    const vd = visibleDaysRef.current;
    const dow = effectiveDow(schedule);
    const initialDowIdx = clamp(vd.indexOf(dow), 0, vd.length - 1);

    dragStateRef.current = {
      schedule,
      durationSlots: timeToSlot(schedule.end_time) - timeToSlot(schedule.start_time),
      grabPx:        e.clientY - blockTopClientY,
      initialDowIdx,
      isDateBased:   !!schedule.date,
      startClientX:  e.clientX,
      startClientY:  e.clientY,
      didMove:       false,
    };

    updateDragSnap({
      scheduleId: schedule.id,
      slot:       timeToSlot(schedule.start_time),
      dowIdx:     initialDowIdx,
    });
  }, [readOnly, updateDragSnap]);

  // ── 7. Pointer move / up — attached to document while dragging ─────────────
  useEffect(() => {
    if (!dragSnap) return;  // not dragging

    const handleMove = (e: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || !gridRef.current) return;

      // Detect whether movement threshold was crossed
      const dx = Math.abs(e.clientX - drag.startClientX);
      const dy = Math.abs(e.clientY - drag.startClientY);
      if (dx + dy > DRAG_THRESHOLD) drag.didMove = true;

      const rect      = gridRef.current.getBoundingClientRect();
      const scrollTop = gridRef.current.scrollTop;
      const vd        = visibleDaysRef.current;
      const colWidth  = (rect.width - GUTTER_W) / vd.length;

      // ── Vertical snap ──────────────────────────────────────────────────────
      // gridTop in viewport coords = rect.top − scrollTop
      const gridTop = rect.top - scrollTop;
      const relY    = e.clientY - gridTop - drag.grabPx;
      const maxStart = TOTAL_SLOTS - drag.durationSlots;
      const snapSlot = clamp(Math.round(relY / SLOT_H), 0, maxStart);

      // ── Horizontal snap ────────────────────────────────────────────────────
      // Locked for date-based schedules (can't change the calendar date here)
      let snapDowIdx: number;
      if (drag.isDateBased) {
        snapDowIdx = drag.initialDowIdx;
      } else {
        const colsLeft = rect.left + GUTTER_W;
        const relX     = e.clientX - colsLeft;
        snapDowIdx = clamp(Math.floor(relX / colWidth), 0, vd.length - 1);
      }

      updateDragSnap({ scheduleId: drag.schedule.id, slot: snapSlot, dowIdx: snapDowIdx });
    };

    const handleUp = (_e: PointerEvent) => {
      const drag = dragStateRef.current;
      const snap = dragSnapRef.current;

      if (!drag) { cleanup(); return; }

      if (!drag.didMove) {
        // Treat as a regular click → open edit form
        openClassFormRef.current(drag.schedule);
      } else if (snap) {
        const vd      = visibleDaysRef.current;
        const newDow  = vd[snap.dowIdx];
        const newStart = slotToTime(snap.slot);
        const newEnd   = slotToTime(snap.slot + drag.durationSlots);

        const unchanged =
          newDow   === effectiveDow(drag.schedule) &&
          newStart === drag.schedule.start_time &&
          newEnd   === drag.schedule.end_time;

        if (!unchanged) {
          updateScheduleRef.current({
            id:           drag.schedule.id,
            day_of_week:  newDow,
            start_time:   newStart,
            end_time:     newEnd,
          });
          toast.success(
            `${drag.schedule.title} → ${ALL_DAYS[newDow]} ${newStart}–${newEnd}`,
            { duration: 2000 }
          );
        }
      }

      cleanup();
    };

    const cleanup = () => {
      dragStateRef.current = null;
      updateDragSnap(null);
    };

    document.addEventListener('pointermove', handleMove, { passive: true });
    document.addEventListener('pointerup',   handleUp);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup',   handleUp);
    };
  // Only re-attach when drag starts (dragSnap goes null→nonNull) or ends.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragSnap !== null, updateDragSnap]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{
      borderRadius: 14,
      border:       '1px solid #ebeef1',
      background:   '#fff',
      overflow:     'hidden',
      boxShadow:    '0 2px 8px rgba(24,28,30,0.06)',
      // Prevent text selection while dragging
      userSelect:   dragSnap ? 'none' : undefined,
    }}>

      {/* Conflict banner */}
      {conflictIds.size > 0 && (
        <div style={{
          display:      'flex',
          alignItems:   'center',
          gap:          8,
          padding:      '8px 16px',
          background:   '#fef2f2',
          borderBottom: '1px solid #fecaca',
          color:        '#b91c1c',
          fontSize:     12,
          fontWeight:   600,
        }}>
          ⚠️ 시간이 겹치는 일정이 {conflictIds.size}개 있습니다. 빨간 테두리로 표시된 일정을 확인하세요.
        </div>
      )}

      {/* ── Day header (weekday + date) ── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #ebeef1' }}>
        <div style={{ width: GUTTER_W, flexShrink: 0 }} />
        {visibleDays.map((dow) => {
          // Compute the calendar date for this column
          const colDate = new Date(weekStart);
          colDate.setDate(weekStart.getDate() + dow);
          const isToday   = localDateStr(colDate) === localDateStr(new Date());
          const hasExam   = (examByDow[dow] ?? []).length > 0;
          const isPreExam = preExamDows.has(dow);
          const dateLabel = `${colDate.getMonth() + 1}/${colDate.getDate()}`;

          const bg    = hasExam ? '#fef08a' : isPreExam ? '#fff1f2' : isToday ? '#eef1ff' : 'transparent';
          const color = hasExam ? '#78350f' : isPreExam ? '#DC2626' : dow >= 5 ? '#e11d48' : isToday ? '#1a4db2' : '#747684';
          const sub   = hasExam ? '#92400e' : isPreExam ? '#DC2626' : dow >= 5 ? '#e11d48' : isToday ? '#1a4db2' : '#aaa';

          return (
            <div key={`hdr-${dow}`} style={{
              flex:      1,
              textAlign: 'center',
              padding:   '5px 2px',
              background: bg,
              borderBottom: isPreExam && !hasExam ? '2px solid #fca5a5' : undefined,
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, color, lineHeight: 1.2 }}>
                {ALL_DAYS[dow]}
              </div>
              <div style={{ fontSize: 10, fontWeight: (hasExam || isToday || isPreExam) ? 700 : 400, color: sub, lineHeight: 1.2, marginTop: 1 }}>
                {dateLabel}
              </div>
              {hasExam && (
                <div style={{ fontSize: 8, fontWeight: 700, color: '#92400e', marginTop: 2, letterSpacing: 0.3 }}>
                  📝 시험
                </div>
              )}
              {isPreExam && !hasExam && (
                <div style={{ fontSize: 8, fontWeight: 700, color: '#DC2626', marginTop: 2, letterSpacing: 0.3 }}>
                  ⚠️ 시험 전날
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Scrollable grid body ── */}
      <div
        ref={gridRef}
        style={{
          display:        'flex',
          overflowY:      'auto',
          maxHeight:      640,
          scrollbarWidth: 'thin',
        }}
      >
        {/* Time gutter — :00 labels + :30 minor marks */}
        <div style={{
          width:     GUTTER_W,
          flexShrink: 0,
          position:  'relative',
          height:    GRID_H,
        }}>
          {Array.from({ length: TOTAL_SLOTS }, (_, i) => {
            const isHour = i % 2 === 0;
            return (
              <div key={`t-${i}`} style={{
                position:   'absolute',
                top:        i * SLOT_H - 6,
                right:      6,
                fontSize:   isHour ? 10 : 8,
                color:      isHour ? '#bbb' : '#ddd',
                lineHeight: 1,
                userSelect: 'none',
              }}>
                {isHour
                  ? String(START_HOUR + i / 2).padStart(2, '0')
                  : '30'}
              </div>
            );
          })}
        </div>

        {/* Weekday columns */}
        {visibleDays.map((dow, colIdx) => (
          <div
            key={`col-${dow}`}
            style={{
              flex:       1,
              position:   'relative',
              height:     GRID_H,
              borderLeft: '1px solid #f0f0f0',
              background: dow >= 5 ? 'rgba(225,29,72,0.02)' : 'transparent',
            }}
          >
            {/* Grid lines */}
            {Array.from({ length: TOTAL_SLOTS }, (_, i) => (
              <div key={`gl-${dow}-${i}`} style={{
                position:      'absolute',
                left:          0,
                right:         0,
                top:           i * SLOT_H,
                borderTop:     i % 2 === 0
                  ? '1px solid #e8eaed'
                  : '1px dashed #f3f4f6',
                pointerEvents: 'none',
              }} />
            ))}

            {/* Schedule blocks */}
            {(byDow[dow] ?? []).map((s) => (
              <EventBlock
                key={s.id}
                schedule={s}
                isConflict={conflictIds.has(s.id)}
                readOnly={readOnly}
                isFaded={dragSnap?.scheduleId === s.id}
                colorMap={titleColorMap}
                onPointerDown={handleBlockPointerDown}
              />
            ))}

            {/* Ghost block — renders in the snapped target column */}
            {dragSnap && dragSnap.dowIdx === colIdx && dragStateRef.current && (
              <GhostBlock
                schedule={dragStateRef.current.schedule}
                slot={dragSnap.slot}
                durationSlots={dragStateRef.current.durationSlots}
                colorMap={titleColorMap}
              />
            )}

            {/* Exam blocks (read-only, always on top) */}
            {(examByDow[dow] ?? []).map((e) => {
              // Exams without time: show as all-day banner at top of column
              if (!e.exam_time) {
                return (
                  <div key={`exam-${e.id}`} style={{
                    position:     'absolute',
                    top:          2,
                    left:         2,
                    right:        2,
                    height:       MIN_BLOCK_H,
                    background:   '#fbbf24',
                    borderRadius: 4,
                    padding:      '2px 4px',
                    overflow:     'hidden',
                    pointerEvents: 'none',
                    zIndex:        3,
                  }}>
                    <div style={{ fontSize: 8, fontWeight: 700, color: '#78350f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      📝 {e.title}
                    </div>
                  </div>
                );
              }
              const startMins = timeToMinutes(e.exam_time);
              if (startMins < 0) return null;
              const durationMins = (e as ExamSchedule & { exam_duration_minutes?: number }).exam_duration_minutes ?? 120;
              const endMins = startMins + durationMins;
              const top    = (startMins - START_HOUR * 60) / 30 * SLOT_H;
              const height = Math.max(MIN_BLOCK_H, (endMins - startMins) / 30 * SLOT_H - 1);
              return (
                <div
                  key={`exam-${e.id}`}
                  style={{
                    position:     'absolute',
                    top,
                    left:         2,
                    right:        2,
                    height,
                    background:   '#fbbf24',
                    borderRadius: 5,
                    padding:      '2px 5px',
                    overflow:     'hidden',
                    pointerEvents: 'none',
                    zIndex:        2,
                  }}
                >
                  <div style={{
                    fontSize:     9,
                    fontWeight:   700,
                    color:        '#78350f',
                    overflow:     'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace:   'nowrap',
                  }}>
                    📝 {e.title}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
