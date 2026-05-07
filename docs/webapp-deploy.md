# SKEMA 웹앱 배포 가이드

이 구성은 한 대의 서버에서 Docker Compose로 다음 서비스를 실행합니다.

- `proxy`: Caddy, HTTPS 인증서 자동 발급
- `frontend`: Next.js 웹앱
- `backend`: FastAPI API 서버
- `db`: MySQL 8.0

## 1. 서버 준비

서버에는 Docker와 Docker Compose 플러그인이 필요합니다.

```bash
docker --version
docker compose version
```

방화벽 또는 클라우드 보안 그룹에서 `80`, `443` 포트를 열어야 합니다.

## 2. DNS 연결

도메인 DNS에서 아래 A 레코드를 서버 공인 IP로 연결합니다.

```text
skema.example.com      A  <server-ip>
api.skema.example.com  A  <server-ip>
```

## 3. 환경변수 작성

```bash
cp .env.production.example .env.production
```

`.env.production`에서 최소한 아래 값은 반드시 바꿉니다.

```env
APP_DOMAIN=skema.example.com
API_DOMAIN=api.skema.example.com
ACME_EMAIL=admin@example.com
MYSQL_ROOT_PASSWORD=...
MYSQL_PASSWORD=...
SECRET_KEY=...
FRONTEND_URL=https://skema.example.com
BACKEND_URL=https://api.skema.example.com
NEXT_PUBLIC_API_URL=https://api.skema.example.com
CORS_ORIGINS=https://skema.example.com
```

`NEXT_PUBLIC_API_URL`은 Next.js 빌드 결과에 포함됩니다. 값을 바꾼 뒤에는 프론트엔드를 다시 빌드해야 합니다.

푸시 알림을 사용하려면 VAPID 키를 생성해 `.env.production`에 추가합니다.

```bash
python3 scripts/generate-vapid-keys.py
```

출력된 값을 아래 환경변수에 넣습니다.

```env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@example.com
```

## 4. 실행

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

상태 확인:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f proxy
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backend
```

정상 URL:

```text
https://skema.example.com
https://api.skema.example.com/health
https://api.skema.example.com/docs
```

푸시 알림 확인:

1. 휴대폰에서 `https://skema.example.com` 접속
2. 로그인 후 설정 > 알림 > 휴대폰 푸시 > 푸시 켜기
3. 테스트 버튼으로 알림 수신 확인

모바일 브라우저 푸시는 HTTPS 보안 컨텍스트에서만 동작합니다. `http://192.168.x.x` 같은 로컬 LAN 주소에서는 브라우저 정책상 사용할 수 없습니다.

## 5. OAuth callback URL

OAuth를 사용하는 경우 각 개발자 콘솔의 callback URL을 배포 API 도메인으로 맞춥니다.

```text
https://api.skema.example.com/auth/google/callback
https://api.skema.example.com/auth/kakao/callback
https://api.skema.example.com/auth/naver/callback
```

코드의 실제 라우터와 공급자 콘솔 설정이 정확히 일치해야 합니다.

## 6. 업데이트 배포

```bash
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

## 7. 백업

DB는 Docker volume `mysql_data`에 저장됩니다. 운영 전에는 주기적인 `mysqldump` 백업을 설정하세요.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec db \
  sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' > skema_backup.sql
```
