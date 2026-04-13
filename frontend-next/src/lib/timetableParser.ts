/**
 * Timetable parsing utilities — strict weekday + 30-minute precision.
 *
 * Key invariants
 *   - day_of_week: 0=Mon 1=Tue 2=Wed 3=Thu 4=Fri 5=Sat 6=Sun  (never mixed up)
 *   - All times snap to :00 or :30 only
 *   - "2:30" in Everytime context → 14:30, never 02:30
 *   - "화" → 1 (Tuesday), never 0 (Monday)
 *   - Multi-day "월수" expands to two entries: dow=0 AND dow=2
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedClass {
  title: string;
  day_of_week: number; // 0=Mon … 6=Sun — strictly 1:1 with Korean/English label
  start_time: string;  // HH:MM, always :00 or :30
  end_time: string;    // HH:MM, always :00 or :30
}

// ─── Weekday mappings ─────────────────────────────────────────────────────────

/** Korean single char → 0-indexed dow (0=Mon). Completely unambiguous. */
const KR_DOW: Readonly<Record<string, number>> = {
  월: 0, 화: 1, 수: 2, 목: 3, 금: 4, 토: 5, 일: 6,
};

/** English (lower/upper) → dow. Matched longest-first to avoid "Tue" → "Tu". */
const EN_DOW_PATTERNS: ReadonlyArray<[RegExp, number]> = [
  [/^(monday|mon)$/i,    0],
  [/^(tuesday|tue|tu)$/i, 1],
  [/^(wednesday|wed)$/i, 2],
  [/^(thursday|thu|th)$/i, 3],
  [/^(friday|fri)$/i,    4],
  [/^(saturday|sat)$/i,  5],
  [/^(sunday|sun)$/i,    6],
];

/**
 * Parse Korean weekday string into sorted dow indices.
 * Each character is mapped independently — no ambiguity, no bleed-over.
 *
 *   "월수"  → [0, 2]   (Mon, Wed)
 *   "화목"  → [1, 3]   (Tue, Thu)
 *   "토일"  → [5, 6]   (Sat, Sun)
 *   "월수금" → [0, 2, 4]
 *   "화"    → [1]       (Tue only)
 */
export function parseKoreanWeekdays(raw: string): number[] {
  const seen = new Set<number>();
  for (const ch of raw.trim()) {
    const idx = KR_DOW[ch];
    if (idx !== undefined) seen.add(idx);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Parse a single English weekday token into a dow index, or null if unknown.
 *   "Tuesday" → 1,  "thu" → 3,  "xyz" → null
 */
export function parseEnglishWeekday(token: string): number | null {
  for (const [re, dow] of EN_DOW_PATTERNS) {
    if (re.test(token.trim())) return dow;
  }
  return null;
}

/**
 * Resolve effective day-of-week from a YYYY-MM-DD date string.
 * Parses in LOCAL time (not UTC) to avoid the one-day-off timezone bug.
 *
 * The bug: new Date("2026-04-07") is parsed as UTC midnight.
 * In UTC+9 (Seoul), that means 2026-04-06 09:00 local → .getDay() = Monday, not Tuesday.
 * Fix: construct the date from year/month/day components (local time).
 */
export function dateStringToDow(dateStr: string): number {
  const [y, mo, da] = dateStr.split('-').map(Number);
  if (!y || !mo || !da) return 0;
  const jsDay = new Date(y, mo - 1, da).getDay(); // 0=Sun in JS
  return jsDay === 0 ? 6 : jsDay - 1;             // convert to 0=Mon
}

// ─── Time arithmetic ──────────────────────────────────────────────────────────

/** "HH:MM" → total minutes since midnight. Returns -1 on failure. */
export function timeToMinutes(time: string): number {
  // Guard against full-width colon (：) and trim whitespace
  const t = time.trim().replace(/：/g, ':');
  const colon = t.indexOf(':');
  if (colon < 1) return -1;
  const h = parseInt(t.slice(0, colon), 10);
  const m = parseInt(t.slice(colon + 1, colon + 3), 10); // only first 2 digits after ':'
  if (isNaN(h) || isNaN(m)) return -1;
  if (h < 0 || h > 23 || m < 0 || m > 59) return -1;
  return h * 60 + m;
}

/** Total minutes since midnight → "HH:MM" */
export function minutesToTime(totalMins: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMins));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Snap total minutes to the nearest 30-minute boundary.
 *
 * Critical: 2:30 (150 min) must stay 2:30 (150 min) — NOT become 3:00 (180 min).
 *
 * Boundary rules:
 *   remainder 0–14  → round DOWN to :00  (e.g. 14:07 → 14:00)
 *   remainder 15–44 → round to    :30  (e.g. 14:20 → 14:30, 14:30 → 14:30)
 *   remainder 45–59 → round UP   to next :00  (e.g. 14:50 → 15:00)
 *
 * This is simple arithmetic — no floating-point, no ambiguity.
 */
export function snapToHalfHour(totalMins: number): number {
  const remainder = totalMins % 30;
  if (remainder < 15) {
    // round down
    return totalMins - remainder;
  } else {
    // round up to next 30-min boundary
    return totalMins + (30 - remainder);
  }
}

/**
 * Parse and snap a time string to the nearest :00 or :30.
 * Strips range notation ("10:30~12:00" → uses "10:30") and seconds ("09:30:00" → "09:30").
 * Returns null for unrecognizable input.
 *
 *   "09:17" → "09:00"
 *   "14:20" → "14:30"  ← rounds to nearest, not always down
 *   "14:30" → "14:30"  ← preserved exactly
 *   "14:45" → "15:00"
 *   "2:30"  → "02:30"  ← NOTE: Everytime PM correction must be applied separately
 */
export function normalizeTime(raw: string): string | null {
  if (!raw || !raw.trim()) return null;

  // Strip range suffix: "10:30~12:00" or "10:30-12:00" → "10:30"
  const rangeMatch = raw.trim().match(/^(\d{1,2}:\d{2})\s*[~\-–]/);
  const cleaned = rangeMatch ? rangeMatch[1] : raw.trim();

  const mins = timeToMinutes(cleaned);
  if (mins < 0) return null;

  const snapped = snapToHalfHour(mins);
  // Clamp to 00:00 – 23:30
  const clamped = Math.min(snapped, 23 * 60 + 30);
  return minutesToTime(clamped);
}

// ─── Everytime-specific helpers ───────────────────────────────────────────────

/**
 * Convert an Everytime axis label to 24-hour minutes.
 *
 * Everytime axis shows: 9 10 11 12 1 2 3 4 5 6 7 8  (no AM/PM text)
 * Interpretation:
 *   9–12 → 09:00–12:00  (morning)
 *   1–8  → 13:00–20:00  (afternoon/evening)
 *
 * @param label  integer label from axis (1–12)
 * @param half   true if at the :30 mark between this label and the next
 */
export function everytimeLabelToMinutes(label: number, half = false): number {
  // Labels 1–8 are afternoon (PM); 9–12 are morning (AM/noon)
  const hour24 = label >= 9 ? label : label + 12;
  return hour24 * 60 + (half ? 30 : 0);
}

/**
 * Apply Everytime PM correction to a time string.
 * If the model outputs "2:30" (Everytime label "2" at :30 mark), it should be "14:30".
 * If the model correctly outputs "14:30", it passes through unchanged.
 *
 * Rule: if h ∈ [1, 8], this is an afternoon hour in Everytime → add 12.
 * Hours 0, 9–23 are left unchanged.
 */
export function correctEverytimeHour(time: string): string {
  const mins = timeToMinutes(time);
  if (mins < 0) return time;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 1 && h <= 8) {
    // Treat as Everytime PM label: 1→13, 2→14, …, 8→20
    return minutesToTime((h + 12) * 60 + m);
  }
  return time;
}

