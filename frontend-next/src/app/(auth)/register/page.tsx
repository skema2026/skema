'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { useRegister } from '@/hooks/useAuth';
import AuthNavbar from '@/components/layout/AuthNavbar';
import AuthFooter from '@/components/layout/AuthFooter';
import MaterialIcon from '@/components/common/MaterialIcon';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 256 262" preserveAspectRatio="xMidYMid">
    <path d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622 38.755 30.023 2.685.268c24.659-22.774 38.875-56.282 38.875-96.027" fill="#4285F4"/>
    <path d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055-34.523 0-63.824-22.773-74.269-54.25l-1.531.13-40.298 31.187-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1" fill="#34A853"/>
    <path d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82 0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602l42.356-32.782" fill="#FBBC05"/>
    <path d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0 79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251" fill="#EB4335"/>
  </svg>
);

const NaverIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <rect width="24" height="24" rx="4" fill="#03C75A"/>
    <path d="M13.56 12.28L10.26 7H7v10h3.44l3.3-5.28V17H17V7h-3.44v5.28z" fill="white"/>
  </svg>
);

const KakaoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18">
    <path d="M9 1C4.582 1 1 3.896 1 7.455c0 2.257 1.493 4.243 3.746 5.378l-.956 3.493c-.084.307.27.549.536.363L8.2 13.997A9.93 9.93 0 0 0 9 14c4.418 0 8-2.896 8-6.545C17 3.896 13.418 1 9 1z" fill="#3C1E1E"/>
  </svg>
);

