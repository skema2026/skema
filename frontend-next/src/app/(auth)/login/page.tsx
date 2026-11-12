'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { toast } from 'sonner';
import { useLogin } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import MaterialIcon from '@/components/common/MaterialIcon';
import { authCss } from '../authStyles';
import { apiErrorMessage } from '@/lib/apiError';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 256 262" preserveAspectRatio="xMidYMid">
    <path d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622 38.755 30.023 2.685.268c24.659-22.774 38.875-56.282 38.875-96.027" fill="#4285F4"/>
    <path d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055-34.523 0-63.824-22.773-74.269-54.25l-1.531.13-40.298 31.187-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1" fill="#34A853"/>
    <path d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82 0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602l42.356-32.782" fill="#FBBC05"/>
    <path d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0 79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251" fill="#EB4335"/>
  </svg>
);

const EyeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
  </svg>
);
const EyeOffIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

export default function LoginPage() {
  const router = useRouter();
  const { setToken } = useAuthStore();
  const loginMutation = useLogin();

  const [form, setForm] = useState({ username: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // 소셜 로그인 토큰은 서버 로그에 남지 않도록 #token= (fragment)로 온다. 예전 ?token= 도 받는다.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = hashParams.get('token') ?? params.get('token');
    const error = params.get('error');
    if (error) {
      toast.error(
        error === 'oauth_email_exists'
          ? '이미 이메일로 가입된 계정입니다. 아이디·비밀번호로 로그인해주세요'
          : '소셜 로그인을 하지 못했어요',
      );
      window.history.replaceState({}, '', '/login');
      return;
    }
    if (token) {
      setToken(token);
      toast.success('로그인했어요');
      window.history.replaceState({}, '', '/login');
      router.push('/onboarding');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSocialLogin = (provider: string) => {
    window.location.href = `${API_BASE}/auth/${provider}/authorize`;
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.username.trim()) e.username = '아이디를 입력해주세요';
    if (!form.password) e.password = '비밀번호를 입력해주세요';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    loginMutation.mutate({ email: form.username, password: form.password }, {
      onSuccess: (data) => { setToken(data.access_token); toast.success('로그인했어요'); router.push('/onboarding'); },
      onError: (err: unknown) => {
        const error = err as { response?: { status?: number } };
        if (error?.response?.status === 401) toast.error('아이디나 비밀번호가 맞지 않아요');
        else toast.error(apiErrorMessage(err, '로그인하지 못했어요'));
      },
    });
  };

  return (
    <>
      <style>{authCss('lp')}</style>

      <div className="lp-root">
        <div className="lp-overlay" />

        <nav className="lp-nav">
          <Link href="/" className="lp-logo">
            <div className="lp-logo-box">
              <Image
              src="/icon-192.png"
              alt="SKEMA 로고"
              width={34}
              height={34}
              style={{ borderRadius: '9px' }}
              />
            </div>
            <span className="lp-logo-text">SKEMA</span>
          </Link>
          <Link href="/register" className="lp-nav-btn">회원가입</Link>
        </nav>

        <div className="lp-body">
          {/* Left branding */}
          <div className="lp-left">
            <h2>하루 밀려도<br /><em>다시 짜 주는</em> 시간표</h2>
            <p>
              에타 시간표 캡처 한 장으로 수업을 넣고, 시험 날짜를 넣으면 수업 사이 빈 시간에 공부 블록이 들어갑니다.
            </p>
            {[
              { icon: 'calendar_month', title: '시험 공부 자동 배치',    desc: '시험 전날까지 빈 30분 칸에 공부 블록을 넣어요. 주에 며칠, 하루 몇 시간인지 고를 수 있어요' },
              { icon: 'autorenew',      title: '밀린 공부는 다시 짜기', desc: '못 한 블록만 남은 빈 시간으로 옮겨요. 수업과 시험은 그대로 둡니다' },
              { icon: 'bar_chart',      title: '주간 리포트',      desc: '이번 주에 끝낸 블록과 못 한 블록을 요일별로 보여 줘요' },
            ].map((f) => (
              <div className="lp-feat" key={f.title}>
                <div className="lp-feat-icon">
                  <MaterialIcon icon={f.icon} size={18} color="currentColor" />
                </div>
                <div>
                  <div className="lp-feat-name">{f.title}</div>
                  <div className="lp-feat-desc">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Glass card */}
          <div className="lp-card">
            <div className="lp-card-title">로그인</div>
            <div className="lp-card-sub">소셜 계정이나 아이디로 로그인해요</div>

            <button className="lp-soc lp-google" onClick={() => handleSocialLogin('google')}>
              <GoogleIcon /> Google로 로그인
            </button>
            <button className="lp-soc lp-naver" onClick={() => handleSocialLogin('naver')}>
              <svg width="18" height="18" viewBox="0 0 24 24">
                <rect width="24" height="24" rx="4" fill="#03C75A"/>
                <path d="M13.56 12.28L10.26 7H7v10h3.44l3.3-5.28V17H17V7h-3.44v5.28z" fill="white"/>
              </svg>
              네이버로 로그인
            </button>
            <button className="lp-soc lp-kakao" onClick={() => handleSocialLogin('kakao')}>
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path d="M9 1C4.582 1 1 3.896 1 7.455c0 2.257 1.493 4.243 3.746 5.378l-.956 3.493c-.084.307.27.549.536.363L8.2 13.997A9.93 9.93 0 0 0 9 14c4.418 0 8-2.896 8-6.545C17 3.896 13.418 1 9 1z" fill="#3C1E1E"/>
              </svg>
              카카오로 로그인
            </button>

            <div className="lp-div">
              <div className="lp-div-line" />
              <span className="lp-div-txt">또는 이메일로 로그인</span>
              <div className="lp-div-line" />
            </div>

            <form onSubmit={handleSubmit}>
              <div className={`lp-field${errors.username ? ' err' : ''}`}>
                <div className="lp-label"><MaterialIcon icon="person" size={16} color="currentColor" />아이디</div>
                <input type="text" autoComplete="username" placeholder="아이디를 입력하세요" value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
              {errors.username && <div className="lp-err">{errors.username}</div>}

              <div className={`lp-field${errors.password ? ' err' : ''}`}>
                <div className="lp-label"><MaterialIcon icon="lock" size={16} color="currentColor" />비밀번호</div>
                <input type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="비밀번호를 입력하세요" value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <button type="button" className="lp-pw-toggle" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {errors.password && <div className="lp-err">{errors.password}</div>}

              <button type="submit" className="lp-submit" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? '로그인 중' : '로그인'}
              </button>
            </form>

            <div className="lp-foot">
              계정이 없으신가요?{' '}
              <Link href="/register">회원가입</Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
