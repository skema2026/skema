'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { useLogin } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';

/* ── Google SVG ── */
const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 256 262" preserveAspectRatio="xMidYMid">
    <path d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622 38.755 30.023 2.685.268c24.659-22.774 38.875-56.282 38.875-96.027" fill="#4285F4"/>
    <path d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055-34.523 0-63.824-22.773-74.269-54.25l-1.531.13-40.298 31.187-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1" fill="#34A853"/>
    <path d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82 0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602l42.356-32.782" fill="#FBBC05"/>
    <path d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0 79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251" fill="#EB4335"/>
  </svg>
);

/* ── Naver SVG ── */
const NaverIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <rect width="24" height="24" rx="4" fill="#03C75A"/>
    <path d="M13.56 12.28L10.26 7H7v10h3.44l3.3-5.28V17H17V7h-3.44v5.28z" fill="white"/>
  </svg>
);

/* ── Kakao SVG ── */
const KakaoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18">
    <path d="M9 1C4.582 1 1 3.896 1 7.455c0 2.257 1.493 4.243 3.746 5.378l-.956 3.493c-.084.307.27.549.536.363L8.2 13.997A9.93 9.93 0 0 0 9 14c4.418 0 8-2.896 8-6.545C17 3.896 13.418 1 9 1z" fill="#3C1E1E"/>
  </svg>
);

/* ── Eye Icons ── */
const EyeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>
);
const EyeOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

