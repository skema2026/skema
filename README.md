# SKEMA — AI 기반 학생 시간표·학습 관리 플랫폼

> **"내 시간표를 AI가 이해하고, 함께 관리한다"**  
> 단국대학교 2026-1 캡스톤디자인 프로젝트

---

## 프로젝트 소개

SKEMA는 대학생의 시간표 관리 문제를 AI로 해결하는 웹 애플리케이션입니다.

기존 시간표 앱은 단순 일정 기록에 그쳤습니다. SKEMA는 시간표 이미지를 올리면 AI가 자동으로 일정을 파싱하고, 등록된 일정을 바탕으로 AI와 대화하며 학습 계획을 세우고, 시험 준비도까지 분석해 줍니다. 웹 푸시 알림으로 놓치는 일정 없이 하루를 관리할 수 있습니다.

---

## 핵심 기능

### AI 기반 자동화
- **시간표 OCR** — 강의계획서·시간표 이미지를 업로드하면 GPT-4.1이 과목명·요일·시간·장소를 자동 추출해 일정으로 등록
- **AI 채팅 어시스턴트** — 등록된 일정을 맥락으로 이해하는 AI. "내일 오후 비는 시간 알려줘", "수학 일정 추가해줘" 등 자연어 명령으로 일정 관리
- **시험 준비도 진단** — 시험 연결 일정의 수행률을 분석하고 AI가 피드백 제공
- **하루 정리 / 내일 준비** — 버튼 하나로 오늘 일정 요약 및 내일 준비 사항을 AI가 정리

### 일정 관리
- **다중 뷰** — 하루·주간·월간 시간표를 탭 전환으로 확인. 드래그&드롭으로 일정 시간 변경 가능
- **일정 유형 분류** — 수업·자율학습·과제·시험·개인 유형별 색상 구분
- **시험 D-day 관리** — 시험 일정 별도 등록. D-7·D-3·D-1·당일 자동 알림
- **빈 시간 시각화** — 기상 시간 기준 하루의 빈 시간대를 계산해 표시
- **일정 공유** — 읽기 전용 공유 링크로 시간표를 외부에 공유

### 알림 시스템
- **개인화 리마인더** — 일정 시작 5·10·15·30·60분 전 선택 알림 (서버 설정 동기화)
- **미완료 알림** — 일정 종료 후에도 완료 처리 안 된 경우 자동 알림
- **주간 리포트** — 매주 월요일 08:00 지난주 수행률·이번주 일정 수 요약 발송
- **동기부여 메시지** — 매일 09:00 학습 동기 메시지
- **웹 푸시** — Service Worker 기반 OS 알림 (Android Chrome 즉시 / iOS Safari PWA 지원)

### 사용자 경험
- **PWA 지원** — 모바일 홈 화면에 설치해 앱처럼 사용 가능
- **OAuth 로그인** — Kakao·Naver·Google OAuth + 이메일/비밀번호 JWT 인증
- **반응형 UI** — 모바일·태블릿·데스크탑 전 환경 최적화
- **Optimistic Update** — 일정 추가·수정·삭제 시 서버 응답 전에 화면이 즉시 반영

---

## 기술 스택

| 영역 | 기술 | 선택 이유 |
|------|------|----------|
| 프런트엔드 | Next.js 15, React 19, TypeScript | App Router + SSR으로 초기 로딩 최적화 |
| 스타일 | Tailwind CSS v4, shadcn/ui | 빠른 UI 구성 + 일관된 디자인 시스템 |
| 상태관리 | Zustand v5, TanStack React Query v5 | 서버 상태와 클라이언트 상태 분리 |
| 백엔드 | FastAPI (Python 3.11+) | 비동기 처리 + 자동 Swagger 문서화 |
| ORM / DB | SQLAlchemy, Alembic, MySQL 8.0 | 마이그레이션 이력 관리 |
| AI | OpenAI GPT-4.1 (Tool Calling) | 일정 파싱·채팅·준비도 분석 |
| 알림 | APScheduler + Web Push (VAPID) | 서버 사이드 스케줄 + 브라우저 푸시 |
| 인프라 | Docker, Docker Compose | 환경 일관성 보장 |

---

## 시스템 아키텍처

