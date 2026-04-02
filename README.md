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
| 백엔드 | FastAPI, Python 3.11+, SQLAlchemy ORM, Alembic |
| 데이터베이스 | MySQL |
| 인증 | JWT (python-jose, passlib) + OAuth 2.0 (Google / Naver / Kakao) |
| AI | Google Gemini 2.5 Flash — Function Calling 방식 |
| 인프라 | Docker, Docker Compose |

---

## 아키텍처

```
[Browser]
  Next.js (App Router + SSR)
    ├── Zustand (인증·UI 상태)
    ├── TanStack Query (서버 상태 캐시)
    └── Axios (JWT Bearer 자동 주입)
          │  HTTP REST / JSON
          ▼
[FastAPI Backend]
  ├── /auth            — 로그인·회원가입·소셜 OAuth
  ├── /schedules       — 일정 CRUD
  ├── /exam-schedules  — 시험 일정 CRUD
  ├── /ai/chat         — Gemini Function Calling 루프
  ├── /profiles        — 온보딩·프로필 관리
  └── /share-tokens    — 공유 토큰 발급·조회
          │
          ├── MySQL
          └── Google Gemini API
```

---

## 빠른 시작

### Docker Compose (권장)

```bash
cp .env.example .env   # 환경변수 설정
docker-compose up --build
```

- 프론트엔드: http://localhost:3000
- 백엔드 API: http://localhost:8000
- Swagger 문서: http://localhost:8000/docs

---

### 수동 실행

#### 백엔드

```bash
cd backend
cp .env.example .env   # 환경변수 설정
pip install -r requirements.txt
alembic upgrade head   # DB 마이그레이션
uvicorn app.main:app --reload
```

#### 프론트엔드

```bash
cd frontend-next
npm install
npm run dev
```

---

### .env 주요 항목

```env
SECRET_KEY=...
DATABASE_URL=mysql+pymysql://user:password@localhost:3306/skema_db

GEMINI_API_KEY=...

# 소셜 로그인 (선택)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NAVER_CLIENT_ID=...
NAVER_CLIENT_SECRET=...
KAKAO_CLIENT_ID=...
KAKAO_CLIENT_SECRET=...

FRONTEND_URL=http://localhost:3000
```

---

## 프로젝트 구조

```
capstone-design-2026-1/
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/
│   │   └── versions/
│   │       └── 001_initial_schema.py   # 초기 DB 스키마
│   └── app/
│       ├── main.py                     # FastAPI 앱 진입점
│       ├── ai_chat/                    # AI 채팅 모듈
│       ├── auth/                       # 인증 모듈
│       ├── schedule/                   # 시간표/시험 모듈
│       ├── share/                      # 공유 모듈
│       ├── clients/                    # Gemini API 클라이언트
│       ├── core/                       # 설정, JWT, 의존성
│       └── db/                         # DB 엔진 및 세션
└── frontend-next/
    ├── Dockerfile
    └── src/
        ├── app/
        │   ├── (auth)/                 # 로그인, 회원가입
        │   ├── (app)/                  # 대시보드, 온보딩
        │   └── share/[token]/          # 공유 시간표 (비로그인 열람)
        ├── components/
        │   ├── timetable/              # 시간표 캘린더
        │   ├── class-form/             # 강의 추가·수정 폼
        │   ├── ai-chat/                # AI 채팅 사이드바
        │   ├── exam/                   # 시험 일정 목록
        │   ├── settings/               # 설정 모달
        │   └── ui/                     # shadcn/ui 공통 컴포넌트
        ├── hooks/                      # useSchedules, useAuth, useExams, useProfile
        ├── store/                      # authStore, uiStore (Zustand)
        ├── lib/                        # Axios 인스턴스, 서버사이드 fetch, 유틸
        └── types/                      # TypeScript 공통 타입
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
| GET / PUT | `/users/me` | 내 정보 조회·수정 |
| GET / POST | `/schedules` | 일정 목록 조회 / 추가 |
| PUT / DELETE | `/schedules/{id}` | 일정 수정 / 삭제 |
| GET / POST | `/exam-schedules` | 시험 일정 목록 조회 / 추가 |
| DELETE | `/exam-schedules/{id}` | 시험 일정 삭제 |
| GET / PUT | `/profiles/me` | 프로필 조회 / 수정 |
| POST | `/ai/chat` | AI 어시스턴트 메시지 전송 |
| POST | `/share-tokens` | 공유 토큰 생성 |
| GET | `/share/{token}` | 공유 시간표 조회 |
