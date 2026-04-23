# SKEMA — AI 기반 개인 시간표·학습 관리

> Scheme에서 따온 이름, SKEMA. 학생의 시간표와 학습 일정을 스마트하게 관리하고, AI가 복습 계획·준비도 분석·동기부여까지 도와줍니다.

---

## 주요 기능

- **시간표 OCR**: 시간표 이미지를 업로드하면 AI가 자동으로 일정을 파싱·등록
- **일정·과목 CRUD**: 과목명, 요일/시간, 장소, 메모, 우선순위, 유형(수업/자율학습/과제/활동/개인)
- **시험 일정 관리**: 중간·기말·퀴즈 등 별도 관리, 시험 전날 복습 블록 자동 생성
- **복습 스케줄러**: 수업 완료 시 다음 날 빈 시간에 복습 일정 자동 배치
- **준비도 경보**: 시험 D-7/D-3 기준 연결 일정 수행률 분석 + AI 진단 피드백
- **주간 AI 편지**: 이번 주 학습 패턴을 분석해 개인화된 편지 자동 생성
- **카카오톡 알림**: 오늘 일정 요약을 카카오톡 메시지로 발송
- **일정 공유**: 읽기 전용 공유 토큰으로 시간표 URL 공유
- **충돌 감지**: 시간이 겹치는 일정 자동 감지 및 경고
- **유형별 분석·주간 리포트**: 요일별/유형별 수행률 시각화
- **OAuth 로그인**: Kakao OAuth + JWT 인증

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프런트엔드 | Next.js 15, React 19, TypeScript, Tailwind CSS v4, shadcn/ui |
| 상태관리 | Zustand v5, TanStack React Query v5 |
| 백엔드 | FastAPI (Python 3.11+), SQLAlchemy ORM, Alembic |
| 데이터베이스 | MySQL 8.0 |
| 인증 | JWT (python-jose, passlib) + Kakao OAuth 2.0 |
| AI | Google Gemini 2.5 Flash (OCR·분석) / GPT-4.1 (fallback) |
| 알림 | APScheduler (백그라운드 주기 작업) + Kakao 메시지 API |
| 운영 | Docker, Docker Compose |

---

## 브랜치 구조

```
main                  — 배포 기준 브랜치 (Docker Compose로 운영)
dev                   — 기능 통합 브랜치 (PR 대상)
feature/<이름>        — 기능 개발 단위 브랜치
refactor/<이름>       — 리팩토링 브랜치
```

> PR은 `feature/*` → `dev` → `main` 순서로 머지합니다.  
> `main` 직접 push는 지양하고, 반드시 PR 리뷰 후 머지합니다.

---

## 빠른 시작

### Docker Compose (권장)

**사전 준비**

