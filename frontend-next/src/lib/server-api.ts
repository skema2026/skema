import { cookies } from 'next/headers';

// 서버 컴포넌트는 Docker 내부 네트워크 URL을 사용 (INTERNAL_API_URL)
// 로컬 개발 시에는 NEXT_PUBLIC_API_URL 또는 localhost 폴백
const API_BASE = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function serverFetch<T>(path: string): Promise<T | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;
  if (!token) return null;

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store', // 항상 최신 데이터 (SSR)
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}
