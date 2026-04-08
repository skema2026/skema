/**
 * 인증 토큰을 자동으로 실어 보내는 fetch 헬퍼
 *  - opts.raw === true → 그대로 res (Response) 또는 res.json() 반환
 */

import { API_BASE } from "../lib/api";

export async function fetchWithAuth<T = any>(
  url: string,
  opts: RequestInit & { raw?: boolean } = {},
): Promise<T> {
  const token   = localStorage.getItem("token");
  const headers = new Headers(opts.headers);

  if (token) headers.set("Authorization", `Bearer ${token}`);

  // JSON Body면 Content-Type 지정
  if (opts.body && !(opts.body instanceof FormData))
    headers.set("Content-Type", headers.get("Content-Type") || "application/json");

  const { raw, ...fetchOpts } = opts;

  const res = await fetch(`${API_BASE}${url}`, {
    redirect: "follow",     // 307 Redirect 도 따라가도록
    ...fetchOpts,
    headers,
  });

  /* ---------- 성공 ---------- */
  if (res.ok) {
    return raw ? (await (opts.raw ? res : res.json())) as T
               : (await res.json()) as T;
  }

  /* ---------- 401 처리 ---------- */
  if (res.status === 401) {
    // ① 클라이언트 측 인증 상태 초기화
    localStorage.removeItem("token");

    // ② 로그인 화면으로 이동 (SPA ↔ 직접 새로고침 모두 OK)
    if (window.location.pathname !== "/login") {
      window.location.replace("/login");
    }

    // 이후 로직은 굳이 실행할 필요 없지만,
    // 호출 쪽에서 try/catch 로 흐름을 맞출 수 있게 Error 는 던져 둡니다.
    const err401 = new Error("Unauthorized") as Error & { status: number };
    err401.status = 401;
    throw err401;
  }

  /* ---------- 에러 처리 ---------- */
  let detail: any = {};
  try { detail = await res.json(); } catch { /* text/html 인 경우 무시 */ }

  // status·detail 을 가진 객체를 던진다
  const err = new Error(detail?.detail || res.statusText) as Error & { status:number; body:any };
  err.status = res.status;
  err.body   = detail;
  throw err;
}
