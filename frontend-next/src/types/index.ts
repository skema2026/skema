export type Schedule = {
  id: number;
  user_id: number;
  title: string;
  day_of_week: number; // 0=Mon, 6=Sun
  date?: string; // YYYY-MM-DD, null = recurring weekly
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  location?: string;
  color: string; // hex, default #6366F1
  priority: 0 | 1 | 2; // 0=normal, 1=high, 2=urgent
  is_completed: boolean;
  schedule_type: 'class' | 'event' | 'study';
  // Phase 5: AI 일관성 추적 필드
  schedule_source?: 'eta_import' | 'syllabus_based' | 'ai_generated' | 'user_created';
  linked_exam_id?: number | null;
  user_override?: boolean;
  deleted_by_user?: boolean;
  original_generated_title?: string | null;
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
  exam_duration_minutes?: number; // default 120
  location?: string;
};

export type User = {
  id: number;
  email: string;
  username?: string; // legacy (UI 호환용)
  is_active?: boolean;
  created_at?: string;
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
