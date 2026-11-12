'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { indexToRecurringDay, recurringDayToIndex } from '@/lib/recurringDay';
import { normalizeTimeString } from '@/lib/utils';
import { useProfile, useUpdateProfile } from '@/hooks/useProfile';
import MaterialIcon from '@/components/common/MaterialIcon';
import { ScheduleKindToggle, toEtaKind, type EtaScheduleKind } from '@/components/timetable/ScheduleKindToggle';
import type { RecurringDay, StudyBlocksGenerateResult } from '@/types';
import { apiErrorMessage } from '@/lib/apiError';

type Phase = 'college-check' | 'eta-upload' | 'eta-review' | 'external-exam' | 'personal-schedule' | 'type-select' | 'sleep' | 'chat' | 'generating' | 'done';
type Message = { role: 'ai' | 'user'; text: string };

interface EtaEntry {
  _id: string;
  subject_name: string;
  day_of_week: number;   // 0=월~6=일
  start_time: string;    // HH:MM
  end_time: string;      // HH:MM
  location?: string;     // 강의실
  raw_text?: string;
  source: string;
  schedule_type: EtaScheduleKind;  // 수업 / 개인 (알바·스터디 등)
}

interface ExternalExam {
  _id: string;
  name: string;
  date: string;                        // YYYY-MM-DD
}

interface PersonalSchedule {
  _id: string;
  title: string;
  recurring_day: RecurringDay;         // MON~SUN
  days: RecurringDay[];                // 반복 요일 다중 선택
  start_time: string;                  // HH:MM
  end_time: string;                    // HH:MM
  is_recurring: boolean;
  date?: string;                       // YYYY-MM-DD (is_recurring=false 시 사용)
}

const DAY_LABELS = ['월','화','수','목','금','토','일'] as const;
const USER_TYPES = [
  { id: 'exam_prep',   label: '취준 & 시험준비생', icon: 'menu_book',    desc: '취업/공무원/자격증/입시 등', color: '#eaf2ff', iconColor: '#2a6fe3' },
  { id: 'high_school', label: '중고등학생',         icon: 'school',       desc: '내신/수능 준비',             color: '#eaf2ff', iconColor: '#2a6fe3' },
  { id: 'worker',      label: '직장인',             icon: 'work',         desc: '업무 외 자기계발',           color: '#eaf2ff', iconColor: '#2a6fe3' },
  { id: 'other',       label: '기타',               icon: 'person',       desc: '위 유형에 해당 없는 경우',   color: '#eaf2ff', iconColor: '#2a6fe3' },
];
// 대학생은 타입 선택 없이 항상 student

const CHAT_STEPS_COLLEGE = [
  {
    key: 'goal_tasks',
    question: `어떤 목표로, 어떤 과목을 공부하고 계세요?`,
    hint: '목표 과목/내용을 입력해주세요',
    quick: ['예시 보기'],
    examples: {
      '예시 보기': `이렇게 적어 주면 돼요\n· 수능준비, 대학입시, 영어\n· 수학, 영어`,
    },
  },
  {
    key: 'sleep',
    question: `보통 몇 시에 자고 몇 시에 일어나세요?`,
    hint: '예) 밤 11시 취침, 아침 7시 기상',
    quick: ['23시 취침, 7시 기상', '24시 취침, 8시 기상', '1시 취침, 8시 기상'],
  },
]
// CHAT_STEPS when NOT a college student (no eta, so include fixed schedule question)
const CHAT_STEPS_NON_COLLEGE = [
  {
    key: 'goal_tasks',
    question: `어떤 목표로, 어떤 과목을 공부하고 계세요?`,
    hint: '목표 과목/내용을 입력해주세요',
    quick: ['예시 보기'],
    examples: {
      '예시 보기': `이렇게 적어 주면 돼요\n· 수능준비, 대학입시, 영어\n· 정보처리기사, 자격증\n· 수학, 영어`,
    },
  },
  {
    key: 'schedule',
    question: `매주 반복되는 일정이 있나요?
업무나 학원 수업처럼요.

예) 화수목 9시~11시 어학원 수업
예) 화목 14시~16시 영어

없으면 아래 "없음"을 눌러주세요`,
    hint: '정기 일정을 입력해주세요',
    quick: ['없음'],
  },
  {
    key: 'exam',
    question: `다가오는 시험 일정이 있나요?

예) 4월 15일 중간고사
예) 5월 20일 발표 시험

없으면 아래 "없음"을 눌러주세요`,
    hint: '시험 일정을 입력해주세요',
    quick: ['없음'],
  },
  {
    key: 'sleep',
    question: `보통 몇 시에 자고 몇 시에 일어나세요?`,
    hint: '예) 밤 11시 취침, 아침 7시 기상',
    quick: ['23시 취침, 7시 기상', '24시 취침, 8시 기상', '1시 취침, 8시 기상'],
  },
]

const GENERATING_STEPS = [
  '입력한 내용을 정리하는 중',
  '비어 있는 시간을 찾는 중',
  '시험 날짜에 맞춰 공부 블록을 놓는 중',
  '거의 다 됐어요',
];

/**
 * 온보딩에서 사용자가 자유 텍스트로 입력한 시험 일정을 파싱한다.
 * POST /exam-schedules 배열 형태에 적합한 구조로 변환.
 *
 * 입력 예시:
 *   "4월 15일 중간고사 영어"
 *   "5/20 발표"
 *   "2026-06-10 기말고사"
 *   줄바꿈 / 쉼표 구분자 지원
 */
function _parseExamText(raw: string): Array<{ title: string; exam_date: string; subject?: string }> {
  if (!raw || raw.trim() === '없음') return [];

  const thisYear = new Date().getFullYear();
  const results: Array<{ title: string; exam_date: string; subject?: string }> = [];

  // 줄바꿈 / 쉼표로 분리
  const lines = raw.split(/[\n,]/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    let examDate = '';
    let title = line;

    // ISO: 2026-06-10
    const isoM = line.match(/(\d{4}-\d{2}-\d{2})/);
    if (isoM) {
      examDate = isoM[1];
      title = line.replace(isoM[0], '').trim();
    } else {
      // "4월 15일" or "4/15" or "4.15"
      const koM = line.match(/(\d{1,2})[월\/.][ ]?(\d{1,2})일?/);
      if (koM) {
        const month = koM[1].padStart(2, '0');
        const day = koM[2].padStart(2, '0');
        examDate = `${thisYear}-${month}-${day}`;
        title = line.replace(koM[0], '').trim();
      }
    }

    if (!examDate || !title) continue;

    // 제목 정리 (앞뒤 비문자 제거)
    title = title.replace(/^[\s\-·]+|[\s\-·]+$/g, '').trim();
    if (!title) title = '시험';

    results.push({ title, exam_date: examDate, subject: title });
  }

  return results;
}

const _DAY_CH_TO_RD: Record<string, RecurringDay> = {
  '월': 'MON', '화': 'TUE', '수': 'WED', '목': 'THU', '금': 'FRI', '토': 'SAT', '일': 'SUN',
};
const _ALL_DAYS: RecurringDay[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** "없음" 계열 응답 판별 */
function _isNoneAnswer(text: string): boolean {
  return /^(없음|없어요|없습니다|없다|없|아니요|아니오|아뇨|해당없음|x|-)$/i.test(text.trim());
}

/**
 * 자유 텍스트에서 시각 토큰을 모두 추출한다. ("HH:MM" 배열)
 * 오전/오후/밤/아침 등 한국어 시간대 표현을 24시간제로 변환.
 *   "밤 11시" → "23:00"   "오후 2시반" → "14:30"   "9~11" → ["09:00","11:00"]
 */
function _parseTimeTokens(text: string): string[] {
  const out: string[] = [];
  const re = /(오전|오후|아침|점심|저녁|밤|새벽|낮|정오|자정)?\s*(\d{1,2})\s*(?::\s*(\d{2})|시\s*(반|\d{1,2}\s*분)?)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const period = m[1];
    let h = parseInt(m[2], 10);
    let min = 0;
    if (m[3]) min = parseInt(m[3], 10);
    else if (m[4]) min = /반/.test(m[4]) ? 30 : (parseInt(m[4], 10) || 0);

    if (period === '오후' || period === '저녁' || period === '밤' || period === '낮' || period === '점심') {
      if (h < 12) h += 12;
    } else if (period === '오전' || period === '아침' || period === '새벽') {
      if (h === 12) h = 0;
    } else if (period === '자정') h = 0;
    else if (period === '정오') h = 12;

    if (h === 24) h = 0;
    if (h > 23 || min > 59) continue;
    out.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return out;
}

/** 취침~기상 수면 시간(시간 단위, 자정 넘김 처리) */
function _sleepHours(start: string, end: string): number {
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  let dur = toMin(end) - toMin(start);
  if (dur <= 0) dur += 24 * 60;
  return Math.round((dur / 60) * 10) / 10;
}

/** 요일 영역에서 반복 요일 추출. 공백/쉼표 구분 토큰이 "전부 요일 글자"일 때만 인정 → "수영" 오인식 방지 */
function _extractDays(region: string): RecurringDay[] {
  if (/매일/.test(region)) return [..._ALL_DAYS];
  if (/평일/.test(region)) return ['MON', 'TUE', 'WED', 'THU', 'FRI'];
  if (/주말/.test(region)) return ['SAT', 'SUN'];
  const days: RecurringDay[] = [];
  for (const rawTok of region.split(/[\s,]+/)) {
    const tok = rawTok.replace(/(요일|요|마다)$/, '');
    if (!tok || ![...tok].every((ch) => ch in _DAY_CH_TO_RD)) continue;
    for (const ch of tok) {
      const d = _DAY_CH_TO_RD[ch];
      if (d && !days.includes(d)) days.push(d);
    }
  }
  return days;
}

/**
 * 정기 일정 자유 텍스트 → PersonalSchedule[].
 * 한 줄 = 한 일정. 요일과 시작·종료 시각을 모두 인식해야 채택, 아니면 그 줄은 버린다.
 *   "화수목 9시~11시 어학원 수업" → 화·수·목 09:00~11:00 "어학원 수업"
 */
function _parseScheduleText(raw: string): PersonalSchedule[] {
  if (!raw || _isNoneAnswer(raw)) return [];
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const results: PersonalSchedule[] = [];
  raw.split(/\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    const times = _parseTimeTokens(line);
    if (times.length < 2) return;
    const days = _extractDays(line);   // 요일이 시각 앞/뒤 어디 있든 인식 (토큰 기반이라 "수영"의 '수' 오인식 없음)
    if (days.length === 0) return;

    // "오후 9시~11시"처럼 종료 시각에 시간대 표현이 빠져 시작보다 빠르면 오후(+12)로 보정
    const start = times[0];
    let end = times[1];
    if (toMin(end) <= toMin(start)) {
      const [eh, em] = end.split(':').map(Number);
      if (eh + 12 <= 23 && (eh + 12) * 60 + em > toMin(start)) {
        end = `${String(eh + 12).padStart(2, '0')}:${String(em).padStart(2, '0')}`;
      }
    }

    // 제목: 요일·시각·연결어 토큰을 제거한 나머지 단어들 (요일 앞/뒤 어디에 있든 보존)
    const title = line.split(/[\s,]+/).map((w) => {
      if (/^(평일|매일|주말|주중)$/.test(w)) return '';                            // 요일 키워드
      const stripped = w.replace(/(요일|요|마다)$/, '');
      if (stripped && [...stripped].every((c) => c in _DAY_CH_TO_RD)) return '';   // 순수 요일 토큰
      return w
        .replace(/(오전|오후|아침|점심|저녁|밤|새벽|낮|정오|자정)/g, '')
        .replace(/\d{1,2}\s*(?::\s*\d{2}|시\s*(?:반|\d{1,2}\s*분)?)?/g, '')
        .replace(/[~\-–]/g, '')
        .replace(/(에서|부터|까지)/g, '')
        .trim();
    }).filter(Boolean).join(' ') || '일정';

    results.push({
      _id: `ps-${Date.now()}-${i}`,
      title,
      recurring_day: days[0],
      days,
      start_time: start,
      end_time: end,
      is_recurring: true,
      date: '',
    });
  });
  return results;
}

