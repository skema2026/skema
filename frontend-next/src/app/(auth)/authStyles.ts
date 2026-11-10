// 로그인·회원가입 공용 스타일 (unslop: 랜딩과 같은 톤, 로고의 하늘색 파랑이 주인공)
// prefix: 'lp' (로그인) 또는 'rp' (회원가입). 두 화면의 클래스 이름은 그대로 둔다.
export function authCss(x: 'lp' | 'rp') {
  return `
  *, *::before, *::after { box-sizing: border-box; }

  .${x}-root {
    --a-bg: #f3f7fe;
    --a-card: #ffffff;
    --a-raised: #e6effc;
    --a-line: rgba(15, 30, 58, 0.10);
    --a-text: #0f1e3a;
    --a-secondary: #44536b;
    --a-muted: #5f6f88;
    --a-accent: #2a6fe3;
    --a-accent-ink: #1f63d6;
    --a-brand-100: #e3efff;
    --ease: cubic-bezier(0.22, 1, 0.36, 1);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, #e4efff 0%, var(--a-bg) 420px);
    color: var(--a-text);
    word-break: keep-all;
  }
  .${x}-overlay { display: none; }

  .${x}-nav {
    display: flex; align-items: center; justify-content: space-between;
    height: 64px; padding: 0 clamp(24px, 4vw, 48px);
    border-bottom: 1px solid var(--a-line);
  }
  .${x}-logo { display: flex; align-items: center; gap: 8px; text-decoration: none; }
  .${x}-logo-box { width: 28px; height: 28px; display: flex; }
  .${x}-logo-box img { width: 28px !important; height: 28px !important; border-radius: 6px !important; }
  .${x}-logo-text { font-size: 17px; font-weight: 600; color: var(--a-text); letter-spacing: -0.01em; }
  .${x}-nav-btn {
    display: inline-flex; align-items: center; height: 36px; padding: 0 16px;
    border-radius: 8px; border: 1px solid #c8dcfb; background: var(--a-card);
    font-size: 14px; color: var(--a-accent-ink); font-weight: 500; text-decoration: none;
    transition: background-color 150ms var(--ease);
  }
  .${x}-nav-btn:hover { background: var(--a-raised); }

  .${x}-body {
    flex: 1; display: flex; align-items: center; justify-content: center;
    gap: clamp(48px, 8vw, 128px);
    padding: 48px clamp(24px, 4vw, 48px) 64px;
  }

  .${x}-left { flex: 1; max-width: 480px; }
  .${x}-left h2 {
    font-size: 40px; font-weight: 600; line-height: 1.15; letter-spacing: -0.02em;
    color: var(--a-text); margin: 0 0 16px;
  }
  .${x}-left h2 em {
    font-style: normal;
    color: var(--a-accent);
    background-image: linear-gradient(transparent 58%, rgba(105, 176, 251, 0.32) 60%, rgba(105, 176, 251, 0.32) 94%, transparent 92%);
  }
  .${x}-left > p { font-size: 16px !important; line-height: 26px !important; color: var(--a-secondary) !important; margin: 0 0 32px !important; max-width: 400px !important; }
  .${x}-feat { display: flex; align-items: flex-start; gap: 12px; padding: 16px 0; border-top: 1px solid var(--a-line); margin: 0; }
  .${x}-feat-icon {
    width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
    background: var(--a-brand-100); color: var(--a-accent);
    display: flex; align-items: center; justify-content: center;
  }
  .${x}-feat-icon svg { color: var(--a-accent) !important; stroke: currentColor; }
  .${x}-feat-name { font-weight: 500; font-size: 15px; color: var(--a-text); margin-bottom: 4px; }
  .${x}-feat-desc { font-size: 14px; line-height: 22px; color: var(--a-secondary); }

  .${x}-card {
    width: 100%; max-width: 400px; flex-shrink: 0;
    background: var(--a-card);
    border: 1px solid var(--a-line);
    border-radius: 16px;
    box-shadow: 0 8px 24px rgba(15, 30, 58, 0.06);
    padding: 32px 28px 28px;
  }
  .${x}-card-title { font-size: 22px; font-weight: 600; color: var(--a-text); margin: 0 0 4px; letter-spacing: -0.01em; }
  .${x}-card-sub { font-size: 14px; color: var(--a-secondary); margin: 0 0 24px; }

  .${x}-soc {
    width: 100%; height: 44px;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    border-radius: 10px; border: 1px solid transparent;
    font-size: 14px; font-weight: 500; font-family: inherit;
    cursor: pointer; margin-bottom: 8px;
    transition: filter 150ms var(--ease), transform 150ms var(--ease);
  }
  .${x}-soc:hover { filter: brightness(0.97); }
  .${x}-soc:active { transform: scale(0.98); }
  .${x}-google { background: #fff; color: #1f1f1f; border-color: var(--a-line) !important; }
  .${x}-naver { background: #03C75A; color: #fff; }
  .${x}-kakao { background: #FEE500; color: rgba(0, 0, 0, 0.85); }

  .${x}-div { display: flex; align-items: center; gap: 12px; margin: 16px 0; }
  .${x}-div-line { flex: 1; height: 1px; background: var(--a-line); }
  .${x}-div-txt { font-size: 13px; color: var(--a-muted); white-space: nowrap; }

  .${x}-field {
    display: flex; align-items: center;
    background: #fff;
    border: 1px solid var(--a-line);
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 8px;
    transition: border-color 150ms var(--ease), box-shadow 150ms var(--ease);
  }
  .${x}-field:focus-within { border-color: var(--a-accent); box-shadow: 0 0 0 3px rgba(42, 111, 227, 0.15); }
  .${x}-field.err { border-color: #dc2626; }
  .${x}-label {
    display: flex; align-items: center; gap: 8px;
    padding: 0 12px; min-width: 88px; height: 44px;
    border-right: 1px solid var(--a-line);
    font-size: 13px; font-weight: 400; color: var(--a-secondary);
    flex-shrink: 0;
  }
  .${x}-label svg { color: var(--a-muted) !important; stroke: currentColor; }
  .${x}-field input {
    flex: 1; min-width: 0; height: 44px; padding: 0 12px;
    background: transparent; border: none; outline: none;
    font-size: 14px; color: var(--a-text); font-family: inherit;
  }
  .${x}-field input::placeholder { color: var(--a-muted); }
  .${x}-pw-toggle {
    background: none; border: none; cursor: pointer;
    color: var(--a-muted); padding: 0 12px; height: 44px;
    display: flex; align-items: center;
    transition: color 150ms var(--ease);
  }
  .${x}-pw-toggle:hover { color: var(--a-text); }
  .${x}-err { font-size: 12px; color: #dc2626; margin: -4px 0 8px 4px; }

  .${x}-submit {
    width: 100%; height: 44px; margin-top: 8px;
    border: none; border-radius: 10px;
    font-size: 15px; font-weight: 500; font-family: inherit;
    cursor: pointer; color: #fff;
    background: var(--a-accent);
    transition: background-color 150ms var(--ease), transform 150ms var(--ease);
  }
  .${x}-submit:hover:not(:disabled) { background: var(--a-accent-ink); }
  .${x}-submit:active:not(:disabled) { transform: scale(0.98); }
  .${x}-submit:disabled { background: #a9b6ca; cursor: not-allowed; }
  .${x}-submit:focus-visible, .${x}-soc:focus-visible { outline: 2px solid var(--a-accent); outline-offset: 2px; }

  .${x}-foot { margin-top: 16px; text-align: center; font-size: 14px; color: var(--a-secondary); }
  .${x}-foot a { color: var(--a-accent-ink); font-weight: 500; text-decoration: none; }
  .${x}-foot a:hover { text-decoration: underline; }

  @media (max-width: 980px) {
    .${x}-left { display: none; }
    .${x}-body { padding: 32px 16px 48px; align-items: flex-start; }
    .${x}-nav { padding: 0 16px; }
    .${x}-card { max-width: 440px; }
  }
  @media (max-width: 480px) {
    .${x}-card { padding: 24px 20px 20px; }
    .${x}-label { min-width: 80px; }
  }
  `;
}
