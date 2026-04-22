export type Schedule = {
  id: number;
  user_id: number;
  title: string;
  day_of_week: number; // 0=Mon, 6=Sun
  date?: string; // YYYY-MM-DD, optional
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  location?: string;
  color: string; // hex, default #6366F1
  priority: 0 | 1 | 2; // 0=normal, 1=high, 2=urgent
  is_completed: boolean;
  schedule_type: 'class' | 'event' | 'study';
};

export type UserProfile = {
  id: number;
  user_id: number;
  user_type?: string; // 'exam_prep' | 'civil_service' | 'student' | 'worker' | 'other'
  occupation?: string;
  sleep_start: string; // HH:MM, default 23:00
  sleep_end: string; // HH:MM, default 07:00
  goal_tasks?: string;
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
