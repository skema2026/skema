# SKEMA — AI 기반 스마트 시간표 관리

> **Scheme**에서 따온 이름, **SKEMA**. 당신의 시간을 설계합니다.

AI 어시스턴트와 함께 강의·일정을 자연어로 관리하는 풀스택 웹 애플리케이션입니다.

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 강의 / 일정 CRUD | 강의명, 요일, 시간, 장소, 색상, 우선순위 등록·수정·삭제 |
| 주간 시간표 뷰 | 동적 시간 범위, 충돌 감지, 현재 시간 표시 |
| 시험 일정 관리 | 시험 날짜·과목·장소 등록 및 목록 조회 |
| 인증 | 이메일/비밀번호 JWT 로그인 + Google · Naver · Kakao 소셜 로그인 |
| 온보딩 | 최초 로그인 시 직업·수면 시간 입력 → AI 학습 일정 자동 생성에 활용 |
| 시간표 공유 | 고유 토큰 링크로 비로그인 열람 가능 |
| AI 어시스턴트 | 자연어로 일정 추가·수정·삭제·조회·빈 시간 탐색·학습 시간표 자동 생성 |

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프론트엔드 | Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui |
| 상태 관리 | Zustand v5, TanStack React Query v5 |
| 백엔드 | FastAPI, Python 3.11+, SQLAlchemy ORM |
| 데이터베이스 | SQLite |
| 인증 | JWT (python-jose, bcrypt) + OAuth 2.0 (Google / Naver / Kakao) |
| AI | Google Gemini 2.5 Flash — Function Calling 방식 |

---

## 아키텍처

전체 시스템 구조는 [`docs/architecture.md`](docs/architecture.md)에서 확인할 수 있습니다.

```
[Browser]
  Next.js (App Router)
    ├── Zustand (인증·UI 상태)
    ├── TanStack Query (서버 상태 캐시)
    └── Axios (JWT Bearer 자동 주입)
          │  HTTP REST / JSON
          ▼
[FastAPI Backend]
  ├── /auth       — 로그인·회원가입·소셜 OAuth
  ├── /schedules  — 일정 CRUD
  ├── /exams      — 시험 일정 CRUD
  ├── /ai/chat    — Gemini Function Calling 루프
  ├── /profile    — 온보딩·프로필 관리
  └── /share      — 공유 토큰 발급·조회
          │
          ├── SQLite (timetable.db)
          └── Google Gemini API
```

---

## 빠른 시작

### 백엔드

```bash
cd backend
cp .env.example .env   # GEMINI_API_KEY 등 설정
pip install -r requirements.txt
uvicorn app.main:app --reload
```

- API 서버: http://localhost:8000
- Swagger 문서: http://localhost:8000/docs

#### .env 주요 항목

```env
GEMINI_API_KEY=...

# 소셜 로그인 (선택)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NAVER_CLIENT_ID=...
NAVER_CLIENT_SECRET=...
KAKAO_CLIENT_ID=...
KAKAO_CLIENT_SECRET=...
```

### 프론트엔드

```bash
cd frontend-next
npm install
npm run dev
```

앱: http://localhost:3000

---

## 프로젝트 구조

```
capstone-design-2026-1/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 앱 진입점, 마이그레이션
│   │   ├── database.py          # SQLAlchemy 설정
│   │   ├── core/config.py       # 환경변수 (pydantic-settings)
│   │   ├── models/              # User, UserProfile, Schedule, ExamSchedule, ShareToken
│   │   ├── schemas/             # Pydantic 요청/응답 스키마
│   │   ├── routers/             # auth, schedules, exams, share, ai, profile
│   │   └── services/            # auth.py (JWT), ai_agent.py (Gemini)
│   ├── requirements.txt
│   └── .env.example
├── frontend-next/
│   └── src/
│       ├── app/
│       │   ├── page.tsx             # 랜딩 페이지
│       │   ├── (auth)/              # 로그인, 회원가입
│       │   ├── (app)/               # 대시보드, 온보딩
│       │   └── share/[token]/       # 공유 시간표 (비로그인 열람)
│       ├── components/
│       │   ├── timetable/           # Timetable 그리드
│       │   ├── class-form/          # 강의 추가·수정 폼
│       │   ├── ai-chat/             # AI 채팅 사이드바
│       │   ├── exam/                # 시험 일정 목록
│       │   ├── settings/            # 설정 모달
│       │   ├── layout/              # AuthNavbar, AuthFooter
│       │   └── ui/                  # shadcn/ui 컴포넌트
│       ├── hooks/                   # useSchedules, useAuth, useExams, useProfile
│       ├── store/                   # authStore, uiStore (Zustand)
│       ├── lib/                     # api.ts (Axios 인스턴스), utils.ts
│       └── types/                   # TypeScript 공통 타입
├── docs/
│   └── architecture.md          # 시스템 아키텍처 다이어그램 (Mermaid)
└── frontend/                    # 구버전 (React + Vite) — 참고용
```

---

## AI 어시스턴트

Google Gemini 2.5 Flash의 **Function Calling**을 활용하여 자연어 명령을 실제 DB 작업으로 변환합니다.

### 사용 예시

```
"월요일 9시에 알고리즘 수업 추가해줘"
"내일 오후 3시 팀 미팅 잡아줘"
"수요일 오전 빈 시간 알려줘"
"알고리즘 수업 삭제해줘"
"자료구조 7일간 하루 2시간씩 학습 일정 만들어줘"
"현재 시간표 보여줘"
```

### AI 도구 목록

| 도구 | 설명 |
|------|------|
| `add_schedule` | 일정 추가 (반복 수업 / 특정 날짜 이벤트) |
| `update_schedule` | 기존 일정 수정 |
| `delete_schedule` | 일정 삭제 |
| `list_schedules` | 일정 목록 조회 (날짜·유형 필터) |
| `find_free_slots` | 특정 날짜·요일의 빈 시간대 탐색 |
| `check_conflicts` | 시간 충돌 사전 확인 |
| `generate_study_schedule` | 기존 일정·수면 시간 고려한 학습 시간표 자동 생성 |

---

## API 엔드포인트 요약

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/auth/register` | 회원가입 |
| POST | `/auth/login` | 로그인 (JWT 발급) |
| GET | `/auth/oauth/{provider}` | 소셜 로그인 (google / naver / kakao) |
| GET/POST | `/schedules` | 일정 목록 조회 / 추가 |
| PUT/DELETE | `/schedules/{id}` | 일정 수정 / 삭제 |
| GET/POST | `/exams` | 시험 일정 목록 조회 / 추가 |
| DELETE | `/exams/{id}` | 시험 일정 삭제 |
| GET/PUT | `/profile` | 프로필 조회 / 수정 |
| POST | `/ai/chat` | AI 어시스턴트 메시지 전송 |
| POST | `/share` | 공유 토큰 생성 |
| GET | `/share/{token}` | 공유 시간표 조회 |
