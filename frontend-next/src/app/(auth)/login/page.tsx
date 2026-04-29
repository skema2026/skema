'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { useLogin } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import MaterialIcon from '@/components/common/MaterialIcon';

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
    const token = params.get('token');
    const error = params.get('error');
    if (error) {
      toast.error('소셜 로그인에 실패했습니다');
      window.history.replaceState({}, '', '/login');
      return;
    }
    if (token) {
      setToken(token);
      toast.success('로그인 되었습니다');
      window.history.replaceState({}, '', '/login');
      router.push('/dashboard');
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
    loginMutation.mutate(form, {
      onSuccess: (data) => { setToken(data.access_token); toast.success('로그인 되었습니다'); router.push('/dashboard'); },
      onError: (err: unknown) => {
        const error = err as { response?: { status?: number } };
        if (error?.response?.status === 401) toast.error('아이디 또는 비밀번호가 올바르지 않습니다');
        else toast.error('로그인 중 오류가 발생했습니다');
      },
    });
  };

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }

        .lp-root {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow: hidden;
          background: #d9c9b0 url('/register-bg.jpg') center/cover no-repeat;
          font-family: inherit;
        }
        .lp-overlay {
          position: absolute; inset: 0; pointer-events: none;
          background: linear-gradient(
            110deg,
            rgba(215,190,140,0.52) 0%,
            rgba(190,165,115,0.30) 45%,
            rgba(80,100,170,0.12) 100%
          );
        }

        /* Navbar */
        .lp-nav {
          position: relative; z-index: 20;
          display: flex; align-items: center; justify-content: space-between;
          padding: 20px 48px;
        }
        .lp-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
        .lp-logo-box {
          width: 34px; height: 34px; border-radius: 9px;
          background: rgba(26,77,178,0.88);
          display: flex; align-items: center; justify-content: center;
        }
        .lp-logo-text { font-size: 18px; font-weight: 800; color: #1a2340; letter-spacing: -0.3px; }
        .lp-nav-btn {
          padding: 8px 24px; border-radius: 999px; font-size: 14px; font-weight: 600;
          color: #1a2340; text-decoration: none;
          border: 1.5px solid rgba(255,255,255,0.65);
          background: rgba(255,255,255,0.28);
          backdrop-filter: blur(10px);
          transition: background 0.2s;
        }
        .lp-nav-btn:hover { background: rgba(255,255,255,0.48); }

        /* Body */
        .lp-body {
          position: relative; z-index: 1;
          flex: 1; display: flex; align-items: center;
          padding: 0 48px 48px;
          gap: 40px;
        }

        /* Left */
        .lp-left { flex: 1; }
        .lp-left h2 {
          font-size: clamp(2rem, 3.2vw, 2.75rem);
          font-weight: 800; line-height: 1.2;
          color: #1a2340; letter-spacing: -0.5px; margin: 0 0 12px;
        }
        .lp-left h2 em { font-style: normal; color: #1a4db2; }
        .lp-feat { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 16px; }
        .lp-feat-icon {
          width: 40px; height: 40px; border-radius: 12px; flex-shrink: 0;
          background: rgba(255,255,255,0.50);
          border: 1px solid rgba(255,255,255,0.6);
          backdrop-filter: blur(6px);
          display: flex; align-items: center; justify-content: center;
        }
        .lp-feat-name { font-weight: 700; font-size: 14px; color: #1a2340; margin-bottom: 2px; }
        .lp-feat-desc { font-size: 13px; color: #3d4e6b; }

        /* Card */
        .lp-card {
          width: 100%; max-width: 420px; flex-shrink: 0;
          background: rgba(255,255,255,0.17);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgba(255,255,255,0.35);
          border-radius: 22px;
          box-shadow:
            0 12px 56px rgba(50,40,10,0.16),
            inset 0 1px 0 rgba(255,255,255,0.45);
          padding: 32px 28px 26px;
        }
        .lp-card-title { font-size: 22px; font-weight: 800; color: #1a2340; margin: 0 0 3px; }
        .lp-card-sub   { font-size: 13px; color: #4a5568; margin: 0 0 20px; }

        /* Social */
        .lp-soc {
          width: 100%; height: 44px;
          display: flex; align-items: center; justify-content: center; gap: 9px;
          border-radius: 11px; border: none;
          font-size: 14px; font-weight: 600; font-family: inherit;
          cursor: pointer; margin-bottom: 7px;
          transition: filter .15s, transform .1s;
        }
        .lp-soc:hover  { filter: brightness(1.07); transform: translateY(-1px); }
        .lp-soc:active { transform: translateY(0); }
        .lp-google { background: rgba(255,255,255,0.84); color: #1f2937; border: 1px solid rgba(255,255,255,0.7) !important; backdrop-filter: blur(6px); }
        .lp-naver  { background: #03C75A; color: #fff; }
        .lp-kakao  { background: #FEE500; color: #3C1E1E; }

        /* Divider */
        .lp-div { display: flex; align-items: center; gap: 10px; margin: 12px 0; }
        .lp-div-line { flex: 1; height: 1px; background: rgba(255,255,255,0.38); }
        .lp-div-txt  { font-size: 12px; color: rgba(30,40,70,0.52); white-space: nowrap; }

        /* Fields */
        .lp-field {
          display: flex; align-items: center;
          background: rgba(255,255,255,0.22);
          border: 1px solid rgba(255,255,255,0.38);
          border-radius: 11px; overflow: hidden;
          margin-bottom: 7px;
          transition: box-shadow .2s, border-color .2s;
        }
        .lp-field:focus-within {
          border-color: rgba(80,120,255,0.65);
          box-shadow: 0 0 0 3px rgba(80,120,255,0.16);
        }
        .lp-field.err { border-color: rgba(220,38,38,0.55); }
        .lp-label {
          display: flex; align-items: center; gap: 6px;
          padding: 0 11px; min-width: 80px; height: 46px;
          border-right: 1px solid rgba(255,255,255,0.32);
          background: rgba(255,255,255,0.10);
          font-size: 13px; font-weight: 600; color: #2d3a55; flex-shrink: 0;
        }
        .lp-field input {
          flex: 1; height: 46px; padding: 0 13px;
          background: transparent; border: none; outline: none;
          font-size: 13px; color: #1a2340; font-family: inherit;
        }
        .lp-field input::placeholder { color: rgba(50,65,100,0.42); }
        .lp-pw-toggle {
          background: none; border: none; cursor: pointer;
          color: rgba(50,65,100,0.5); padding: 0 12px;
          display: flex; align-items: center;
          transition: color .15s;
        }
        .lp-pw-toggle:hover { color: #1a2340; }
        .lp-err { font-size: 11px; color: #dc2626; margin: -3px 0 5px 4px; }

        /* Submit */
        .lp-submit {
          width: 100%; height: 48px; margin-top: 8px;
          border: none; border-radius: 11px;
          font-size: 15px; font-weight: 700; font-family: inherit;
          cursor: pointer; color: #fff;
          background: linear-gradient(90deg, #3b6ef0 0%, #6b4fd6 100%);
          box-shadow: 0 4px 20px rgba(70,100,230,0.38);
          transition: filter .15s, transform .1s;
        }
        .lp-submit:hover:not(:disabled) { filter: brightness(1.09); transform: translateY(-1px); }
        .lp-submit:active:not(:disabled) { transform: translateY(0); }
        .lp-submit:disabled {
          background: linear-gradient(90deg, #94aee8 0%, #a899d6 100%);
          box-shadow: none; cursor: not-allowed;
        }

        .lp-foot { margin-top: 14px; text-align: center; font-size: 13px; color: #4a5568; }
        .lp-foot a { color: #1a4db2; font-weight: 700; text-decoration: none; }
        .lp-foot a:hover { text-decoration: underline; }

        @media (max-width: 860px) {
          .lp-left { display: none; }
          .lp-body  { justify-content: center; padding: 0 16px 40px; }
          .lp-nav   { padding: 18px 24px; }
          .lp-card  { max-width: 100%; }
        }
      `}</style>

      <div className="lp-root">
        <div className="lp-overlay" />

        <nav className="lp-nav">
          <Link href="/" className="lp-logo">
            <div className="lp-logo-box">
              <MaterialIcon icon="schedule" size={18} color="#fff" />
            </div>
            <span className="lp-logo-text">SKEMA</span>
          </Link>
          <Link href="/register" className="lp-nav-btn">회원가입</Link>
        </nav>

        <div className="lp-body">
          {/* Left branding */}
          <div className="lp-left">
            <h2>AI가 설계하는<br />나만의 <em>스마트 시간표</em></h2>
            <p style={{ fontSize: '15px', lineHeight: 1.8, color: '#2d3a55', margin: '0 0 24px', maxWidth: '380px' }}>
              시험 일정과 기존 수업을 분석해 빈 시간에<br />
              최적의 학습 계획을 자동으로 만들어드립니다.
            </p>
            {[
              { icon: 'calendar_month', title: '시험 기반 자동 배치',    desc: '시험 날짜를 등록하면 AI가 역산해 공부 일정을 배치합니다.' },
              { icon: 'smart_toy',      title: 'AI 채팅으로 일정 관리',  desc: '자연어로 대화하듯 일정을 추가·수정·삭제할 수 있습니다.' },
              { icon: 'bar_chart',      title: '주간 수행률 리포트',      desc: '완료한 일정을 시각화해 학습 패턴을 파악할 수 있습니다.' },
            ].map((f) => (
              <div className="lp-feat" key={f.title}>
                <div className="lp-feat-icon">
                  <MaterialIcon icon={f.icon} size={20} color="#1a4db2" />
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
            <div className="lp-card-title">다시 오셨군요!</div>
            <div className="lp-card-sub">SKEMA 계정으로 로그인하세요</div>

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
                <div className="lp-label"><MaterialIcon icon="person" size={14} color="#4a5568" />아이디</div>
                <input type="text" placeholder="아이디를 입력하세요" value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
              {errors.username && <div className="lp-err">{errors.username}</div>}

              <div className={`lp-field${errors.password ? ' err' : ''}`}>
                <div className="lp-label"><MaterialIcon icon="lock" size={14} color="#4a5568" />비밀번호</div>
                <input type={showPassword ? 'text' : 'password'} placeholder="비밀번호를 입력하세요" value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <button type="button" className="lp-pw-toggle" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {errors.password && <div className="lp-err">{errors.password}</div>}

              <button type="submit" className="lp-submit" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? '로그인 중...' : '로그인'}
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
