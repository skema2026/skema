'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { toast } from 'sonner';
import { useRegister } from '@/hooks/useAuth';
import MaterialIcon from '@/components/common/MaterialIcon';
import { authCss } from '../authStyles';

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
        onSuccess: () => { toast.success('가입했어요. 로그인해 주세요'); router.push('/login'); },
        onError: (err: unknown) => {
          const error = err as { response?: { status?: number; data?: { detail?: string } } };
          const detail = error?.response?.data?.detail ?? '';
          if (error?.response?.status === 409) toast.error(detail || '이미 사용 중인 이메일 또는 아이디입니다');
          else if (error?.response?.status === 422 && detail.includes('이메일')) {
            setErrors((prev) => ({ ...prev, email: '올바른 이메일 형식이 아닙니다' }));
            toast.error('올바른 이메일 형식이 아닙니다');
          }
          else toast.error('가입하지 못했어요. 잠시 후 다시 시도해 주세요');
        },
      }
    );
  };

  return (
    <>
      <style>{authCss('rp')}</style>

      <div className="rp-root">
        <div className="rp-overlay" />

        <nav className="rp-nav">
          <Link href="/" className="rp-logo">
            <div className="rp-logo-box">
              <Image 
              src="/icon-192.png"
              alt="SKEMA 로고"
              width={34}
              height={34}
              style={{ borderRadius: '9px' }}
              />
            </div>
            <span className="rp-logo-text">SKEMA</span>
          </Link>
          <Link href="/login" className="rp-nav-btn">로그인</Link>
        </nav>

        <div className="rp-body">
          {/* Left branding */}
          <div className="rp-left">
            <h2>하루 밀려도<br /><em>다시 짜 주는</em> 시간표</h2>
            <p>
              에타 시간표 캡처 한 장으로 수업을 넣고, 시험 날짜를 넣으면 수업 사이 빈 시간에 공부 블록이 들어갑니다.
            </p>
            {[
              { icon: 'calendar_month', title: '시험 공부 자동 배치',   desc: '시험 전날까지 빈 30분 칸에 공부 블록을 넣어요. 주에 며칠, 하루 몇 시간인지 고를 수 있어요' },
              { icon: 'autorenew',      title: '밀린 공부는 다시 짜기', desc: '못 한 블록만 남은 빈 시간으로 옮겨요. 수업과 시험은 그대로 둡니다' },
              { icon: 'bar_chart',      title: '주간 리포트',     desc: '이번 주에 끝낸 블록과 못 한 블록을 요일별로 보여 줘요' },
            ].map((f) => (
              <div className="rp-feat" key={f.title}>
                <div className="rp-feat-icon">
                  <MaterialIcon icon={f.icon} size={18} color="currentColor" />
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
            <div className="rp-card-sub">가입하면 온보딩에서 시간표와 시험을 바로 넣어요</div>

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
                <div className="rp-label"><MaterialIcon icon="person" size={16} color="currentColor" />아이디</div>
                <input type="text" autoComplete="username" placeholder="아이디 (3자 이상)" value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
              {errors.username && <div className="rp-err">{errors.username}</div>}

              <div className={`rp-field${errors.email ? ' err' : ''}`}>
                <div className="rp-label"><MaterialIcon icon="mail" size={16} color="currentColor" />이메일</div>
                <input type="text" inputMode="email" autoComplete="email" placeholder="이메일 주소" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              {errors.email && <div className="rp-err">{errors.email}</div>}

              <div className={`rp-field${errors.password ? ' err' : ''}`}>
                <div className="rp-label"><MaterialIcon icon="lock" size={16} color="currentColor" />비밀번호</div>
                <input type="password" autoComplete="new-password" placeholder="비밀번호 (6자 이상)" value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              {errors.password && <div className="rp-err">{errors.password}</div>}

              <div className={`rp-field${errors.confirmPassword ? ' err' : ''}`}>
                <div className="rp-label"><MaterialIcon icon="lock" size={16} color="currentColor" />비밀번호 확인</div>
                <input type="password" autoComplete="new-password" placeholder="비밀번호를 다시 입력하세요" value={form.confirmPassword}
                  onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
              </div>
              {errors.confirmPassword && <div className="rp-err">{errors.confirmPassword}</div>}

              <button type="submit" className="rp-submit" disabled={registerMutation.isPending}>
                {registerMutation.isPending ? '가입 중' : '가입하기'}
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
