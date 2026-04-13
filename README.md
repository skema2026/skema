# SKEMA — AI 기반 개인 시간표·일정 관리

> Scheme에서 따온 이름, SKEMA. 학생의 시간표와 학습 일정을 깔끔하게 관리하고, AI가 빠르게 만들어 줍니다.

SKEMA는 이미지/문서에서 시간표·강의계획서를 읽어 구조화하고, 사용자의 일정 CRUD, 시험 일정, 공유 링크, OAuth 로그인을 지원합니다. Google Gemini 2.5 Flash의 Function Calling을 활용해 한국어 그대로의 텍스트를 보존한 채 일정을 자동 생성합니다.

---

## 주요 기능

- 일정/과목 CRUD: 과목명, 요일/시간, 장소, 메모, 우선순위, 유형(class/study/event)
- 시험 일정: 중간·기말·퀴즈 등 별도 관리, 충돌 감지
- 공유 링크: 읽기 전용 공유 토큰으로 시간표 공유
- 인증: JWT 로그인 + Google/Naver/Kakao OAuth
- 온보딩: 최초 로그인 시 기본 일정 입력 → AI가 학습 일정 자동 생성
- 권한/보안: 공유 링크는 읽기 전용, 토큰 만료/폐기 지원
- AI 대화: 자연어로 “다음 주 수요일 2시~4시 스터디 추가” 같이 요청하면 바로 일정 생성

---

## 기술 스택

- 프런트엔드: Next.js 16, React 19, TypeScript, Tailwind CSS v4, shadcn/ui
- 상태관리/데이터: Zustand v5, TanStack React Query v5, Axios/fetch
- 백엔드: FastAPI (Python 3.11+), SQLAlchemy ORM, Alembic
- 데이터베이스: MySQL
- 인증: JWT (python-jose, passlib) + OAuth 2.0 (Google · Naver · Kakao)
- AI: Google Gemini 2.5 Flash + Function Calling
- 운영: Docker, Docker Compose

---

## 빠른 시작

### Docker Compose

```bash
cp .env.example .env
docker-compose up --build
```

- 프런트엔드: http://localhost:3000
- 백엔드 API: http://localhost:8000
- Swagger 문서: http://localhost:8000/docs

### 로컬 실행

백엔드

```bash
cd backend
cp .env.example .env
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

프런트엔드

```bash
cd frontend-next
npm install
npm run dev
```

---

## .env 필수 키

```env
SECRET_KEY=...
DATABASE_URL=mysql+pymysql://user:password@localhost:3306/skema_db

GEMINI_API_KEY=...

# OAuth 로그인 (선택)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NAVER_CLIENT_ID=...
NAVER_CLIENT_SECRET=...
KAKAO_CLIENT_ID=...
KAKAO_CLIENT_SECRET=...

FRONTEND_URL=http://localhost:3000
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
│   ├── alembic/
│   │   └── versions/
│   │       └── 001_initial_schema.py   # 최초 DB 스키마
│   └── app/
│       ├── main.py                     # FastAPI 진입점
│       ├── ai_chat/                    # AI 채팅 모듈
│       ├── auth/                       # 인증 모듈
│       ├── schedule/                   # 일정/시험 모듈
│       ├── share/                      # 공유 모듈
│       ├── clients/                    # Gemini API 클라이언트
│       ├── core/                       # 설정, JWT, 공통 유틸
│       └── db/                         # DB 세션/베이스
└── frontend-next/
    ├── Dockerfile
    └── src/
        ├── app/
        │   ├── (auth)/                 # 로그인/회원가입
        │   ├── (app)/                  # 대시보드/온보딩
        │   └── share/[token]/          # 공유 시간표(읽기 전용)
        ├── components/
        │   ├── timetable/              # 시간표 뷰
        │   ├── class-form/             # 과목 추가/수정
        │   ├── ai-chat/                # AI 채팅 UI
        │   ├── exam/                   # 시험 일정 목록
        │   ├── settings/               # 설정 모달
        │   └── ui/                     # shadcn/ui 공통 컴포넌트
        ├── hooks/                      # useSchedules, useAuth, useExams, useProfile
        ├── store/                      # authStore, uiStore (Zustand)
        ├── lib/                        # Axios 서비스, 서버 fetch, 포맷터 등
        └── types/                      # TS 공통 타입
```

---

## 주요 API (요약)

- POST `/auth/register`  회원가입
- POST `/auth/login`     로그인(JWT)
- GET  `/auth/oauth/{provider}`  OAuth (google/naver/kakao)
- GET/PUT `/users/me`    내 정보 조회/수정
- GET/POST `/schedules`  일정 목록 조회/추가
- PUT/DELETE `/schedules/{id}` 일정 수정/삭제
- GET/POST `/exam-schedules` 시험 일정 조회/추가
- DELETE `/exam-schedules/{id}` 시험 일정 삭제
- GET/PUT `/profiles/me` 프로필 조회/수정
- POST `/ai/chat`        AI 대화형 액션 전송
- POST `/share-tokens`   공유 토큰 생성
- GET  `/share/{token}`  공유 시간표 조회

---

## 인코딩/문자 가이드

- 한국어 텍스트는 반드시 UTF-8로 저장합니다.
- 한국어를 한자로 자동 치환하거나, 한자·일문 혼용 표기를 사용하지 않습니다.
- 문서에서 한자처럼 보이는 이상 문자는 기존 인코딩 깨짐(모지바케)에서 비롯된 것으로, 전부 정정했습니다.
