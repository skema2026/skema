# SKEMA — AI 기반 학생 시간표·학습 관리 플랫폼

> **"내 시간표를 AI가 이해하고, 함께 관리한다"**  
> 단국대학교 2026-1 캡스톤디자인 프로젝트

---

## 프로젝트 소개

SKEMA는 대학생의 시간표 관리 문제를 AI로 해결하는 웹 애플리케이션입니다.

시간표 이미지를 올리면 AI가 자동으로 일정을 파싱하고, 등록된 일정을 바탕으로 AI와 대화하며 학습 계획을 세울 수 있습니다. 스터디 그룹 기능으로 함께 공부하는 친구들과 기록을 공유하고, 웹 푸시 알림으로 놓치는 일정 없이 하루를 관리합니다.

---

## 핵심 기능

### AI 기반 자동화
- **시간표 OCR** — 강의계획서·시간표 이미지 업로드 시 GPT-4.1이 과목명·요일·시간·장소 자동 추출
- **AI 채팅 어시스턴트** — 등록된 일정을 맥락으로 이해하는 AI. 자연어로 일정 추가·수정·삭제 가능
- **시험 준비도 진단** — 시험 연결 일정의 수행률을 분석하고 AI가 피드백 제공
- **하루 정리 / 내일 준비** — 오늘 일정 요약 및 내일 준비 사항을 AI가 자동 정리

### 일정 관리
- **다중 뷰** — 하루·주간·월간 시간표 탭 전환. 드래그&드롭으로 일정 이동
- **일정 유형 분류** — 수업·자율학습·과제·시험·개인 유형별 색상 구분
- **시험 D-day 관리** — D-7·D-3·D-1·당일 자동 알림
- **빈 시간 시각화** — 기상 시간 기준 하루의 빈 시간대 계산·표시
- **일정 공유** — 읽기 전용 공유 링크로 시간표 외부 공유

### 스터디 그룹 & 기록
- **스터디 그룹** — 초대코드 또는 이름 검색으로 그룹 참여. 여러 그룹 동시 가입 가능
- **BeReal 스타일 피드** — 날짜별 그룹 멤버 전원의 기록 현황 (올린 사람·아직 안 올린 사람 모두 표시)
- **기록 남기기** — 일정 완료 후 사진·텍스트로 기록 → 그룹 피드에 자동 표시
- **내 기록 탭** — 내가 올린 모든 기록을 시간순으로 확인·삭제
- **좋아요** — 그룹원의 기록에 👍 반응
- **스트릭** — 매일 일정 완료 시 연속 일수 카운트

### 알림
- **웹 푸시 알림** (VAPID 기반)
  - 일정 시작 전 N분 알림 (5·10·15·30·60분 선택)
  - 미완료 일정 재촉 알림
  - 시험 D-day 알림
  - 그룹원이 기록 올릴 때 알림
  - 내 기록에 좋아요 달릴 때 알림 (5분 배치 묶음 처리)
  - 매일 학습 동기부여 메시지
  - 주간 수행률 리포트

### 계정
- 이메일·비밀번호 회원가입 / 로그인
- 카카오·Google OAuth 소셜 로그인
- 온보딩 (사용자 유형, 수면 시간, 에타 시간표 파싱)
- 타 사용자 프로필 조회 (스트릭·기록·게시글)

---

## 기술 스택

### 백엔드
| 항목 | 내용 |
|------|------|
| 언어 | Python 3.11 |
| 프레임워크 | FastAPI |
| ORM | SQLAlchemy + Alembic |
| DB | MySQL 8.0 |
| AI | Anthropic Claude (claude-opus-4-5, claude-sonnet-4-5) |
| 인증 | JWT (python-jose) + OAuth2 |
| 알림 | Web Push (pywebpush, VAPID) + APScheduler |
| 스토리지 | 로컬 볼륨 (/app/uploads) |

### 프론트엔드
| 항목 | 내용 |
|------|------|
| 언어 | TypeScript |
| 프레임워크 | Next.js 16 (App Router) |
| 스타일 | Tailwind CSS |
| 서버 상태 | TanStack Query (React Query) |
| 클라이언트 상태 | Zustand |
| HTTP | Axios |
| 알림 | Service Worker + Web Push API |

### 인프라
- Docker Compose (개발·프로덕션 분리)

---

## 프로젝트 구조

```
capstone-design-2026-1/
├── backend/
│   ├── app/
│   │   ├── auth/          # 회원가입·로그인·프로필·OAuth
│   │   ├── ai_chat/       # AI 채팅 어시스턴트
│   │   ├── schedule/      # 일정 CRUD
│   │   ├── eta/           # 에타 시간표 OCR 파싱
│   │   ├── notification/  # 웹 푸시·스케줄러
│   │   ├── share/         # 시간표 공유 링크
│   │   └── studylog/      # 기록·그룹·스트릭
│   └── alembic/           # DB 마이그레이션 (018버전)
└── frontend-next/
    └── src/
        ├── app/
        │   └── (app)/
        │       ├── dashboard/   # 메인 시간표·AI 채팅
        │       ├── log/         # 기록·그룹 피드
        │       ├── notifications/ # 알림 설정
        │       └── profile/     # 내 프로필·타 사용자 프로필
        └── hooks/
            ├── useSchedules.ts
            ├── useStudyLogs.ts
            ├── useGroups.ts
            └── ...
```

---

## 로컬 실행

### 사전 요구사항
- Docker Desktop
- Node.js 20+

### 실행

```bash
# 1. 환경변수 설정
cp .env.example .env
# .env 파일에서 ANTHROPIC_API_KEY, VAPID 키 등 설정

# 2. 백엔드 + DB 실행
docker compose up -d

# 3. DB 마이그레이션
docker compose exec backend alembic upgrade head

# 4. 프론트엔드 실행
cd frontend-next
npm install
npm run dev
```

브라우저에서 http://localhost:3000 접속

---

## 주요 API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/auth/signup` | 회원가입 |
| POST | `/auth/login` | 로그인 |
| GET | `/schedules` | 일정 목록 |
| POST | `/eta/parse-image` | 시간표 이미지 파싱 |
| POST | `/ai-chat` | AI 채팅 |
| POST | `/study-logs` | 기록 생성 |
| GET | `/study-logs/me` | 내 기록 목록 |
| POST | `/groups` | 그룹 생성 |
| GET | `/groups/search` | 그룹 이름 검색 |
| POST | `/groups/join` | 초대코드로 참여 |
| GET | `/groups/{id}/feed` | 그룹 BeReal 피드 |
| GET | `/notifications/prefs` | 알림 설정 조회 |

---

## DB 마이그레이션 이력

| 버전 | 내용 |
|------|------|
| 001–010 | 기본 스키마 (유저·일정·시험·공유·알림) |
| 011 | study_logs 테이블 |
| 012 | streak_check_ins |
| 013 | study_log photo_path nullable |
| 014 | study_groups, study_group_members, study_log group_id |
| 015 | study_groups description |
| 016 | posts, post_likes (커뮤니티 — 현재 미노출) |
| 017 | like_notification_queue (좋아요 배치 알림) |
| 018 | study_logs is_public 복구 |

---

## 팀

단국대학교 소프트웨어학과 2026-1 캡스톤디자인
