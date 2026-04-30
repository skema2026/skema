import type { RecurringDay } from '@/types';

export const RECURRING_DAYS: RecurringDay[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export function recurringDayToIndex(day: RecurringDay | string | undefined): number {
  const index = RECURRING_DAYS.indexOf((day ?? 'MON') as RecurringDay);
  return index >= 0 ? index : 0;
}

export function indexToRecurringDay(index: number): RecurringDay {
  return RECURRING_DAYS[index] ?? 'MON';
}

export function dateStringToRecurringDay(dateStr: string): RecurringDay {
  const [year, month, day] = dateStr.split('-').map(Number);
  const jsDay = new Date(year, month - 1, day).getDay();
  return indexToRecurringDay(jsDay === 0 ? 6 : jsDay - 1);
}
