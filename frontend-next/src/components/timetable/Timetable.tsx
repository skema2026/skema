'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Schedule } from '@/types';
import { DAY_NAMES, timeToMinutes, cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useDeleteSchedule, useToggleComplete } from '@/hooks/useSchedules';
import { useUIStore } from '@/store/uiStore';
import { toast } from 'sonner';

const HOUR_HEIGHT = 60; // px per hour

interface TimetableProps {
  schedules: Schedule[];
  readOnly?: boolean;
}

function isSameDay(a: Schedule, b: Schedule): boolean {
  // 둘 다 특정 날짜 → 날짜가 같아야 충돌
  if (a.date && b.date) return a.date === b.date;
  // 둘 다 반복 일정 → 같은 요일이면 충돌
  if (!a.date && !b.date) return a.day_of_week === b.day_of_week;
  // 하나만 날짜 지정 → 해당 날짜의 요일과 반복 일정의 요일이 같으면 충돌
  const dated = a.date ? a : b;
  const recurring = a.date ? b : a;
  const dow = new Date(dated.date!).getDay(); // 0=Sun
  const dowMon = dow === 0 ? 6 : dow - 1;    // 0=Mon 변환
  return dowMon === recurring.day_of_week;
}

function hasConflict(a: Schedule, b: Schedule): boolean {
  if (!isSameDay(a, b)) return false;
  const aStart = timeToMinutes(a.start_time);
  const aEnd = timeToMinutes(a.end_time);
  const bStart = timeToMinutes(b.start_time);
  const bEnd = timeToMinutes(b.end_time);
  return aStart < bEnd && bStart < aEnd;
}

interface ScheduleBlockProps {
  schedule: Schedule;
  isConflict: boolean;
  readOnly: boolean;
  onEdit: (s: Schedule) => void;
  onDelete: (id: number) => void;
  onToggleComplete: (id: number, completed: boolean) => void;
  startHour: number;
  totalMinutes: number;
}

function getTopPercent(time: string, startHour: number, totalMinutes: number): number {
  const minutes = timeToMinutes(time) - startHour * 60;
  return (Math.max(0, minutes) / totalMinutes) * 100;
}

function getHeightPercent(start: string, end: string, startHour: number, endHour: number, totalMinutes: number): number {
  const startMin = Math.max(timeToMinutes(start), startHour * 60);
  const endMin = Math.min(timeToMinutes(end), endHour * 60);
  return ((endMin - startMin) / totalMinutes) * 100;
}

function ScheduleBlock({ schedule, isConflict, readOnly, onEdit, onDelete, onToggleComplete, startHour, totalMinutes }: ScheduleBlockProps) {
  const [hovered, setHovered] = useState(false);
  const endHour = startHour + totalMinutes / 60;
  const top = getTopPercent(schedule.start_time, startHour, totalMinutes);
  const height = getHeightPercent(schedule.start_time, schedule.end_time, startHour, endHour, totalMinutes);

  const durationMin = (timeToMinutes(schedule.end_time) - timeToMinutes(schedule.start_time));
  const isCompact = durationMin < 45;

  const priorityDot =
    schedule.priority === 2
      ? 'bg-orange-500'
      : schedule.priority === 1
      ? 'bg-yellow-400'
      : null;

  return (
    <div
      className={cn(
        'absolute left-0.5 right-0.5 rounded-md px-1.5 py-1 text-white text-xs overflow-hidden cursor-pointer group transition-opacity',
        isConflict && 'ring-2 ring-red-400 ring-offset-1',
        schedule.is_completed && 'opacity-60'
      )}
      style={{
        top: `${top}%`,
        height: `${Math.max(height, 2)}%`,
        backgroundColor: schedule.color || '#6366F1',
        minHeight: '24px',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => !readOnly && onEdit(schedule)}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex-1 min-w-0">
          {priorityDot && !isCompact && (
            <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0 inline-block mr-1', priorityDot)} />
          )}
          {/* Title */}
          <div style={{
            fontSize: isCompact ? '10px' : '11px',
            fontWeight: 700,
            lineHeight: 1.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: isCompact ? 'nowrap' : 'normal',
            display: isCompact ? 'block' : '-webkit-box',
            WebkitLineClamp: isCompact ? undefined : 2,
            WebkitBoxOrient: isCompact ? undefined : 'vertical' as const,
            textDecoration: schedule.is_completed ? 'line-through' : 'none',
            opacity: schedule.is_completed ? 0.6 : 1,
          }}>
            {schedule.title}
          </div>
          {/* Time — hide in compact mode */}
          {!isCompact && (
            <div style={{ fontSize: '10px', opacity: 0.72, marginTop: '2px', fontWeight: 400 }}>
              {schedule.start_time}–{schedule.end_time}
            </div>
          )}
          {/* Location — only when not compact */}
          {!isCompact && schedule.location && (
            <div style={{ fontSize: '10px', opacity: 0.65, marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              📍 {schedule.location}
            </div>
          )}
        </div>
        {!readOnly && hovered && (
          <div className="flex flex-col gap-0.5 flex-shrink-0">
            <button
              className="text-white/80 hover:text-white leading-none"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(schedule.id);
              }}
            >
              ✕
            </button>
            <button
              className="text-white/80 hover:text-white leading-none"
              title={schedule.is_completed ? '미완료로 변경' : '완료로 변경'}
              onClick={(e) => {
                e.stopPropagation();
                onToggleComplete(schedule.id, !schedule.is_completed);
              }}
            >
              {schedule.is_completed ? '↩' : '✓'}
            </button>
          </div>
        )}
      </div>
      {schedule.is_completed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-full h-px bg-white/60"></div>
        </div>
      )}
    </div>
  );
}

