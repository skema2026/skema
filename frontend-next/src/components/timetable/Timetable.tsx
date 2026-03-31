'use client';

import { useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import koLocale from '@fullcalendar/core/locales/ko';
import type { EventInput, EventClickArg, EventContentArg } from '@fullcalendar/core';
import type { EventDropArg } from '@fullcalendar/core';
import { Schedule } from '@/types';
import { useDeleteSchedule, useToggleComplete, useUpdateSchedule } from '@/hooks/useSchedules';
import { useUIStore } from '@/store/uiStore';
import { toast } from 'sonner';

interface TimetableProps {
  schedules: Schedule[];
  readOnly?: boolean;
}

// 0=Mon → ISO date string for this week
function getWeekDate(dow: number): string {
  const today = new Date();
  const jsDow = today.getDay(); // 0=Sun
  const todayDow = jsDow === 0 ? 6 : jsDow - 1; // 0=Mon
  const target = new Date(today);
  target.setDate(today.getDate() + (dow - todayDow));
  return target.toISOString().slice(0, 10);
}

function isSameDay(a: Schedule, b: Schedule): boolean {
  if (a.date && b.date) return a.date === b.date;
  if (!a.date && !b.date) return a.day_of_week === b.day_of_week;
  const dated = a.date ? a : b;
  const recurring = a.date ? b : a;
  const dow = new Date(dated.date!).getDay();
  const dowMon = dow === 0 ? 6 : dow - 1;
  return dowMon === recurring.day_of_week;
}

function hasConflict(a: Schedule, b: Schedule): boolean {
  if (!isSameDay(a, b)) return false;
  const parse = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  return parse(a.start_time) < parse(b.end_time) && parse(b.start_time) < parse(a.end_time);
}

function EventContent({ arg, conflictIds }: { arg: EventContentArg; conflictIds: Set<number> }) {
  const s: Schedule = arg.event.extendedProps.schedule;
  const isConflict = conflictIds.has(s.id);
  const start = arg.event.start!;
  const end = arg.event.end ?? new Date(start.getTime() + 60 * 60000);
  const durationMin = (end.getTime() - start.getTime()) / 60000;
  const isCompact = durationMin < 45;

  const priorityColor =
    s.priority === 2 ? '#f97316' : s.priority === 1 ? '#facc15' : null;

  return (
    <div
      style={{
        padding: isCompact ? '1px 4px' : '3px 6px',
        height: '100%',
        overflow: 'hidden',
        opacity: s.is_completed ? 0.55 : 1,
        outline: isConflict ? '2px solid #f87171' : 'none',
        outlineOffset: '-2px',
        borderRadius: 4,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
        {priorityColor && !isCompact && (
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: priorityColor, flexShrink: 0, marginTop: 3,
          }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: isCompact ? 10 : 11,
            fontWeight: 700,
            lineHeight: 1.2,
            color: '#fff',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: isCompact ? 'nowrap' : 'normal',
            display: isCompact ? 'block' : '-webkit-box',
            WebkitLineClamp: isCompact ? undefined : 2,
            WebkitBoxOrient: isCompact ? undefined : 'vertical' as const,
            textDecoration: s.is_completed ? 'line-through' : 'none',
          }}>
            {s.title}
          </div>
          {!isCompact && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)', marginTop: 2 }}>
              {s.start_time}–{s.end_time}
            </div>
          )}
          {!isCompact && s.location && (
            <div style={{
              fontSize: 10, color: 'rgba(255,255,255,0.65)', marginTop: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              📍 {s.location}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Timetable({ schedules, readOnly = false }: TimetableProps) {
  const openClassForm = useUIStore((s) => s.openClassForm);
  const updateSchedule = useUpdateSchedule();

  const conflictIds = useMemo(() => {
    const ids = new Set<number>();
    schedules.forEach((a) => {
      schedules.forEach((b) => {
        if (a.id !== b.id && hasConflict(a, b)) {
          ids.add(a.id);
          ids.add(b.id);
        }
      });
    });
    return ids;
  }, [schedules]);

  const events: EventInput[] = useMemo(() =>
    schedules.map((s) => {
      const date = s.date ?? getWeekDate(s.day_of_week);
      return {
        id: String(s.id),
        title: s.title,
        start: `${date}T${s.start_time}`,
        end: `${date}T${s.end_time}`,
        backgroundColor: s.color || '#6366F1',
        borderColor: conflictIds.has(s.id) ? '#f87171' : (s.color || '#6366F1'),
        extendedProps: { schedule: s },
      };
    }), [schedules, conflictIds]);

  const slotMin = useMemo(() => {
    if (!schedules.length) return '08:00:00';
    const minH = Math.max(6, Math.min(...schedules.map(s => parseInt(s.start_time))) - 1);
    return `${String(minH).padStart(2, '0')}:00:00`;
  }, [schedules]);

  const slotMax = useMemo(() => {
    if (!schedules.length) return '22:00:00';
    const maxH = Math.min(23, Math.max(...schedules.map(s => parseInt(s.end_time.split(':')[0]))) + 1);
    return `${String(maxH).padStart(2, '0')}:00:00`;
  }, [schedules]);

  const handleEventClick = (arg: EventClickArg) => {
    if (readOnly) return;
    const s: Schedule = arg.event.extendedProps.schedule;
    openClassForm(s);
  };

  const handleEventDrop = (arg: EventDropArg) => {
    if (readOnly) { arg.revert(); return; }
    const s: Schedule = arg.event.extendedProps.schedule;
    const newStart = arg.event.start!;
    const newEnd = arg.event.end ?? new Date(newStart.getTime() + (
      (parseInt(s.end_time.split(':')[0]) * 60 + parseInt(s.end_time.split(':')[1]))
      - (parseInt(s.start_time.split(':')[0]) * 60 + parseInt(s.start_time.split(':')[1]))
    ) * 60000);

    const jsDow = newStart.getDay();
    const newDow = jsDow === 0 ? 6 : jsDow - 1;
    const pad = (n: number) => String(n).padStart(2, '0');
    const newStartTime = `${pad(newStart.getHours())}:${pad(newStart.getMinutes())}`;
    const newEndTime = `${pad(newEnd.getHours())}:${pad(newEnd.getMinutes())}`;

    updateSchedule.mutate(
      {
        id: s.id,
        day_of_week: newDow,
        start_time: newStartTime,
        end_time: newEndTime,
        ...(s.date ? { date: newStart.toISOString().slice(0, 10) } : {}),
      },
      {
        onSuccess: () => toast.success('일정이 이동되었습니다'),
        onError: () => { arg.revert(); toast.error('이동 중 오류가 발생했습니다'); },
      }
    );
  };

  return (
    <div style={{ borderRadius: 14, border: '1px solid var(--skema-container)', background: '#fff', overflow: 'hidden', boxShadow: '0 2px 8px rgba(24,28,30,0.06)' }}>
      {conflictIds.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, fontWeight: 600 }}>
          <span>⚠️</span>
          <span>시간이 겹치는 일정이 {conflictIds.size}개 있습니다. 빨간 테두리로 표시된 일정을 확인하세요.</span>
        </div>
      )}
      <FullCalendar
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        locale={koLocale}
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: '',
        }}
        buttonText={{ today: '오늘' }}
        events={events}
        editable={!readOnly}
        eventDrop={handleEventDrop}
        eventClick={handleEventClick}
        eventContent={(arg) => <EventContent arg={arg} conflictIds={conflictIds} />}
        slotMinTime={slotMin}
        slotMaxTime={slotMax}
        slotDuration="00:30:00"
        snapDuration="00:15:00"
        nowIndicator
        allDaySlot={false}
        height="auto"
        scrollTime={slotMin}
        dayHeaderFormat={{ weekday: 'short' }}
        businessHours={{
          daysOfWeek: [1, 2, 3, 4, 5],
          startTime: '08:00',
          endTime: '22:00',
        }}
        eventMinHeight={24}
      />
    </div>
  );
}
