# 운영 배포

| 구성 | 서비스 | 주소 |
| --- | --- | --- |
| 프론트엔드 | Vercel (`frontend-next`) | https://skema-dku.vercel.app |
| 백엔드 | Railway (`backend/Dockerfile`, 싱가포르) | https://backend-production-e565.up.railway.app |
| DB | Railway MySQL 8 | (내부 주소) |
| 영상 저장 | Cloudflare R2 비공개 버킷 | 서명 주소(1시간)로만 재생 |

`main`에 PR이 머지되면 Vercel과 Railway가 자동으로 새로 배포합니다.

## 백엔드 (Railway)

- `backend/Dockerfile`로 빌드합니다. 이미지 안에 Tesseract와 한국어·영어 `tessdata_best`(sha256 확인)가 들어갑니다.
- 컨테이너가 켜질 때 `entrypoint.sh`가 DB 연결을 기다린 뒤 **Alembic 마이그레이션을 자동 실행**하고 서버를 띄웁니다. 마이그레이션이 실패하면 배포가 멈춥니다. 테이블은 이미 있고 버전 기록만 빠진 DB처럼 꼭 필요할 때만 `ALEMBIC_STAMP_ON_FAILURE=1`로 넘어갈 수 있습니다.
- ⚠️ **Serverless(잠자기) 끄기, Replica 1대.** 알림 예약 작업(APScheduler)이 서버 안에서 돌기 때문에, 잠들면 알림이 멈추고 2대면 알림이 두 번 갑니다. 요청 횟수 제한도 서버 메모리에서 세므로 1대 기준입니다.

### 환경변수 (값은 Railway에만 넣고 저장소·문서·채팅에 적지 않기)

| 변수 | 설명 |
| --- | --- |
| `DATABASE_URL` | Railway MySQL 주소 (`mysql+pymysql://…`) |
| `SECRET_KEY` | JWT 서명 키 (32자 이상 무작위 문자열). **운영(`BACKEND_URL`이 https)에서 비어 있거나 기본값이면 서버가 시작하지 않음** |
| `FRONTEND_URL`, `CORS_ORIGINS` | `https://skema-dku.vercel.app` |
| `BACKEND_URL` | 백엔드 공개 주소. 소셜 로그인 콜백 주소를 만들 때 씀 |
| `KAKAO_*`, `NAVER_*`, `GOOGLE_*` | 소셜 로그인 앱 키 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | 웹 푸시 키 (`scripts/generate-vapid-keys.py`). **바꾸면 기존 구독이 모두 끊기므로 바꾸지 않기** |
| `STORAGE=r2`, `R2_*` | 영상 저장소 |
| `ADMIN_EMAILS` | 관리자 화면 접근 계정 |
| `ETA_TEXT_ENGINE=ocr` | 시간표 인식기 (기본값) |

### 소셜 로그인 콜백 주소

각 개발자 콘솔에 `{BACKEND_URL}/auth/{provider}/callback` 을 등록합니다.

- 카카오: `…/auth/kakao/callback`
- 네이버: `…/auth/naver/callback` (서비스 URL은 프론트 주소)
- 구글: `…/auth/google/callback` · 승인된 도메인 `skema-dku.vercel.app` · 개인정보처리방침 `https://skema-dku.vercel.app/privacy`

## 프론트엔드 (Vercel)

- 루트 디렉터리: `frontend-next` · 프레임워크: Next.js
- 환경변수: `NEXT_PUBLIC_API_URL` = 백엔드 공개 주소 (빌드할 때 번들에 들어감)
- 폰트는 프로젝트 안 파일을 씁니다 (빌드 중 외부 폰트 다운로드 실패로 배포가 깨지는 것을 막기 위해)
- 서비스워커(`public/sw.js`)가 바뀌면 사용자가 사이트를 한 번 새로고침해야 새 버전이 적용됩니다

## 서버 한 대로 직접 띄우기

Railway·Vercel 대신 서버 한 대에 Docker Compose(Caddy + 프론트 + 백엔드 + MySQL)로 띄우는 방법은 [`webapp-deploy.md`](webapp-deploy.md)에 있습니다. (지금 운영에는 쓰지 않음)
