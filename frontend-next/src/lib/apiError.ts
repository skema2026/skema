// 서버가 보낸 오류 안내(detail)를 꺼낸다. 없으면 기본 문구 (11/7).
// 429(요청 과다)·413(너무 큼)·422(형식 거절)는 서버 안내가 사용자에게 의미 있어서 그대로 보여 준다.
export function apiErrorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { status?: number; data?: { detail?: unknown } } };
  const detail = e?.response?.data?.detail;
  const status = e?.response?.status;
  if (typeof detail === 'string' && detail && status && [413, 422, 429].includes(status)) {
    return detail;
  }
  return fallback;
}