/**
 * Snap a pixel Y position to the nearest 30-minute time slot.
 *
 * @param pixelY      Y coordinate of the block edge within the grid area
 * @param gridTopPx   Y coordinate where startHour begins (the topmost grid line)
 * @param pxPerHour   pixel height for one full 60-minute slot
 * @param startHour   the hour shown at gridTopPx  (default: 9 for Everytime)
 */
export function snapPixelToTime(
  pixelY: number,
  gridTopPx: number,
  pxPerHour: number,
  startHour = 9,
): string {
  const relPx      = pixelY - gridTopPx;
  const relMinutes = (relPx / pxPerHour) * 60;
  const absolute   = startHour * 60 + relMinutes;
  const snapped    = snapToHalfHour(Math.max(0, absolute));
  return minutesToTime(Math.min(snapped, 23 * 60 + 30));
}

// ─── Free-text schedule parsing ───────────────────────────────────────────────

/**
 * Parse a free-text schedule string into one ParsedClass entry per weekday.
 *
 * Supported formats
 *   "알고리즘 월수 10:30-12:00"    → 2 entries (Mon dow=0, Wed dow=2)
 *   "SW보안개론 화목 13:00~15:00"  → 2 entries (Tue dow=1, Thu dow=3)
 *   "체육 토 09:00-10:00"          → 1 entry  (Sat dow=5)
 *   "영어 일 14:00-15:30"          → 1 entry  (Sun dow=6)
 *   "운영체제 월 09:00-10:30"      → 1 entry  (Mon dow=0)
 *
 * Weekday characters are mapped one-to-one with no ambiguity:
 *   월=0, 화=1, 수=2, 목=3, 금=4, 토=5, 일=6
 *
 * Returns [] for unrecognizable input.
 */
export function parseScheduleText(text: string): ParsedClass[] {
  const cleaned = text.trim();
  if (!cleaned) return [];

  // 1. Extract time range — two HH:MM tokens separated by ~, -, –, or whitespace
  const timeRe = /(\d{1,2}:\d{2})\s*(?:[~\-–]|~)\s*(\d{1,2}:\d{2})/;
  let timeMatch = cleaned.match(timeRe);
  // Fallback: two separate HH:MM tokens with a space
  if (!timeMatch) {
    const twoTimes = cleaned.match(/(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})/);
    if (twoTimes) timeMatch = twoTimes;
  }
  if (!timeMatch) return [];

  const startTime = normalizeTime(timeMatch[1]);
  const endTime   = normalizeTime(timeMatch[2]);
  if (!startTime || !endTime) return [];
  if (timeToMinutes(startTime) >= timeToMinutes(endTime)) return [];

  // 2. Extract all Korean weekday characters
  const days: number[] = [];
  for (const ch of cleaned) {
    const d = KR_DOW[ch];
    if (d !== undefined && !days.includes(d)) days.push(d);
  }
  if (days.length === 0) return [];
  days.sort((a, b) => a - b);

  // 3. Title = text before the first weekday character
  const firstKrIdx = [...cleaned].findIndex((ch) => KR_DOW[ch] !== undefined);
  const rawTitle = firstKrIdx > 0 ? cleaned.slice(0, firstKrIdx) : '';
  const title = rawTitle
    .replace(timeMatch[0], '')
    .replace(/\s+/g, ' ')
    .trim() || '수업';

  // 4. Expand: one entry per weekday (strict 1:1 mapping)
  return days.map((dow) => ({
    title,
    day_of_week: dow,  // EXACTLY this day — no adjustment, no inference
    start_time: startTime,
    end_time:   endTime,
  }));
}
