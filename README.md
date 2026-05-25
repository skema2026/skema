# SKEMA — AI 기반 개인 시간표·학습 관리

> Scheme에서 따온 이름, SKEMA. 학생의 시간표와 학습 일정을 스마트하게 관리하고, AI가 일정 파싱·채팅·준비도 분석까지 도와줍니다.

---

## 주요 기능

- **시간표 OCR**: 시간표 이미지를 업로드하면 AI가 자동으로 일정을 파싱·등록
- **일정 CRUD**: 과목명, 요일/시간, 장소, 메모, 우선순위, 유형(수업/자율학습/과제/활동/개인)
- **시험 일정 관리**: 중간·기말·퀴즈 등 시험 일정 별도 관리
- **이벤트 관리**: 수업·시험 외 별도 이벤트 일정 등록
- **AI 채팅**: 일정 기반 맥락을 이해하는 AI 어시스턴트 (GPT-4.1)
- **준비도 진단**: 시험 연결 일정 수행률 분석 + AI 피드백
- **대시보드**: 오늘 일정 요약, 다음 일정, 빈 시간대 시각화
- **알림 센터**: 앱 내 알림 목록, 읽음 처리, 알림 설정(유형별 ON/OFF)
- **웹 푸시 알림**: Service Worker 기반 OS 푸시 알림 (Android 즉시 / iOS PWA 필요)
  - 일정 시작 30분 전 리마인더
  - 매일 09:00 동기부여 메시지
  - 매주 월요일 주간 수행률 리포트
  - 매주 수요일 평균 대비 비교 알림
- **카카오 알림**: 카카오톡으로 일정 요약 메시지 발송
- **일정 공유**: 읽기 전용 공유 토큰으로 시간표 URL 공유
- **OAuth 로그인**: Kakao OAuth + 이메일/비밀번호 JWT 인증

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프런트엔드 | Next.js 15, React 19, TypeScript, Tailwind CSS v4, shadcn/ui |
| 상태관리 | Zustand v5, TanStack React Query v5 |
| 백엔드 | FastAPI (Python 3.11+), SQLAlchemy ORM, Alembic |
| 데이터베이스 | MySQL 8.0 |
| 인증 | JWT (python-jose, bcrypt) + Kakao OAuth 2.0 |
| AI | OpenAI GPT-4.1 (채팅·OCR·준비도 분석) |
| 알림 | APScheduler (푸시 스케줄러) + Web Push API (VAPID) + Kakao 메시지 API |
| 운영 | Docker, Docker Compose |

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

코드 변경 시 자동 재시작(hot-reload)이 활성화됩니다.

```bash
# DB + 백엔드만 컨테이너로 실행 (프런트는 로컬 dev 서버 사용)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db backend

# 프런트 dev 서버 별도 실행
cd frontend-next && npm run dev

# 백엔드 재시작
docker compose -f docker-compose.yml -f docker-compose.dev.yml restart backend
```

---

#### 컨테이너 내부 명령 실행

```bash
# 백엔드 컨테이너 셸 접속
docker compose exec backend bash

# DB 마이그레이션 수동 실행
docker compose exec backend alembic upgrade head
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
cp .env.local.example .env.local   # 없으면 직접 생성 (아래 참고)
npm install
npm run dev
```

`frontend-next/.env.local`:
```
NEXT_PUBLIC_API_URL=/proxy
INTERNAL_API_URL=http://localhost:8000
```

---

### 모바일 테스트 (ngrok)

모바일(Android/iPhone)에서 로컬 개발 서버를 테스트할 때 사용합니다.

1. ngrok 설치 및 계정 연동
   ```bash
   winget install ngrok.ngrok
   ngrok config add-authtoken <토큰>
   ```

2. ngrok 실행 (프런트 dev 서버가 켜진 상태에서)
   ```bash
   ngrok http 3000
   ```
   → 표시된 `https://xxxx.ngrok-free.app` URL 메모

3. `frontend-next/next.config.ts`의 `allowedDevOrigins` 업데이트
   ```ts
   allowedDevOrigins: ['xxxx.ngrok-free.app'],
   ```

4. 루트 `.env` 업데이트
   ```
   CORS_ORIGINS=http://localhost:3000,https://xxxx.ngrok-free.app
   FRONTEND_URL=https://xxxx.ngrok-free.app
   ```

5. 백엔드 재시작 후 모바일에서 ngrok URL 접속