export default function LoginPage() {
  const router = useRouter();
  const { setToken } = useAuthStore();
  const loginMutation = useLogin();

  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const error = params.get('error');
    if (error) { toast.error('소셜 로그인에 실패했습니다'); return; }
    if (token) {
      setToken(token);
      toast.success('로그인 되었습니다');
      router.push('/dashboard');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSocialLogin = (provider: string) => {
    window.location.href = `${API_BASE}/auth/${provider}/authorize`;
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!form.email.trim()) newErrors.email = '이메일을 입력해주세요';
    if (!form.password) newErrors.password = '비밀번호를 입력해주세요';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    loginMutation.mutate(form, {
      onSuccess: (data) => {
        setToken(data.access_token);
        toast.success('로그인 되었습니다');
        router.push('/dashboard');
      },
      onError: (err: unknown) => {
        const error = err as { response?: { status?: number } };
        if (error?.response?.status === 401) {
          toast.error('아이디 또는 비밀번호가 올바르지 않습니다');
        } else {
          toast.error('로그인 중 오류가 발생했습니다');
        }
      },
    });
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* ── Left: Form Panel ── */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '48px',
        width: '100%',
        maxWidth: '520px',
        background: '#f9fafb',
        position: 'relative',
      }}>
        {/* Logo */}
        <div style={{ position: 'absolute', top: '32px', left: '48px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '28px', height: '28px', background: 'linear-gradient(135deg, #1a4db2, #3b66cc)', borderRadius: '7px' }} />
          <span style={{ fontSize: '18px', fontWeight: 700, color: '#11181c', letterSpacing: '-0.3px' }}>SKEMA</span>
        </div>

        {/* Form Container */}
        <div style={{ width: '100%', maxWidth: '380px', margin: '0 auto' }}>

          {/* Heading */}
          <div style={{ marginBottom: '32px' }}>
            <p style={{ fontSize: '30px', fontWeight: 600, color: '#11181c', marginBottom: '8px' }}>
              👋 다시 오셨군요!
            </p>
            <p style={{ fontSize: '14px', color: '#6b7280', lineHeight: 1.6 }}>
              Google, 네이버, 카카오 계정으로 로그인하거나<br />아이디와 비밀번호로 로그인하세요.
            </p>
          </div>

          {/* Social Login Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
            {/* Google */}
            <button
              type="button"
              onClick={() => handleSocialLogin('google')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                width: '100%', height: '45px', padding: '0 16px',
                background: '#fff', border: '1px solid #d3d3d8', borderRadius: '8px',
                cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: '#11181c',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}
            >
              <GoogleIcon />
              Google로 로그인
            </button>

            {/* Naver */}
            <button
              type="button"
              onClick={() => handleSocialLogin('naver')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                width: '100%', height: '45px', padding: '0 16px',
                background: '#fff', border: '1px solid #d3d3d8', borderRadius: '8px',
                cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: '#11181c',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}
            >
              <NaverIcon />
              네이버로 로그인
            </button>

            {/* Kakao */}
            <button
              type="button"
              onClick={() => handleSocialLogin('kakao')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                width: '100%', height: '45px', padding: '0 16px',
                background: '#FEE500', border: '1px solid #FEE500', borderRadius: '8px',
                cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: '#3C1E1E',
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              <KakaoIcon />
              카카오로 로그인
            </button>
          </div>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
            <span style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500 }}>또는</span>
            <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Email */}
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                이메일
              </label>
              <input
                type="text"
                placeholder="이메일을 입력하세요"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                style={{
                  width: '100%', height: '42px', padding: '0 12px',
                  background: '#fff', border: `1px solid ${errors.email ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '6px', fontSize: '14px', color: '#111827', outline: 'none',
                  boxSizing: 'border-box', transition: 'border-color 0.15s',
                  fontFamily: 'inherit',
                }}
                onFocus={(e) => { if (!errors.email) e.currentTarget.style.borderColor = '#1a4db2'; }}
                onBlur={(e) => { if (!errors.email) e.currentTarget.style.borderColor = '#d1d5db'; }}
              />
              {errors.email && <p style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>{errors.email}</p>}
            </div>

            {/* Password */}
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                비밀번호
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="비밀번호를 입력하세요"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  style={{
                    width: '100%', height: '42px', padding: '0 40px 0 12px',
                    background: '#fff', border: `1px solid ${errors.password ? '#ef4444' : '#d1d5db'}`,
                    borderRadius: '6px', fontSize: '14px', color: '#111827', outline: 'none',
                    boxSizing: 'border-box', transition: 'border-color 0.15s',
                    fontFamily: 'inherit',
                  }}
                  onFocus={(e) => { if (!errors.password) e.currentTarget.style.borderColor = '#1a4db2'; }}
                  onBlur={(e) => { if (!errors.password) e.currentTarget.style.borderColor = '#d1d5db'; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af',
                    display: 'flex', alignItems: 'center', padding: '2px',
                  }}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {errors.password && <p style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>{errors.password}</p>}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loginMutation.isPending}
              style={{
                width: '100%', height: '42px',
                background: loginMutation.isPending ? '#93aee8' : '#1a4db2',
                color: '#fff', border: 'none', borderRadius: '6px',
                fontSize: '14px', fontWeight: 600, cursor: loginMutation.isPending ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
                fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => { if (!loginMutation.isPending) e.currentTarget.style.background = '#3b66cc'; }}
              onMouseLeave={(e) => { if (!loginMutation.isPending) e.currentTarget.style.background = '#1a4db2'; }}
            >
              {loginMutation.isPending ? '로그인 중...' : '로그인'}
            </button>
          </form>

          {/* Register Link */}
          <p style={{ textAlign: 'center', fontSize: '13px', color: '#6b7280', marginTop: '20px' }}>
            계정이 없으신가요?{' '}
            <Link href="/register" style={{ color: '#1a4db2', fontWeight: 600, textDecoration: 'none' }}>
              회원가입
            </Link>
          </p>

          {/* Help */}
          <p style={{ textAlign: 'center', fontSize: '12px', color: '#9ca3af', marginTop: '32px', lineHeight: 1.6 }}>
            계정이나 구독에 문제가 있으신가요?{' '}
            <a href="mailto:support@skema.app" style={{ color: '#9ca3af', textDecoration: 'underline' }}>
              고객센터에 문의하세요
            </a>
          </p>
        </div>
      </div>

      {/* ── Right: Hero Panel ── */}
      <div style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #1a4db2 0%, #2d5fc4 40%, #4a7ae0 70%, #6b9bff 100%)',
        display: 'none',
      }}
        className="login-hero"
      >
        <style>{`
          @media (min-width: 1024px) { .login-hero { display: block !important; } }
        `}</style>

        {/* Grid pattern overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }} />

        {/* Floating blobs */}
        <div style={{ position: 'absolute', top: '15%', right: '10%', width: '280px', height: '280px', borderRadius: '50%', background: 'rgba(255,255,255,0.06)', filter: 'blur(40px)' }} />
        <div style={{ position: 'absolute', bottom: '20%', left: '5%', width: '200px', height: '200px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', filter: 'blur(30px)' }} />

        {/* Content */}
        <div style={{
          position: 'relative', zIndex: 1,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100%', padding: '48px', textAlign: 'center', color: '#fff',
        }}>
          <h1 style={{ fontSize: '32px', fontWeight: 700, lineHeight: 1.3, marginBottom: '16px', maxWidth: '420px' }}>
            AI가 설계하는<br />나만의 스마트 시간표
          </h1>
          <p style={{ fontSize: '16px', color: 'rgba(255,255,255,0.75)', marginBottom: '48px', maxWidth: '360px', lineHeight: 1.7 }}>
            시험 일정과 기존 수업을 분석해 빈 시간에 최적의 학습 계획을 자동으로 만들어드립니다.
          </p>

          {/* Feature Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', maxWidth: '360px' }}>
            {[
              { icon: '🗓️', title: '시험 기반 자동 배치', desc: '시험 날짜를 등록하면 AI가 역산해 공부 일정을 배치합니다' },
              { icon: '🤖', title: 'AI 채팅으로 일정 관리', desc: '자연어로 대화하듯 일정을 추가·수정·삭제할 수 있습니다' },
              { icon: '📊', title: '주간 수행률 리포트', desc: '완료한 일정을 시각화해 학습 패턴을 파악할 수 있습니다' },
            ].map((f) => (
              <div key={f.title} style={{
                background: 'rgba(255,255,255,0.12)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '14px',
                padding: '16px 20px',
                display: 'flex', alignItems: 'flex-start', gap: '14px', textAlign: 'left',
              }}>
                <span style={{ fontSize: '22px', lineHeight: 1.2 }}>{f.icon}</span>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px' }}>{f.title}</div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.5 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