```
[클라이언트 (Next.js)]
    │  /proxy rewrite (dev)
    │  REST API
    ▼
[FastAPI 백엔드]  ──────  [MySQL 8.0]
    │
    ├── OpenAI GPT-4.1 (Tool Calling)
    ├── APScheduler (알림 스케줄러)
    │     ├── 매 30분: 일정 리마인더
    │     ├── 매일 08:00: 시험 D-day 알림
    │     ├── 매일 09:00: 동기부여 메시지
    │     └── 매주 월요일: 주간 리포트
    └── Web Push (VAPID / pywebpush)
            ▼
    [Service Worker → OS 푸시 알림]
```

---

## 빠른 시작

### 사전 준비

- Docker Desktop 설치 및 실행
- `.env` 파일 설정

```bash
cp .env.example .env
# .env 파일에 아래 필수 키 입력
```

### 실행

```bash
# 전체 서비스 실행 (DB + 백엔드 + 프런트)
docker compose up -d --build

# 로그 확인
docker compose logs -f
```

| 서비스 | 주소 |
|--------|------|
| 프런트엔드 | http://localhost:3000 |
| 백엔드 API | http://localhost:8000 |
| API 문서 (Swagger) | http://localhost:8000/docs |

### 개발 모드 (Hot-reload)

```bash
# DB + 백엔드만 컨테이너로
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db backend

# 프런트 로컬 dev 서버
cd frontend-next && npm run dev
```

---

## 환경 변수

```env
# DB
MYSQL_ROOT_PASSWORD=your_password
MYSQL_DATABASE=skema_db
MYSQL_USER=skema
MYSQL_PASSWORD=your_password

# JWT
SECRET_KEY=your_secret_key
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# AI
OPENAI_API_KEY=sk-...

# Web Push (VAPID)
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:your@email.com

# OAuth
KAKAO_CLIENT_ID=...
KAKAO_CLIENT_SECRET=...
NAVER_CLIENT_ID=...
NAVER_CLIENT_SECRET=...

# URL
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
BACKEND_URL=http://localhost:8000
```

---

## 프로젝트 구조

```
capstone-design-2026-1/
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
│
├── backend/                        # FastAPI 백엔드
│   └── app/
│       ├── main.py                 # 진입점 + 라우터 등록
│       ├── ai_chat/                # AI 채팅 · Tool Calling · 준비도 분석
│       ├── auth/                   # JWT + OAuth (Kakao · Naver · Google)
│       ├── eta/                    # 시간표 이미지 OCR 파서
│       ├── notification/           # APScheduler + 웹 푸시 + 알림 CRUD
│       ├── schedule/               # 일정 · 시험 · 이벤트 CRUD
│       ├── share/                  # 공유 토큰
│       └── core/                   # 설정 · JWT · LLM 유틸
│
└── frontend-next/                  # Next.js 15 프런트엔드
    └── src/
        ├── app/
        │   ├── (auth)/             # 로그인 · 회원가입
        │   └── (app)/
        │       ├── dashboard/      # 메인 대시보드 (하루·주간·월간 시간표)
        │       ├── onboarding/     # 최초 시간표 등록 (AI 채팅 기반)
        │       ├── notifications/  # 알림 센터 · 알림 설정
        │       ├── profile/        # 프로필 설정
        │       ├── report/         # 주간 리포트
        │       └── ai_chat/        # AI 채팅 전용 화면
        ├── components/
        │   ├── timetable/          # 주간 시간표 (드래그&드롭)
        │   └── class-form/         # 일정 추가·수정 폼
        ├── hooks/                  # 데이터 패칭 훅 (React Query)
        ├── lib/                    # API 클라이언트 · 색상 · 유틸
        └── store/                  # 인증 상태 (Zustand)
```

---

## 주요 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/auth/signup` | 회원가입 |
| POST | `/auth/login` | JWT 로그인 |
| GET | `/auth/{provider}/authorize` | OAuth 로그인 |
| GET/POST | `/schedules` | 일정 목록/추가 |
| PUT/DELETE | `/schedules/{id}` | 일정 수정/삭제 |
| GET/POST | `/exam-schedules` | 시험 일정 조회/추가 |
| POST | `/eta/parse-image` | 시간표 OCR 파싱 |
| POST | `/ai/chat` | AI 채팅 (Tool Calling) |
| POST | `/ai/readiness-summary` | 시험 준비도 AI 진단 |
| GET/PUT | `/notifications/prefs` | 알림 설정 조회/수정 |
| POST | `/push/subscriptions` | 웹 푸시 구독 등록 |
| POST | `/share-tokens` | 공유 토큰 생성 |
| GET | `/share/{token}` | 공유 시간표 조회 |