> **iOS 푸시 알림**: Safari에서 공유 버튼 → "홈 화면에 추가" 후 해당 아이콘으로 실행해야 동작 (iOS 16.4+ 필요)  
> **Android 푸시 알림**: Chrome 브라우저 탭에서 바로 동작  
> **ngrok 무료 플랜**: 재실행 시 URL이 바뀌므로 3~5단계 반복 필요

---

## .env 필수 키

```env
# DB
DATABASE_URL=mysql+pymysql://user:password@localhost:3306/skema_db

# JWT
SECRET_KEY=your-secret-key

# AI
OPENAI_API_KEY=...

# Web Push (VAPID)
VAPID_PRIVATE_KEY=...
VAPID_PUBLIC_KEY=...
VAPID_CLAIMS_EMAIL=mailto:your@email.com

# OAuth
KAKAO_CLIENT_ID=...
KAKAO_CLIENT_SECRET=...

# URL
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
```

---

## 폴더 구조

```
capstone-design-2026-1/
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/versions/       # DB 마이그레이션 이력
│   └── app/
│       ├── main.py             # FastAPI 진입점 + 라우터 등록
│       ├── ai_chat/            # AI 채팅·준비도 진단 API
│       ├── auth/               # JWT + OAuth 인증, 프로필
│       ├── eta/                # 시간표 이미지 OCR 파서
│       ├── kakao/              # 카카오 OAuth·메시지 API
│       ├── notification/       # APScheduler 푸시 스케줄러 + 알림 CRUD
│       ├── schedule/           # 일정·시험·이벤트 CRUD
│       ├── share/              # 공유 토큰
│       ├── admin/              # 관리자 API
│       ├── core/               # 설정, JWT, LLM 유틸
│       └── db/                 # DB 세션·베이스
└── frontend-next/
    ├── Dockerfile
    ├── public/
    │   └── sw.js               # Service Worker (웹 푸시)
    └── src/
        ├── app/
        │   ├── (auth)/         # 로그인·회원가입
        │   ├── (app)/
        │   │   ├── dashboard/  # 대시보드 (오늘 일정·AI 채팅)
        │   │   ├── onboarding/ # 최초 시간표 등록
        │   │   ├── notifications/ # 알림 센터
        │   │   ├── profile/    # 프로필 설정
        │   │   ├── report/     # 주간 리포트
        │   │   └── ai_chat/    # AI 채팅
        │   └── share/[token]/  # 공유 시간표 (읽기 전용)
        ├── components/
        │   ├── timetable/      # 시간표 뷰
        │   ├── class-form/     # 과목 추가·수정 폼
        │   ├── ai-chat/        # AI 채팅 컴포넌트
        │   └── ui/             # shadcn/ui 공통 컴포넌트
        ├── hooks/              # useSchedules, useExams, useProfile, usePushNotifications 등
        ├── store/              # authStore (Zustand)
        ├── lib/                # Axios 클라이언트, 서버 fetch
        └── types/              # 공통 TypeScript 타입
```

---

## 주요 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/auth/signup` | 회원가입 |
| POST | `/auth/login` | JWT 로그인 |
| GET | `/auth/{provider}/authorize` | OAuth 로그인 (kakao) |
| GET/PUT | `/users/me` | 내 정보 조회/수정 |
| GET/PUT | `/profiles` | 프로필 조회/수정 |
| GET/POST | `/schedules` | 일정 목록/추가 |
| PUT/DELETE | `/schedules/{id}` | 일정 수정/삭제 |
| GET/POST | `/exam-schedules` | 시험 일정 조회/추가 |
| GET/POST | `/events` | 이벤트 조회/추가 |
| POST | `/eta/parse-image` | 시간표 이미지 OCR |
| POST | `/eta/save-schedules` | OCR 결과 일정 저장 |
| POST | `/ai/chat` | AI 채팅 |
| POST | `/ai/readiness-summary` | 시험 준비도 AI 진단 |
| GET | `/notifications` | 알림 목록 |
| GET/PUT | `/notifications/prefs` | 알림 설정 조회/수정 |
| GET | `/push/public-key` | VAPID 공개키 |
| POST | `/push/subscriptions` | 푸시 구독 등록 |
| DELETE | `/push/subscriptions` | 푸시 구독 해제 |
| POST | `/push/test` | 테스트 푸시 발송 |
| POST | `/share-tokens` | 공유 토큰 생성 |
| GET | `/share/{token}` | 공유 시간표 조회 |
| POST | `/kakao/notify/schedule-summary` | 카카오톡 일정 알림 |