type StepResult =
  | { ok: true; schedules?: PersonalSchedule[]; exams?: ExternalExam[]; confirm?: string }
  | { ok: false; error: string };

/**
 * 비대학생 온보딩 채팅의 단계별 답변 검증·파싱.
 * 제대로 인식하지 못하면 ok:false + 안내 문구를 돌려주어 같은 단계에서 다시 묻도록 한다.
 */
function _validateStep(key: string, text: string): StepResult {
  const t = text.trim();

  if (key === 'goal_tasks') {
    if (t.length < 2) {
      return { ok: false, error: '조금 더 자세히 알려 주세요\n예) 정보처리기사, 자격증\n예) 수학, 영어' };
    }
    return { ok: true };
  }

  if (key === 'schedule') {
    if (_isNoneAnswer(t)) return { ok: true, schedules: [] };
    const parsed = _parseScheduleText(t);
    if (parsed.length === 0) {
      return { ok: false, error: '요일과 시간을 같이 적어 주면 정확하게 넣어 드려요\n예) 화수목 9시~11시 어학원 수업\n없으면 아래 "없음"을 눌러주세요' };
    }
    const fmt = parsed.map((s) => `· ${s.days.map((d) => DAY_LABELS[recurringDayToIndex(d)]).join('·')} ${s.start_time}~${s.end_time} ${s.title}`).join('\n');
    return { ok: true, schedules: parsed, confirm: `이렇게 등록해 둘게요\n${fmt}` };
  }

  if (key === 'exam') {
    if (_isNoneAnswer(t)) return { ok: true, exams: [] };
    const parsed = _parseExamText(t);
    if (parsed.length === 0) {
      return { ok: false, error: '날짜와 시험 이름을 같이 적어 주세요\n예) 4월 15일 중간고사\n없으면 아래 "없음"을 눌러주세요' };
    }
    const exams: ExternalExam[] = parsed.map((e, i) => ({ _id: `ex-${Date.now()}-${i}`, name: e.title, date: e.exam_date }));
    const fmt = exams.map((e) => `· ${e.date} ${e.name}`).join('\n');
    return { ok: true, exams, confirm: `이렇게 등록해 둘게요\n${fmt}` };
  }

  if (key === 'sleep') {
    const toks = _parseTimeTokens(t);
    if (toks.length < 2) {
      return { ok: false, error: '자는 시간과 일어나는 시간을 둘 다 알려 주세요\n예) 밤 11시 취침, 아침 7시 기상' };
    }
    const dur = _sleepHours(toks[0], toks[1]);
    const durLabel = dur % 1 === 0 ? `${dur}` : dur.toFixed(1);
    // 수면이 짧아도 되묻지 않고 그대로 반영 — 짧을 때만 가볍게 알려줌
    const note = dur < 6 ? `\n잠이 짧은 편이라 공부 블록은 무리하지 않게 넣을게요` : '';
    return { ok: true, confirm: `반영했어요${note}` };
  }

  return { ok: true };
}

