/**
 * 백엔드 API의 Base URL을 계산한다.
 *
 * 1) .env 에서 VITE_API_URL 을 읽어오고
 * 2) 없으면   - 로컬(=localhost)  ➜  http://localhost:8000
 *              - 그 외(EC2·도메인) ➜  http://<현재호스트>:8000
 */
export const API_BASE =
  import.meta.env.VITE_API_URL ||
  (window.location.hostname === "localhost"
      ? "http://localhost:8000"
      : `http://${window.location.hostname}:8000`);
