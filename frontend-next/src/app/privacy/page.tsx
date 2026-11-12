import type { Metadata } from 'next';
import Link from 'next/link';

// 개인정보처리방침 (11/6). 로그인 없이 볼 수 있는 공개 페이지.
// 구글 OAuth 앱 게시(프로덕션)와 네이버 로그인 검수에 이 주소를 쓴다: https://skema-dku.vercel.app/privacy
// 내용을 바꾸면 아래 '시행일'도 같이 바꾸기.

export const metadata: Metadata = {
  title: '개인정보처리방침 | SKEMA',
  description: 'SKEMA가 수집하는 개인정보와 이용 목적, 보관 기간을 안내합니다.',
};

const EFFECTIVE_DATE = '2026년 11월 7일';
const CONTACT_EMAIL = 'dkuskema2026@gmail.com';

const COLLECTED: [string, string, string][] = [
  ['회원가입·로그인', '이메일, 이름 또는 닉네임, 비밀번호(암호화 저장), 소셜 로그인 식별값(카카오·네이버·구글)', '회원 식별, 로그인'],
  ['서비스 이용', '수업·개인 일정, 시험 일정, 공부 블록과 완료 여부, 수면 시간 등 온보딩 설정', '시간표·공부 계획 제공, 다시 짜기, 시험 준비도 계산'],
  ['시간표 이미지', '업로드한 시간표 캡처 이미지', '수업 정보 인식 (처리 후 바로 삭제하며 저장하지 않음)'],
  ['스터디 기록', '사용자가 올린 영상과 글, 좋아요', '스터디 그룹 기록 공유'],
  ['알림', '웹 푸시 구독 정보(브라우저가 만든 주소·키), 알림 설정', '일정 시작 전·미완료·시험 알림'],
  ['자동 수집', '접속 일시, 로그인 기록, 오류 기록', '보안, 오류 확인, 서비스 개선'],
];

const PROCESSORS: [string, string, string][] = [
  ['Railway', '서버·데이터베이스 운영', '싱가포르'],
  ['Vercel', '웹사이트 호스팅', '미국 등'],
  ['Cloudflare (R2)', '스터디 기록 영상 저장', '미국 등'],
  ['카카오·네이버·구글', '소셜 로그인', '각 사업자'],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-extrabold text-slate-950">{title}</h2>
      <div className="mt-3 space-y-2 text-sm leading-7 text-slate-700">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="bg-slate-50 text-xs font-bold text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-3">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="border-t border-slate-100 align-top">
              {row.map((cell, i) => (
                <td key={i} className={`px-4 py-3 ${i === 0 ? 'font-bold text-slate-900' : 'text-slate-700'}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white px-4 py-12 text-slate-900 sm:px-6">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm font-bold text-[#2a6fe3]">← SKEMA</Link>
        <h1 className="mt-4 text-3xl font-extrabold text-slate-950">개인정보처리방침</h1>
        <p className="mt-2 text-sm text-slate-500">시행일: {EFFECTIVE_DATE}</p>
        <p className="mt-6 text-sm leading-7 text-slate-700">
          SKEMA(단국대학교 2026 졸업작품 SKEMA팀, 이하 &lsquo;서비스&rsquo;)는 이용자의 개인정보를 소중히 다루며,
          서비스 제공에 꼭 필요한 정보만 수집합니다. 이 방침은 어떤 정보를 왜 수집하고 얼마나 보관하는지 안내합니다.
        </p>

        <Section title="1. 수집하는 정보와 이용 목적">
          <Table head={['구분', '수집 항목', '이용 목적']} rows={COLLECTED} />
          <p>수집한 정보는 위 목적 외에는 사용하지 않으며, 광고나 판매 목적으로 쓰지 않습니다.</p>
        </Section>

        <Section title="2. 보관 기간과 삭제">
          <p>회원 정보와 일정 등 서비스 이용 정보는 회원 탈퇴 시까지 보관하고, 탈퇴하면 바로 삭제합니다.</p>
          <p>탈퇴는 로그인 후 <b>프로필 → 회원탈퇴</b>에서 직접 할 수 있습니다.</p>
          <p>업로드한 시간표 이미지는 인식이 끝나면 바로 지우며 서버에 저장하지 않습니다.</p>
        </Section>

        <Section title="3. 제3자 제공">
          <p>이용자의 개인정보를 다른 회사나 기관에 제공하지 않습니다. 단, 법령에 따라 요구되는 경우는 예외입니다.</p>
        </Section>

        <Section title="4. 처리 위탁과 국외 이전">
          <p>서비스 운영을 위해 아래 업체의 서비스를 이용하며, 이 과정에서 정보가 해외 서버에 저장·처리될 수 있습니다.</p>
          <Table head={['업체', '맡기는 일', '위치']} rows={PROCESSORS} />
        </Section>

        <Section title="5. 이용자의 권리">
          <p>이용자는 언제든지 프로필에서 자신의 정보를 확인·수정하고, 회원탈퇴로 삭제할 수 있습니다.
            알림은 알림 설정에서 끄거나 브라우저 설정에서 거부할 수 있습니다.</p>
        </Section>

        <Section title="6. 안전성 확보 조치">
          <p>비밀번호는 암호화해 저장하고, 모든 통신은 HTTPS로 암호화합니다. 서버 접근 권한은 개발팀으로 제한합니다.</p>
        </Section>

        <Section title="7. 문의">
          <p>개인정보 관련 문의: <a className="font-bold text-[#2a6fe3]" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> (SKEMA팀)</p>
        </Section>

        <Section title="8. 방침 변경">
          <p>이 방침이 바뀌면 시행일과 함께 이 페이지에 알립니다.</p>
        </Section>
      </article>
    </main>
  );
}
