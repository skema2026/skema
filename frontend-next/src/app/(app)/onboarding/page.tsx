'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { normalizeTimeString } from '@/lib/utils';
import { useUpdateProfile } from '@/hooks/useProfile';

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
}

interface ExternalExam {
  _id: string;
  name: string;
  date: string;                        // YYYY-MM-DD
}

interface PersonalSchedule {
  _id: string;
  title: string;
  day_of_week: number;                 // 0=월~6=일
  start_time: string;                  // HH:MM
  end_time: string;                    // HH:MM
  is_recurring: boolean;
  date?: string;                       // YYYY-MM-DD (is_recurring=false 시 사용)
}

const DAY_LABELS = ['월','화','수','목','금','토','일'] as const;
const CLASS_COLORS = ['#1a4db2', '#065f46', '#92400e', '#7c3aed', '#be185d', '#0f766e', '#b45309'] as const;

const USER_TYPES = [
  { id: 'exam_prep', label: '수험 준비', icon: 'menu_book', desc: '수능/자격/입시 등', color: '#c3d0ff', iconColor: '#1a4db2' },
  { id: 'civil_service', label: '공무원', icon: 'account_balance', desc: '공시 등 시험 준비', color: '#ffdcc6', iconColor: '#844000' },
  { id: 'student', label: '대학생', icon: 'school', desc: '대학/대학원 학생', color: '#d1fae5', iconColor: '#065f46' },
  { id: 'worker', label: '직장인', icon: 'work', desc: '업무/자기계발', color: '#fef3c7', iconColor: '#92400e' },
];
// 대학생은 타입 선택 없이 항상 student

const CHAT_STEPS_COLLEGE = [
  {
    key: 'goal_tasks',
    question: `어떤 목표와 과목들로 공부하시나요?

예시:
"수능준비, 대학입시, 영어"
"수학, 영어과목"`,
    hint: '목표 과목/내용을 입력해주세요',
    quick: ['예시 보기']
  },
  {
    key: 'sleep',
    question: `수면 시간대를 알려주세요
수면 시간은 최소 6시간 이상 입력해 주세요.`,
    hint: '예) 밤 11시 취침, 아침 7시 기상',
    quick: ['23시 취침, 7시 기상', '24시 취침, 8시 기상', '1시 취침, 8시 기상'],
  },
]
// CHAT_STEPS when NOT a college student (no eta, so include fixed schedule question)
const CHAT_STEPS_NON_COLLEGE = [
  {
    key: 'goal_tasks',
    question: `어떤 목표와 과목들로 공부하시나요?

예시:
"수능준비, 대학입시, 영어"
"정보처리기사, 자격증"
"수학, 영어과목"`,
    hint: '목표 과목/내용을 입력해주세요',
    quick: ['예시 보기'],
  },
  {
    key: 'schedule',
    question: `정기적인 업무나 학원 일정이 있나요?

예시:
"화수목 9시~11시 어학원 수업"
"화목요 14시~16시 영어"

없으면 "없음"을 선택해 주세요`,
    hint: '정기 일정을 입력해주세요',
    quick: ['없음'],
  },
  {
    key: 'exam',
    question: `다가오는 시험 일정이 있나요?

예시:
"4월 15일 중간고사"
"5월 20일 발표 시험"

없으면 "없음"을 선택해 주세요`,
    hint: '시험 일정을 입력해주세요',
    quick: ['없음'],
  },
  {
    key: 'sleep',
    question: `수면 시간대를 알려주세요
수면 시간은 최소 6시간 이상 입력해 주세요.`,
    hint: '예) 밤 11시 취침, 아침 7시 기상',
    quick: ['23시 취침, 7시 기상', '24시 취침, 8시 기상', '1시 취침, 8시 기상'],
  },
]

const MOTIVATIONS: Record<string, string> = {
  exam_prep: '매일 꾸준히 목표를 향해 나아갑니다 🌟',
  civil_service: '꾸준함이 실력입니다. 함께 해봐요 💪',
  student: '청춘의 열정으로 화이팅입니다 📚',
  worker: '성장하는 분이에요, 화이팅 🙌',
};

