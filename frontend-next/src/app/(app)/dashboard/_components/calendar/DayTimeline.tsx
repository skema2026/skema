"use client";

import { displayTitle } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import type { Schedule } from "@/types";
import MaterialIcon from "@/components/common/MaterialIcon";

type DayTimelineProps = {
  schedules: Schedule[];
  freeWindows?: { start: number; end: number }[];
  isToday: boolean;
  onScheduleClick: (schedule: Schedule) => void;
  onToggleComplete: (schedule: Schedule) => void;
  getDisplayColor: (schedule: Schedule) => string;
  /** 그릴 시간 범위 (기본 0~24시). 모바일은 그날 일정 앞뒤만 그려 길이를 줄인다 */
  startHour?: number;
  endHour?: number;
};

const getScheduleStyle = (type?: string | null) => {
  switch (type) {
    case "class":
      return { icon: "school", background: "#f3f6fd" };
    case "study":
      return { icon: "menu_book", background: "#eef0ff" };
    case "exam":
      return { icon: "assignment", background: "#fdf3f3" };
    case "personal":
      return { icon: "event", background: "#f3f0fb" };
    default:
      return { icon: "event_note", background: "#edf3fc" };
  }
};

const HOUR_HEIGHT = 64;
const MINUTE_HEIGHT = HOUR_HEIGHT / 60;

const toMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

export default function DayTimeline({
  schedules,
  freeWindows = [],
  isToday,
  onScheduleClick,
  onToggleComplete,
  getDisplayColor,
  startHour = 0,
  endHour = 24,
}: DayTimelineProps) {
  const START_HOUR = startHour;
  const END_HOUR = endHour;
  const rangeStart = START_HOUR * 60;
  const rangeEnd = END_HOUR * 60;
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    if (!isToday) return;

    const updateNow = () => setNow(new Date());
    updateNow();

    const interval = window.setInterval(updateNow, 60_000);
    return () => window.clearInterval(interval);
  }, [isToday]);

  const totalHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
  const nowMinutes = now ? now.getHours() * 60 + now.getMinutes() : null;
  const currentTop =
    nowMinutes !== null && nowMinutes >= rangeStart && nowMinutes <= rangeEnd
      ? (nowMinutes - rangeStart) * MINUTE_HEIGHT
      : null;

  const sortedSchedules = useMemo(
    () => [...schedules].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time)),
    [schedules],
  );

  return (
    <div className="overflow-hidden rounded-lg border border-black/[0.08] bg-white">
      <div className="relative ml-14 mr-2" style={{ height: totalHeight }}>
        {Array.from({ length: (END_HOUR - START_HOUR) * 2 + 1 }, (_, index) => {
          const minutes = rangeStart + index * 30;
          const hour = Math.floor(minutes / 60);
          const minute = minutes % 60;
          const isHour = minute === 0;

          return (
            <div
              key={minutes}
              className={`absolute left-0 right-0 border-t ${
                isHour ? "border-black/[0.08]" : "border-black/[0.04]"
              }`}
              style={{ top: (minutes - rangeStart) * MINUTE_HEIGHT }}
            >
              <span className="absolute -left-13 -top-2 w-10 text-right font-mono text-[11px] tabular-nums text-[#98a6ba]">
                {isHour ? `${String(hour).padStart(2, "0")}:00` : ""}
              </span>
            </div>
          );
        })}

        {freeWindows.map((window) => {
          const wStart = Math.max(window.start, rangeStart);
          const wEnd = Math.min(window.end, rangeEnd);
          if (wEnd <= wStart) return null;
          const top = (wStart - rangeStart) * MINUTE_HEIGHT;
          const height = Math.max((wEnd - wStart) * MINUTE_HEIGHT, 18);

          return (
            <div
              key={`free-${window.start}-${window.end}`}
              className="absolute left-2 right-2 z-10 overflow-hidden rounded-lg border border-dashed border-black/[0.12]"
              style={{ top, height }}
              title="빈 시간"
            />
          );
        })}

        {sortedSchedules.map((schedule) => {
          const rawStart = toMinutes(schedule.start_time);
          const rawEnd = toMinutes(schedule.end_time);

          if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) {
            return null;
          }
          // 범위 밖은 잘라서 그린다
          const start = Math.max(rawStart, rangeStart);
          const end = Math.min(rawEnd, rangeEnd);
          if (end <= start) return null;

          const top = (start - rangeStart) * MINUTE_HEIGHT;
          const height = (end - start) * MINUTE_HEIGHT;
          const color = getDisplayColor(schedule);
          const scheduleStyle = getScheduleStyle(schedule.schedule_type);

          return (
            <div
              key={schedule.id}
              data-schedule-id={schedule.id}
              className={`absolute left-2 right-2 z-20 overflow-hidden rounded-lg border border-black/[0.06] p-2 transition-opacity ${
                schedule.is_completed ? "opacity-70" : ""
              }`}
              style={{
                top,
                height,
                borderLeftWidth: 4,
                borderLeftColor: color,
                backgroundColor: scheduleStyle.background,
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onScheduleClick(schedule)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] font-medium text-[#0f1e3a]"
                  title={displayTitle(schedule.title)}
                >
                  <MaterialIcon icon={scheduleStyle.icon} size={16} color="#5f6f88" />
                  <span
                    className={`truncate ${
                      schedule.is_completed ? "text-slate-400 line-through" : ""
                    }`}
                  >
                    {displayTitle(schedule.title)}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onToggleComplete(schedule)}
                  aria-label={`${displayTitle(schedule.title)} 완료 여부`}
                  aria-pressed={Boolean(schedule.is_completed)}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${
                    schedule.is_completed
                      ? "border-[#2a6fe3] bg-[#2a6fe3]"
                      : "border-[#cfdbec] bg-white hover:border-[#2a6fe3]"
                  }`}
                >
                  {schedule.is_completed && (
                    <svg
                      className="h-3 w-3 text-white"
                      viewBox="0 0 12 12"
                      fill="none"
                    >
                      <path
                        d="M2 6l3 3 5-5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </div>

              {height >= 56 && (
                <p
                  className={`mt-1 font-mono text-[12px] tabular-nums ${
                    schedule.is_completed ? "text-slate-400 line-through" : "text-slate-600"
                  }`}
                >
                  {schedule.start_time} – {schedule.end_time}
                </p>
              )}

              {schedule.location && height >= 72 && (
                <p className="mt-1 truncate text-[12px] text-[#5f6f88]">{schedule.location}</p>
              )}
            </div>
          );
        })}

        {isToday && currentTop !== null && (
          <div
            className="pointer-events-none absolute left-0 right-0 z-30 border-t border-[#e5484d]"
            style={{ top: currentTop }}
          >
            <span className="absolute -left-1 -top-[3px] h-[5px] w-[5px] rounded-full bg-[#e5484d]" />
          </div>
        )}
      </div>
    </div>
  );
}
