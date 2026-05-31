import { Schedule, ScheduleViewScope } from '@/types';

export type ScheduleViewTarget = 'day' | 'week' | 'month';

export function scopeToTargets(scope?: ScheduleViewScope): ScheduleViewTarget[] {
  if (scope === 'all') return ['day', 'week', 'month'];
  if (scope === 'day') return ['day'];
  if (scope === 'week') return ['week'];
  if (scope === 'month') return ['month'];
  if (scope === 'day_month') return ['day', 'month'];
  if (scope === 'week_month') return ['week', 'month'];
  return ['day', 'week'];
}

export function targetsToScope(targets: ScheduleViewTarget[]): ScheduleViewScope {
  const normalized = [...new Set(targets)].sort();
  const key = normalized.join('_');
  if (key === 'day_month_week') return 'all';
  if (key === 'day_month') return 'day_month';
  if (key === 'day_week') return 'day_week';
  if (key === 'month_week') return 'week_month';
  if (key === 'day') return 'day';
  if (key === 'month') return 'month';
  return 'week';
}

export function scheduleVisibleIn(schedule: Pick<Schedule, 'view_scope'>, target: ScheduleViewTarget): boolean {
  return scopeToTargets(schedule.view_scope).includes(target);
}
