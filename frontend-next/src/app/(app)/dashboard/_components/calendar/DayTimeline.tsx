"use client";

import { useEffect, useState } from "react";
import type { Schedule } from "@/types";
import MaterialIcon from "@/components/common/MaterialIcon";

type DayTimelineProps = {
  schedules: Schedule[];
  freeWindows?: { start: number; end: number }[];
  isToday: boolean;
  onScheduleClick: (schedule: Schedule) => void;
  onToggleComplete: (schedule: Schedule) => void;
  getDisplayColor: (schedule: Schedule) => string;
};

const getScheduleStyle = (type?: string | null) => {
  switch (type) {
    case "class":
      return {
        icon: "school",
        background: "#EFF6FF",
      };

    case "study":
      return {
        icon: "menu_book",
        background: "#F0FDF4",
      };

    case "exam":
      return {
        icon: "assignment",
        background: "#FFFBEB",
      };

    case "personal":
      return {
        icon: "event",
        background: "#FAF5FF",
      };

    default:
      return {
        icon: "event_note",
        background: "#F8FAFC",
      };
  }
};

const START_HOUR = 0;
const END_HOUR = 24;
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
}: DayTimelineProps) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    if (!isToday) return;

    const updateNow = () => setNow(new Date());
    updateNow();

    const interval = setInterval(updateNow, 60_000);
    return () => clearInterval(interval);
  }, [isToday]);

  const totalHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT;

  const nowMinutes = now ? now.getHours() * 60 + now.getMinutes() : null;

  const currentTop =
    nowMinutes !== null ? (nowMinutes - START_HOUR * 60) * MINUTE_HEIGHT : null;

  return (
    <div className="overflow-hidden rounded-xl border border-blue-100 bg-white">
      <div className="border-b border-blue-100 px-4 py-3">
        <h3 className="text-base font-black text-slate-900">하루 타임라인</h3>
        <p className="mt-1 text-xs text-slate-500">
          30분 단위로 일정을 확인할 수 있어요.
        </p>
      </div>

      <div className="max-h-[650px] overflow-y-auto">
        <div className="relative ml-16 mr-4" style={{ height: totalHeight }}>
          {Array.from({ length: 49 }, (_, index) => {
            const minutes = index * 30;
            const hour = Math.floor(minutes / 60);
            const minute = minutes % 60;
            const isHour = minute === 0;

            return (
              <div
                key={minutes}
                className={`absolute left-0 right-0 border-t ${
                  isHour ? "border-slate-200" : "border-dashed border-slate-100"
                }`}
                style={{ top: minutes * MINUTE_HEIGHT }}
              >
                <span className="absolute -left-14 -top-2.5 w-12 text-right text-[11px] font-semibold text-slate-400">
                  {`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`}
                </span>
              </div>
            );
          })}

          {freeWindows.map((window) => {
            const top = window.start * MINUTE_HEIGHT;
            const height = Math.max((window.end - window.start) * MINUTE_HEIGHT, 18);

            return (
              <div
                key={`free-${window.start}-${window.end}`}
                className="absolute left-2 right-2 z-10 overflow-hidden rounded-lg border border-dashed border-blue-200/80 bg-blue-50/60"
                style={{
                  top,
                  height,
                  backgroundImage:
                    "linear-gradient(90deg, rgba(191,219,254,0.15) 0%, rgba(147,197,253,0.28) 40%, rgba(191,219,254,0.14) 100%)",
                  borderColor: "rgba(147, 197, 253, 0.5)",
                  boxShadow: "inset 0 0 0 1px rgba(147, 197, 253, 0.2)",
                }}
              />
            );
          })}

          {schedules.map((schedule) => {
            const start = toMinutes(schedule.start_time);
            const end = toMinutes(schedule.end_time);

            if (
              !Number.isFinite(start) ||
              !Number.isFinite(end) ||
              end <= start
            ) {
              return null;
            }

            const top = start * MINUTE_HEIGHT;
            const height = (end - start) * MINUTE_HEIGHT;
            const color = getDisplayColor(schedule);
            const scheduleStyle = getScheduleStyle(schedule.schedule_type);

            return (
              <div
                key={schedule.id}
                className={`absolute left-2 right-2 z-20 overflow-hidden rounded-lg border p-2 shadow-sm ${
                  schedule.is_completed ? "opacity-60" : ""
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
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-bold text-slate-900"
                    title={schedule.title}
                  >
                    <MaterialIcon
                      icon={scheduleStyle.icon}
                      size={15}
                      color={color}
                    />
                    <span
                      className={`truncate ${
                        schedule.is_completed ? "text-slate-400 line-through" : ""
                      }`}
                    >
                      {schedule.title}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleComplete(schedule)}
                    aria-label={`${schedule.title} 완료 여부`}
                    aria-pressed={Boolean(schedule.is_completed)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
                      schedule.is_completed
                        ? "border-emerald-400 bg-emerald-400"
                        : "border-slate-300 bg-white hover:border-blue-400"
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

                {height >= 55 && (
                  <p
                    className={`mt-1 text-[11px] ${
                      schedule.is_completed ? "text-slate-400 line-through" : "text-slate-500"
                    }`}
                  >
                    {schedule.start_time} – {schedule.end_time}
                  </p>
                )}

                {schedule.location && height >= 70 && (
                  <p className="mt-1 truncate text-[10px] text-slate-500">
                    {schedule.location}
                  </p>
                )}
              </div>
            );
          })}

          {isToday && currentTop !== null && (
            <div
              className="pointer-events-none absolute left-0 right-0 z-30 border-t-2 border-red-500"
              style={{ top: currentTop }}
            >
              <span className="absolute -left-2 -top-1.5 h-3 w-3 rounded-full bg-red-500" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