export function Timetable({ schedules, readOnly = false }: TimetableProps) {
  const openClassForm = useUIStore((s) => s.openClassForm);
  const deleteSchedule = useDeleteSchedule();
  const toggleComplete = useToggleComplete();
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentTimeTop, setCurrentTimeTop] = useState<number | null>(null);

  // Compute dynamic time range
  const { visibleStart, visibleEnd } = useMemo(() => {
    if (!schedules || schedules.length === 0) return { visibleStart: 8, visibleEnd: 22 };
    const starts = schedules.map(s => Math.floor(parseInt(s.start_time.split(':')[0])));
    const ends = schedules.map(s => Math.ceil(parseInt(s.end_time.split(':')[0])));
    return {
      visibleStart: Math.max(6, Math.min(...starts) - 1),
      visibleEnd: Math.min(23, Math.max(...ends) + 1),
    };
  }, [schedules]);

  const TOTAL_MINUTES = (visibleEnd - visibleStart) * 60;
  const GRID_HEIGHT = TOTAL_MINUTES; // 1px per minute

  const updateCurrentTime = useCallback(() => {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes() - visibleStart * 60;
    if (minutes >= 0 && minutes <= TOTAL_MINUTES) {
      setCurrentTimeTop((minutes / TOTAL_MINUTES) * 100);
    } else {
      setCurrentTimeTop(null);
    }
  }, [visibleStart, TOTAL_MINUTES]);

  useEffect(() => {
    updateCurrentTime();
    const interval = setInterval(updateCurrentTime, 60000);
    return () => clearInterval(interval);
  }, [updateCurrentTime]);

  const handleDelete = (id: number) => {
    if (confirm('일정을 삭제하시겠습니까?')) {
      deleteSchedule.mutate(id, {
        onSuccess: () => toast.success('일정이 삭제되었습니다'),
        onError: () => toast.error('삭제 중 오류가 발생했습니다'),
      });
    }
  };

  const hours = Array.from({ length: visibleEnd - visibleStart + 1 }, (_, i) => visibleStart + i);

  const schedulesByDay = DAY_NAMES.map((_, dayIdx) =>
    schedules.filter((s) => s.day_of_week === dayIdx)
  );

  const conflictIds = new Set<number>();
  schedules.forEach((a) => {
    schedules.forEach((b) => {
      if (a.id !== b.id && hasConflict(a, b)) {
        conflictIds.add(a.id);
        conflictIds.add(b.id);
      }
    });
  });

  return (
    <div className="overflow-x-auto rounded-xl border bg-white dark:bg-gray-900 shadow-sm">
      <div className="min-w-[700px]">
        {/* 충돌 경고 배너 */}
        {conflictIds.size > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border-b border-red-200 text-red-700 text-xs font-medium">
            <span>⚠️</span>
            <span>시간이 겹치는 일정이 {conflictIds.size}개 있습니다. 빨간 테두리로 표시된 일정을 확인하세요.</span>
          </div>
        )}
        {/* Header row */}
        <div className="flex border-b">
          <div className="w-12 flex-shrink-0" />
          {DAY_NAMES.map((day, i) => (
            <div
              key={day}
              className={cn(
                'flex-1 text-center py-3 text-sm font-semibold',
                i === 5 && 'text-blue-600 dark:text-blue-400',
                i === 6 && 'text-red-600 dark:text-red-400'
              )}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="flex" ref={containerRef}>
          {/* Time labels */}
          <div className="w-12 flex-shrink-0 relative" style={{ height: `${GRID_HEIGHT}px` }}>
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute right-2 text-[10px] text-gray-400 dark:text-gray-500 -translate-y-2"
                style={{ top: `${((hour - visibleStart) * 60 / TOTAL_MINUTES) * 100}%` }}
              >
                {hour}:00
              </div>
            ))}
          </div>

          {/* Day columns */}
          {DAY_NAMES.map((_, dayIdx) => {
            const daySchedules = schedulesByDay[dayIdx];
            return (
              <div
                key={dayIdx}
                className="flex-1 relative border-l"
                style={{ height: `${GRID_HEIGHT}px` }}
              >
                {/* Hour grid lines */}
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className="absolute left-0 right-0 border-t border-gray-100 dark:border-gray-800"
                    style={{ top: `${((hour - visibleStart) / (visibleEnd - visibleStart)) * 100}%` }}
                  />
                ))}

                {/* Current time indicator */}
                {currentTimeTop !== null && (
                  <div
                    className="absolute left-0 right-0 z-10 pointer-events-none"
                    style={{ top: `${currentTimeTop}%` }}
                  >
                    <div className="relative">
                      <div className="absolute -left-1 w-2 h-2 rounded-full bg-red-500 -translate-y-1" />
                      <div className="h-px bg-red-400" />
                    </div>
                  </div>
                )}

                {/* Schedule blocks */}
                {daySchedules.map((schedule) => (
                  <ScheduleBlock
                    key={schedule.id}
                    schedule={schedule}
                    isConflict={conflictIds.has(schedule.id)}
                    readOnly={readOnly}
                    onEdit={openClassForm}
                    onDelete={handleDelete}
                    onToggleComplete={(id, completed) => toggleComplete.mutate({ id, is_completed: completed })}
                    startHour={visibleStart}
                    totalMinutes={TOTAL_MINUTES}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