const GENERATING_STEPS = [
  '입력하신 정보를 분석하고 있습니다...',
  '여유로운 시간대를 파악하고 있습니다...',
  '시험 일정에 맞춰 계획을 세우고 있습니다...',
  'SKEMA 완성됩니다! 🎉',
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

export default function OnboardingPage() {
  const router = useRouter();
  const updateProfile = useUpdateProfile();

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
  // 공부 블록 자동 생성 설정
  const [studyStartDays, setStudyStartDays] = useState<number>(14);
  const [studyDaysPerWeek, setStudyDaysPerWeek] = useState<number>(3);
  const [studyHoursPerSession, setStudyHoursPerSession] = useState<number>(2);
  // personal-schedule 입력 폼 임시 상태
  const [scheduleDraft, setScheduleDraft] = useState<Omit<PersonalSchedule, '_id'>>({ title: '', day_of_week: 0, start_time: '', end_time: '', is_recurring: true, date: '' });
  const [sleepStart, setSleepStart] = useState('23:00');
  const [sleepEnd, setSleepEnd] = useState('07:00');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [generatingStep, setGeneratingStep] = useState(0);
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
      const res = await api.post('/eta/parse-image-v2', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
            const v2 = Array.isArray(res.data) ? res.data as Array<{ title: string; day: string; startTime: string; endTime: string; location?: string; bbox?: [number,number,number,number]; }> : [];
      const dayMap: Record<string, number> = { MONDAY:0, TUESDAY:1, WEDNESDAY:2, THURSDAY:3, FRIDAY:4, SATURDAY:5, SUNDAY:6 };
      const dayKo = ['월요일','화요일','수요일','목요일','금요일','토요일','일요일'];
      const entries: EtaEntry[] = v2.map((e, i) => ({
        _id: `eta-${Date.now()}-${i}`,
        subject_name: (e.title && e.title !== '수업') ? e.title : '',
        day_of_week: dayMap[e.day] ?? 0,
        start_time: normalizeTimeString(e.startTime) || e.startTime,
        end_time: normalizeTimeString(e.endTime) || e.endTime,
        location: e.location ?? '',
        raw_text: `${dayKo[dayMap[e.day] ?? 0]} ${e.startTime}~${e.endTime}`,
        source: 'eta_image_v2',
      }));
      setEtaEntries(entries);
      if (entries.length === 0) {
        toast('\uc774\ubbf8\uc9c0\uc5d0\uc11c \uc2dc\uac04\ud45c\ub97c \uc77d\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4. \uc9c1\uc811 \ucd94\uac00\ud574 \uc8fc\uc138\uc694.');
      }
    } catch {
            toast.error('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.')
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
    toast.success('\ub2e4\uc2dc \ubd84\uc11d\uc774 \uc644\ub8cc\ub418\uc5c8\uc2b5\ub2c8\ub2e4.');
  };

  const parseTime = (text: string) => {
    const nums = text.match(/\d+/g)?.map(Number) || [];
    const toHHMM = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;
    return {
      sleep_start: nums[0] !== undefined ? toHHMM(nums[0]) : '23:00',
      sleep_end: nums[1] !== undefined ? toHHMM(nums[1]) : '07:00',
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
      // 대학생은 type-select 없으므로 'student' 기본값
      const effectiveType = selectedType || 'student';
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
              day_of_week: sched.day_of_week,
              start_time: sched.start_time,
              end_time: sched.end_time,
              schedule_type: 'activity',
              schedule_source: 'user_created',
              ...(sched.is_recurring ? {} : { date: sched.date || undefined }),
              color: '#A855F7',
            });
          } catch { /* 개별 일정 등록 실패 시 무시 */ }
        }

        // 시험별 공부 블록 자동 생성
        const toDateStr = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const durationMin = Math.round(studyHoursPerSession * 60);
        const endMin = 19 * 60 + durationMin;
        const end_time = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

        for (let ei = 0; ei < savedExamIds.length; ei++) {
          const exam = externalExams[ei];
          const examId = savedExamIds[ei];
          if (!exam || !examId) continue;

          const examDateObj = new Date(exam.date + 'T00:00:00');
          // studyStartDays=0 → 오늘부터 시험 전날까지
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const actualStartDays = studyStartDays === 0
            ? Math.max(1, Math.ceil((examDateObj.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))
            : studyStartDays;
          const candidateDays: string[] = [];
          for (let d = actualStartDays; d >= 1; d--) {
            const day = new Date(examDateObj);
            day.setDate(examDateObj.getDate() - d);
            candidateDays.push(toDateStr(day));
          }

          const chosenDays: string[] = [];
          if (studyDaysPerWeek >= 7) {
            chosenDays.push(...candidateDays);
          } else {
            for (let j = 0; j < candidateDays.length; j += 7) {
              const week = candidateDays.slice(j, j + 7);
              chosenDays.push(...week.slice(0, Math.min(studyDaysPerWeek, week.length)));
            }
          }

          for (const dateStr of chosenDays) {
            const jsDay = new Date(dateStr + 'T00:00:00').getDay();
            const dow = jsDay === 0 ? 6 : jsDay - 1;
            try {
              await api.post('/schedules', {
                title: `📖 ${exam.name} 준비`,
                day_of_week: dow,
                date: dateStr,
                start_time: '19:00',
                end_time,
                schedule_type: 'study',
                schedule_source: 'user_created',
                linked_exam_id: examId,
                color: '#059669',
              });
            } catch { /* ignore */ }
          }
        }
      } else {
        // 비대학생 온보딩: chat 답변에서 시험/일정 파싱 후 등록
        const scheduleText = finalAnswers.schedule;
        if (scheduleText && scheduleText !== '없음') {
          try {
            await api.post('/ai/chat', {
              message: `\ub2e4\uc74c \uc218\uc5c5/\uc815\uae30 \uc77c\uc815\uc744 \ub4f1\ub85d\ud574\uc918: ${scheduleText}`,
              messages: [],
            });
          } catch { /* 실패해도 온보딩 무시 */ }
        }

        const examText = finalAnswers.exam;
        const parsedExams = examText && examText !== '없음' ? _parseExamText(examText) : [];
        for (const exam of parsedExams) {
          try {
            const { data } = await api.post<{ id: number }>('/exam-schedules', exam);
            savedExamIds.push(data.id);
          } catch { /* 개별 시험 등록 실패 시 무시 */ }
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
    setPhase('sleep');
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

    const newAnswers = { ...answers, [activeSteps[stepIdx].key]: userText };
    setAnswers(newAnswers);
    const nextIdx = stepIdx + 1;

    if (nextIdx < activeSteps.length) {
      setStepIdx(nextIdx);
      setIsProcessing(true);
      setTimeout(() => {
        setMessages((prev) => [...prev, { role: 'ai', text: activeSteps[nextIdx].question }]);
        setIsProcessing(false);
      }, 500);
    } else {
      setIsProcessing(true);
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          { role: 'ai', text: '\uc54c\uac4c\uc2b5\ub2c8\ub2e4! AI \ub9de\ucda4 \uc2dc\uac04\ud45c\ub97c \uc0dd\uc131\ud558\uace0 \uc788\uc2b5\ub2c8\ub2e4 \ud83d\uddd3\ufe0f' },
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
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: 'linear-gradient(135deg, #f7fafd 0%, #eef1ff 100%)' }}>
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-6" style={{ background: '#1a4db2' }}>
            <span className="ms text-white text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>schedule</span>
          </div>
          <h1 className="text-2xl font-extrabold mb-2" style={{ color: '#181c1e' }}>SKEMA에 오신 것을 환영합니다!</h1>
          <p className="text-sm mb-10" style={{ color: '#434653' }}>먼저 몇 가지 질문에 답해주세요.</p>

          <div className="rounded-2xl p-6 mb-8 text-left" style={{ background: '#fff', boxShadow: '0 4px 24px rgba(26,77,178,0.08)', border: '1px solid #ebeef1' }}>
            <p className="text-lg font-bold mb-1" style={{ color: '#181c1e' }}>현재 대학생이신가요?</p>
            <p className="text-sm" style={{ color: '#747684' }}>에타 기반으로 시간표를 더 정확하게 만들어드려요.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => {
                setIsCollegeStudent(true);
                setSelectedType('student');
                setPhase('eta-upload');
              }}
              className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: '#fff', borderColor: '#ebeef1', boxShadow: '0 2px 12px rgba(26,77,178,0.06)' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#1a4db2'; e.currentTarget.style.background = '#eef1ff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#ebeef1'; e.currentTarget.style.background = '#fff'; }}
            >
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#d1fae5' }}>
                <span className="ms text-3xl" style={{ color: '#065f46', fontVariationSettings: "'FILL' 1" }}>school</span>
              </div>
              <div>
                <p className="font-bold text-sm mb-0.5" style={{ color: '#181c1e' }}>네, 대학생이에요</p>
                <p className="text-xs" style={{ color: '#747684' }}>에타 시간표 자동 생성</p>
              </div>
            </button>

            <button
              onClick={() => {
                setIsCollegeStudent(false);
                setPhase('type-select');
              }}
              className="flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: '#fff', borderColor: '#ebeef1', boxShadow: '0 2px 12px rgba(26,77,178,0.06)' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#747684'; e.currentTarget.style.background = '#f7fafd'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#ebeef1'; e.currentTarget.style.background = '#fff'; }}
            >
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#fef3c7' }}>
                <span className="ms text-3xl" style={{ color: '#92400e', fontVariationSettings: "'FILL' 1" }}>person</span>
              </div>
              <div>
                <p className="font-bold text-sm mb-0.5" style={{ color: '#181c1e' }}>아니요</p>
                <p className="text-xs" style={{ color: '#747684' }}>일반 유형으로 진행</p>
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
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: 'linear-gradient(135deg, #f7fafd 0%, #eef1ff 100%)' }}>
        <div className="w-full max-w-lg">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setPhase('college-check')}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
              style={{ background: '#fff', border: '1px solid #ebeef1' }}
            >
              <span className="ms text-lg" style={{ color: '#434653' }}>arrow_back</span>
            </button>
            <div>
              <h2 className="font-extrabold text-lg" style={{ color: '#181c1e' }}>에타 시간표 업로드</h2>
              <p className="text-xs" style={{ color: '#747684' }}>1단계 / 5단계</p>
            </div>
          </div>

          {/* Progress */}
          <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#ebeef1' }}>
            <div className="h-full rounded-full" style={{ width: '20%', background: '#1a4db2' }} />
          </div>

          {/* Guide card */}
          <div className="rounded-2xl p-4 mb-5 flex items-start gap-3" style={{ background: '#eef1ff', border: '1px solid #c3d0ff' }}>
            <span className="ms text-2xl flex-shrink-0 mt-0.5" style={{ color: '#1a4db2', fontVariationSettings: "'FILL' 1" }}>photo_camera</span>
            <div>
              <p className="text-sm font-bold mb-1" style={{ color: '#1a4db2' }}>에타 시간표 촬영 방법</p>
              <ol className="text-xs leading-relaxed space-y-0.5" style={{ color: '#434653' }}>
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
            className="rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-3 cursor-pointer transition-all mb-5"
            style={{ minHeight: 200, borderColor: etaImage ? '#1a4db2' : '#d1d5db', background: etaImage ? '#eef1ff' : '#fafbfc' }}
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
                  <span className="text-white text-sm font-bold">다른 이미지 선택</span>
                </div>
              </div>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: '#eef1ff' }}>
                  <span className="ms text-4xl" style={{ color: '#1a4db2', fontVariationSettings: "'FILL' 1" }}>upload_file</span>
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold" style={{ color: '#181c1e' }}>이미지를 드래그하거나 클릭해서 업로드</p>
                  <p className="text-xs mt-1" style={{ color: '#747684' }}>JPG, PNG, WEBP · 최대 20MB</p>
                </div>
              </>
            )}
          </div>

          {etaParsing && (
            <div className="rounded-xl p-4 mb-4 flex items-center gap-3" style={{ background: '#eef1ff', border: '1px solid #c3d0ff' }}>
              <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0" style={{ borderColor: '#c3d0ff', borderTopColor: 'transparent' }} />
              <p className="text-sm font-semibold" style={{ color: '#1a4db2' }}>AI가 시간표를 분석하고 있습니다...</p>
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
              className="flex-1 py-3 rounded-xl text-sm font-semibold border transition-colors"
              style={{ color: '#747684', borderColor: '#ebeef1', background: '#fff' }}
              disabled={etaParsing}
            >
              건너뛰기
            </button>
            {etaImage && !etaParsing && (
              <button
                onClick={() => setPhase('eta-review')}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all"
                style={{ background: '#1a4db2' }}
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
    const addEntry = () => {
      setEtaEntries((prev) => [
        ...prev,
        { _id: `manual-${Date.now()}`, subject_name: '', day_of_week: 0, start_time: '09:00', end_time: '11:00', location: '', source: 'manual' },
      ]);
    };

    const removeEntry = (id: string) => setEtaEntries((prev) => prev.filter((e) => e._id !== id));

    const updateEntry = (id: string, field: keyof EtaEntry, value: string | number) => {
      setEtaEntries((prev) => prev.map((e) => e._id === id ? { ...e, [field]: value } : e));
    };

    const handleSaveAndContinue = async () => {
      const valid = etaEntries.filter(
        (e) => e.subject_name.trim() && e.start_time && e.end_time && e.start_time < e.end_time,
      );
      if (valid.length === 0) {
        setPhase('external-exam');
        return;
      }
      setEtaSaving(true);
      try {
        await api.post('/eta/save-schedules', {
          entries: valid.map(({ subject_name, day_of_week, start_time, end_time, location, source }) => ({
            subject_name, day_of_week, start_time, end_time, location: location ?? '', source,
          })),
        });
        toast.success(`${valid.length}개 과목을 시간표에 등록했습니다 ✅`);
      } catch {
            toast.error('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
      } finally {
        setEtaSaving(false);
        setPhase('external-exam');
      }
    };

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: 'linear-gradient(135deg, #f7fafd 0%, #eef1ff 100%)' }}>
        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setPhase('eta-upload')}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
              style={{ background: '#fff', border: '1px solid #ebeef1' }}
            >
              <span className="ms text-lg" style={{ color: '#434653' }}>arrow_back</span>
            </button>
            <div>
              <h2 className="font-extrabold text-lg" style={{ color: '#181c1e' }}>시간표 확인 및 수정</h2>
              <p className="text-xs" style={{ color: '#747684' }}>2단계 / 5단계 · AI 분석 결과를 확인하고 수정해주세요</p>
            </div>
          </div>

          {/* Progress */}
          <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#ebeef1' }}>
            <div className="h-full rounded-full" style={{ width: '40%', background: '#1a4db2' }} />
          </div>

          {/* Status banner */}
          {etaParsing ? (
            <div className="rounded-xl p-3 mb-5 flex items-center gap-2" style={{ background: '#eef1ff', border: '1px solid #c3d0ff' }}>
              <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0" style={{ borderColor: '#c3d0ff', borderTopColor: 'transparent' }} />
              <p className="text-sm font-semibold" style={{ color: '#1a4db2' }}>AI가 시간표를 다시 분석하고 있습니다</p>
            </div>
          ) : etaEntries.length > 0 ? (
            <div className="rounded-xl p-3 mb-5 flex items-center gap-2" style={{ background: '#d1fae5', border: '1px solid #6ee7b7' }}>
              <span className="ms text-base" style={{ color: '#065f46', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              <p className="text-sm font-semibold" style={{ color: '#065f46' }}>
                {etaEntries.length}개 과목을 인식했습니다. 잘못된 항목은 수정하거나 삭제해주세요.
              </p>
            </div>
          ) : (
            <div className="rounded-xl p-3 mb-5 flex items-center gap-2" style={{ background: '#fef3c7', border: '1px solid #fcd34d' }}>
              <span className="ms text-base" style={{ color: '#92400e', fontVariationSettings: "'FILL' 1" }}>warning</span>
              <p className="text-sm font-semibold" style={{ color: '#92400e' }}>
                자동 인식에 실패했습니다. &quot;다시 분석&quot; 버튼으로 재시도하거나 직접 과목을 추가해주세요.
              </p>
            </div>
          )}

          {/* Entry list */}
          <div className="rounded-2xl overflow-hidden mb-4" style={{ background: '#fff', border: '1px solid #ebeef1', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
            {/* Table header */}
            <div className="grid gap-2 px-4 py-2.5 text-xs font-bold" style={{
              gridTemplateColumns: '2fr 80px 90px 90px 1fr 36px',
              borderBottom: '1px solid #f1f4f7',
              background: '#fafbfc',
              color: '#747684',
            }}>
              <span>과목명</span>
              <span>요일</span>
              <span>시작</span>
              <span>종료</span>
              <span>강의실</span>
              <span></span>
            </div>

            {etaEntries.length === 0 && (
              <div className="px-4 py-8 text-center text-sm" style={{ color: '#9ca3af' }}>
                추가된 과목이 없습니다
              </div>
            )}

            {etaEntries.map((entry, idx) => (
              <div
                key={entry._id}
                className="grid gap-2 px-4 py-2.5 items-center"
                style={{
                  gridTemplateColumns: '2fr 80px 90px 90px 1fr 36px',
                  borderBottom: idx < etaEntries.length - 1 ? '1px solid #f1f4f7' : 'none',
                }}
              >
                {/* 과목명 */}
                <input
                  type="text"
                  value={entry.subject_name}
                  onChange={(e) => updateEntry(entry._id, 'subject_name', e.target.value)}
                  placeholder="과목명을 입력하세요"
                  className="w-full px-2 py-1.5 text-sm rounded-lg border outline-none transition-colors"
                  style={{ borderColor: entry.subject_name ? '#ebeef1' : '#fca5a5', background: '#fafbfc' }}
                  onFocus={(e) => e.target.style.borderColor = '#1a4db2'}
                  onBlur={(e) => e.target.style.borderColor = entry.subject_name ? '#ebeef1' : '#fca5a5'}
                />
                {/* 요일 */}
                <select
                  value={entry.day_of_week}
                  onChange={(e) => updateEntry(entry._id, 'day_of_week', Number(e.target.value))}
                  className="w-full px-2 py-1.5 text-sm rounded-lg border outline-none"
                  style={{ borderColor: '#ebeef1', background: '#fafbfc' }}
                >
                  {DAY_LABELS.map((d, i) => (
                    <option key={i} value={i}>{d}요일</option>
                  ))}
                </select>
                {/* 시작 시간 */}
                <input
                  type="text"
                  value={entry.start_time}
                  onChange={(e) => updateEntry(entry._id, 'start_time', e.target.value)}
                  onBlur={(e) => {
                    const norm = normalizeTimeString(e.target.value);
                    if (norm) updateEntry(entry._id, 'start_time', norm);
                  }}
                  placeholder="09:00"
                  pattern="[0-9]{2}:[0-9]{2}"
                  className="w-full px-2 py-1.5 text-sm rounded-lg border outline-none"
                  style={{ borderColor: '#ebeef1', background: '#fafbfc' }}
                />
                {/* 종료 시간 */}
                <input
                  type="text"
                  value={entry.end_time}
                  onChange={(e) => updateEntry(entry._id, 'end_time', e.target.value)}
                  onBlur={(e) => {
                    const norm = normalizeTimeString(e.target.value);
                    if (norm) updateEntry(entry._id, 'end_time', norm);
                  }}
                  placeholder="11:00"
                  pattern="[0-9]{2}:[0-9]{2}"
                  className="w-full px-2 py-1.5 text-sm rounded-lg border outline-none"
                  style={{ borderColor: '#ebeef1', background: '#fafbfc' }}
                />
                {/* 강의실 */}
                <input
                  type="text"
                  value={entry.location ?? ''}
                  onChange={(e) => updateEntry(entry._id, 'location', e.target.value)}
                  placeholder="강의실"
                  className="w-full px-2 py-1.5 text-sm rounded-lg border outline-none"
                  style={{ borderColor: '#ebeef1', background: '#fafbfc' }}
                />
                {/* 삭제 */}
                <button
                  onClick={() => removeEntry(entry._id)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
                  style={{ background: '#fef2f2' }}
                >
                  <span className="ms text-sm" style={{ color: '#ef4444' }}>delete</span>
                </button>
              </div>
            ))}
          </div>
          {/* Image preview & re-analyze */}
          {etaImagePreview && (
            <div className="rounded-xl mb-4" style={{ background: '#fafbfc', border: '1px solid #ebeef1' }}>
              {/* ?ㅻ뜑 */}
              <div className="flex items-center justify-between px-3 py-2.5" style={{ borderBottom: '1px solid #f1f4f7' }}>
                <div className="flex items-center gap-2">
                  <span className="ms text-base" style={{ color: '#1a4db2', fontVariationSettings: "'FILL' 1" }}>image</span>
                  <p className="text-xs font-bold" style={{ color: '#181c1e' }}>업로드한 원본 이미지</p>
                  <p className="text-xs" style={{ color: '#747684' }}>이미지가 맞는지 확인해주세요</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleReParseEtaImage}
                    disabled={etaParsing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                    style={{
                      background: etaParsing ? '#c3d0ff' : '#eef1ff',
                      color: '#1a4db2',
                      border: '1px solid #c3d0ff',
                      cursor: etaParsing ? 'not-allowed' : 'pointer',
                    }}
                    title="같은 이미지로 AI 다시 분석"
                  >
                    {etaParsing ? (
                      <>
                        <div className="w-3 h-3 border border-t-transparent rounded-full animate-spin" style={{ borderColor: '#c3d0ff', borderTopColor: 'transparent' }} />
                        분석 중
                      </>
                    ) : (
                      <>
                        <span className="ms text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>refresh</span>
                        다시 분석
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setEtaImageExpanded((v) => !v)}
                    className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all"
                    style={{ background: '#f1f4f7', color: '#434653', border: '1px solid #ebeef1', cursor: 'pointer' }}
                    title={etaImageExpanded ? '이미지 접기' : '이미지 펼치기'}
                  >
                    <span className="ms text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                      {etaImageExpanded ? 'expand_less' : 'expand_more'}
                    </span>
                    {etaImageExpanded ? '접기' : '펼치기'}
                  </button>
                  <button
                    onClick={() => setPhase('eta-upload')}
                    className="text-xs font-semibold"
                    style={{ color: '#747684', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    원본 이미지
                  </button>
                </div>
              </div>
              {/* ?대? 몄껜 */}
              <div className="p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={etaImagePreview}
                  alt="원본 시간표"
                  className="w-full rounded-lg object-contain cursor-pointer transition-all"
                  style={{
                    maxHeight: etaImageExpanded ? 'none' : 180,
                    objectFit: 'contain',
                  }}
                  onClick={() => setEtaImageExpanded((v) => !v)}
                />
                {!etaImageExpanded && (
                  <p className="text-xs text-center mt-1.5" style={{ color: '#9ca3af' }}>
                    클릭하면 전체 이미지를 볼 수 있어요
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex gap-3">
            <button
              onClick={() => { setEtaEntries([]); setPhase('external-exam'); }}
              className="flex-1 py-3 rounded-xl text-sm font-semibold border"
              style={{ color: '#747684', borderColor: '#ebeef1', background: '#fff' }}
              disabled={etaSaving}
            >
              건너뛰기
            </button>
            <button
              onClick={handleSaveAndContinue}
              disabled={etaSaving}
              className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all"
              style={{ background: etaSaving ? '#93c5fd' : '#1a4db2' }}
            >
              {etaSaving ? '저장 중...' : `${etaEntries.filter(e => e.subject_name.trim()).length}개 확인, 다음`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ?? AI ?시간???앹꽦 ??붾㈃ ??
  if (phase === 'generating' || phase === 'done') {
    const typeInfo = USER_TYPES.find((t) => t.id === selectedType);
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: 'linear-gradient(135deg, #f7fafd 0%, #eef1ff 100%)' }}>
        <div className="w-full max-w-sm text-center">
          <div className="relative inline-flex items-center justify-center w-20 h-20 rounded-full mb-6" style={{ background: '#1a4db2' }}>
            {phase === 'done' ? (
              <span className="ms text-white text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            ) : (
              <>
                <span className="ms text-white text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>smart_toy</span>
                <div className="absolute inset-0 rounded-full border-4 border-t-transparent animate-spin" style={{ borderColor: '#c3d0ff', borderTopColor: 'transparent' }} />
              </>
            )}
          </div>

          <h2 className="text-xl font-extrabold mb-2" style={{ color: '#181c1e' }}>
            {phase === 'done' ? 'SKEMA 완성! 🎉' : 'AI 시간표를 만드는 중..'}
          </h2>

          {isCollegeStudent && etaEntries.length > 0 && phase !== 'done' && (
            <p className="text-xs mb-4" style={{ color: '#747684' }}>에타 시간표를 반영하고 있습니다 🔄</p>
          )}

          {phase !== 'done' && (
            <div className="space-y-2 mt-4">
              {GENERATING_STEPS.map((step, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-xl text-left transition-all"
                  style={{
                    background: i <= generatingStep ? (typeInfo?.color + '40' || '#c3d0ff40') : '#f1f4f7',
                    opacity: i <= generatingStep ? 1 : 0.4,
                  }}
                >
                  <span className="ms text-base flex-shrink-0" style={{ color: i <= generatingStep ? '#1a4db2' : '#747684', fontVariationSettings: "'FILL' 1" }}>
                    {i < generatingStep ? 'check_circle' : i === generatingStep ? 'pending' : 'radio_button_unchecked'}
                  </span>
                  <span className="text-sm font-medium" style={{ color: i <= generatingStep ? '#181c1e' : '#747684' }}>{step}</span>
                </div>
              ))}
            </div>
          )}

          {phase === 'done' && (
            <p className="text-sm mt-4" style={{ color: '#434653' }}>잠시 후 대시보드로 이동합니다..</p>
          )}
        </div>
      </div>
    );
  }

  // ?? ?몃? ?시험 ?낅젰 ?붾㈃ (??숈깮 ?꾩슜 STEP 4) ??
  if (phase === 'external-exam') {
    const EXAM_EXAMPLES = ['중간고사', '기말고사', '토익', '정보처리기사', '자격증', '프로젝트 발표'];
    const DAYS_OPTIONS = [0, 7, 14, 21, 30, 60] as const;
    const DAYS_PER_WEEK_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;
    const fmtHours = (h: number) => h < 1 ? `${h * 60}분` : h % 1 === 0 ? `${h}시간` : `${Math.floor(h)}시간 ${(h % 1) * 60}분`;
    const canAddExam = examDraft.name.trim() && examDraft.date;

    const addExam = () => {
      if (!canAddExam) return;
      setExternalExams((prev) => [...prev, { ...examDraft, _id: `ex-${Date.now()}` }]);
      setExamDraft({ name: '', date: '' });
    };

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: 'linear-gradient(135deg, #f7fafd 0%, #eef1ff 100%)' }}>
        <div className="w-full max-w-lg">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => setPhase('eta-review')} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
              <span className="ms text-lg" style={{ color: '#434653' }}>arrow_back</span>
            </button>
            <div>
              <h2 className="font-extrabold text-lg" style={{ color: '#181c1e' }}>추가 시험 입력</h2>
              <p className="text-xs" style={{ color: '#747684' }}>3단계 / 5단계</p>
            </div>
          </div>
          <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#ebeef1' }}>
            <div className="h-full rounded-full" style={{ width: '60%', background: '#1a4db2' }} />
          </div>

          <div className="rounded-2xl p-5 mb-5" style={{ background: '#fff', boxShadow: '0 4px 24px rgba(26,77,178,0.08)', border: '1px solid #ebeef1' }}>
            <p className="font-bold text-base mb-1" style={{ color: '#181c1e' }}>별도로 준비 중인 시험이 있나요?</p>
            <p className="text-xs mb-4" style={{ color: '#747684' }}>없으면 건너뛰어도 됩니다</p>

            {/* ?덉떆 chips */}
            <div className="flex flex-wrap gap-2 mb-4">
              {EXAM_EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => setExamDraft((d) => ({ ...d, name: ex }))}
                  className="px-3 py-1 text-xs rounded-full border font-medium transition-colors"
                  style={{ borderColor: examDraft.name === ex ? '#1a4db2' : '#c3d0ff', color: '#1a4db2', background: examDraft.name === ex ? '#eef1ff' : '#f0f4ff' }}>
                  {ex}
                </button>
              ))}
            </div>

            {/* 입력 폼 */}
            <div className="space-y-3">
              <input
                className="w-full px-4 py-2.5 text-sm border-2 rounded-xl outline-none"
                style={{ borderColor: '#ebeef1' }}
                placeholder="시험명 (예: 중간고사, 프로젝트 발표)"
                value={examDraft.name}
                onChange={(e) => setExamDraft((d) => ({ ...d, name: e.target.value }))}
                onFocus={(e) => e.target.style.borderColor = '#1a4db2'}
                onBlur={(e) => e.target.style.borderColor = '#ebeef1'}
              />
              <input
                type="date"
                className="w-full px-4 py-2.5 text-sm border-2 rounded-xl outline-none"
                style={{ borderColor: '#ebeef1' }}
                value={examDraft.date}
                onChange={(e) => setExamDraft((d) => ({ ...d, date: e.target.value }))}
                onFocus={(e) => e.target.style.borderColor = '#1a4db2'}
                onBlur={(e) => e.target.style.borderColor = '#ebeef1'}
              />
              <button onClick={addExam} disabled={!canAddExam}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white"
                style={{ background: canAddExam ? '#1a4db2' : '#d1d5db', cursor: canAddExam ? 'pointer' : 'not-allowed' }}>
                + 시험 추가
              </button>
            </div>
          </div>

          {/* 추가된 시험 목록 */}
          {externalExams.length > 0 && (
            <div className="space-y-2 mb-5">
              {externalExams.map((ex) => (
                <div key={ex._id} className="flex items-center justify-between p-3 rounded-xl" style={{ background: '#eef1ff', border: '1px solid #c3d0ff' }}>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: '#1a4db2' }}>{ex.name}</p>
                    <p className="text-xs" style={{ color: '#434653' }}>{ex.date}</p>
                  </div>
                  <button onClick={() => setExternalExams((prev) => prev.filter((e) => e._id !== ex._id))}>
                    <span className="ms text-base" style={{ color: '#747684' }}>close</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 공부 블록 설정 — 시험이 하나라도 있을 때만 표시 */}
          {externalExams.length > 0 && (
            <div className="rounded-2xl p-5 mb-5" style={{ background: '#fff', border: '1px solid #d1fae5', boxShadow: '0 2px 12px rgba(5,150,105,0.06)' }}>
              <p className="font-bold text-sm mb-1" style={{ color: '#065f46' }}>📖 공부 일정 자동 배치</p>
              <p className="text-xs mb-4" style={{ color: '#747684' }}>캘린더 빈 시간에 공부 블록을 자동으로 넣어드려요</p>

              <div className="space-y-4">
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: '#434653' }}>몇 일 전부터</p>
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS_OPTIONS.map((d) => (
                      <button key={d} type="button"
                        onClick={() => setStudyStartDays(d)}
                        className="py-2 text-xs font-semibold rounded-lg border-2 transition-colors"
                        style={{ minWidth: 52, padding: '6px 10px', borderColor: studyStartDays === d ? '#059669' : '#ebeef1', background: studyStartDays === d ? '#d1fae5' : '#fff', color: studyStartDays === d ? '#059669' : '#747684' }}>
                        {d === 0 ? '오늘부터' : `D-${d}`}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: '#434653' }}>주 몇 일</p>
                  <div className="flex gap-1.5">
                    {DAYS_PER_WEEK_OPTIONS.map((d) => (
                      <button key={d} type="button"
                        onClick={() => setStudyDaysPerWeek(d)}
                        className="flex-1 py-2 text-xs font-semibold rounded-lg border-2 transition-colors"
                        style={{ borderColor: studyDaysPerWeek === d ? '#059669' : '#ebeef1', background: studyDaysPerWeek === d ? '#d1fae5' : '#fff', color: studyDaysPerWeek === d ? '#059669' : '#747684' }}>
                        {d === 7 ? '매일' : `${d}일`}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: '#434653' }}>회당 공부 시간</p>
                  <select
                    value={studyHoursPerSession}
                    onChange={(e) => setStudyHoursPerSession(Number(e.target.value))}
                    className="w-full px-3 py-2.5 text-sm rounded-xl border-2 outline-none"
                    style={{ borderColor: '#c3d0ff', background: '#f8f9ff', color: '#181c1e' }}
                  >
                    {Array.from({ length: 24 }, (_, i) => (i + 1) * 0.5).map((h) => (
                      <option key={h} value={h}>{fmtHours(h)}</option>
                    ))}
                  </select>
                </div>
                <p className="text-xs" style={{ color: '#9ca3af', lineHeight: 1.6 }}>
                  각 시험 {studyStartDays === 0 ? '오늘' : `D-${studyStartDays}`}부터 주 {studyDaysPerWeek === 7 ? '매일' : `${studyDaysPerWeek}일`}, 19:00 기준 빈 시간에 {fmtHours(studyHoursPerSession)}씩 자동 배치됩니다
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setPhase('personal-schedule')} className="flex-1 py-3 rounded-xl text-sm font-semibold border" style={{ color: '#747684', borderColor: '#ebeef1', background: '#fff' }}>
              건너뛰기
            </button>
            <button onClick={() => setPhase('personal-schedule')} className="flex-1 py-3 rounded-xl text-sm font-bold text-white" style={{ background: '#1a4db2' }}>
              {externalExams.length > 0 ? `${externalExams.length}개 등록 →` : '다음 →'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ?? 쒖씤 ?일정 ?낅젰 ?붾㈃ (??숈깮 ?꾩슜 STEP 5) ??
  if (phase === 'personal-schedule') {
    const SCHED_EXAMPLES = ['알바', '면접', '프로젝트', '동아리 활동'];
    const canAddSched = scheduleDraft.title.trim() && scheduleDraft.start_time && scheduleDraft.end_time &&
      (scheduleDraft.is_recurring || !!scheduleDraft.date);

    const addSched = () => {
      if (!canAddSched) return;
      let draft = { ...scheduleDraft };
      // 특정 날짜인 경우 day_of_week를 날짜에서 자동 계산
      if (!draft.is_recurring && draft.date) {
        const [y, m, d] = draft.date.split('-').map(Number);
        const jsDay = new Date(y, m - 1, d).getDay(); // 0=Sun
        draft.day_of_week = jsDay === 0 ? 6 : jsDay - 1;
      }
      setPersonalSchedules((prev) => [...prev, { ...draft, _id: `ps-${Date.now()}` }]);
      setScheduleDraft({ title: '', day_of_week: 0, start_time: '', end_time: '', is_recurring: true, date: '' });
    };

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: 'linear-gradient(135deg, #f7fafd 0%, #eef1ff 100%)' }}>
        <div className="w-full max-w-lg">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => setPhase('external-exam')} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
              <span className="ms text-lg" style={{ color: '#434653' }}>arrow_back</span>
            </button>
            <div>
              <h2 className="font-extrabold text-lg" style={{ color: '#181c1e' }}>개인 일정 입력</h2>
              <p className="text-xs" style={{ color: '#747684' }}>4단계 / 5단계</p>
            </div>
          </div>
          <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#ebeef1' }}>
            <div className="h-full rounded-full" style={{ width: '80%', background: '#1a4db2' }} />
            {/* personal-schedule = 4/5 = 80% */}
          </div>

          <div className="rounded-2xl p-5 mb-5" style={{ background: '#fff', boxShadow: '0 4px 24px rgba(26,77,178,0.08)', border: '1px solid #ebeef1' }}>
            <p className="font-bold text-base mb-1" style={{ color: '#181c1e' }}>학업 외에 중요한 일정이 있나요?</p>
            <p className="text-xs mb-4" style={{ color: '#747684' }}>없으면 건너뛰어도 됩니다</p>

            {/* ?덉떆 chips */}
            <div className="flex flex-wrap gap-2 mb-4">
              {SCHED_EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => setScheduleDraft((d) => ({ ...d, title: ex }))}
                  className="px-3 py-1 text-xs rounded-full border font-medium"
                  style={{ borderColor: scheduleDraft.title === ex ? '#1a4db2' : '#c3d0ff', color: '#1a4db2', background: scheduleDraft.title === ex ? '#eef1ff' : '#f0f4ff' }}>
                  {ex}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <input
                className="w-full px-4 py-2.5 text-sm border-2 rounded-xl outline-none"
                style={{ borderColor: '#ebeef1' }}
                placeholder="일정 제목 (예: 동아리, 운동)"
                value={scheduleDraft.title}
                onChange={(e) => setScheduleDraft((d) => ({ ...d, title: e.target.value }))}
                onFocus={(e) => e.target.style.borderColor = '#1a4db2'}
                onBlur={(e) => e.target.style.borderColor = '#ebeef1'}
              />
              {/* 반복/단일 날짜 선택 */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleDraft((d) => ({ ...d, is_recurring: true, date: '' }))}
                  className="flex-1 py-2 text-xs rounded-xl font-semibold border-2 transition-colors"
                  style={{ borderColor: scheduleDraft.is_recurring ? '#1a4db2' : '#ebeef1', background: scheduleDraft.is_recurring ? '#eef1ff' : '#fff', color: scheduleDraft.is_recurring ? '#1a4db2' : '#747684' }}>
                  매주 반복
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleDraft((d) => ({ ...d, is_recurring: false }))}
                  className="flex-1 py-2 text-xs rounded-xl font-semibold border-2 transition-colors"
                  style={{ borderColor: !scheduleDraft.is_recurring ? '#1a4db2' : '#ebeef1', background: !scheduleDraft.is_recurring ? '#eef1ff' : '#fff', color: !scheduleDraft.is_recurring ? '#1a4db2' : '#747684' }}>
                  특정 날짜
                </button>
              </div>
              {/* 요일 (매주 반복) / 날짜 (특정 날짜) */}
              {scheduleDraft.is_recurring ? (
                <div>
                  <p className="text-xs font-medium mb-2" style={{ color: '#434653' }}>요일</p>
                  <div className="flex gap-1.5">
                    {DAY_LABELS.map((d, i) => (
                      <button key={i} onClick={() => setScheduleDraft((prev) => ({ ...prev, day_of_week: i }))}
                        className="flex-1 py-2 text-xs rounded-lg font-semibold border-2 transition-colors"
                        style={{ borderColor: scheduleDraft.day_of_week === i ? '#1a4db2' : '#ebeef1', background: scheduleDraft.day_of_week === i ? '#eef1ff' : '#fff', color: scheduleDraft.day_of_week === i ? '#1a4db2' : '#747684' }}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-medium mb-2" style={{ color: '#434653' }}>날짜</p>
                  <input
                    type="date"
                    className="w-full px-4 py-2.5 text-sm border-2 rounded-xl outline-none"
                    style={{ borderColor: scheduleDraft.date ? '#1a4db2' : '#ebeef1' }}
                    value={scheduleDraft.date ?? ''}
                    onChange={(e) => setScheduleDraft((d) => ({ ...d, date: e.target.value }))}
                    onFocus={(ev) => ev.target.style.borderColor = '#1a4db2'}
                    onBlur={(ev) => ev.target.style.borderColor = scheduleDraft.date ? '#1a4db2' : '#ebeef1'}
                  />
                </div>
              )}
              {/* 시간 */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <p className="text-xs font-medium mb-1" style={{ color: '#434653' }}>시작</p>
                  <input type="time" className="w-full px-3 py-2 text-sm border-2 rounded-xl outline-none" style={{ borderColor: '#ebeef1' }}
                    value={scheduleDraft.start_time}
                    onChange={(e) => setScheduleDraft((d) => ({ ...d, start_time: e.target.value }))}
                    onFocus={(e) => e.target.style.borderColor = '#1a4db2'}
                    onBlur={(e) => e.target.style.borderColor = '#ebeef1'} />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium mb-1" style={{ color: '#434653' }}>종료</p>
                  <input type="time" className="w-full px-3 py-2 text-sm border-2 rounded-xl outline-none" style={{ borderColor: '#ebeef1' }}
                    value={scheduleDraft.end_time}
                    onChange={(e) => setScheduleDraft((d) => ({ ...d, end_time: e.target.value }))}
                    onFocus={(e) => e.target.style.borderColor = '#1a4db2'}
                    onBlur={(e) => e.target.style.borderColor = '#ebeef1'} />
                </div>
              </div>
              <button onClick={addSched} disabled={!canAddSched}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white"
                style={{ background: canAddSched ? '#1a4db2' : '#d1d5db', cursor: canAddSched ? 'pointer' : 'not-allowed' }}>
                + 일정 추가
              </button>
            </div>
          </div>

          {/* 붽????일정 ⑸줉 */}
          {personalSchedules.length > 0 && (
            <div className="space-y-2 mb-5">
              {personalSchedules.map((s) => (
                <div key={s._id} className="flex items-center justify-between p-3 rounded-xl" style={{ background: '#fef3c7', border: '1px solid #fcd34d' }}>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: '#92400e' }}>{s.title}</p>
                    <p className="text-xs" style={{ color: '#78350f' }}>
                      {s.is_recurring
                        ? `${DAY_LABELS[s.day_of_week]}요일 ${s.start_time}~${s.end_time} · 매주`
                        : `${s.date} ${s.start_time}~${s.end_time} · 1회`}
                    </p>
                  </div>
                  <button onClick={() => setPersonalSchedules((prev) => prev.filter((x) => x._id !== s._id))}>
                    <span className="ms text-base" style={{ color: '#747684' }}>close</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={handleCollegeStartChat} className="flex-1 py-3 rounded-xl text-sm font-semibold border" style={{ color: '#747684', borderColor: '#ebeef1', background: '#fff' }}>
              건너뛰기
            </button>
            <button onClick={handleCollegeStartChat} className="flex-1 py-3 rounded-xl text-sm font-bold text-white" style={{ background: '#1a4db2' }}>
              {personalSchedules.length > 0 ? `${personalSchedules.length}개 등록 →` : '다음 →'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ?? ?좎? ????좏깮 ?붾㈃ ??
  if (phase === 'type-select') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: 'linear-gradient(135deg, #f7fafd 0%, #eef1ff 100%)' }}>
        <div className="w-full max-w-lg">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setPhase('college-check')}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
              style={{ background: '#fff', border: '1px solid #ebeef1' }}
            >
              <span className="ms text-lg" style={{ color: '#434653' }}>arrow_back</span>
            </button>
            <div>
              <h1 className="font-extrabold text-lg" style={{ color: '#181c1e' }}>나에게 맞는 유형 선택</h1>
              <p className="text-xs" style={{ color: '#747684' }}>
                {isCollegeStudent ? '2단계 / 2단계' : '1단계'}
              </p>
            </div>
          </div>

          {/* Progress */}
          <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#ebeef1' }}>
            <div className="h-full rounded-full" style={{ width: isCollegeStudent ? '100%' : '50%', background: '#1a4db2' }} />
          </div>

          {isCollegeStudent && etaEntries.length > 0 && (
            <div className="rounded-xl p-3 mb-5 flex items-center gap-2" style={{ background: '#d1fae5', border: '1px solid #6ee7b7' }}>
              <span className="ms text-base" style={{ color: '#065f46', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              <p className="text-sm font-semibold" style={{ color: '#065f46' }}>에타 시간표 {etaEntries.filter(e=>e.subject_name.trim()).length}개 등록 완료 ✅</p>
            </div>
          )}

          <p className="text-sm mb-5" style={{ color: '#434653' }}>AI 맞춤 시간표를 만들어드릴게요</p>

          {/* Type cards */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            {USER_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => handleTypeSelect(type.id)}
                className="text-left p-5 rounded-2xl border-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: '#fff', borderColor: '#ebeef1', boxShadow: '0 2px 12px rgba(26,77,178,0.06)' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#1a4db2'; e.currentTarget.style.background = type.color + '30'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#ebeef1'; e.currentTarget.style.background = '#fff'; }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: type.color }}>
                  <span className="ms text-lg" style={{ color: type.iconColor, fontVariationSettings: "'FILL' 1" }}>{type.icon}</span>
                </div>
                <p className="font-bold text-sm mb-1" style={{ color: '#181c1e' }}>{type.label}</p>
                <p className="text-xs leading-relaxed" style={{ color: '#434653' }}>{type.desc}</p>
              </button>
            ))}
          </div>

          <button
            onClick={handleSkip}
            className="w-full py-3 text-sm font-medium rounded-xl border transition-colors"
            style={{ color: '#747684', borderColor: '#ebeef1' }}
          >
            건너뛰기 (나중에 설정에서 변경 가능)
          </button>
        </div>
      </div>
    );
  }

  // 수면 시간 입력 화면
  if (phase === 'sleep') {
    const backTarget = isCollegeStudent ? 'personal-schedule' : 'type-select';
    const handleSleepSubmit = () => {
      finishOnboarding({}, { sleep_start: sleepStart, sleep_end: sleepEnd });
    };

    const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
    const fmtHour = (h: number) => `${String(h).padStart(2, '0')}:00`;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: 'linear-gradient(135deg, #f7fafd 0%, #eef1ff 100%)' }}>
        <div className="w-full max-w-md">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setPhase(backTarget)}
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: '#fff', border: '1px solid #ebeef1' }}
            >
              <span className="ms text-lg" style={{ color: '#434653' }}>arrow_back</span>
            </button>
            <div>
              <h2 className="font-extrabold text-lg" style={{ color: '#181c1e' }}>수면 시간 설정</h2>
              <p className="text-xs" style={{ color: '#747684' }}>{isCollegeStudent ? '5단계 / 5단계' : '마지막 단계'}</p>
            </div>
          </div>

          {/* Progress */}
          <div className="w-full h-1.5 rounded-full mb-8" style={{ background: '#ebeef1' }}>
            <div className="h-full rounded-full" style={{ width: '100%', background: '#1a4db2' }} />
          </div>

          {/* Card */}
          <div className="rounded-2xl p-6 mb-6" style={{ background: '#fff', boxShadow: '0 4px 24px rgba(26,77,178,0.08)', border: '1px solid #ebeef1' }}>
            <div className="flex items-center gap-2 mb-6">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#eef1ff' }}>
                <span className="ms text-xl" style={{ color: '#1a4db2', fontVariationSettings: "'FILL' 1" }}>bedtime</span>
              </div>
              <p className="font-bold text-base" style={{ color: '#181c1e' }}>평소 수면 패턴을 알려주세요</p>
            </div>

            {/* 취침 시간 */}
            <div className="mb-5">
              <label className="block text-sm font-semibold mb-2" style={{ color: '#434653' }}>
                <span className="ms text-base align-middle mr-1" style={{ color: '#1a4db2' }}>nights_stay</span>
                취침 시간
              </label>
              <select
                value={sleepStart}
                onChange={(e) => setSleepStart(e.target.value)}
                className="w-full px-4 py-3 text-sm rounded-xl border-2 outline-none font-medium"
                style={{ borderColor: '#c3d0ff', background: '#f8f9ff', color: '#181c1e' }}
              >
                {HOUR_OPTIONS.map((h) => (
                  <option key={h} value={fmtHour(h)}>
                    {h === 0 ? '자정 (00:00)' : h < 12 ? `오전 ${h}시` : h === 12 ? '정오 (12:00)' : `오후 ${h - 12}시 (${String(h).padStart(2,'0')}:00)`}
                  </option>
                ))}
              </select>
            </div>

            {/* 기상 시간 */}
            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: '#434653' }}>
                <span className="ms text-base align-middle mr-1" style={{ color: '#f59e0b' }}>wb_sunny</span>
                기상 시간
              </label>
              <select
                value={sleepEnd}
                onChange={(e) => setSleepEnd(e.target.value)}
                className="w-full px-4 py-3 text-sm rounded-xl border-2 outline-none font-medium"
                style={{ borderColor: '#fde68a', background: '#fffbeb', color: '#181c1e' }}
              >
                {HOUR_OPTIONS.map((h) => (
                  <option key={h} value={fmtHour(h)}>
                    {h === 0 ? '자정 (00:00)' : h < 12 ? `오전 ${h}시` : h === 12 ? '정오 (12:00)' : `오후 ${h - 12}시 (${String(h).padStart(2,'0')}:00)`}
                  </option>
                ))}
              </select>
            </div>

            {/* 수면 시간 요약 */}
            {(() => {
              const startH = parseInt(sleepStart.split(':')[0]);
              const endH = parseInt(sleepEnd.split(':')[0]);
              const hours = endH > startH ? endH - startH : 24 - startH + endH;
              const isValid = hours >= 6;
              return (
                <div className="mt-4 px-4 py-3 rounded-xl flex items-center gap-2" style={{ background: isValid ? '#f0fdf4' : '#fff7ed', border: `1px solid ${isValid ? '#bbf7d0' : '#fed7aa'}` }}>
                  <span className="ms text-base" style={{ color: isValid ? '#16a34a' : '#ea580c', fontVariationSettings: "'FILL' 1" }}>
                    {isValid ? 'check_circle' : 'warning'}
                  </span>
                  <span className="text-sm font-medium" style={{ color: isValid ? '#15803d' : '#c2410c' }}>
                    {isValid ? `${hours}시간 수면 · 권장 범위예요` : `${hours}시간 수면 · 최소 6시간 이상 권장해요`}
                  </span>
                </div>
              );
            })()}
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
                className="px-3 py-1.5 text-xs rounded-full font-medium border-2 transition-all"
                style={{
                  borderColor: sleepStart === p.start && sleepEnd === p.end ? '#1a4db2' : '#c3d0ff',
                  color: sleepStart === p.start && sleepEnd === p.end ? '#1a4db2' : '#434653',
                  background: sleepStart === p.start && sleepEnd === p.end ? '#eef1ff' : '#f0f4ff',
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
              className="flex-1 py-3 rounded-xl text-sm font-semibold border"
              style={{ color: '#747684', borderColor: '#ebeef1', background: '#fff' }}
            >
              건너뛰기
            </button>
            <button
              onClick={handleSleepSubmit}
              className="flex-1 py-3 rounded-xl text-sm font-bold text-white"
              style={{ background: '#1a4db2' }}
            >
              완료 →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 채팅 화면 (레거시 — 직접 접근 시 fallback)
  const currentStep = activeSteps[stepIdx];
  const progress = (stepIdx / activeSteps.length) * 100;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #f7fafd 0%, #eef1ff 100%)' }}>
      <div className="w-full max-w-lg flex flex-col" style={{ height: '85vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPhase(isCollegeStudent ? 'personal-schedule' : 'type-select')}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors"
            >
              <span className="ms text-lg" style={{ color: '#434653' }}>arrow_back</span>
            </button>
            <div>
              <p className="font-bold text-sm" style={{ color: '#181c1e' }}>
                {isCollegeStudent ? '학습 목표 설정' : (USER_TYPES.find((t) => t.id === selectedType)?.label + ' 맞춤 설정')}
              </p>
              <p className="text-xs" style={{ color: '#747684' }}>{stepIdx + 1} / {activeSteps.length} 단계</p>
            </div>
          </div>
          <button
            onClick={handleSkip}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors"
            style={{ color: '#747684', borderColor: '#ebeef1' }}
          >
            대꼫?곌린
          </button>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 rounded-full mb-4" style={{ background: '#ebeef1' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progress}%`, background: '#1a4db2' }}
          />
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 mb-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'ai' && (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mr-2 mt-1 flex-shrink-0 text-white" style={{ background: '#1a4db2' }}>
                  AI
                </div>
              )}
              <div
                className="max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed"
                style={
                  msg.role === 'user'
                    ? { background: '#1a4db2', color: '#fff', borderTopRightRadius: 4 }
                    : { background: '#fff', color: '#181c1e', borderTopLeftRadius: 4, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }
                }
              >
                {msg.text}
              </div>
            </div>
          ))}
          {isProcessing && (
            <div className="flex justify-start">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mr-2 mt-1 flex-shrink-0 text-white" style={{ background: '#1a4db2' }}>AI</div>
              <div className="rounded-2xl rounded-tl-sm px-4 py-3" style={{ background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                <div className="flex gap-1">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: `${d}ms` }} />
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
                onClick={() => handleSend(q)}
                className="px-3 py-1.5 text-xs rounded-full font-medium transition-all border-2 hover:border-blue-400 hover:text-blue-600"
                style={{ borderColor: '#c3d0ff', color: '#1a4db2', background: '#f0f4ff' }}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="flex gap-2">
          <input
            className="flex-1 px-4 py-3 text-sm border-2 rounded-xl outline-none transition-colors"
            style={{ borderColor: '#ebeef1', background: '#fff' }}
            onFocus={(e) => e.target.style.borderColor = '#1a4db2'}
            onBlur={(e) => e.target.style.borderColor = '#ebeef1'}
            placeholder={currentStep?.hint || '입력해주세요..'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={isProcessing}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isProcessing}
            className="px-5 py-3 rounded-xl text-sm font-bold text-white transition-all"
            style={{ background: (!input.trim() || isProcessing) ? '#93c5fd' : '#1a4db2' }}
          >
            <span className="ms" style={{ color: '#fff', fontSize: 22 }}>send</span>
          </button>
        </div>
      </div>
    </div>
  );
}