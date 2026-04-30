'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { useRegister } from '@/hooks/useAuth';
import MaterialIcon from '@/components/common/MaterialIcon';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 256 262" preserveAspectRatio="xMidYMid">
    <path d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622 38.755 30.023 2.685.268c24.659-22.774 38.875-56.282 38.875-96.027" fill="#4285F4"/>
    <path d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055-34.523 0-63.824-22.773-74.269-54.25l-1.531.13-40.298 31.187-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1" fill="#34A853"/>
    <path d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82 0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602l42.356-32.782" fill="#FBBC05"/>
    <path d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0 79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251" fill="#EB4335"/>
  </svg>
);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
    const e: Record<string, string> = {};
    if (!form.username.trim()) e.username = '아이디를 입력해주세요';
    else if (form.username.trim().length < 3) e.username = '아이디는 3자 이상이어야 합니다';
    if (!form.email.trim()) e.email = '이메일을 입력해주세요';
    else if (!EMAIL_REGEX.test(form.email.trim())) e.email = '올바른 이메일 형식이 아닙니다';
    if (!form.password) e.password = '비밀번호를 입력해주세요';
    else if (form.password.length < 6) e.password = '비밀번호는 6자 이상이어야 합니다';
    if (form.password !== form.confirmPassword) e.confirmPassword = '비밀번호가 일치하지 않습니다';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    registerMutation.mutate(
      { username: form.username.trim(), email: form.email.trim(), password: form.password },
      {
        onSuccess: () => { toast.success('회원가입이 완료되었습니다. 로그인해주세요.'); router.push('/login'); },
        onError: (err: unknown) => {
          const error = err as { response?: { status?: number; data?: { detail?: string } } };
          const detail = error?.response?.data?.detail ?? '';
          if (error?.response?.status === 409) toast.error(detail || '이미 사용 중인 이메일 또는 아이디입니다');
          else if (error?.response?.status === 422 && detail.includes('이메일')) {
            setErrors((prev) => ({ ...prev, email: '올바른 이메일 형식이 아닙니다' }));
            toast.error('올바른 이메일 형식이 아닙니다');
          }
          else toast.error('회원가입 중 오류가 발생했습니다');
        },
      }
    );
  };

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; }

        .rp-root {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow-x: hidden;
          overflow-y: auto;
          background: #f6f8fc url('/register-bg.jpg') center/cover no-repeat;
          font-family: inherit;
        }
        .rp-overlay {
          position: absolute; inset: 0; pointer-events: none;
          background:
            linear-gradient(90deg, rgba(37,99,235,0.08) 1px, transparent 1px),
            linear-gradient(rgba(14,165,233,0.07) 1px, transparent 1px),
            linear-gradient(110deg, rgba(246,248,252,0.96) 0%, rgba(246,248,252,0.88) 46%, rgba(232,243,255,0.72) 100%);
          background-size: 28px 28px, 28px 28px, auto;
        }

        /* ── Navbar ── */
        .rp-nav {
          position: relative; z-index: 20;
          display: flex; align-items: center; justify-content: space-between;
          padding: 20px clamp(20px, 4vw, 56px);
        }
        .rp-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
        .rp-logo-box {
          width: 34px; height: 34px; border-radius: 9px;
          background: #2563eb;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 10px 26px rgba(19,63,124,0.22);
        }
        .rp-logo-text { font-size: 18px; font-weight: 800; color: #0f172a; letter-spacing: 0; }
        .rp-nav-btn {
          padding: 8px 24px; border-radius: 999px; font-size: 14px; font-weight: 600;
          color: #2563eb; text-decoration: none;
          border: 1px solid #bfd0ff;
          background: rgba(255,255,255,0.92);
          backdrop-filter: blur(14px);
          box-shadow: 0 10px 30px rgba(15,23,42,0.07);
          transition: background 0.2s, transform 0.2s;
        }
        .rp-nav-btn:hover { background: #eaf1ff; transform: translateY(-1px); }

        /* ── Body ── */
        .rp-body {
          position: relative; z-index: 1;
          flex: 1; display: flex; align-items: center;
          padding: 0 clamp(20px, 4vw, 56px) 48px;
          gap: 40px;
          justify-content: center;
        }

        /* ── Left ── */
        .rp-left { flex: 1; max-width: 560px; }
        .rp-left h2 {
          font-size: clamp(2rem, 3.2vw, 2.75rem);
          font-weight: 800; line-height: 1.2;
          color: #0f172a; letter-spacing: 0; margin: 0 0 14px;
        }
        .rp-left h2 em { font-style: normal; color: #0ea5e9; }
        .rp-left p {
          font-size: 15px; line-height: 1.8; color: #2d3a55;
          margin: 0 0 28px; max-width: 380px;
        }
        .rp-feat { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 16px; }
        .rp-feat-icon {
          width: 40px; height: 40px; border-radius: 12px; flex-shrink: 0;
          background: #fff;
          border: 1px solid rgba(14,165,233,0.18);
          box-shadow: 0 6px 0 rgba(14,165,233,0.08), 0 10px 24px rgba(15,23,42,0.08);
          display: flex; align-items: center; justify-content: center;
        }
        .rp-feat-name { font-weight: 700; font-size: 14px; color: #0f172a; margin-bottom: 2px; }
        .rp-feat-desc { font-size: 13px; color: #475569; }

        /* ── Card ── */
        .rp-card {
          width: 100%; max-width: 455px; flex-shrink: 0;
          background: rgba(255,255,255,0.96);
          backdrop-filter: blur(22px) saturate(125%);
          -webkit-backdrop-filter: blur(22px) saturate(125%);
          border: 1px solid rgba(255,255,255,0.70);
          border-radius: 8px;
          box-shadow:
            0 24px 70px rgba(15,23,42,0.16),
            inset 0 1px 0 rgba(255,255,255,0.85);
          padding: 34px 30px 28px;
        }
        .rp-card-title { font-size: 22px; font-weight: 800; color: #0f172a; margin: 0 0 3px; }
        .rp-card-sub   { font-size: 13px; color: #3f4b61; margin: 0 0 20px; }

        /* Social */
        .rp-soc {
          width: 100%; height: 44px;
          display: flex; align-items: center; justify-content: center; gap: 9px;
          border-radius: 11px; border: none;
          font-size: 14px; font-weight: 600; font-family: inherit;
          cursor: pointer; margin-bottom: 7px;
          transition: filter .15s, transform .1s;
        }
        .rp-soc:hover  { filter: brightness(1.07); transform: translateY(-1px); }
        .rp-soc:active { transform: translateY(0); }
        .rp-google { background: rgba(255,255,255,0.84); color: #1f2937; border: 1px solid rgba(255,255,255,0.7) !important; backdrop-filter: blur(6px); }
        .rp-naver  { background: #03C75A; color: #fff; }
        .rp-kakao  { background: #FEE500; color: #3C1E1E; }

        /* Divider */
        .rp-div { display: flex; align-items: center; gap: 10px; margin: 12px 0; }
        .rp-div-line { flex: 1; height: 1px; background: rgba(255,255,255,0.38); }
        .rp-card .rp-div-line { background: rgba(15,23,42,0.12); }
        .rp-div-txt  { font-size: 12px; color: rgba(30,40,70,0.52); white-space: nowrap; }

        /* Fields */
        .rp-field {
          display: flex; align-items: center;
          background: #fff;
          border: 1px solid #b8c5d6;
          border-radius: 8px; overflow: hidden;
          margin-bottom: 7px;
          transition: box-shadow .2s, border-color .2s;
        }
        .rp-field:focus-within {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37,99,235,0.18);
        }
        .rp-field.err { border-color: rgba(220,38,38,0.55); }
        .rp-label {
          display: flex; align-items: center; gap: 6px;
          padding: 0 11px; min-width: 90px; height: 46px;
          border-right: 1px solid rgba(19,63,124,0.10);
          background: #eaf1ff;
          font-size: 13px; font-weight: 700; color: #0f172a; flex-shrink: 0;
        }
        .rp-field input {
          flex: 1; height: 46px; padding: 0 13px;
          background: transparent; border: none; outline: none;
          font-size: 13px; color: #0f172a; font-family: inherit;
        }
        .rp-field input::placeholder { color: rgba(50,65,100,0.42); }
        .rp-err { font-size: 11px; color: #dc2626; margin: -3px 0 5px 4px; }

        /* Submit */
        .rp-submit {
          width: 100%; height: 48px; margin-top: 8px;
          border: none; border-radius: 11px;
          font-size: 15px; font-weight: 700; font-family: inherit;
          cursor: pointer; color: #fff;
          background: linear-gradient(90deg, #2563eb 0%, #0ea5e9 100%);
          box-shadow: 0 12px 28px rgba(26,77,178,0.24);
          transition: filter .15s, transform .1s;
        }
        .rp-submit:hover:not(:disabled) { filter: brightness(1.09); transform: translateY(-1px); }
        .rp-submit:active:not(:disabled) { transform: translateY(0); }
        .rp-submit:disabled {
          background: linear-gradient(90deg, #94a3b8 0%, #8fb8b4 100%);
          box-shadow: none; cursor: not-allowed;
        }

        .rp-foot { margin-top: 14px; text-align: center; font-size: 13px; color: #334155; }
        .rp-foot a { color: #2563eb; font-weight: 700; text-decoration: none; }
        .rp-foot a:hover { text-decoration: underline; }

        @media (max-width: 980px) {
          .rp-left { display: none; }
          .rp-body  { justify-content: center; padding: 0 16px 40px; }
          .rp-nav   { padding: 18px 24px; }
          .rp-card  { max-width: 100%; }
        }
        @media (max-width: 480px) {
          .rp-card { padding: 26px 18px 22px; border-radius: 16px; }
          .rp-label { min-width: 82px; font-size: 12px; padding: 0 9px; }
          .rp-logo-text { font-size: 16px; }
          .rp-nav-btn { padding: 8px 14px; }
        }
      `}</style>

      <div className="rp-root">
        <div className="rp-overlay" />

        <nav className="rp-nav">
          <Link href="/" className="rp-logo">
            <div className="rp-logo-box">
              <MaterialIcon icon="schedule" size={18} color="#fff" />
            </div>
            <span className="rp-logo-text">SKEMA</span>
          </Link>
          <Link href="/login" className="rp-nav-btn">로그인</Link>
        </nav>

        <div className="rp-body">
          {/* Left branding */}
          <div className="rp-left">
            <h2>AI가 설계하는<br />나만의 <em>스마트 시간표</em></h2>
            <p>
              AI가 당신의 학습 패턴을 분석하고,<br />
              최적화된 시간표를 설계해 드립니다.<br />
              지금 바로 스마트한 시간 관리를 시작하세요.
            </p>
            {[
              { icon: 'psychology',    title: 'Smart Scheduling', desc: 'AI가 최적의 공부 시간을 예측하고 추천합니다' },
              { icon: 'insights',      title: 'Time Insights',    desc: '학습 효율을 분석하고 개선점을 제안합니다' },
              { icon: 'track_changes', title: 'Goal Tracking',    desc: '목표 달성을 위한 진척도를 추적합니다' },
            ].map((f) => (
              <div className="rp-feat" key={f.title}>
                <div className="rp-feat-icon">
                  <MaterialIcon icon={f.icon} size={20} color="#2563eb" />
                </div>
                <div>
                  <div className="rp-feat-name">{f.title}</div>
                  <div className="rp-feat-desc">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Glass card */}
          <div className="rp-card">
            <div className="rp-card-title">계정 만들기</div>
            <div className="rp-card-sub">SKEMA와 함께 스마트한 시간 관리를 시작하세요</div>

            <button className="rp-soc rp-google" onClick={() => handleSocialLogin('google')}>
              <GoogleIcon /> Google로 시작하기
            </button>
            <button className="rp-soc rp-naver" onClick={() => handleSocialLogin('naver')}>
              <svg width="18" height="18" viewBox="0 0 24 24">
                <rect width="24" height="24" rx="4" fill="#03C75A"/>
                <path d="M13.56 12.28L10.26 7H7v10h3.44l3.3-5.28V17H17V7h-3.44v5.28z" fill="white"/>
              </svg>
              네이버로 시작하기
            </button>
            <button className="rp-soc rp-kakao" onClick={() => handleSocialLogin('kakao')}>
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path d="M9 1C4.582 1 1 3.896 1 7.455c0 2.257 1.493 4.243 3.746 5.378l-.956 3.493c-.084.307.27.549.536.363L8.2 13.997A9.93 9.93 0 0 0 9 14c4.418 0 8-2.896 8-6.545C17 3.896 13.418 1 9 1z" fill="#3C1E1E"/>
              </svg>
              카카오로 시작하기
            </button>

            <div className="rp-div">
              <div className="rp-div-line" />
              <span className="rp-div-txt">또는 이메일로 가입</span>
              <div className="rp-div-line" />
            </div>

            <form onSubmit={handleSubmit} noValidate>
              <div className={`rp-field${errors.username ? ' err' : ''}`}>
                <div className="rp-label"><MaterialIcon icon="person" size={14} color="#334155" />아이디</div>
                <input type="text" autoComplete="username" placeholder="아이디 (3자 이상)" value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
              {errors.username && <div className="rp-err">{errors.username}</div>}

              <div className={`rp-field${errors.email ? ' err' : ''}`}>
                <div className="rp-label"><MaterialIcon icon="mail" size={14} color="#334155" />이메일</div>
                <input type="text" inputMode="email" autoComplete="email" placeholder="이메일 주소" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              {errors.email && <div className="rp-err">{errors.email}</div>}

              <div className={`rp-field${errors.password ? ' err' : ''}`}>
                <div className="rp-label"><MaterialIcon icon="lock" size={14} color="#334155" />비밀번호</div>
                <input type="password" autoComplete="new-password" placeholder="비밀번호 (6자 이상)" value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              {errors.password && <div className="rp-err">{errors.password}</div>}

              <div className={`rp-field${errors.confirmPassword ? ' err' : ''}`}>
                <div className="rp-label"><MaterialIcon icon="lock" size={14} color="#334155" />비밀번호 확인</div>
                <input type="password" autoComplete="new-password" placeholder="비밀번호를 다시 입력하세요" value={form.confirmPassword}
                  onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
              </div>
              {errors.confirmPassword && <div className="rp-err">{errors.confirmPassword}</div>}

              <button type="submit" className="rp-submit" disabled={registerMutation.isPending}>
                {registerMutation.isPending ? '처리 중...' : '가입하기'}
              </button>
            </form>

            <div className="rp-foot">
              이미 계정이 있으신가요?{' '}
              <Link href="/login">로그인</Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
