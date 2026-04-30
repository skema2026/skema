'use client';

import type { NormalizedETAEntry } from '@/types';

// Fixed mapping Mon=0 .. Sun=6
const DAY_INDEX: Record<NormalizedETAEntry['day'], number> = {
  MONDAY: 0, TUESDAY: 1, WEDNESDAY: 2, THURSDAY: 3, FRIDAY: 4, SATURDAY: 5, SUNDAY: 6,
};

// Render constants
const START_HOUR = 8;   // visual grid start (can adjust)
const END_HOUR   = 22;  // visual grid end
const SLOT_H     = 28;  // px per 30-min slot
const GUTTER_W   = 44;  // time gutter width

const TOTAL_SLOTS = (END_HOUR - START_HOUR) * 2;
const GRID_H      = TOTAL_SLOTS * SLOT_H;

function timeToMinutes(t: string): number {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return -1;
  const h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  return h * 60 + mm;
}

export function ParsedTimetableRenderer({ data }: { data: NormalizedETAEntry[] }) {
  // Group by day index
  const byDay = Array.from({ length: 7 }, () => [] as NormalizedETAEntry[]);
  for (const e of data) byDay[DAY_INDEX[e.day]].push(e);

  return (
    <div className="rounded-xl border" style={{ overflow: 'hidden', background: '#fff' }}>
      {/* Header */}
      <div style={{ display: 'flex', borderBottom: '1px solid #ebeef1' }}>
        <div style={{ width: GUTTER_W, flexShrink: 0 }} />
        {['월','화','수','목','금','토','일'].map((label, idx) => (
          <div key={idx} style={{ flex: 1, textAlign: 'center', padding: '8px 0', fontSize: 12, fontWeight: 700, color: idx >= 5 ? '#e11d48' : '#3f4b61' }}>
            {label}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex' }}>
        {/* Time gutter */}
        <div style={{ width: GUTTER_W, flexShrink: 0, position: 'relative', height: GRID_H }}>
          {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => (
            <div key={i} style={{ position: 'absolute', top: i * SLOT_H * 2 - 6, right: 6, fontSize: 10, color: '#bbb', lineHeight: 1, userSelect: 'none' }}>
              {String(START_HOUR + i).padStart(2, '0')}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {byDay.map((list, dayIdx) => (
          <div key={dayIdx} style={{ flex: 1, position: 'relative', height: GRID_H, borderLeft: '1px solid #f0f0f0', background: dayIdx >= 5 ? 'rgba(225,29,72,0.02)' : 'transparent' }}>
            {Array.from({ length: TOTAL_SLOTS }, (_, i) => (
              <div key={`gl-${dayIdx}-${i}`} style={{ position: 'absolute', left: 0, right: 0, top: i * SLOT_H, borderTop: i % 2 === 0 ? '1px solid #e8eaed' : '1px dashed #f3f4f6', pointerEvents: 'none' }} />
            ))}

            {list.map((e, i) => {
              const s = timeToMinutes(e.startTime);
              const t = timeToMinutes(e.endTime);
              const top = ((s - START_HOUR * 60) / 30) * SLOT_H;
              const height = Math.max(18, ((t - s) / 30) * SLOT_H - 1);
              return (
                <div key={i} style={{ position: 'absolute', top, left: 2, right: 2, height, background: '#4f46e5', color: '#fff', borderRadius: 6, padding: '4px 6px', overflow: 'hidden' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{e.title}</div>
                  <div style={{ fontSize: 10, opacity: 0.9 }}>{e.startTime}–{e.endTime}{e.location ? ` · ${e.location}` : ''}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default ParsedTimetableRenderer;
