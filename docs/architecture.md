# 시스템 아키텍처 다이어그램

> AI 기반 시간표 관리 시스템 — 전체 구조 및 데이터 흐름

```mermaid
graph TB
    subgraph Client["클라이언트 (Browser)"]
        subgraph FE["Frontend — Next.js 16 (App Router + SSR)"]
            direction TB
            Pages["Pages\n/login · /register\n/dashboard · /onboarding\n/share/[token]"]
            Components["Components\nTimetable · AIChat\nClassForm · ExamList\nSettingsModal"]
            Hooks["Hooks\nuseAuth · useSchedules\nuseExams · useProfile"]
            Store["State (Zustand)\nauthStore · uiStore"]
            ApiClient["API Client\nlib/api.ts (Axios, CSR)\nlib/server-api.ts (fetch, SSR)\nBearer Token 자동 주입"]

            Pages --> Components
            Components --> Hooks
            Hooks --> ApiClient
            Store --> Components
        end
    end

    subgraph Backend["Backend — FastAPI (Python)"]
        direction TB
        subgraph Modules["모듈별 구조 (router · service · repository · schema · model)"]
            AuthRouter["/auth · /users/me\nPOST /register · /login\nGET /oauth/{provider}"]
            ScheduleRouter["/schedules · /exam-schedules\nCRUD 일정·시험 관리"]
            AIRouter["/ai/chat · /ai-chat-logs\nPOST 대화 처리"]
            ShareRouter["/share-tokens · /share/{token}\n시간표 공유 토큰"]
            ProfileRouter["/profiles/me\n온보딩 · 프로필"]
        end

        subgraph Core["Core"]
            Security["core/security.py\nJWT 생성·검증 (HS256)"]
            Deps["core/deps.py\nDB 세션 · 현재 유저 의존성"]
            Config["core/config.py\n환경변수 (pydantic-settings)"]
        end

        subgraph Clients["External Clients"]
            GeminiClient["clients/gemini_client.py\nGemini Function Calling\n일정 도구 실행 루프"]
        end

        subgraph DBLayer["Database Layer"]
            DBSession["db/database.py\nSQLAlchemy 엔진·세션"]
            DBBase["db/base.py\nBase · 모델 import 통합"]
        end

        Modules --> Core
        Modules --> DBLayer
        AIRouter --> GeminiClient
    end

    subgraph Infra["인프라 (Docker Compose)"]
        MySQL[("MySQL\nskema_db")]
        Alembic["Alembic\nDB 마이그레이션"]
    end

    subgraph External["외부 서비스"]
        Gemini["Google Gemini API\ngemini-2.5-flash\nFunction Calling"]
        OAuth["OAuth Providers\nGoogle · Naver · Kakao"]
    end

    %% 데이터 흐름
    ApiClient -- "HTTP REST / JSON" --> Modules
    DBLayer -- "ORM Query" --> MySQL
    Alembic -- "Schema Migration" --> MySQL
    GeminiClient -- "google-genai SDK" --> Gemini
    AuthRouter -- "OAuth 2.0 Redirect" --> OAuth

    %% 인증 흐름
    Security -- "JWT 24h" --> ApiClient

    %% 공유 흐름
    ShareRouter -- "공개 URL /share/[token]" --> Pages

    style Client fill:#EFF6FF,stroke:#3B82F6
    style Backend fill:#F0FDF4,stroke:#22C55E
    style Infra fill:#FEF9C3,stroke:#EAB308
    style External fill:#FDF4FF,stroke:#A855F7
```

## 구성 요소별 역할

| 레이어 | 기술 | 역할 |
|--------|------|------|
| Frontend | Next.js 16, React 19, Zustand, TailwindCSS v4, shadcn/ui | UI 렌더링(SSR/CSR), 상태 관리, API 통신 |
| Backend | FastAPI, SQLAlchemy, Alembic, passlib, python-jose | REST API, 비즈니스 로직, JWT 인증 |
| Database | MySQL | 사용자·일정·시험·프로필·공유토큰 영속 저장 |
| AI | Google Gemini 2.5 Flash | 자연어 일정 관리 (Function Calling) |
| OAuth | Google / Naver / Kakao | 소셜 로그인 |
| 인프라 | Docker, Docker Compose | 컨테이너 빌드·오케스트레이션 |

## 주요 데이터 흐름

1. **인증**: 로그인 → JWT 발급 → `localStorage` 저장 → 모든 요청 헤더에 `Bearer` 자동 첨부
2. **SSR**: 서버 컴포넌트에서 `server-api.ts`를 통해 토큰 기반 데이터 선패치 → 초기 렌더링 제공
3. **일정 CRUD**: 프론트엔드 훅 → Axios → `/schedules` 라우터 → SQLAlchemy → MySQL
4. **AI 채팅**: 사용자 메시지 → `/ai/chat` → Gemini Function Calling 루프 → 도구 실행(일정 CRUD) → 자연어 응답 반환
5. **시간표 공유**: 공유 토큰 생성 → `/share/[token]` 공개 URL → 인증 없이 열람 가능
6. **온보딩**: 최초 로그인 → `/onboarding` → 수면 시간·직업 입력 → AI 학습 일정 자동 생성에 활용
