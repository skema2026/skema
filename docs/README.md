# 문서

## 제출물 (캡스톤 페스티벌 2026)

| 제출물 | 위치 | 상태 |
| --- | --- | --- |
| 포스터 (90×140cm, PDF) | [`poster/`](poster/) | 준비 중 (11/16 전) |
| 프로젝트 결과보고서 (PDF) | [`report/`](report/) | 준비 중 (11/16 전) |
| 시연 영상 | 메인 [README](../README.md) 맨 위 링크 | 준비 중 (11/16 전) |
| 소스 코드 | 이 저장소 | ✅ |
| 실행 방법·배포 주소 | 메인 [README](../README.md#6-실행-방법) | ✅ |

## 개발 문서

| 문서 | 내용 |
| --- | --- |
| [architecture.md](architecture.md) | 시스템 구성, 시간표 등록·공부 블록 배치·다시 짜기·알림 흐름, 주요 API |
| [timetable-recognition.md](timetable-recognition.md) | 시간표 인식기(OpenCV + Tesseract) 처리 단계, 보정 규칙, 정확도 |
| [erd.md](erd.md) | DB 구조 (ERD) |
| [deploy.md](deploy.md) | 운영 배포 (Railway + Vercel), 환경변수, 소셜 로그인 콜백 |
| [webapp-deploy.md](webapp-deploy.md) | 서버 한 대에 Docker Compose로 직접 띄우기 (참고) |

API 전체 목록은 서버의 Swagger 문서에서 볼 수 있습니다: https://backend-production-e565.up.railway.app/docs
