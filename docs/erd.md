# DB 구조 (ERD)

MySQL 8 · SQLAlchemy 모델 기준 (`backend/app/*/models.py`). 마이그레이션은 `backend/alembic/versions` (001~018).
아래 그림은 주요 칸만 보여줍니다. 전체 칸은 각 모델 파일에 있습니다.

```mermaid
erDiagram
  users ||--o| user_profiles : "온보딩 설정"
  users ||--o{ schedules : ""
  users ||--o{ exam_schedules : ""
  exam_schedules ||--o{ schedules : "공부 블록 linked_exam_id"
  users ||--o{ notifications : ""
  schedules ||--o{ notifications : "related_schedule_id"
  users ||--o{ push_subscriptions : ""
  users ||--o{ share_tokens : ""
  users ||--o{ login_logs : ""
  users ||--o{ streak_check_ins : ""
  users ||--o{ study_group_members : ""
  study_groups ||--o{ study_group_members : ""
  study_groups ||--o{ study_logs : ""
  users ||--o{ study_logs : ""
  study_logs ||--o{ study_log_reactions : ""
  users ||--o{ like_notification_queue : ""
  users ||--o{ events : ""

  users {
    int id PK
    string username
    string email
    string hashed_password
    string social_provider "kakao / naver / google"
    string social_id
  }
  user_profiles {
    int id PK
    int user_id FK
    string user_type
    string sleep_start "수면 시작"
    string sleep_end "수면 끝"
    bool onboarding_completed
    text notification_prefs "알림 시점 등 JSON"
  }
  schedules {
    int id PK
    int user_id FK
    string course_name "제목"
    string location "강의실"
    enum recurring_day "반복 요일 (수업)"
    string date "날짜 (단발 일정)"
    string start_time
    string end_time
    string schedule_type "class / study / assignment / personal ..."
    bool is_completed
    int linked_exam_id FK "공부 블록 → 시험"
  }
  exam_schedules {
    int id PK
    int user_id FK
    string title
    string subject
    date exam_date
    string start_time
  }
  notifications {
    bigint id PK
    bigint user_id FK
    string type
    string title
    bool is_read
    bigint related_schedule_id FK
  }
  push_subscriptions {
    bigint id PK
    bigint user_id FK
    text endpoint
    int fail_count
  }
  share_tokens {
    int id PK
    int user_id FK
    string token
    bool is_active
  }
  study_groups {
    int id PK
    string name
    string invite_code
    int created_by FK
  }
  study_group_members {
    int id PK
    int group_id FK
    int user_id FK
  }
  study_logs {
    int id PK
    int user_id FK
    int group_id FK
    int schedule_id FK
    string photo_path "R2 키 (영상·사진)"
    string caption
  }
  study_log_reactions {
    int id PK
    int log_id FK
    int user_id FK
    string emoji
  }
  streak_check_ins {
    int id PK
    int user_id FK
    date check_date
  }
  login_logs {
    int id PK
    int user_id FK
    string login_method
    bool success
  }
  like_notification_queue {
    int id PK
    int target_user_id FK
    string content_type
  }
  events {
    int id PK
    int user_id FK
    string title
    date date
  }
```

## 테이블 설명

| 테이블 | 내용 |
| --- | --- |
| `users`, `user_profiles` | 계정, 온보딩 값(수면 시간·알림 설정 등) |
| `schedules` | 모든 일정. 수업은 `recurring_day`로 매주 반복, 공부·과제·개인 일정은 `date`로 단발. 공부 블록은 `linked_exam_id`로 시험과 연결 → 준비도 계산 |
| `exam_schedules` | 시험 날짜·과목 |
| `notifications`, `push_subscriptions` | 알림 기록, 브라우저 푸시 구독 (실패가 쌓이면 정리) |
| `share_tokens` | 읽기 전용 시간표 공유 링크 |
| `study_groups`, `study_group_members`, `study_logs`, `study_log_reactions`, `streak_check_ins`, `like_notification_queue` | 스터디 그룹 인증 기록·좋아요·스트릭 |
| `login_logs` | 로그인 기록 (관리자 화면) |
| `events` | 1학기 단발 일정 테이블 (지금은 `schedules`의 `date` 사용) |
| `ai_chat_logs` | 1학기 AI 채팅 기록 (2학기 화면에서 AI 기능 제외, 테이블만 남음) |
| `posts`, `post_likes` | 1학기 커뮤니티 (11/2 코드에서 제거, 되돌릴 수 없는 DB 삭제는 하지 않아 테이블만 남음) |