export default function RegisterPage() {
  const router = useRouter();
  const registerMutation = useRegister();

  const [form, setForm] = useState({ username: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  const handleSocialLogin = (provider: string) => {
    window.location.href = `${API_BASE}/auth/${provider}/authorize`;
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!form.username.trim()) newErrors.username = '아이디를 입력해주세요';
    else if (form.username.length < 3) newErrors.username = '아이디는 3자 이상이어야 합니다';
    if (!form.email.trim()) newErrors.email = '이메일을 입력해주세요';
    else if (!/\S+@\S+\.\S+/.test(form.email)) newErrors.email = '올바른 이메일 형식이 아닙니다';
    if (!form.password) newErrors.password = '비밀번호를 입력해주세요';
    else if (form.password.length < 6) newErrors.password = '비밀번호는 6자 이상이어야 합니다';
    if (form.password !== form.confirmPassword) newErrors.confirmPassword = '비밀번호가 일치하지 않습니다';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    registerMutation.mutate(
      { username: form.username, email: form.email, password: form.password },
      {
        onSuccess: () => {
          toast.success('회원가입이 완료되었습니다. 로그인해주세요.');
          router.push('/login');
        },
        onError: (err: unknown) => {
          const error = err as { response?: { data?: { detail?: string } } };
          const detail = error?.response?.data?.detail;
          if (detail?.includes('username')) {
            toast.error('이미 사용 중인 아이디입니다');
          } else if (detail?.includes('email')) {
            toast.error('이미 사용 중인 이메일입니다');
          } else {
            toast.error('회원가입 중 오류가 발생했습니다');
          }
        },
      }
    );
  };

  return (
    <>
      <style>{`
        .register-input {
          width: 100%;
          padding: 10px 14px;
          border-radius: 8px;
          outline: none;
          border: 1.5px solid #e5e7eb;
          transition: border-color 0.2s, box-shadow 0.2s;
          background: #fff;
          color: #111827;
          font-family: inherit;
          font-size: 14px;
          box-sizing: border-box;
        }
        .register-input:focus {
          border-color: #1a4db2;
          box-shadow: 0 0 0 3px rgba(26,77,178,0.1);
        }
        .register-input.error {
          border-color: #ef4444;
        }
      `}</style>

      <div className="min-h-screen flex flex-col" style={{ background: 'var(--skema-surface)', color: 'var(--skema-on-surface)' }}>
        <AuthNavbar mode="register" />

        {/* Main */}
        <main className="flex-grow flex pt-16">
          {/* Left Panel */}
          <div
            className="hidden lg:flex lg:w-1/2 flex-col justify-center px-16 py-12"
            style={{ background: 'var(--skema-primary)', color: '#fff' }}
          >
            <div className="max-w-md">
              <h2
                className="skema-headline text-4xl font-bold mb-4 leading-tight"
              >
                Master your time
                <br />
                with AI precision.
              </h2>
              <p className="text-base leading-relaxed mb-10 opacity-90">
                AI가 당신의 학습 패턴을 분석하고, 최적화된 시간표를 설계해 드립니다.
                지금 바로 스마트한 시간 관리를 시작하세요.
              </p>

              <div className="flex flex-col gap-4 mb-10">
                <div
                  className="rounded-2xl p-5 flex items-start gap-4"
                  style={{ background: 'rgba(255,255,255,0.12)' }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(255,255,255,0.2)' }}
                  >
                    <MaterialIcon icon="psychology" size={20} color="#fff" />
                  </div>
                  <div>
                    <div className="font-bold mb-1">Smart Scheduling</div>
                    <div className="text-sm opacity-80">AI가 최적의 공부 시간을 예측하고 추천합니다</div>
                  </div>
                </div>

                <div
                  className="rounded-2xl p-5 flex items-start gap-4"
                  style={{ background: 'rgba(255,255,255,0.12)' }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(255,255,255,0.2)' }}
                  >
                    <MaterialIcon icon="insights" size={20} color="#fff" />
                  </div>
                  <div>
                    <div className="font-bold mb-1">Time Insights</div>
                    <div className="text-sm opacity-80">학습 효율을 분석하고 개선점을 제안합니다</div>
                  </div>
                </div>
              </div>

              {/* Decorative box */}
              <div
                className="rounded-2xl p-6 relative overflow-hidden"
                style={{
                  background: 'linear-gradient(135deg, #3b66cc 0%, #1a4db2 100%)',
                  border: '1px solid rgba(255,255,255,0.2)',
                }}
              >
                <div
                  className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-20"
                  style={{ background: 'var(--skema-secondary-container)' }}
                />
                <div
                  className="absolute -bottom-4 -left-4 w-16 h-16 rounded-full"
                  style={{ background: 'var(--skema-tertiary-fixed)', opacity: 0.15 }}
                />
                <div className="relative z-10">
                  <div
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl mb-3"
                    style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}
                  >
                    <MaterialIcon icon="trending_up" size={18} color="#fff" />
                    <span className="font-bold text-lg">85% 효율 향상</span>
                  </div>
                  <div className="text-sm opacity-80">SKEMA 사용자 평균 학습 효율 향상율</div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel */}
          <div className="w-full lg:w-1/2 flex items-center justify-center px-6 py-12">
            <div className="w-full max-w-md">
              <div
                className="bg-white rounded-xl p-8 shadow-sm"
                style={{ border: '1px solid var(--skema-container)' }}
              >
                <div className="mb-6">
                  <h1
                    className="skema-headline text-2xl font-bold mb-1"
                    style={{ color: 'var(--skema-on-surface)' }}
                  >
                    계정 만들기
                  </h1>
                  <p className="text-sm" style={{ color: 'var(--skema-on-surface-variant)' }}>
                    SKEMA와 함께 스마트한 시간 관리를 시작하세요
                  </p>
                </div>

                {/* SNS 로그인 */}
                <div className="space-y-2 mb-5">
                  <button
                    type="button"
                    onClick={() => handleSocialLogin('google')}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border font-semibold text-sm transition-colors hover:bg-gray-50"
                    style={{ background: '#fff', border: '1px solid #d1d5db', color: '#111827' }}
                  >
                    <GoogleIcon />
                    Google로 시작하기
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSocialLogin('naver')}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border font-semibold text-sm transition-colors hover:bg-gray-50"
                    style={{ background: '#fff', border: '1px solid #d1d5db', color: '#111827' }}
                  >
                    <NaverIcon />
                    네이버로 시작하기
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSocialLogin('kakao')}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
                    style={{ background: '#FEE500', border: '1px solid #FEE500', color: '#3C1E1E' }}
                  >
                    <KakaoIcon />
                    카카오로 시작하기
                  </button>
                </div>

                {/* 구분선 */}
                <div className="flex items-center gap-3 mb-5">
                  <div className="flex-1 h-px" style={{ background: 'var(--skema-container)' }} />
                  <span className="text-xs" style={{ color: 'var(--skema-on-surface-variant)' }}>또는 이메일로 가입</span>
                  <div className="flex-1 h-px" style={{ background: 'var(--skema-container)' }} />
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Username */}
                  <div>
                    <label
                      htmlFor="username"
                      className="block text-xs font-bold uppercase tracking-wider mb-1.5"
                      style={{ color: 'var(--skema-on-surface-variant)' }}
                    >
                      아이디
                    </label>
                    <input
                      id="username"
                      type="text"
                      placeholder="아이디 (3자 이상)"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      className={`register-input${errors.username ? ' error' : ''}`}
                    />
                    {errors.username && (
                      <p className="text-xs mt-1" style={{ color: '#ef4444' }}>{errors.username}</p>
                    )}
                  </div>

                  {/* Email */}
                  <div>
                    <label
                      htmlFor="email"
                      className="block text-xs font-bold uppercase tracking-wider mb-1.5"
                      style={{ color: 'var(--skema-on-surface-variant)' }}
                    >
                      이메일
                    </label>
                    <input
                      id="email"
                      type="email"
                      placeholder="이메일 주소"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className={`register-input${errors.email ? ' error' : ''}`}
                    />
                    {errors.email && (
                      <p className="text-xs mt-1" style={{ color: '#ef4444' }}>{errors.email}</p>
                    )}
                  </div>

                  {/* Password */}
                  <div>
                    <label
                      htmlFor="password"
                      className="block text-xs font-bold uppercase tracking-wider mb-1.5"
                      style={{ color: 'var(--skema-on-surface-variant)' }}
                    >
                      비밀번호
                    </label>
                    <input
                      id="password"
                      type="password"
                      placeholder="비밀번호 (6자 이상)"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className={`register-input${errors.password ? ' error' : ''}`}
                    />
                    {errors.password && (
                      <p className="text-xs mt-1" style={{ color: '#ef4444' }}>{errors.password}</p>
                    )}
                  </div>

                  {/* Confirm Password */}
                  <div>
                    <label
                      htmlFor="confirmPassword"
                      className="block text-xs font-bold uppercase tracking-wider mb-1.5"
                      style={{ color: 'var(--skema-on-surface-variant)' }}
                    >
                      비밀번호 확인
                    </label>
                    <input
                      id="confirmPassword"
                      type="password"
                      placeholder="비밀번호를 다시 입력하세요"
                      value={form.confirmPassword}
                      onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                      className={`register-input${errors.confirmPassword ? ' error' : ''}`}
                    />
                    {errors.confirmPassword && (
                      <p className="text-xs mt-1" style={{ color: '#ef4444' }}>{errors.confirmPassword}</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={registerMutation.isPending}
                    style={{
                      width: '100%', height: '44px', marginTop: '8px',
                      background: registerMutation.isPending ? '#93aee8' : '#1a4db2',
                      color: '#fff', border: 'none', borderRadius: '8px',
                      fontSize: '14px', fontWeight: 700,
                      cursor: registerMutation.isPending ? 'not-allowed' : 'pointer',
                      transition: 'background 0.15s',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={(e) => { if (!registerMutation.isPending) (e.currentTarget as HTMLButtonElement).style.background = '#2d5fc4'; }}
                    onMouseLeave={(e) => { if (!registerMutation.isPending) (e.currentTarget as HTMLButtonElement).style.background = '#1a4db2'; }}
                  >
                    {registerMutation.isPending ? '처리 중...' : '회원가입'}
                  </button>
                </form>

                <div className="mt-5 p-3 rounded-xl text-center text-sm" style={{ background: '#f9fafb', border: '1px solid #e5e7eb' }}>
                  이미 계정이 있으신가요?{' '}
                  <Link href="/login" className="font-bold hover:underline" style={{ color: '#1a4db2' }}>
                    로그인하기 →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </main>

        <AuthFooter />
      </div>
    </>
  );
}
