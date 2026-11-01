export type RecurringDay = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
export type ScheduleViewScope = 'day' | 'week' | 'month' | 'day_week' | 'day_month' | 'week_month' | 'all';

export type Schedule = {
  id: number;
  user_id: number;
  title: string;
  recurring_day: RecurringDay;
  date?: string; // YYYY-MM-DD, null = recurring weekly
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  location?: string;
  color: string; // hex, default #6366F1
  priority: 0 | 1 | 2; // 0=normal, 1=high, 2=urgent
  is_completed: boolean;
  schedule_type: 'class' | 'study' | 'assignment' | 'activity' | 'personal' | 'event';
  view_scope?: ScheduleViewScope;
  // Phase 5: AI 일관성 추적 필드
  schedule_source?: 'eta_import' | 'ai_generated' | 'user_created';
  linked_exam_id?: number | null;
  user_override?: boolean;
  deleted_by_user?: boolean;
  original_generated_title?: string | null;
};

// 다시 짜기 (#11) — POST /reschedule/preview, /reschedule/apply
export type RescheduleSegment = {
  date: string; // YYYY-MM-DD
  start_time: string; // HH:MM
  end_time: string; // HH:MM
};

export type RescheduleMove = {
  schedule_id: number;
  title: string;
  schedule_type: Schedule['schedule_type'];
  linked_exam_id: number | null;
  deadline: string;
  from: RescheduleSegment;
  to: RescheduleSegment[];
};

export type RescheduleUnplaced = {
  schedule_id: number;
  title: string;
  deadline: string;
  minutes: number;
  reason: 'NO_SLOT' | 'DEADLINE_PASSED';
};

export type ReschedulePreview = {
  generated_at: string;
  moves: RescheduleMove[];
  unplaced: RescheduleUnplaced[];
  warning: string | null;
  summary: { target: number; placed: number; unplaced: number };
};

export type RescheduleApplyResult = {
  applied: number;
  updated_ids: number[];
  created_ids: number[];
};

// 시험 공부 블록 배치 (#12) — POST /study-blocks/generate
export type StudyBlocksGenerateRequest = {
  exam_ids: number[];
  start_days_before?: number; // 0이면 오늘부터
  days_per_week?: number; // 1~7
  minutes_per_day?: number; // 30~720
  replace?: boolean;
};

export type StudyBlocksGenerateResult = {
  created: number;
  removed: number;
  blocks: { schedule_id: number; exam_id: number; title: string; date: string; start_time: string; end_time: string }[];
  exams: { exam_id: number; title: string; planned_minutes: number; placed_minutes: number; block_count: number }[];
  warning: string | null;
};

export type UserProfile = {
  id: number;
  user_id: number;
  user_type?: string; // 'exam_prep' | 'civil_service' | 'student' | 'worker' | 'other'
  occupation?: string;
  goal_tasks?: string;
  sleep_start: string; // HH:MM, default 23:00
  sleep_end: string; // HH:MM, default 07:00
  is_college_student?: boolean;
  semester_start_date?: string; // YYYY-MM-DD
  onboarding_completed: boolean;
  updated_at?: string;
};

export type ExamSchedule = {
  id: number;
  user_id: number;
  title: string;
  subject?: string;
  exam_date: string; // YYYY-MM-DD
  exam_time?: string; // HH:MM
  start_time?: string; // HH:MM
  end_time?: string; // HH:MM
  exam_duration_minutes?: number; // default 120
  location?: string;
  memo?: string;
};

export type User = {
  id: number;
  username?: string | null;
  email: string;
  is_active?: boolean | null;
  is_admin?: boolean;
  created_at?: string | null;
};

export type LoginLog = {
  id: number;
  user_id: number | null;
  login_identifier: string;
  login_method: 'email' | 'username';
  success: boolean;
  failure_reason?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at: string;
  user?: {
    id: number;
    username?: string | null;
    email: string;
  } | null;
};

export type AdminUser = {
  id: number;
  username?: string | null;
  email: string;
  is_active?: boolean | null;
  social_provider?: string | null;
  social_id?: string | null;
  created_at?: string | null;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ConflictItem = {
  schedule_a: Schedule;
  schedule_b: Schedule;
  day_label: string; // "2026-04-10" or "매주 월요일"
};
export type NormalizedETAEntry = {
  title: string;
  day: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  location: string;
  bbox: [number, number, number, number];
};
