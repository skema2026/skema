'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { useLogin } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import { useQueryClient } from '@tanstack/react-query';
import AuthNavbar from '@/components/layout/AuthNavbar';
import AuthFooter from '@/components/layout/AuthFooter';
import MaterialIcon from '@/components/common/MaterialIcon';

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setToken, setUser } = useAuthStore();
  const loginMutation = useLogin();

  const [form, setForm] = useState({ username: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // Handle OAuth callback (?token= or ?error=)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const error = params.get('error');
    if (error) {
      toast.error('소셜 로그인에 실패했습니다');
      return;
    }
    if (token) {
      setToken(token);
      import('@/lib/api').then(({ api }) => {
        api.get('/auth/me').then(({ data: user }) => {
          setUser(user);
          queryClient.invalidateQueries({ queryKey: ['me'] });
          toast.success('로그인 되었습니다');
          api.get('/profile').then(({ data: profile }) => {
            router.push(profile.onboarding_completed ? '/dashboard' : '/onboarding');
          }).catch(() => router.push('/dashboard'));
        }).catch(() => router.push('/dashboard'));
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSocialLogin = (provider: string) => {
    window.location.href = `${API_BASE}/auth/${provider}/authorize`;
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!form.username.trim()) newErrors.username = '아이디를 입력해주세요';
    if (!form.password) newErrors.password = '비밀번호를 입력해주세요';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    loginMutation.mutate(form, {
      onSuccess: async (data) => {
        setToken(data.access_token);
        try {
          const { api } = await import('@/lib/api');
          const { data: user } = await api.get('/auth/me');
          setUser(user);
          const { data: profile } = await api.get('/profile');
          queryClient.invalidateQueries({ queryKey: ['me'] });
          toast.success('로그인 되었습니다');
          router.push(profile.onboarding_completed ? '/dashboard' : '/onboarding');
        } catch {
          queryClient.invalidateQueries({ queryKey: ['me'] });
          toast.success('로그인 되었습니다');
          router.push('/dashboard');
        }
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
    <>
      <style>{`
        .glass-panel {
          background: rgba(255,255,255,0.72);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        .input-field {
          width: 100%;
          background: var(--skema-surface-low);
          border: 1.5px solid transparent;
          border-radius: 10px;
          padding: 13px 16px;
          font-size: 14px;
          color: var(--skema-on-surface);
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          font-family: Inter, sans-serif;
          box-sizing: border-box;
        }
        .input-field:focus {
          border-color: rgba(26,77,178,0.3);
          box-shadow: 0 0 0 3px rgba(26,77,178,0.08);
        }
        .input-field.error { border-color: #ef4444; }
        .submit-btn {
          width: 100%;
          background: var(--skema-primary-hover);
          color: #fff;
          border: none;
          border-radius: 999px;
          padding: 15px;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 6px 20px var(--skema-primary-shadow);
          transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
          font-family: Inter, sans-serif;
        }
        .submit-btn:hover:not(:disabled) { background: #2b58be; box-shadow: 0 8px 28px rgba(26,77,178,0.3); transform: scale(1.015); }
        .submit-btn:active:not(:disabled) { transform: scale(0.985); }
        .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
      `}</style>

      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--skema-surface)', color: 'var(--skema-on-surface)' }}>

        <AuthNavbar mode="login" />

        {/* ── Main ── */}
        <main style={{ flexGrow: 1, display: 'flex', paddingTop: '64px' }}>
          <div style={{ display: 'flex', width: '100%', maxWidth: '1280px', margin: '0 auto', padding: '48px 24px', gap: '48px', alignItems: 'center' }}>

            {/* ── Left Panel ── */}
            <div style={{ flex: 1, display: 'none', flexDirection: 'column', justifyContent: 'center', gap: '32px' }} className="left-panel">
              <style>{`.left-panel { display: none; } @media (min-width: 1024px) { .left-panel { display: flex; } }`}</style>

              {/* Headline */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--skema-primary)', letterSpacing: '2.5px', textTransform: 'uppercase' }}>
                  AI 시간 설계의 시작
                </span>
                <h1 className="skema-headline" style={{ fontSize: '40px', fontWeight: 800, lineHeight: 1.2, color: 'var(--skema-on-surface)' }}>
                  나의 시간을<br />AI와 함께<br />설계하세요.
                </h1>
                <p style={{ fontSize: '16px', color: 'var(--skema-on-surface-variant)', lineHeight: 1.75, maxWidth: '380px' }}>
                  SKEMA와 함께라면 복잡한 일정도 간단해집니다. AI가 최적의 시간표를 설계해드립니다.
                </p>
              </div>

              {/* Feature Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                {[
                  { icon: 'auto_awesome', title: '스마트 스케줄링', desc: '집중력 최고점 시간대에 맞춰 과제를 자동 배치합니다.' },
                  { icon: 'analytics', title: '시간 인사이트', desc: '나의 생산성 흐름을 분석하여 최적의 패턴을 찾아드립니다.' },
                ].map((card) => (
                  <div key={card.icon} style={{ background: 'var(--skema-container)', borderRadius: '14px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <MaterialIcon icon={card.icon} color="var(--skema-primary)" filled />
                    <div className="skema-headline" style={{ fontWeight: 700, fontSize: '15px', color: 'var(--skema-on-surface)' }}>{card.title}</div>
                    <p style={{ fontSize: '13px', color: 'var(--skema-on-surface-variant)', lineHeight: 1.6 }}>{card.desc}</p>
                  </div>
                ))}
              </div>

              {/* Abstract Visual */}
              <div style={{ position: 'relative', height: '220px', borderRadius: '18px', overflow: 'hidden', background: 'linear-gradient(135deg, #3b66cc, #c3d0ff)', boxShadow: '0 8px 32px rgba(26,77,178,0.2)' }}>
                {/* grid pattern overlay */}
                <div style={{ position: 'absolute', inset: 0, opacity: 0.12, backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
                {/* floating dots */}
                {[[20,30],[60,70],[80,20],[40,80],[70,50]].map(([x,y],i) => (
                  <div key={i} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: '6px', height: '6px', borderRadius: '50%', background: 'rgba(255,255,255,0.5)' }} />
                ))}
                {/* glass stat card */}
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="glass-panel" style={{ padding: '28px 36px', borderRadius: '16px', boxShadow: '0 8px 32px rgba(0,0,0,0.12)', border: '1px solid rgba(255,255,255,0.3)', textAlign: 'center' }}>
                    <div className="skema-headline" style={{ fontSize: '40px', fontWeight: 900, color: 'var(--skema-primary)', lineHeight: 1 }}>85%</div>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--skema-on-surface-variant)', letterSpacing: '1px', textTransform: 'uppercase', marginTop: '6px' }}>평균 효율 향상</div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Right: Form Card ── */}
            <div style={{ width: '100%', maxWidth: '440px', margin: '0 auto' }}>
              <div style={{ background: '#fff', borderRadius: '20px', padding: '36px', boxShadow: '0 4px 24px rgba(26,77,178,0.07)', border: '1px solid rgba(195,198,213,0.15)' }}>

                {/* Title */}
                <div style={{ marginBottom: '28px' }}>
                  <h2 className="skema-headline" style={{ fontSize: '28px', fontWeight: 800, color: 'var(--skema-on-surface)', marginBottom: '6px' }}>
                    로그인
                  </h2>
                  <p style={{ fontSize: '14px', color: 'var(--skema-on-surface-variant)' }}>SKEMA에서 나만의 시간표를 관리하세요.</p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

                  {/* Username */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--skema-on-surface-variant)', letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: '7px' }}>
                      아이디
                    </label>
                    <input
                      type="text"
                      placeholder="아이디를 입력하세요"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      className={`input-field${errors.username ? ' error' : ''}`}
                    />
                    {errors.username && <p style={{ fontSize: '12px', color: '#ef4444', marginTop: '5px' }}>{errors.username}</p>}
                  </div>

                  {/* Password */}
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--skema-on-surface-variant)', letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: '7px' }}>
                      비밀번호
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="비밀번호를 입력하세요"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        className={`input-field${errors.password ? ' error' : ''}`}
                        style={{ paddingRight: '44px' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--skema-outline-strong)', padding: '4px', display: 'flex', alignItems: 'center' }}
                      >
                        <MaterialIcon icon={showPassword ? 'visibility_off' : 'visibility'} size={20} />
                      </button>
                    </div>
                    {errors.password && <p style={{ fontSize: '12px', color: '#ef4444', marginTop: '5px' }}>{errors.password}</p>}
                  </div>

                  <button type="submit" className="submit-btn" disabled={loginMutation.isPending} style={{ marginTop: '4px' }}>
                    {loginMutation.isPending ? '로그인 중...' : '로그인'}
                  </button>
                </form>

                {/* Divider */}
                <div style={{ position: 'relative', margin: '24px 0' }}>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' }}>
                    <div style={{ width: '100%', height: '1px', background: 'var(--skema-container-high)' }} />
                  </div>
                  <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                    <span style={{ background: '#fff', padding: '0 16px', fontSize: '11px', fontWeight: 700, color: 'var(--skema-outline-strong)', letterSpacing: '1px', textTransform: 'uppercase' }}>또는</span>
                  </div>
                </div>

                {/* Social Login Buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={() => handleSocialLogin('google')}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '12px', border: '1.5px solid var(--skema-container-high)', borderRadius: '10px', background: '#fff', cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: 'var(--skema-on-surface)', fontFamily: 'Inter, sans-serif', transition: 'background 0.15s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--skema-surface-low)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.616z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/><path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/></svg>
                    Google로 로그인
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSocialLogin('naver')}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '12px', border: 'none', borderRadius: '10px', background: '#03C75A', cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: '#fff', fontFamily: 'Inter, sans-serif', transition: 'opacity 0.15s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                  >
                    <span style={{ fontWeight: 900, fontSize: '16px', lineHeight: 1 }}>N</span>
                    네이버로 로그인
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSocialLogin('kakao')}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '12px', border: 'none', borderRadius: '10px', background: '#FEE500', cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: '#3C1E1E', fontFamily: 'Inter, sans-serif', transition: 'opacity 0.15s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18"><path d="M9 1C4.582 1 1 3.896 1 7.455c0 2.257 1.493 4.243 3.746 5.378l-.956 3.493c-.084.307.27.549.536.363L8.2 13.997A9.93 9.93 0 0 0 9 14c4.418 0 8-2.896 8-6.545C17 3.896 13.418 1 9 1z" fill="#3C1E1E"/></svg>
                    카카오로 로그인
                  </button>
                </div>

                {/* Bottom link */}
                <p style={{ textAlign: 'center', fontSize: '14px', color: 'var(--skema-on-surface-variant)', marginTop: '4px' }}>
                  계정이 없으신가요?{' '}
                  <Link href="/register" style={{ color: 'var(--skema-primary-hover)', fontWeight: 700, textDecoration: 'none' }}>
                    회원가입
                  </Link>
                </p>
              </div>
            </div>

          </div>
        </main>

        <AuthFooter />
      </div>
    </>
  );
}
