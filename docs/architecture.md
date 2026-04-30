# 시스템 아키텍처 개요

> AI 기반 시간표·일정 관리 — 전체 구성과 데이터 흐름

```mermaid
graph TB
    subgraph Client[클라이언트 (Browser)]
        subgraph FE[Frontend — Next.js 16 (App Router + SSR)]
            direction TB
            Pages[Pages\n/login · /register\n/dashboard · /onboarding\n/share/[token]]
            Components[Components\nTimetable · AIChat\nClassForm · ExamList\nSettingsModal]
            Hooks[Hooks\nuseAuth · useSchedules\nuseExams · useProfile]
            Store[State (Zustand)\nauthStore · uiStore]
            ApiClient[API Client\nlib/api.ts (Axios, CSR)\nlib/server-api.ts (fetch, SSR)\nBearer Token 자동 주입]
            Pages --> Components
            Components --> Hooks
            Hooks --> ApiClient
            Store --> Components
        end
    end

    subgraph Backend[Backend — FastAPI (Python)]
        direction TB
        subgraph Modules[라우터 · 서비스 · 리포지토리 · 스키마 · 모델]
            AuthRouter[/auth · /users/me\nPOST /register · /login\nGET /oauth/{provider}]
            ScheduleRouter[/schedules · /exam-schedules\nCRUD 일정/시험]
            AIRouter[/ai/chat · /ai-chat-logs\nPOST 대화 처리]
            ShareRouter[/share-tokens · /share/{token}\n시간표 공유]
            ProfileRouter[/profiles/me\n프로필 조회/수정]
        end

        subgraph Core[Core]
            Security[core/security.py\nJWT 생성/검증 (HS256)]
            Deps[core/deps.py\nDB 세션 · 현재 사용자]
            Config[core/config.py\n환경변수 (pydantic-settings)]
        end

        subgraph Clients[External Clients]
            GeminiClient[clients/gemini_client.py\nGemini Function Calling\n일정 생성/추론]
        end

        subgraph DBLayer[Database Layer]
            DBSession[db/database.py\nSQLAlchemy 세션/엔진]
            DBBase[db/base.py\nBase · 모델 import]
        end

        Modules --> Core
        Modules --> DBLayer
        AIRouter --> GeminiClient
    end

    subgraph Infra[배포 (Docker Compose)]
        MySQL[(MySQL\nskema_db)]
        Alembic[Alembic\nDB 마이그레이션]
    end

    ApiClient -- "HTTP REST / JSON" --> Modules
    DBLayer -- "ORM Query" --> MySQL
    Alembic -- "Schema Migration" --> MySQL
    GeminiClient -- "google-genai SDK" --> Gemini[Google Gemini API]
    AuthRouter -- "OAuth 2.0 Redirect" --> OAuth[OAuth Providers\nGoogle · Naver · Kakao]

    style Client fill:#EFF6FF,stroke:#3B82F6
    style Backend fill:#F0FDF4,stroke:#22C55E
    style Infra fill:#FEF9C3,stroke:#EAB308
```