export default function OnboardingPage() {
  const router = useRouter();
  const updateProfile = useUpdateProfile();
  const { data: profile } = useProfile();

  useEffect(() => {
    if (!profile?.onboarding_completed) return;
    const flag = sessionStorage.getItem('skema_onboarding_done');
    if (!flag) {
      sessionStorage.setItem('skema_onboarding_done', '1');
      router.push('/dashboard');
    }
  }, [profile?.onboarding_completed, router]);

  const todayStr = new Date().toISOString().split('T')[0];

  const [phase, setPhase] = useState<Phase>('college-check');
  const [isCollegeStudent, setIsCollegeStudent] = useState<boolean | null>(null);

  // ETA 이미지 업로드 & 파싱 상태
  const [etaImage, setEtaImage] = useState<File | null>(null);
  const [etaImagePreview, setEtaImagePreview] = useState<string | null>(null);
  const [etaParsing, setEtaParsing] = useState(false);
  const [etaEntries, setEtaEntries] = useState<EtaEntry[]>([]);
  const [etaSaving, setEtaSaving] = useState(false);
  const [etaImageExpanded, setEtaImageExpanded] = useState(false);
  const etaFileRef = useRef<HTMLInputElement>(null);


  const [selectedType, setSelectedType] = useState<string>('');
  // 비대학생 온보딩 사용
  const [externalExams, setExternalExams] = useState<ExternalExam[]>([]);
  const [personalSchedules, setPersonalSchedules] = useState<PersonalSchedule[]>([]);
  // external-exam 입력 폼 임시 상태
  const [examDraft, setExamDraft] = useState<Omit<ExternalExam, '_id'>>({ name: '', date: '' });
  const examDateRef = useRef<HTMLInputElement>(null);
  const [examError, setExamError] = useState('');
  // 공부 블록 자동 생성 설정
  const [studyStartDays, setStudyStartDays] = useState<number>(14);
  const [studyDaysPerWeek, setStudyDaysPerWeek] = useState<number>(3);
  const [studyHoursPerSession, setStudyHoursPerSession] = useState<number>(2);
  // personal-schedule 입력 폼 임시 상태
  const [scheduleDraft, setScheduleDraft] = useState<Omit<PersonalSchedule, '_id'>>({ title: '', recurring_day: 'MON', days: ['MON'], start_time: '09:00', end_time: '10:00', is_recurring: true, date: '' });
  const [sleepStart, setSleepStart] = useState('23:00');
  const [sleepEnd, setSleepEnd] = useState('07:00');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [generatingStep, setGeneratingStep] = useState(0);
  const [showEtaOverwriteConfirm, setShowEtaOverwriteConfirm] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeSteps = isCollegeStudent ? CHAT_STEPS_COLLEGE : CHAT_STEPS_NON_COLLEGE;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);


  // ETA 이미지 분석 (공통 로직 — upload/review 양쪽에서 호출 가능)
  const _parseEtaFile = async (file: File, goToReview = true) => {
    setEtaImage(file);
    const previewUrl = URL.createObjectURL(file);
    setEtaImagePreview(previewUrl);
    setEtaParsing(true);
    setEtaEntries([]);

    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/eta/parse-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const v1 = Array.isArray(res.data) ? res.data as Array<{ subject_name: string; day_of_week: number; start_time: string; end_time: string; location?: string | null; raw_text?: string; source?: string; requires_review?: boolean; schedule_type?: string; }> : [];
      const dayKo = ['월요일','화요일','수요일','목요일','금요일','토요일','일요일'];
      const entries: EtaEntry[] = v1.map((e, i) => ({
        _id: `eta-${Date.now()}-${i}`,
        subject_name: e.subject_name || '',
        day_of_week: e.day_of_week,
        start_time: normalizeTimeString(e.start_time) || e.start_time,
        end_time: normalizeTimeString(e.end_time) || e.end_time,
        location: e.location || '',
        raw_text: e.raw_text || `${dayKo[e.day_of_week] ?? ''} ${e.start_time}~${e.end_time}`,
        source: e.source || 'eta_image',
        schedule_type: toEtaKind(e.schedule_type),
      }));
      setEtaEntries(entries);
      if (entries.length === 0) {
        toast('시간표를 읽지 못했어요. 수업을 직접 추가해 주세요');
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, '연결이 불안정해요. 잠시 후 다시 시도해 주세요'));
      setEtaEntries([]);
    } finally {
      setEtaParsing(false);
      if (goToReview) setPhase('eta-review');
    }
  };

  /** 새 파일 선택 후 분석 → review 화면 이동 */
  const handleParseEtaImage = (file: File) => _parseEtaFile(file, true);

  /** review 화면에서 기존 이미지 재분석 (화면 이동 없이) */
  const handleReParseEtaImage = async () => {
    if (!etaImage || etaParsing) return;
    await _parseEtaFile(etaImage, false);
    toast.success('다시 읽었어요');
  };

  const parseTime = (text: string) => {
    const toks = _parseTimeTokens(text);
    return {
      sleep_start: toks[0] ?? '23:00',
      sleep_end: toks[1] ?? '07:00',
    };
  };

  const finishOnboarding = async (
    finalAnswers: Record<string, string>,
    directSleep?: { sleep_start: string; sleep_end: string }
  ) => {
    setPhase('generating');
    for (let i = 0; i < GENERATING_STEPS.length; i++) {
      setGeneratingStep(i);
      await new Promise((r) => setTimeout(r, i === GENERATING_STEPS.length - 1 ? 800 : 1200));
    }

    try {
      const sleepTimes = directSleep ?? parseTime(finalAnswers.sleep || '');
      const effectiveType = selectedType || (isCollegeStudent ? 'student' : 'other');
      await updateProfile.mutateAsync({
        user_type: effectiveType,
        occupation: USER_TYPES.find((t) => t.id === effectiveType)?.label || '',
        sleep_start: sleepTimes.sleep_start,
        sleep_end: sleepTimes.sleep_end,
        goal_tasks: finalAnswers.goal_tasks || '',
        is_college_student: isCollegeStudent ?? false,
        onboarding_completed: true,
      });

      // 강의 시간표는 eta-review 단계에서 저장 → /eta/save-schedules 직접 저장됨

      // 대학생 온보딩: external-exam phase에서 입력한 시험 일정 저장
      const savedExamIds: number[] = [];
      if (isCollegeStudent) {
        for (const exam of externalExams) {
          if (!exam.date || !exam.name) continue;
          try {
            const { data } = await api.post<{ id: number }>('/exam-schedules', {
              title: exam.name,
              subject: exam.name,
              exam_date: exam.date,
            });
            savedExamIds.push(data.id);
          } catch { /* 개별 시험 등록 실패 시 무시 */ }
        }

        // personal-schedule phase에서 입력한 정기 일정 저장
        for (const sched of personalSchedules) {
          if (!sched.title || !sched.start_time || !sched.end_time) continue;
          try {
            await api.post('/schedules', {
              title: sched.title,
              recurring_day: sched.recurring_day,
              days: sched.is_recurring ? sched.days : undefined,
              start_time: sched.start_time,
              end_time: sched.end_time,
              schedule_type: 'activity',
              schedule_source: 'user_created',
              view_scope: 'all',
              ...(sched.is_recurring ? {} : { date: sched.date || undefined }),
              color: '#A855F7',
            });
          } catch { /* 개별 일정 등록 실패 시 무시 */ }
        }

        // 시험별 공부 블록 자동 생성 (#12): 시험 전날까지 빈 시간에 30분 단위로 서버가 배치
        if (savedExamIds.length > 0) {
          try {
            await api.post<StudyBlocksGenerateResult>('/study-blocks/generate', {
              exam_ids: savedExamIds,
              start_days_before: studyStartDays,
              days_per_week: studyDaysPerWeek,
              minutes_per_day: Math.max(30, Math.round(studyHoursPerSession * 60)),
            });
          } catch { /* 공부 블록 배치 실패 시 온보딩은 계속 진행 */ }
        }
      } else {
        // 비대학생 온보딩: external-exam / personal-schedule 에서 입력한 상태 직접 저장
        for (const exam of externalExams) {
          if (!exam.date || !exam.name) continue;
          try {
            const { data } = await api.post<{ id: number }>('/exam-schedules', {
              title: exam.name,
              subject: exam.name,
              exam_date: exam.date,
            });
            savedExamIds.push(data.id);
          } catch { /* 개별 시험 등록 실패 시 무시 */ }
        }

        for (const sched of personalSchedules) {
          if (!sched.title || !sched.start_time || !sched.end_time) continue;
          try {
            await api.post('/schedules', {
              title: sched.title,
              recurring_day: sched.recurring_day,
              days: sched.is_recurring ? sched.days : undefined,
              start_time: sched.start_time,
              end_time: sched.end_time,
              schedule_type: 'activity',
              schedule_source: 'user_created',
              view_scope: 'all',
              ...(sched.is_recurring ? {} : { date: sched.date || undefined }),
              color: '#A855F7',
            });
          } catch { /* 개별 일정 등록 실패 시 무시 */ }
        }
      }

      setPhase('done');
      setTimeout(() => router.push('/dashboard'), 1800);
    } catch {
      toast.error('\uc124\uc815 \uc800\uc7a5 \uc911 \uc624\ub958\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4');
      setPhase('sleep');
    }
  };

  const handleTypeSelect = (typeId: string) => {
    setSelectedType(typeId);
    setPhase('external-exam');
  };

  /** 대학생 온보딩: personal-schedule 완료 후 chat 진입 */
  const handleCollegeStartChat = () => {
    setPhase('sleep');
  };

  const handleSend = async (text?: string) => {
    const userText = (text ?? input).trim();
    if (!userText || isProcessing) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: userText }]);

    const step = activeSteps[stepIdx];
    const result = _validateStep(step.key, userText);

    // \ub2f5\uc744 \uc81c\ub300\ub85c \uc778\uc2dd\ud558\uc9c0 \ubabb\ud558\uba74 \ub2e4\uc74c \ub2e8\uacc4\ub85c \ub118\uc5b4\uac00\uc9c0 \uc54a\uace0 \uac19\uc740 \ub2e8\uacc4\uc5d0\uc11c \ub2e4\uc2dc \ubb3b\ub294\ub2e4
    if (!result.ok) {
      setIsProcessing(true);
      setTimeout(() => {
        setMessages((prev) => [...prev, { role: 'ai', text: result.error }]);
        setIsProcessing(false);
      }, 400);
      return;
    }

    // \ud30c\uc2f1 \uacb0\uacfc\ub97c \uc628\ubcf4\ub529 \uc800\uc7a5\uc5d0 \uc4f0\uc774\ub294 \uc0c1\ud0dc\uc5d0 \ubc18\uc601 (\ube44\ub300\ud559\uc0dd: finishOnboarding\uc774 \uc774 \ubc30\uc5f4\uc744 \uc800\uc7a5)
    if (result.schedules?.length) setPersonalSchedules((prev) => [...prev, ...result.schedules!]);
    if (result.exams?.length) setExternalExams((prev) => [...prev, ...result.exams!]);

    const newAnswers = { ...answers, [step.key]: userText };
    setAnswers(newAnswers);
    const nextIdx = stepIdx + 1;
    const confirmMsg: Message[] = result.confirm ? [{ role: 'ai', text: result.confirm }] : [];

    if (nextIdx < activeSteps.length) {
      setStepIdx(nextIdx);
      setIsProcessing(true);
      setTimeout(() => {
        setMessages((prev) => [...prev, ...confirmMsg, { role: 'ai', text: activeSteps[nextIdx].question }]);
        setIsProcessing(false);
      }, 500);
    } else {
      setIsProcessing(true);
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          ...confirmMsg,
          { role: 'ai', text: '시간표를 만드는 중이에요' },
        ]);
        setIsProcessing(false);
        finishOnboarding(newAnswers);
      }, 500);
    }
  };

  const handleSkip = () => {
    updateProfile.mutate(
      { onboarding_completed: true, is_college_student: isCollegeStudent ?? false },
      {
        onSuccess: () => router.push('/dashboard'),
        onError: () => router.push('/dashboard'),
      }
    );
  };

  // 대학생 여부 선택 화면 렌더
  if (phase === 'college-check') {
    return (
      <div className="skema-onboarding-screen min-h-screen flex flex-col items-center justify-center overflow-y-auto p-4 sm:p-6">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6" style={{ background: '#2a6fe3' }}>
            <MaterialIcon icon="schedule" size={32} color="#fff" />
          </div>
          <h1 className="text-2xl font-semibold mb-2" style={{ color: '#0f1e3a' }}>시간표 만들기</h1>
          <p className="text-sm mb-10" style={{ color: '#44536b' }}>질문 몇 개에 답하면 수업과 공부 블록이 들어간 시간표가 만들어져요</p>

          <div className="rounded-2xl p-6 mb-8 text-left" style={{ background: '#fff', border: '1px solid #dfe7f3' }}>
            <p className="text-lg font-medium mb-1" style={{ color: '#0f1e3a' }}>현재 대학생이신가요?</p>
            <p className="text-sm" style={{ color: '#44536b' }}>대학생이면 에브리타임 시간표 캡처로 수업을 바로 넣어요</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => {
                setIsCollegeStudent(true);
                setSelectedType('student');
                setPhase('eta-upload');
              }}
              className="flex flex-col items-center gap-3 p-6 rounded-2xl border transition-colors active:scale-[0.98]"
              style={{ background: '#fff', borderColor: '#dfe7f3' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2a6fe3'; e.currentTarget.style.background = '#eaf2ff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#dfe7f3'; e.currentTarget.style.background = '#fff'; }}
            >
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#eaf2ff' }}>
                <MaterialIcon icon="school" size={30} color="#1f63d6" />
              </div>
              <div>
                <p className="font-medium text-sm mb-0.5" style={{ color: '#0f1e3a' }}>네, 대학생이에요</p>
                <p className="text-xs" style={{ color: '#44536b' }}>에타 시간표 자동 생성</p>
              </div>
            </button>

            <button
              onClick={() => {
                setIsCollegeStudent(false);
                setStepIdx(0);
                setMessages([{ role: 'ai', text: CHAT_STEPS_NON_COLLEGE[0].question }]);
                setPhase('chat');
              }}
              className="flex flex-col items-center gap-3 p-6 rounded-2xl border transition-colors active:scale-[0.98]"
              style={{ background: '#fff', borderColor: '#dfe7f3' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#44536b'; e.currentTarget.style.background = '#f5f8fd'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#dfe7f3'; e.currentTarget.style.background = '#fff'; }}
            >
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#fff8eb' }}>
                <MaterialIcon icon="person" size={30} color="#92400e" />
              </div>
              <div>
                <p className="font-medium text-sm mb-0.5" style={{ color: '#0f1e3a' }}>아니요</p>
                <p className="text-xs" style={{ color: '#44536b' }}>일반 유형으로 진행</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 에브리타임 시간표 이미지 업로드 화면 렌더
  if (phase === 'eta-upload') {
    return (
      <div className="skema-onboarding-screen min-h-screen flex flex-col items-center justify-center overflow-y-auto p-4 sm:p-6">
        <div className="w-full max-w-lg">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setPhase('college-check')}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
              style={{ background: '#fff', border: '1px solid #dfe7f3' }}
            >
              <MaterialIcon icon="arrow_back" size={18} color="#44536b" />
            </button>
            <div>
              <h2 className="font-semibold text-lg" style={{ color: '#0f1e3a' }}>에타 시간표 업로드</h2>
              <p className="text-xs" style={{ color: '#44536b' }}>1단계 / 5단계</p>
            </div>
          </div>

          {/* Progress */}
          <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#dfe7f3' }}>
            <div className="h-full rounded-full" style={{ width: '20%', background: '#2a6fe3' }} />
          </div>

          {/* Guide card */}
          <div className="rounded-2xl p-4 mb-5 flex items-start gap-3" style={{ background: '#eaf2ff', border: '1px solid #bcd8fe' }}>
            <MaterialIcon icon="photo_camera" size={20} color="#2a6fe3" className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium mb-1" style={{ color: '#2a6fe3' }}>에타 시간표 촬영 방법</p>
              <ol className="text-xs leading-relaxed space-y-0.5" style={{ color: '#44536b' }}>
                <li>1. 에브리타임 앱에서 시간표 전체 보기</li>
                <li>2. 전체 시간표가 보이도록 화면 캡처</li>
                <li>3. 이미지를 여기에 업로드해주세요</li>
              </ol>
            </div>
          </div>

          {/* Upload area */}
          <input
            ref={etaFileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleParseEtaImage(f); }}
          />

          <div
            className="rounded-2xl border border-dashed flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors mb-5"
            style={{ minHeight: 200, borderColor: etaImage ? '#2a6fe3' : '#dfe7f3', background: etaImage ? '#eaf2ff' : '#f5f8fd' }}
            onClick={() => etaFileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f && f.type.startsWith('image/')) handleParseEtaImage(f);
            }}
          >
            {etaImagePreview ? (
              <div className="relative w-full p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={etaImagePreview}
                  alt="업로드된 시간표"
                  className="w-full rounded-xl object-contain"
                  style={{ maxHeight: 280 }}
                />
                <div className="absolute inset-0 flex items-center justify-center rounded-xl opacity-0 hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.4)' }}>
                  <span className="text-white text-sm font-medium">다른 이미지 선택</span>
                </div>
              </div>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: '#eaf2ff' }}>
                  <MaterialIcon icon="upload_file" size={38} color="#2a6fe3" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium" style={{ color: '#0f1e3a' }}>이미지를 드래그하거나 클릭해서 업로드</p>
                  <p className="text-xs mt-1" style={{ color: '#44536b' }}>JPG, PNG, WEBP · 최대 20MB</p>
                </div>
              </>
            )}
          </div>

          {etaParsing && (
            <div className="rounded-xl p-4 mb-4 flex items-center gap-3" style={{ background: '#eaf2ff', border: '1px solid #bcd8fe' }}>
              <div className="w-5 h-5 border border-t-transparent rounded-full animate-spin flex-shrink-0" style={{ borderColor: '#bcd8fe', borderTopColor: 'transparent' }} />
              <p className="text-[14px] font-medium" style={{ color: '#2a6fe3' }}>시간표를 읽고 있어요...</p>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => {
                setEtaImage(null);
                setEtaImagePreview(null);
                setEtaEntries([]);
                setPhase('external-exam');
              }}
              className="flex-1 py-3 rounded-xl text-[14px] font-medium border transition-colors"
              style={{ color: '#44536b', borderColor: '#dfe7f3', background: '#fff' }}
              disabled={etaParsing}
            >
              건너뛰기
            </button>
            {etaImage && !etaParsing && (
              <button
                onClick={() => setPhase('eta-review')}
                className="flex-1 py-3 rounded-xl text-sm font-medium text-white transition-colors"
                style={{ background: '#2a6fe3' }}
              >
                다음
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 에타 시간표 확인 및 수정 화면 렌더
  if (phase === 'eta-review') {
    const removeEntry = (id: string) => setEtaEntries((prev) => prev.filter((e) => e._id !== id));

    const updateEntry = (id: string, field: keyof EtaEntry, value: string | number) => {
      setEtaEntries((prev) => prev.map((e) => e._id === id ? { ...e, [field]: value } : e));
    };

    const valid = etaEntries.filter(
      (e) => e.subject_name.trim() && e.start_time && e.end_time && e.start_time < e.end_time,
    );

    const isReturningUser = profile?.onboarding_completed === true;

    const doSaveAndContinue = async () => {
      setShowEtaOverwriteConfirm(false);
      if (valid.length === 0) { setPhase('external-exam'); return; }
      setEtaSaving(true);
      try {
        if (isReturningUser) await api.delete('/eta/schedules');
        await api.post('/eta/save-schedules', {
          entries: valid.map(({ subject_name, day_of_week, start_time, end_time, location, source, schedule_type }) => ({
            subject_name, day_of_week, start_time, end_time, location: location ?? '', source, schedule_type,
          })),
        });
        toast.success(`수업 ${valid.length}개를 시간표에 넣었어요`);
      } catch {
        toast.error('연결이 불안정해요. 잠시 후 다시 시도해 주세요');
      } finally {
        setEtaSaving(false);
        setPhase('external-exam');
      }
    };

    const handleSaveAndContinue = () => {
      if (isReturningUser && valid.length > 0) {
        setShowEtaOverwriteConfirm(true);
      } else {
        doSaveAndContinue();
      }
    };

    return (
      <>
      <div className="skema-onboarding-screen min-h-screen flex flex-col items-center justify-start overflow-y-auto px-4 py-5 sm:justify-center sm:p-6">
        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="flex items-start gap-3 mb-6">
            <button
              onClick={() => setPhase('eta-upload')}
              className="w-9 h-9 rounded-xl flex shrink-0 items-center justify-center transition-colors"
              style={{ background: '#fff', border: '1px solid #dfe7f3' }}
            >
              <MaterialIcon icon="arrow_back" size={18} color="#44536b" />
            </button>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-tight" style={{ color: '#0f1e3a' }}>시간표 확인 및 수정</h2>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: '#44536b' }}>2단계 / 5단계 · 읽어 온 결과를 확인하고 수정해주세요</p>
            </div>
          </div>

          {/* Progress */}
          <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#dfe7f3' }}>
            <div className="h-full rounded-full" style={{ width: '40%', background: '#2a6fe3' }} />
          </div>

          {/* Status banner */}
          {etaParsing ? (
            <div className="rounded-xl p-3 mb-5 flex items-center gap-2" style={{ background: '#eaf2ff', border: '1px solid #bcd8fe' }}>
              <div className="w-4 h-4 border border-t-transparent rounded-full animate-spin flex-shrink-0" style={{ borderColor: '#bcd8fe', borderTopColor: 'transparent' }} />
              <p className="text-[14px] font-medium" style={{ color: '#2a6fe3' }}>시간표를 다시 읽고 있어요</p>
            </div>
          ) : etaEntries.length > 0 ? (
            <div className="rounded-xl p-3 mb-5 flex items-center gap-2" style={{ background: '#eaf2ff', border: '1px solid #bcd8fe' }}>
              <MaterialIcon icon="check_circle" size={16} color="#1f63d6" />
              <p className="text-[14px] font-medium" style={{ color: '#1f63d6' }}>
                수업 {etaEntries.length}개를 읽었어요. 틀린 줄은 고치거나 지워 주세요
              </p>
            </div>
          ) : (
            <div className="rounded-xl p-3 mb-5 flex items-center gap-2" style={{ background: '#fff8eb', border: '1px solid #fde7b0' }}>
              <MaterialIcon icon="warning" size={16} color="#92400e" />
              <p className="text-[14px] font-medium" style={{ color: '#92400e' }}>
                시간표를 읽지 못했어요. &quot;다시 분석&quot;을 누르거나 수업을 직접 추가해 주세요
              </p>
            </div>
          )}

          {/* Entry list */}
          <div className="rounded-2xl overflow-hidden mb-4" style={{ background: '#fff', border: '1px solid #dfe7f3' }}>
            {/* Table header */}
            <div className="hidden gap-2 px-4 py-2.5 text-xs font-medium sm:grid" style={{
              gridTemplateColumns: '2fr 96px 80px 90px 90px 1fr 36px',
              borderBottom: '1px solid #edf3fc',
              background: '#f5f8fd',
              color: '#44536b',
            }}>
              <span>과목명</span>
              <span>종류</span>
              <span>요일</span>
              <span>시작</span>
              <span>종료</span>
              <span>강의실</span>
              <span></span>
            </div>

            {etaEntries.length === 0 && (
              <div className="px-4 py-8 text-center text-sm" style={{ color: '#5f6f88' }}>
                추가된 과목이 없습니다
              </div>
            )}

            {etaEntries.map((entry, idx) => (
              <div key={entry._id}>
                <div
                  className="hidden gap-2 px-4 py-2.5 items-center sm:grid"
                  style={{
                    gridTemplateColumns: '2fr 96px 80px 90px 90px 1fr 36px',
                    borderBottom: idx < etaEntries.length - 1 ? '1px solid #edf3fc' : 'none',
                  }}
                >
                  {/* 과목명 */}
                  <input
                    type="text"
                    value={entry.subject_name}
                    onChange={(e) => updateEntry(entry._id, 'subject_name', e.target.value)}
                    placeholder="과목명을 입력하세요"
                    className="w-full px-2 py-1.5 text-sm rounded-lg border outline-none transition-colors"
                    style={{ borderColor: entry.subject_name ? '#dfe7f3' : '#fecaca', background: '#f5f8fd' }}
                    onFocus={(e) => e.target.style.borderColor = '#2a6fe3'}
                    onBlur={(e) => e.target.style.borderColor = entry.subject_name ? '#dfe7f3' : '#fecaca'}
                  />
                  {/* 종류: 수업 / 개인 */}
                  <ScheduleKindToggle
                    value={entry.schedule_type}
                    onChange={(v) => updateEntry(entry._id, 'schedule_type', v)}
                  />
                  {/* 요일 */}
                  <select
                    value={entry.day_of_week}
                    onChange={(e) => updateEntry(entry._id, 'day_of_week', Number(e.target.value))}
                    className="w-full px-2 py-1.5 text-sm rounded-lg border outline-none"
                    style={{ borderColor: '#dfe7f3', background: '#f5f8fd' }}
                  >
                    {DAY_LABELS.map((d, i) => (
                      <option key={i} value={i}>{d}요일</option>
                    ))}
                  </select>
                  {/* 시작 시간 */}
                  <input
                    type="time"
                    step="300"
                    value={entry.start_time}
                    onChange={(e) => updateEntry(entry._id, 'start_time', e.target.value)}
                    className="w-full px-2 py-1.5 text-sm rounded-lg border outline-none"
                    style={{ borderColor: '#dfe7f3', background: '#f5f8fd' }}
                  />
                  {/* 종료 시간 */}
                  <input
                    type="time"
                    step="300"
                    value={entry.end_time}
                    onChange={(e) => updateEntry(entry._id, 'end_time', e.target.value)}
                    className="w-full px-2 py-1.5 text-sm rounded-lg border outline-none"
                    style={{ borderColor: '#dfe7f3', background: '#f5f8fd' }}
                  />
                  {/* 강의실 */}
                  <input
                    type="text"
                    value={entry.location ?? ''}
                    onChange={(e) => updateEntry(entry._id, 'location', e.target.value)}
                    placeholder="강의실"
                    className="w-full px-2 py-1.5 text-sm rounded-lg border outline-none"
                    style={{ borderColor: '#dfe7f3', background: '#f5f8fd' }}
                  />
                  {/* 삭제 */}
                  <button
                    onClick={() => removeEntry(entry._id)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                    style={{ background: '#fef2f2' }}
                    aria-label="과목 삭제"
                  >
                    <MaterialIcon icon="delete" size={14} color="#dc2626" />
                  </button>
                </div>

                <div
                  className="p-3 sm:hidden"
                  style={{ borderBottom: idx < etaEntries.length - 1 ? '1px solid #edf3fc' : 'none' }}
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-[13px]" style={{ color: '#5f6f88' }}>과목 {idx + 1}</p>
                    <button
                      onClick={() => removeEntry(entry._id)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors"
                      style={{ background: '#fef2f2' }}
                      aria-label="과목 삭제"
                    >
                      <MaterialIcon icon="delete" size={16} color="#dc2626" />
                    </button>
                  </div>

                  <label className="mb-3 block">
                    <span className="mb-1 block text-xs font-medium" style={{ color: '#44536b' }}>과목명</span>
                    <input
                      type="text"
                      value={entry.subject_name}
                      onChange={(e) => updateEntry(entry._id, 'subject_name', e.target.value)}
                      placeholder="과목명을 입력하세요"
                      className="h-11 w-full rounded-xl border px-3 text-base outline-none transition-colors"
                      style={{ borderColor: entry.subject_name ? '#dfe7f3' : '#fecaca', background: '#f5f8fd' }}
                      onFocus={(e) => e.target.style.borderColor = '#2a6fe3'}
                      onBlur={(e) => e.target.style.borderColor = entry.subject_name ? '#dfe7f3' : '#fecaca'}
                    />
                  </label>

                  <div className="mb-3">
                    <span className="mb-1 block text-xs font-medium" style={{ color: '#44536b' }}>종류</span>
                    <ScheduleKindToggle
                      size="md"
                      value={entry.schedule_type}
                      onChange={(v) => updateEntry(entry._id, 'schedule_type', v)}
                    />
                  </div>

                  <div className="mb-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                    <label className="block min-w-0">
                      <span className="mb-1 block text-xs font-medium" style={{ color: '#44536b' }}>요일</span>
                      <select
                        value={entry.day_of_week}
                        onChange={(e) => updateEntry(entry._id, 'day_of_week', Number(e.target.value))}
                        className="h-11 w-full rounded-xl border px-3 text-base outline-none"
                        style={{ borderColor: '#dfe7f3', background: '#f5f8fd' }}
                      >
                        {DAY_LABELS.map((d, i) => (
                          <option key={i} value={i}>{d}요일</option>
                        ))}
                      </select>
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1 block text-xs font-medium" style={{ color: '#44536b' }}>강의실</span>
                      <input
                        type="text"
                        value={entry.location ?? ''}
                        onChange={(e) => updateEntry(entry._id, 'location', e.target.value)}
                        placeholder="강의실"
                        className="h-11 w-full rounded-xl border px-3 text-base outline-none"
                        style={{ borderColor: '#dfe7f3', background: '#f5f8fd' }}
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                    <label className="block min-w-0">
                      <span className="mb-1 block text-xs font-medium" style={{ color: '#44536b' }}>시작</span>
                      <input
                        type="time"
                        step="300"
                        value={entry.start_time}
                        onChange={(e) => updateEntry(entry._id, 'start_time', e.target.value)}
                        className="h-11 w-full rounded-xl border px-3 text-base outline-none"
                        style={{ borderColor: '#dfe7f3', background: '#f5f8fd' }}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1 block text-xs font-medium" style={{ color: '#44536b' }}>종료</span>
                      <input
                        type="time"
                        step="300"
                        value={entry.end_time}
                        onChange={(e) => updateEntry(entry._id, 'end_time', e.target.value)}
                        className="h-11 w-full rounded-xl border px-3 text-base outline-none"
                        style={{ borderColor: '#dfe7f3', background: '#f5f8fd' }}
                      />
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {/* Image preview & re-analyze */}
          {etaImagePreview && (
            <div className="rounded-xl mb-4" style={{ background: '#f5f8fd', border: '1px solid #dfe7f3' }}>
              {/* Header */}
              <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-2.5" style={{ borderBottom: '1px solid #edf3fc' }}>
                <div className="flex min-w-0 items-start gap-2 sm:items-center">
                  <MaterialIcon icon="image" size={16} color="#2a6fe3" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium" style={{ color: '#0f1e3a' }}>업로드한 원본 이미지</p>
                    <p className="mt-0.5 text-xs leading-relaxed" style={{ color: '#44536b' }}>이미지가 맞는지 확인해주세요</p>
                  </div>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-stretch gap-2 sm:flex sm:items-center">
                  <button
                    onClick={handleReParseEtaImage}
                    disabled={etaParsing}
                    className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      background: etaParsing ? '#bcd8fe' : '#eaf2ff',
                      color: '#2a6fe3',
                      border: '1px solid #bcd8fe',
                      cursor: etaParsing ? 'not-allowed' : 'pointer',
                    }}
                    title="같은 이미지로 다시 읽기"
                  >
                    {etaParsing ? (
                      <>
                        <div className="w-3 h-3 border border-t-transparent rounded-full animate-spin" style={{ borderColor: '#bcd8fe', borderTopColor: 'transparent' }} />
                        분석 중
                      </>
                    ) : (
                      <>
                        <MaterialIcon icon="refresh" size={14} color="#2a6fe3" />
                        다시 분석
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setEtaImageExpanded((v) => !v)}
                    className="flex min-h-10 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[13px] transition-colors"
                    style={{ background: '#edf3fc', color: '#44536b', border: '1px solid #dfe7f3', cursor: 'pointer' }}
                    title={etaImageExpanded ? '이미지 접기' : '이미지 펼치기'}
                  >
                    <MaterialIcon icon={etaImageExpanded ? 'expand_less' : 'expand_more'} size={14} color="#44536b" />
                    {etaImageExpanded ? '접기' : '펼치기'}
                  </button>
                  <button
                    onClick={() => setPhase('eta-upload')}
                    className="min-h-10 rounded-lg px-2 text-[13px]"
                    style={{ color: '#44536b', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    원본 이미지
                  </button>
                </div>
              </div>
              {/* Image body */}
              <div className="p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={etaImagePreview}
                  alt="원본 시간표"
                  className="w-full rounded-lg object-contain cursor-pointer transition-colors"
                  style={{
                    maxHeight: etaImageExpanded ? 'none' : 180,
                    objectFit: 'contain',
                  }}
                  onClick={() => setEtaImageExpanded((v) => !v)}
                />
                {!etaImageExpanded && (
                  <p className="text-xs text-center mt-1.5" style={{ color: '#5f6f88' }}>
                    클릭하면 전체 이미지를 볼 수 있어요
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="sticky bottom-0 -mx-4 flex gap-3 bg-white/80 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-0">
            <button
              onClick={() => { setEtaEntries([]); setPhase('external-exam'); }}
              className="flex-1 py-3 rounded-xl text-[14px] font-medium border"
              style={{ color: '#44536b', borderColor: '#dfe7f3', background: '#fff' }}
              disabled={etaSaving}
            >
              건너뛰기
            </button>
            <button
              onClick={handleSaveAndContinue}
              disabled={etaSaving}
              className="flex-1 py-3 rounded-xl text-sm font-medium text-white transition-colors"
              style={{ background: etaSaving ? '#bcd8fe' : '#2a6fe3' }}
            >
              {etaSaving ? '저장하는 중' : `${etaEntries.filter(e => e.subject_name.trim()).length}개 확인, 다음`}
            </button>
          </div>
        </div>
      </div>

      {/* 기존 시간표 덮어쓰기 확인 */}
      {showEtaOverwriteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,30,58,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#fff', borderRadius: 20, padding: '28px 24px', maxWidth: 360, width: '90%', boxShadow: '0 12px 32px rgba(15,30,58,0.12)' }}>
            <p className="font-semibold text-base mb-2" style={{ color: '#0f1e3a' }}>기존 시간표를 교체할까요?</p>
            <p className="text-sm mb-2" style={{ color: '#44536b' }}>지금 등록된 수업을 모두 지우고 새 시간표로 바꿔요</p>
            <p className="text-xs rounded-lg px-3 py-2 mb-5" style={{ background: '#f5f8fd', color: '#0f1e3a' }}>
              직접 넣은 개인 일정과 시험은 그대로 남아요
            </p>
            <div className="flex gap-2">
              <button onClick={() => setShowEtaOverwriteConfirm(false)}
                style={{ flex: 1, height: 44, borderRadius: 11, border: '1px solid #dfe7f3', background: '#fff', color: '#44536b', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>
                취소
              </button>
              <button onClick={doSaveAndContinue}
                style={{ flex: 1, height: 44, borderRadius: 11, border: 'none', background: '#dc2626', color: '#fff', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>
                교체
              </button>
            </div>
          </div>
        </div>
      )}
      </>
    );
  }

  // 시간표 생성 화면
  if (phase === 'generating' || phase === 'done') {
    return (
      <div className="skema-onboarding-screen min-h-screen flex flex-col items-center justify-center overflow-y-auto p-4 sm:p-6">
        <div className="w-full max-w-sm text-center">
          <div className="relative inline-flex items-center justify-center w-20 h-20 rounded-full mb-6" style={{ background: '#2a6fe3' }}>
            {phase === 'done' ? (
              <MaterialIcon icon="check_circle" size={40} color="#fff" />
            ) : (
              <>
                <MaterialIcon icon="autorenew" size={32} color="#fff" />
                <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: '#bcd8fe', borderTopColor: 'transparent' }} />
              </>
            )}
          </div>

          <h2 className="text-xl font-semibold mb-2" style={{ color: '#0f1e3a' }}>
            {phase === 'done' ? '시간표를 만들었어요' : '시간표를 만드는 중'}
          </h2>

          {isCollegeStudent && etaEntries.length > 0 && phase !== 'done' && (
            <p className="text-xs mb-4" style={{ color: '#44536b' }}>에타 시간표를 반영하고 있습니다</p>
          )}

          {phase !== 'done' && (
            <div className="space-y-2 mt-4">
              {GENERATING_STEPS.map((step, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-xl text-left transition-colors"
                  style={{
                    background: i <= generatingStep ? '#eaf2ff' : '#f5f8fd',
                    opacity: i <= generatingStep ? 1 : 0.4,
                  }}
                >
                  <MaterialIcon
                    icon={i < generatingStep ? 'check_circle' : i === generatingStep ? 'pending' : 'radio_button_unchecked'}
                    size={16}
                    color={i <= generatingStep ? '#2a6fe3' : '#44536b'}
                    className="flex-shrink-0"
                  />
                  <span className="text-sm font-medium" style={{ color: i <= generatingStep ? '#0f1e3a' : '#44536b' }}>{step}</span>
                </div>
              ))}
            </div>
          )}

          {phase === 'done' && (
            <p className="text-sm mt-4" style={{ color: '#44536b' }}>잠시 뒤 시간표 화면으로 넘어가요</p>
          )}
        </div>
      </div>
    );
  }

  // 추가 시험 입력 화면
  if (phase === 'external-exam') {
    const fmtHours = (h: number) => h < 1 ? `${h * 60}분` : h % 1 === 0 ? `${h}시간` : `${Math.floor(h)}시간 ${(h % 1) * 60}분`;

    const registerExam = (draft: Omit<ExternalExam, '_id'> = examDraft) => {
      if (!draft.name.trim()) {
        setExamError('시험명을 입력해주세요');
        return false;
      }
      if (!draft.date) {
        setExamError('날짜를 선택해주세요');
        return false;
      }
      setExamError('');
      setExternalExams((prev) => [...prev, { name: draft.name.trim(), date: draft.date, _id: `ex-${Date.now()}` }]);
      setExamDraft({ name: '', date: '' });
      return true;
    };

    const updateExamDraft = (patch: Partial<Omit<ExternalExam, '_id'>>) => {
      const nextDraft = { ...examDraft, ...patch };
      setExamError('');
      setExamDraft(nextDraft);
    };

    const registerInitialExamIfReady = (draft: Omit<ExternalExam, '_id'> = examDraft) => {
      if (externalExams.length > 0) return;
      if (!draft.name.trim() || !draft.date) return;
      registerExam(draft);
    };

    return (
      <div className="skema-onboarding-screen min-h-screen flex flex-col items-center justify-center overflow-y-auto p-4 sm:p-6">
        <div className="w-full max-w-lg">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => setPhase(isCollegeStudent ? 'eta-review' : 'type-select')} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#fff', border: '1px solid #dfe7f3' }}>
              <MaterialIcon icon="arrow_back" size={18} color="#44536b" />
            </button>
            <div>
              <h2 className="font-semibold text-lg" style={{ color: '#0f1e3a' }}>추가 시험 입력</h2>
              <p className="text-xs" style={{ color: '#44536b' }}>{isCollegeStudent ? '3단계 / 5단계' : '1단계 / 3단계'}</p>
            </div>
          </div>
          <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#dfe7f3' }}>
            <div className="h-full rounded-full" style={{ width: isCollegeStudent ? '60%' : '33%', background: '#2a6fe3' }} />
          </div>

          <p className="text-sm font-medium mb-4" style={{ color: '#44536b' }}>
            별도로 준비 중인 시험이 있나요?{' '}
            <span style={{ color: '#5f6f88', fontWeight: 400 }}>없으면 건너뛰어도 됩니다</span>
          </p>

          <div className="grid grid-cols-1 gap-2 mb-3 sm:grid-cols-[minmax(0,1fr)_170px_auto]">
            <label className="block min-w-0">
              <span className="mb-1 block text-[12px]" style={{ color: '#44536b' }}>시험명</span>
              <input
                className="h-12 w-full px-3 text-base border rounded-xl outline-none"
                style={{ borderColor: '#dfe7f3', background: 'rgba(255,255,255,0.6)' }}
                placeholder="예: 중간고사, 토익"
                value={examDraft.name}
                onChange={(e) => updateExamDraft({ name: e.target.value })}
                onFocus={(e) => e.target.style.borderColor = '#2a6fe3'}
                onBlur={(e) => {
                  e.target.style.borderColor = '#dfe7f3';
                  registerInitialExamIfReady({ ...examDraft, name: e.target.value });
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' && externalExams.length > 0) registerExam(); }}
              />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-[12px]" style={{ color: examError && !examDraft.date ? '#dc2626' : '#44536b' }}>시험 날짜</span>
              <div
                className="relative flex h-12 w-full items-center gap-2 rounded-xl border px-3 cursor-pointer"
                style={{ borderColor: examError && !examDraft.date ? '#dc2626' : '#dfe7f3', background: 'rgba(255,255,255,0.72)' }}
                onClick={() => examDateRef.current?.showPicker?.() ?? examDateRef.current?.click()}
              >
                <MaterialIcon icon="event" size={17} color={examDraft.date ? '#2a6fe3' : '#5f6f88'} />
                <span className="min-w-0 flex-1 truncate text-base font-medium" style={{ color: examDraft.date ? '#0f1e3a' : '#5f6f88' }}>
                  {examDraft.date || '시험 날짜 선택'}
                </span>
                <MaterialIcon icon="expand_more" size={18} color="#5f6f88" />
                <input
                  ref={examDateRef}
                  type="date"
                  min={todayStr}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  style={{ zIndex: 1 }}
                  value={examDraft.date}
                  onChange={(e) => updateExamDraft({ date: e.target.value })}
                  onBlur={(e) => registerInitialExamIfReady({ ...examDraft, date: e.target.value })}
                  aria-label="시험 날짜 선택"
                />
              </div>
            </label>
            {externalExams.length > 0 && (
              <button onClick={() => registerExam()}
                className="h-12 self-end rounded-xl px-4 text-sm font-medium text-white"
                style={{ background: '#2a6fe3', cursor: 'pointer' }}>
                시험 추가
              </button>
            )}
          </div>
          {examError && (
            <p className="mt-1 text-xs font-medium" style={{ color: '#dc2626' }}>{examError}</p>
          )}

          {externalExams.length > 0 && (
            <div className="space-y-2 mb-4">
              {externalExams.map((ex) => (
                <div key={ex._id} className="flex items-center justify-between px-4 py-2.5 rounded-full" style={{ background: '#f5f8fd', border: '1px solid #dfe7f3' }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span style={{ color: '#2a6fe3', fontSize: 10, flexShrink: 0 }}>○</span>
                    <span className="text-sm font-medium truncate" style={{ color: '#0f1e3a' }}>{ex.name}</span>
                    <span className="text-sm flex-shrink-0" style={{ color: '#0f1e3a' }}>{ex.date}</span>
                  </div>
                  <button onClick={() => setExternalExams((prev) => prev.filter((e) => e._id !== ex._id))} className="flex-shrink-0 ml-2">
                    <MaterialIcon icon="close" size={14} color="#0f1e3a" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {externalExams.length > 0 && (
            <div className="rounded-xl p-4 mb-5" style={{ background: '#eaf2ff', border: '1px solid #bcd8fe' }}>
              <p className="text-xs font-medium mb-3" style={{ color: '#1f63d6' }}>공부 블록 자동 배치</p>
              <div className="space-y-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-xs flex-shrink-0" style={{ color: '#44536b', width: 100 }}>시험 몇 일 전부터</span>
                  <select value={studyStartDays} onChange={(e) => setStudyStartDays(Number(e.target.value))}
                    className="flex-1 px-2 py-1.5 text-xs rounded-lg border outline-none"
                    style={{ borderColor: '#dfe7f3', background: '#fff' }}>
                    <option value={0}>당일부터</option>
                    {Array.from({ length: 60 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>{d}일 전부터</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs flex-shrink-0" style={{ color: '#44536b', width: 100 }}>일주일에 며칠</span>
                  <div className="flex gap-1">
                    {([1,2,3,4,5,6,7] as const).map((d) => (
                      <button key={d} type="button" onClick={() => setStudyDaysPerWeek(d)}
                        className="w-7 h-7 text-[13px] rounded-lg border transition-colors"
                        style={{ borderColor: studyDaysPerWeek === d ? '#2a6fe3' : '#dfe7f3', background: studyDaysPerWeek === d ? '#eaf2ff' : '#fff', color: studyDaysPerWeek === d ? '#2a6fe3' : '#44536b' }}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs flex-shrink-0" style={{ color: '#44536b', width: 100 }}>하루 몇 시간</span>
                  <select value={studyHoursPerSession} onChange={(e) => setStudyHoursPerSession(Number(e.target.value))}
                    className="flex-1 px-2 py-1.5 text-xs rounded-lg border outline-none"
                    style={{ borderColor: '#dfe7f3', background: '#fff' }}>
                    {Array.from({ length: 18 }, (_, i) => (i + 1) * 0.5).map((h) => (
                      <option key={h} value={h}>{fmtHours(h)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setPhase('personal-schedule')} className="flex-1 py-3 rounded-xl text-[14px] font-medium border" style={{ color: '#44536b', borderColor: '#dfe7f3', background: '#fff' }}>
              건너뛰기
            </button>
            <button onClick={() => setPhase('personal-schedule')} className="flex-1 py-3 rounded-xl text-sm font-medium text-white" style={{ background: '#2a6fe3' }}>
              {externalExams.length > 0 ? `${externalExams.length}개 등록 →` : '다음 →'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 개인 일정 입력 화면
  if (phase === 'personal-schedule') {
    const isOvernight = !!scheduleDraft.start_time && !!scheduleDraft.end_time &&
      scheduleDraft.end_time <= scheduleDraft.start_time;
    const canAddSched = scheduleDraft.title.trim() && scheduleDraft.start_time && scheduleDraft.end_time &&
      scheduleDraft.start_time !== scheduleDraft.end_time &&
      (scheduleDraft.is_recurring ? scheduleDraft.days.length > 0 : !!scheduleDraft.date);

    const toggleDraftDay = (idx: number) => {
      const day = indexToRecurringDay(idx);
      setScheduleDraft((prev) => {
        const exists = prev.days.includes(day);
        const days = exists ? prev.days.filter((d) => d !== day) : [...prev.days, day];
        return { ...prev, days, recurring_day: days[0] ?? day };
      });
    };

    const addSched = () => {
      if (!canAddSched) return;
      const draft = { ...scheduleDraft };
      if (!draft.is_recurring && draft.date) {
        const [y, m, d] = draft.date.split('-').map(Number);
        const jsDay = new Date(y, m - 1, d).getDay();
        draft.recurring_day = indexToRecurringDay(jsDay === 0 ? 6 : jsDay - 1);
      } else {
        draft.recurring_day = draft.days[0] ?? 'MON';
      }
      setPersonalSchedules((prev) => [...prev, { ...draft, _id: `ps-${Date.now()}` }]);
      setScheduleDraft({ title: '', recurring_day: 'MON', days: ['MON'], start_time: '09:00', end_time: '10:00', is_recurring: true, date: '' });
    };

    return (
      <div className="skema-onboarding-screen min-h-screen flex flex-col items-center justify-center overflow-y-auto p-4 sm:p-6">
        <div className="w-full max-w-lg">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => setPhase('external-exam')} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#fff', border: '1px solid #dfe7f3' }}>
              <MaterialIcon icon="arrow_back" size={18} color="#44536b" />
            </button>
            <div>
              <h2 className="font-semibold text-lg" style={{ color: '#0f1e3a' }}>개인 일정 입력</h2>
              <p className="text-xs" style={{ color: '#44536b' }}>{isCollegeStudent ? '4단계 / 5단계' : '2단계 / 3단계'}</p>
            </div>
          </div>
          <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#dfe7f3' }}>
            <div className="h-full rounded-full" style={{ width: isCollegeStudent ? '80%' : '66%', background: '#2a6fe3' }} />
          </div>

          <p className="text-sm font-medium mb-4" style={{ color: '#44536b' }}>
            학업 외에 중요한 일정이 있나요?{' '}
            <span style={{ color: '#5f6f88', fontWeight: 400 }}>없으면 건너뛰어도 됩니다</span>
          </p>

          <div className="space-y-3 mb-4">
            <input
              className="w-full px-3 py-2.5 text-sm border rounded-xl outline-none"
              style={{ borderColor: '#dfe7f3' }}
              placeholder="일정 제목 (예: 동아리, 운동, 알바)"
              value={scheduleDraft.title}
              onChange={(e) => setScheduleDraft((d) => ({ ...d, title: e.target.value }))}
              onFocus={(e) => e.target.style.borderColor = '#2a6fe3'}
              onBlur={(e) => e.target.style.borderColor = '#dfe7f3'}
            />

            <div className="flex gap-2">
              <button type="button"
                onClick={() => setScheduleDraft((d) => ({ ...d, is_recurring: true, date: '', days: d.days.length ? d.days : [d.recurring_day] }))}
                className="flex-1 py-2 text-xs rounded-xl font-semibold border transition-colors"
                style={{ borderColor: scheduleDraft.is_recurring ? '#2a6fe3' : '#dfe7f3', background: scheduleDraft.is_recurring ? '#eaf2ff' : '#fff', color: scheduleDraft.is_recurring ? '#2a6fe3' : '#44536b' }}>
                매주 반복
              </button>
              <button type="button"
                onClick={() => setScheduleDraft((d) => ({ ...d, is_recurring: false }))}
                className="flex-1 py-2 text-xs rounded-xl font-semibold border transition-colors"
                style={{ borderColor: !scheduleDraft.is_recurring ? '#2a6fe3' : '#dfe7f3', background: !scheduleDraft.is_recurring ? '#eaf2ff' : '#fff', color: !scheduleDraft.is_recurring ? '#2a6fe3' : '#44536b' }}>
                특정 날짜
              </button>
            </div>

            {scheduleDraft.is_recurring ? (
              <div className="flex gap-1.5">
                {DAY_LABELS.map((d, i) => (
                  <button key={i} type="button"
                    onClick={() => toggleDraftDay(i)}
                    className="flex-1 py-2 text-xs font-medium rounded-lg border transition-colors"
                    style={{
                      borderColor: scheduleDraft.days.includes(indexToRecurringDay(i)) ? '#2a6fe3' : '#dfe7f3',
                      background: scheduleDraft.days.includes(indexToRecurringDay(i)) ? '#eaf2ff' : '#fff',
                      color: scheduleDraft.days.includes(indexToRecurringDay(i)) ? '#2a6fe3' : '#5f6f88',
                    }}>
                    {d}
                  </button>
                ))}
              </div>
            ) : (
              <input type="date"
                min={todayStr}
                className="w-full px-3 py-2.5 text-sm border rounded-xl outline-none"
                style={{ borderColor: '#dfe7f3' }}
                value={scheduleDraft.date ?? ''}
                onChange={(e) => setScheduleDraft((d) => ({ ...d, date: e.target.value }))}
                onFocus={(e) => e.target.style.borderColor = '#2a6fe3'}
                onBlur={(e) => e.target.style.borderColor = '#dfe7f3'}
              />
            )}

            <div className="flex gap-2">
              <label className="flex-1">
                <span className="block text-[11px] font-semibold mb-1" style={{ color: '#44536b' }}>시작 시간</span>
                <input type="time" step="300" className="w-full px-3 py-2.5 text-sm border rounded-xl outline-none"
                  style={{ borderColor: '#dfe7f3' }}
                  value={scheduleDraft.start_time}
                  onChange={(e) => setScheduleDraft((d) => ({ ...d, start_time: e.target.value }))}
                  onFocus={(e) => e.target.style.borderColor = '#2a6fe3'}
                  onBlur={(e) => e.target.style.borderColor = '#dfe7f3'} />
              </label>
              <label className="flex-1">
                <span className="block text-[11px] font-semibold mb-1" style={{ color: '#44536b' }}>
                  종료 시간{isOvernight && <span className="ml-1 text-[11px] px-1 py-0.5 rounded" style={{ background: '#edf3fc', color: '#44536b' }}>다음날</span>}
                </span>
                <input type="time" step="300" className="w-full px-3 py-2.5 text-sm border rounded-xl outline-none"
                  style={{ borderColor: scheduleDraft.start_time === scheduleDraft.end_time ? '#dc2626' : '#dfe7f3' }}
                  value={scheduleDraft.end_time}
                  onChange={(e) => setScheduleDraft((d) => ({ ...d, end_time: e.target.value }))}
                  onFocus={(e) => e.target.style.borderColor = '#2a6fe3'}
                  onBlur={(e) => e.target.style.borderColor = scheduleDraft.start_time === scheduleDraft.end_time ? '#dc2626' : '#dfe7f3'} />
              </label>
            </div>

            <button onClick={addSched} disabled={!canAddSched}
              className="w-full py-2.5 rounded-xl text-sm font-medium text-white"
              style={{ background: canAddSched ? '#2a6fe3' : '#dfe7f3', cursor: canAddSched ? 'pointer' : 'not-allowed' }}>
              + 일정 추가
            </button>
          </div>

          {personalSchedules.length > 0 && (
            <div className="space-y-2 mb-5">
              {personalSchedules.map((s) => (
                <div key={s._id} className="flex items-center justify-between px-4 py-2.5 rounded-full" style={{ background: '#f5f8fd', border: '1px solid #dfe7f3' }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span style={{ color: '#2a6fe3', fontSize: 10, flexShrink: 0 }}>○</span>
                    <span className="text-sm truncate" style={{ color: '#0f1e3a' }}>
                      {s.title && <span className="font-semibold mr-1">{s.title}</span>}
                      {s.is_recurring
                        ? `${s.days.map((day) => DAY_LABELS[recurringDayToIndex(day)]).join('')}요일 ${s.start_time}~${s.end_time}`
                        : `${s.date} ${s.start_time}~${s.end_time}`}
                    </span>
                  </div>
                  <button onClick={() => setPersonalSchedules((prev) => prev.filter((x) => x._id !== s._id))} className="flex-shrink-0 ml-2">
                    <MaterialIcon icon="close" size={14} color="#0f1e3a" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={handleCollegeStartChat} className="flex-1 py-3 rounded-xl text-[14px] font-medium border" style={{ color: '#44536b', borderColor: '#dfe7f3', background: '#fff' }}>
              건너뛰기
            </button>
            <button onClick={handleCollegeStartChat} className="flex-1 py-3 rounded-xl text-sm font-medium text-white" style={{ background: '#2a6fe3' }}>
              {personalSchedules.length > 0 ? `${personalSchedules.length}개 등록 →` : '다음 →'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 사용자 유형 선택 화면
  if (phase === 'type-select') {
    return (
      <div className="skema-onboarding-screen min-h-screen flex flex-col items-center justify-center overflow-y-auto p-4 sm:p-6">
        <div className="w-full max-w-lg">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setPhase('college-check')}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
              style={{ background: '#fff', border: '1px solid #dfe7f3' }}
            >
              <MaterialIcon icon="arrow_back" size={18} color="#44536b" />
            </button>
            <div>
              <h1 className="font-semibold text-lg" style={{ color: '#0f1e3a' }}>나에게 맞는 유형 선택</h1>
              <p className="text-xs" style={{ color: '#44536b' }}>
                {isCollegeStudent ? '2단계 / 2단계' : '1단계'}
              </p>
            </div>
          </div>

          {/* Progress */}
          <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#dfe7f3' }}>
            <div className="h-full rounded-full" style={{ width: isCollegeStudent ? '100%' : '50%', background: '#2a6fe3' }} />
          </div>

          {isCollegeStudent && etaEntries.length > 0 && (
            <div className="rounded-xl p-3 mb-5 flex items-center gap-2" style={{ background: '#eaf2ff', border: '1px solid #bcd8fe' }}>
              <MaterialIcon icon="check_circle" size={16} color="#1f63d6" />
              <p className="text-[14px] font-medium" style={{ color: '#1f63d6' }}>에타 시간표 {etaEntries.filter(e=>e.subject_name.trim()).length}개 등록 완료</p>
            </div>
          )}

          <p className="text-sm mb-5" style={{ color: '#44536b' }}>맞춤 시간표를 만들어드릴게요</p>

          {/* Type cards */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            {USER_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => handleTypeSelect(type.id)}
                className="text-left p-5 rounded-2xl border transition-colors active:scale-[0.98]"
                style={{ background: '#fff', borderColor: '#dfe7f3' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2a6fe3'; e.currentTarget.style.background = type.color + '30'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#dfe7f3'; e.currentTarget.style.background = '#fff'; }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: type.color }}>
                  <MaterialIcon icon={type.icon} size={18} color={type.iconColor} />
                </div>
                <p className="font-medium text-sm mb-1" style={{ color: '#0f1e3a' }}>{type.label}</p>
                <p className="text-xs leading-relaxed" style={{ color: '#44536b' }}>{type.desc}</p>
              </button>
            ))}
          </div>

          <button
            onClick={handleSkip}
            className="w-full py-3 text-sm font-medium rounded-xl border transition-colors"
            style={{ color: '#44536b', borderColor: '#dfe7f3' }}
          >
            건너뛰기 (나중에 설정에서 변경 가능)
          </button>
        </div>
      </div>
    );
  }

  // 수면 시간 입력 화면
  if (phase === 'sleep') {
    const backTarget = 'personal-schedule';
    const handleSleepSubmit = () => {
      finishOnboarding({}, { sleep_start: sleepStart, sleep_end: sleepEnd });
    };

    return (
      <div className="skema-onboarding-screen min-h-screen flex flex-col items-center justify-center overflow-y-auto p-4 sm:p-6">
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setPhase(backTarget)}
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: '#fff', border: '1px solid #dfe7f3' }}
            >
              <MaterialIcon icon="arrow_back" size={18} color="#44536b" />
            </button>
            <div>
              <h2 className="font-semibold text-lg" style={{ color: '#0f1e3a' }}>수면 시간 설정</h2>
              <p className="text-xs" style={{ color: '#44536b' }}>{isCollegeStudent ? '5단계 / 5단계' : '3단계 / 3단계'}</p>
            </div>
          </div>

          {/* Progress */}
          <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#dfe7f3' }}>
            <div className="h-full rounded-full" style={{ width: '100%', background: '#2a6fe3' }} />
          </div>

          <p className="text-sm font-medium mb-4" style={{ color: '#44536b' }}>평소 수면 패턴을 알려주세요</p>

          <div className="space-y-3 mb-4">
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="block text-[11px] font-semibold mb-1" style={{ color: '#44536b' }}>취침 시간</span>
                <input
                  type="time"
                  step="300"
                  value={sleepStart}
                  onChange={(e) => setSleepStart(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm rounded-xl border outline-none"
                  style={{ borderColor: '#dfe7f3', background: '#fff', color: '#0f1e3a' }}
                />
              </label>
              <label className="flex-1">
                <span className="block text-[11px] font-semibold mb-1" style={{ color: '#44536b' }}>기상 시간</span>
                <input
                  type="time"
                  step="300"
                  value={sleepEnd}
                  onChange={(e) => setSleepEnd(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm rounded-xl border outline-none"
                  style={{ borderColor: '#dfe7f3', background: '#fff', color: '#0f1e3a' }}
                />
              </label>
            </div>

            <div className="px-4 py-2.5 rounded-xl flex items-center gap-2" style={{ background: '#f5f8fd', border: '1px solid #dfe7f3' }}>
              <MaterialIcon icon="check_circle" size={15} color="#16a34a" />
              <span className="text-sm" style={{ color: '#15803d' }}>
                {`${sleepStart.split(':')[0]}시부터 ${sleepEnd.split(':')[0]}시 취침`}
              </span>
            </div>
          </div>

          {/* Quick presets */}
          <div className="flex flex-wrap gap-2 mb-6">
            {[
              { label: '밤 11시 · 아침 7시', start: '23:00', end: '07:00' },
              { label: '자정 · 아침 8시', start: '00:00', end: '08:00' },
              { label: '새벽 1시 · 아침 8시', start: '01:00', end: '08:00' },
            ].map((p) => (
              <button
                key={p.label}
                onClick={() => { setSleepStart(p.start); setSleepEnd(p.end); }}
                className="px-3 py-1.5 text-xs rounded-full font-medium border transition-colors"
                style={{
                  borderColor: sleepStart === p.start && sleepEnd === p.end ? '#2a6fe3' : '#bcd8fe',
                  color: sleepStart === p.start && sleepEnd === p.end ? '#2a6fe3' : '#44536b',
                  background: sleepStart === p.start && sleepEnd === p.end ? '#eaf2ff' : '#eaf2ff',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSkip}
              className="flex-1 py-3 rounded-xl text-[14px] font-medium border"
              style={{ color: '#44536b', borderColor: '#dfe7f3', background: '#fff' }}
            >
              건너뛰기
            </button>
            <button
              onClick={handleSleepSubmit}
              className="flex-1 py-3 rounded-xl text-sm font-medium text-white"
              style={{ background: '#2a6fe3' }}
            >
              완료 →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 채팅 화면
  const currentStep = activeSteps[stepIdx];
  const progress = (stepIdx / activeSteps.length) * 100;

  return (
    <div className="skema-onboarding-screen min-h-screen flex flex-col items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-lg flex flex-col" style={{ height: '85vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setMessages([]);
                setStepIdx(0);
                setAnswers({});
                setPhase(isCollegeStudent ? 'personal-schedule' : 'college-check');
              }}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[#edf3fc] transition-colors"
            >
              <MaterialIcon icon="arrow_back" size={18} color="#44536b" />
            </button>
            <div>
              <p className="font-medium text-sm" style={{ color: '#0f1e3a' }}>
                {isCollegeStudent ? '학습 목표 설정' : '기본 정보 입력'}
              </p>
              <p className="text-xs" style={{ color: '#44536b' }}>{stepIdx + 1} / {activeSteps.length} 단계</p>
            </div>
          </div>
          <button
            onClick={handleSkip}
            className="text-[13px] px-3 py-1.5 rounded-lg border transition-colors"
            style={{ color: '#44536b', borderColor: '#dfe7f3' }}
          >
            건너뛰기
          </button>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 rounded-full mb-4" style={{ background: '#dfe7f3' }}>
          <div
            className="h-full rounded-full transition-colors duration-500"
            style={{ width: `${progress}%`, background: '#2a6fe3' }}
          />
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 mb-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'ai' && (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium mr-2 mt-1 flex-shrink-0 text-white" style={{ background: '#2a6fe3' }}>
                  S
                </div>
              )}
              <div
                className="max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed"
                style={
                  msg.role === 'user'
                    ? { background: '#2a6fe3', color: '#fff', borderTopRightRadius: 4 }
                    : { background: '#fff', color: '#0f1e3a', borderTopLeftRadius: 4, border: '1px solid #dfe7f3' }
                }
              >
                {msg.text}
              </div>
            </div>
          ))}
          {isProcessing && (
            <div className="flex justify-start">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium mr-2 mt-1 flex-shrink-0 text-white" style={{ background: '#2a6fe3' }}>S</div>
              <div className="rounded-2xl rounded-tl-sm px-4 py-3" style={{ background: '#fff', border: '1px solid #dfe7f3' }}>
                <div className="flex gap-1">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="w-2 h-2 rounded-full bg-[#cfdbec] animate-pulse" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Quick replies */}
        {!isProcessing && currentStep?.quick && (
          <div className="flex flex-wrap gap-2 mb-3">
            {currentStep.quick.map((q) => (
              <button
                key={q}
                onClick={() => {
                  const exampleText = (currentStep as { examples?: Record<string, string> }).examples?.[q];
                  if (exampleText) {
                    setMessages((prev) => [
                      ...prev,
                      { role: 'user', text: q },
                      { role: 'ai', text: exampleText },
                    ]);
                  } else {
                    handleSend(q);
                  }
                }}
                className="px-3 py-1.5 text-xs rounded-full font-medium transition-colors border hover:border-[#bcd8fe] hover:text-[#1f63d6]"
                style={{ borderColor: '#bcd8fe', color: '#2a6fe3', background: '#eaf2ff' }}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="flex gap-2">
          <input
            className="flex-1 px-4 py-3 text-sm border rounded-xl outline-none transition-colors"
            style={{ borderColor: '#dfe7f3', background: '#fff' }}
            onFocus={(e) => e.target.style.borderColor = '#2a6fe3'}
            onBlur={(e) => e.target.style.borderColor = '#dfe7f3'}
            placeholder={currentStep?.hint || '입력'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={isProcessing}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isProcessing}
            className="px-5 py-3 rounded-xl text-sm font-medium text-white transition-colors"
            style={{ background: (!input.trim() || isProcessing) ? '#bcd8fe' : '#2a6fe3' }}
          >
            <MaterialIcon icon="send" size={22} color="#fff" />
          </button>
        </div>
      </div>
    </div>
  );
}