- Docker Desktop 설치 및 실행 확인
- `.env` 파일 설정 (아래 [.env 필수 키](#env-필수-키) 참고)

```bash
cp .env.example .env
# .env 파일에 필요한 키 입력
```

---

#### 프로덕션 모드 (`docker-compose.yml`)

MySQL + 백엔드 + 프런트엔드를 모두 컨테이너로 실행합니다.

```bash
# 빌드 후 백그라운드 실행
docker compose up -d --build

# 특정 서비스만 재빌드
docker compose up -d --build backend

# 실행 중인 컨테이너 확인
docker compose ps

# 전체 로그 스트리밍
docker compose logs -f

# 특정 서비스 로그만 보기
docker compose logs -f backend
docker compose logs -f frontend

# 중지 (컨테이너만 제거, 볼륨 유지)
docker compose down

# 중지 + 볼륨까지 삭제 (DB 초기화 시)
docker compose down -v
```

접속 주소:

| 서비스 | URL |
|--------|-----|
| 프런트엔드 | http://localhost:3000 |
| 백엔드 API | http://localhost:8000 |
| Swagger 문서 | http://localhost:8000/docs |

---

#### 개발 모드 (`docker-compose.dev.yml`)

코드 변경 시 자동 재시작(hot-reload)이 활성화됩니다. DB는 별도 실행 필요 (로컬 MySQL 또는 프로덕션 compose의 `db` 서비스 사용).

```bash
# 개발 서버 실행 (hot-reload 포함)
docker compose -f docker-compose.dev.yml up --build

# 백그라운드 실행
docker compose -f docker-compose.dev.yml up -d --build

# 중지
docker compose -f docker-compose.dev.yml down
```

> 개발 모드에서는 DB 서비스가 포함되지 않습니다.  
> 로컬 MySQL을 사용하거나, 프로덕션 compose로 DB만 먼저 실행하세요:
> ```bash
> docker compose up -d db   # DB 컨테이너만 먼저 실행
> docker compose -f docker-compose.dev.yml up --build
> ```

---

#### 컨테이너 내부 명령 실행

```bash
# 백엔드 컨테이너 셸 접속
docker compose exec backend bash

# DB 마이그레이션 수동 실행
docker compose exec backend alembic upgrade head

# 프런트엔드 컨테이너 셸 접속
docker compose exec frontend sh
```

---

### 로컬 개발 (Docker 없이)

**백엔드**

```bash
cd backend
cp .env.example .env
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

**프런트엔드**

```bash
cd frontend-next
npm install
npm run dev
```

---

## .env 필수 키

```env
# DB
DATABASE_URL=mysql+pymysql://user:password@localhost:3306/skema_db

# JWT
SECRET_KEY=your-secret-key

# AI (둘 중 하나 이상 필요)
GEMINI_API_KEY=...
OPENAI_API_KEY=...

# OAuth
KAKAO_CLIENT_ID=...
KAKAO_CLIENT_SECRET=...

# URL
FRONTEND_URL=http://localhost:3000
BACKEND_URL=http://localhost:8000
```

---

## 폴더 구조

```
capstone-design-2026-1/
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/versions/       # DB 마이그레이션 이력
│   └── app/
│       ├── main.py             # FastAPI 진입점
│       ├── ai_chat/            # AI 채팅·준비도 진단 API
│       ├── auth/               # JWT + OAuth 인증
│       ├── eta/                # 시간표 OCR 파서
│       ├── kakao/              # 카카오 OAuth·메시지 API
│       ├── notification/       # APScheduler 알림 작업
│       ├── schedule/           # 일정·시험 CRUD
│       ├── share/              # 공유 토큰
│       ├── syllabus/           # 강의계획서 업로드
│       ├── clients/            # Gemini API 클라이언트
│       ├── core/               # 설정, JWT, LLM 유틸
│       └── db/                 # DB 세션·베이스
└── frontend-next/
    ├── Dockerfile
    └── src/
        ├── app/
        │   ├── (auth)/         # 로그인·회원가입
        │   ├── (app)/          # 대시보드·온보딩
        │   └── share/[token]/  # 공유 시간표(읽기 전용)
        ├── components/
        │   ├── timetable/      # 시간표 뷰
        │   ├── class-form/     # 과목 추가·수정 폼
        │   ├── exam/           # 시험 일정 목록
        │   ├── settings/       # 설정 모달
        │   └── ui/             # shadcn/ui 공통 컴포넌트
        ├── hooks/              # useSchedules, useExams, useProfile 등
        ├── store/              # authStore, uiStore (Zustand)
        ├── lib/                # Axios 클라이언트, 서버 fetch, 포맷터
        └── types/              # 공통 TypeScript 타입
```

---

## 주요 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/auth/register` | 회원가입 |
| POST | `/auth/login` | JWT 로그인 |
| GET | `/auth/oauth/kakao` | Kakao OAuth |
| GET/PUT | `/users/me` | 내 정보 조회/수정 |
| GET/POST | `/schedules` | 일정 목록/추가 |
| PUT/DELETE | `/schedules/{id}` | 일정 수정/삭제 |
| GET | `/schedules/conflicts` | 시간 충돌 감지 |
| GET/POST | `/exam-schedules` | 시험 일정 조회/추가 |
| POST | `/eta/parse` | 시간표 이미지 OCR |
| POST | `/ai/readiness-summary` | 시험 준비도 AI 진단 |
| POST | `/kakao/notify/schedule-summary` | 카카오톡 일정 알림 |
| POST | `/share` | 공유 토큰 생성 |
| GET | `/share/{token}` | 공유 시간표 조회 |
