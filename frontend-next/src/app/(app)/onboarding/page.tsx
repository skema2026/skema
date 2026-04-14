'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { normalizeTimeString } from '@/lib/utils';
import { useUpdateProfile } from '@/hooks/useProfile';
import { useUploadSyllabus, useReAnalyzeSyllabus, useAutoCreateExam, type SyllabusItem, type SyllabusAnalysis } from '@/hooks/useSyllabi';

type Phase = 'college-check' | 'eta-upload' | 'eta-review' | 'syllabus-upload' | 'external-exam' | 'personal-schedule' | 'type-select' | 'chat' | 'generating' | 'done';
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
  status: 'starting' | 'studying';
  progress: string;                    // 현재 진도 메모
  weak_parts: string;                  // 취약한 파트
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
  const uploadSyllabus = useUploadSyllabus();
  const reAnalyzeSyllabus = useReAnalyzeSyllabus();
  const autoCreateExam = useAutoCreateExam();
  // 분석 상태 추적: syllabusId → status
  const [analysisStatuses, setAnalysisStatuses] = useState<Record<number, string>>({});
  // 분석 결과 보관: syllabusId → SyllabusAnalysis
  const [analysisResults, setAnalysisResults] = useState<Record<number, SyllabusAnalysis>>({});
  // 학기 시작일
  const [semesterStartDate, setSemesterStartDate] = useState<string>('');
  // 시험 등록 완료 추적: syllabusId → true
  const [examRegistered, setExamRegistered] = useState<Record<number, boolean>>({});

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

  // syllabus upload state
  const [syllabusSubject, setSyllabusSubject] = useState('');
  const [syllabusFile, setSyllabusFile] = useState<File | null>(null);
  const [uploadedSyllabi, setUploadedSyllabi] = useState<SyllabusItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const syllabusInputRef = useRef<HTMLInputElement>(null);
  // per-subject upload state (비대학생 사용)
  const [pendingUploadSubject, setPendingUploadSubject] = useState<string | null>(null);
  const [subjectUploadingMap, setSubjectUploadingMap] = useState<Record<string, boolean>>({});
  const [showManualInput, setShowManualInput] = useState(false);

  const [selectedType, setSelectedType] = useState<string>('');
  // 비대학생 온보딩 사용
  const [externalExams, setExternalExams] = useState<ExternalExam[]>([]);
  const [personalSchedules, setPersonalSchedules] = useState<PersonalSchedule[]>([]);
  // external-exam 입력 폼 임시 상태
  const [examDraft, setExamDraft] = useState<Omit<ExternalExam, '_id'>>({ name: '', date: '', status: 'studying', progress: '', weak_parts: '' });
  // personal-schedule 입력 폼 임시 상태
  const [scheduleDraft, setScheduleDraft] = useState<Omit<PersonalSchedule, '_id'>>({ title: '', day_of_week: 0, start_time: '', end_time: '', is_recurring: true, date: '' });
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

  // 분석 상태 감시 — pending인 syllabus 주기적 갱신
  useEffect(() => {
    const pendingIds = Object.entries(analysisStatuses)
      .filter(([, s]) => s === 'pending')
      .map(([id]) => Number(id));
    if (pendingIds.length === 0) return;

    const timer = setInterval(async () => {
      for (const id of pendingIds) {
        try {
          const { data } = await api.get<SyllabusAnalysis>(`/syllabi/${id}/analysis`);
          if (data.analysis_status !== 'pending') {
            setAnalysisStatuses((prev) => ({ ...prev, [id]: data.analysis_status }));
            setAnalysisResults((prev) => ({ ...prev, [id]: data }));
          }
        } catch { /* 분석 결과 없음 — 재시도 */ }
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [analysisStatuses]);

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

  const finishOnboarding = async (finalAnswers: Record<string, string>) => {
    setPhase('generating');
    for (let i = 0; i < GENERATING_STEPS.length; i++) {
      setGeneratingStep(i);
      await new Promise((r) => setTimeout(r, i === GENERATING_STEPS.length - 1 ? 800 : 1200));
    }

    try {
      const sleepTimes = parseTime(finalAnswers.sleep || '');
      // 대학생은 type-select 없으므로 'student' 기본값
      const effectiveType = selectedType || 'student';
      await updateProfile.mutateAsync({
        user_type: effectiveType,
        occupation: USER_TYPES.find((t) => t.id === effectiveType)?.label || '',
        sleep_start: sleepTimes.sleep_start,
        sleep_end: sleepTimes.sleep_end,
        goal_tasks: finalAnswers.goal_tasks || '',
        is_college_student: isCollegeStudent ?? false,
        semester_start_date: semesterStartDate || undefined,
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
              source: 'onboarding_external_exam',
              progress_note: exam.progress || null,
              weak_parts: exam.weak_parts || null,
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
              schedule_type: 'event',
              schedule_source: 'user_created',
              // 반복: date 생략(null 저장됨) / 단일: date 전송
              ...(sched.is_recurring ? {} : { date: sched.date || undefined }),
              color: '#f59e0b',
            });
          } catch { /* 개별 일정 등록 실패 시 무시 */ }
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

      // 학습 시간표 생성 (시험 등록 성공 시)
      if (savedExamIds.length > 0) {
        try {
          await api.post('/ai/chat', {
            message: 'generate_exam_prep_schedule \ub4f1\ub85d\ub41c \uc2dc\ud5d8 \uc77c\uc815 \uae30\ubc18\uc73c\ub85c 14\uc77c\uac04 \ud559\uc2b5 \uc2dc\uac04\ud45c\ub97c \ud558\ub8e8 3\uc2dc\uac04\uc529 \uc0dd\uc131\ud574\uc918',
            messages: [],
          });
        } catch { /* ?ㅽ뙣?대룄 ?⑤낫??꾩냽 */ }
      } else if (finalAnswers.goal_tasks && finalAnswers.goal_tasks !== '없음') {
        try {
          await api.post('/ai/chat', {
            message: `${finalAnswers.goal_tasks} \ubaa9\ud45c\ub85c 7\uc77c\uac04 \ud558\ub8e8 2\uc2dc\uac04\uc529 \ud559\uc2b5 \uc77c\uc815\uc73c\ub85c \ub9cc\ub4e4\uc5b4\uc918`,
            messages: [],
          });
        } catch { /* ?ㅽ뙣?대룄 ?⑤낫??꾩냽 */ }
      }

      setPhase('done');
      setTimeout(() => router.push('/dashboard'), 1800);
    } catch {
      toast.error('\uc124\uc815 \uc800\uc7a5 \uc911 \uc624\ub958\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4');
      setPhase('chat');
    }
  };

  const handleTypeSelect = (typeId: string) => {
    setSelectedType(typeId);
    const typeLabel = USER_TYPES.find((t) => t.id === typeId)?.label || '';
    setPhase('chat');
    setStepIdx(0);
    setMessages([
      {
        role: 'ai',
        text: `${typeLabel}\uc774\uc2dc\uad70\uc694! \ubc18\uac11\uc2b5\ub2c8\ub2e4 \ud83d\udc4b

${MOTIVATIONS[typeId] || ''}

AI \ub9de\ucda4 \uc2dc\uac04\ud45c\ub97c \ub9cc\ub4e4\uc5b4\ub4dc\ub9b4\uac8c\uc694 \ud83d\uddd3\ufe0f`,
      },
      { role: 'ai', text: activeSteps[0].question },
    ]);
  };

  /** 대학생 온보딩: personal-schedule 완료 후 chat 진입 */
  const handleCollegeStartChat = () => {
    setPhase('chat');
    setStepIdx(0);
    setMessages([
      {
        role: 'ai',
        text: '\ub300\ud559\uc0dd\uc774\uc2dc\uad70\uc694! \ubc18\uac11\uc2b5\ub2c8\ub2e4 \ud83d\udc4b\n\uc774\uc81c \ud559\uc2b5 \ubaa9\ud45c\uc640 \uc218\uba74 \uc2dc\uac04\uc744 \uc54c\ub824\uc8fc\uc2dc\uba74 AI \ub9de\ucda4 \uc2dc\uac04\ud45c\ub97c \uc644\uc131\ud574\ub4dc\ub9b4\uac8c\uc694',
      },
      { role: 'ai', text: CHAT_STEPS_COLLEGE[0].question },
    ]);
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
              <p className="text-xs" style={{ color: '#747684' }}>1단계 / 3단계</p>
            </div>
          </div>

          {/* Progress */}
          <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#ebeef1' }}>
            <div className="h-full rounded-full" style={{ width: '33%', background: '#1a4db2' }} />
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
                setPhase('syllabus-upload');
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
        setPhase('syllabus-upload');
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
        setPhase('syllabus-upload');
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
              <p className="text-xs" style={{ color: '#747684' }}>2단계 / 3단계 · AI 분석 결과를 확인하고 수정해주세요</p>
            </div>
          </div>

          {/* Progress */}
          <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#ebeef1' }}>
            <div className="h-full rounded-full" style={{ width: '66%', background: '#1a4db2' }} />
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
              onClick={() => { setEtaEntries([]); setPhase('syllabus-upload'); }}
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

  // ?? 과목꾪쉷???낅줈???붾㈃ ??
  if (phase === 'syllabus-upload') {
    const formatSize = (bytes: number | null) => {
      if (!bytes) return '';
      if (bytes < 1024) return `${bytes}B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    };

    // 쇰ぉ꾨줈 ?낅줈?쒕맂 ?뚯씪 몃９??
    const syllabiBySub = uploadedSyllabi.reduce<Record<string, SyllabusItem[]>>((acc, s) => {
      if (!acc[s.subject_name]) acc[s.subject_name] = [];
      acc[s.subject_name].push(s);
      return acc;
    }, {});

    // eta?먯꽌 붿텧???좊땲??쇰ぉ?⑸줉
    const etaSubjects = Array.from(new Set(etaEntries.map((e) => e.subject_name).filter(Boolean)));

    // ?낅줈????꾩꽍 ?곹깭 덇린???ы띁
    const markPending = (id: number) =>
      setAnalysisStatuses((prev) => ({ ...prev, [id]: 'pending' }));

    // 쇰ぉ??낅줈???몃뱾??
    const handleSubjectUpload = async (subjectName: string, file: File) => {
      setSubjectUploadingMap((prev) => ({ ...prev, [subjectName]: true }));
      try {
        const item = await uploadSyllabus.mutateAsync({
          subjectName,
          file,
          source: 'syllabus_upload',
        });
        setUploadedSyllabi((prev) => [...prev, item]);
        markPending(item.id);
        toast.success(`${subjectName} 강의계획서 업로드 완료 · AI 분석 시작`);
      } catch {
        toast.error('업로드에 실패했습니다. 파일 크기(20MB 이하) 및 형식(PDF/이미지)을 확인해주세요');
      } finally {
        setSubjectUploadingMap((prev) => ({ ...prev, [subjectName]: false }));
      }
    };

    // ?섎룞 ?낅젰 ?낅줈???몃뱾??
    const handleManualUpload = async () => {
      if (!syllabusSubject.trim() || !syllabusFile) return;
      setIsUploading(true);
      try {
        const item = await uploadSyllabus.mutateAsync({
          subjectName: syllabusSubject.trim(),
          file: syllabusFile,
          source: 'syllabus_upload',
        });
        setUploadedSyllabi((prev) => [...prev, item]);
        markPending(item.id);
        setSyllabusSubject('');
        setSyllabusFile(null);
        if (syllabusInputRef.current) syllabusInputRef.current.value = '';
        toast.success(`${item.subject_name} 강의계획서 업로드 완료 · AI 분석 시작`);
      } catch {
        toast.error('업로드에 실패했습니다.');
      } finally {
        setIsUploading(false);
      }
    };

    // ?щ텇???몃뱾??
    const handleReAnalyze = async (syllabusId: number) => {
      setAnalysisStatuses((prev) => ({ ...prev, [syllabusId]: 'pending' }));
      try {
        await reAnalyzeSyllabus.mutateAsync(syllabusId);
        toast.success('다시 분석을 시작했습니다.');
      } catch {
        toast.error('다시 분석 요청이 실패했습니다.');
        setAnalysisStatuses((prev) => ({ ...prev, [syllabusId]: 'failed' }));
      }
    };

    // 꾩꽍 ?곹깭 곗? 댄룷?뚰듃
    const AnalysisBadge = ({ syllabusId }: { syllabusId: number }) => {
      const statusInState = analysisStatuses[syllabusId];
      if (!statusInState) return null;

      if (statusInState === 'pending') {
        return (
          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>
            <span className="w-2.5 h-2.5 border border-t-transparent rounded-full animate-spin inline-block" style={{ borderColor: '#d97706', borderTopColor: 'transparent' }} />
            분석 중
          </span>
        );
      }
      if (statusInState === 'success' || statusInState === 'partial') {
        return (
          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: '#d1fae5', color: '#065f46' }}>
            <span className="ms text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            분석 완료
          </span>
        );
      }
      if (statusInState === 'quota_exceeded') {
        return (
          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>
            <span className="ms text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
            AI 일일 한도 초과 · 내일 다시 시도
          </span>
        );
      }
      if (statusInState === 'failed') {
        return (
          <button
            onClick={() => handleReAnalyze(syllabusId)}
            className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors"
            style={{ background: '#fee2e2', color: '#dc2626', border: 'none', cursor: 'pointer' }}
          >
            <span className="ms text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>refresh</span>
            다시 분석
          </button>
        );
      }
      return null;
    };

    // ?시험 ?먮룞 ?깅줉 ?몃뱾??
    const handleAutoCreateExam = async (syllabusId: number) => {
      try {
        const result = await autoCreateExam.mutateAsync({ syllabusId, semesterStartDate: semesterStartDate || undefined });
        setExamRegistered((prev) => ({ ...prev, [syllabusId]: true }));
        if (result.created > 0) {
          toast.success(`${result.created}개 시험 일정을 등록했습니다 🎉`);
        } else if (result.exams.length > 0) {
          toast('시험 일정이 이미 등록되어 있습니다.');
        } else {
          toast('시험 날짜 정보가 없습니다. 학기 시작일을 입력하면 주차 기반으로 계산됩니다.');
        }
      } catch {
        toast.error('시험 등록에 실패했습니다.');
      }
    };

    // 꾩꽍 ?꾨즺 ???꾨━??⑤꼸
    const AnalysisPreviewPanel = ({ syllabusId }: { syllabusId: number }) => {
      const result = analysisResults[syllabusId];
      const status = analysisStatuses[syllabusId];
      if (!result || (status !== 'success' && status !== 'partial')) return null;

      const eval_ = result.evaluation;
      const exams = result.exam_schedule || [];
      const hasExamInfo = exams.length > 0 || result.midterm_week || result.final_week;
      const alreadyRegistered = examRegistered[syllabusId];

      return (
        <div className="mt-2 rounded-xl overflow-hidden" style={{ background: '#f7fafd', border: '1px solid #ebeef1' }}>
          {/* ?됯? 꾩쑉 */}
          {eval_ && (
            <div className="px-3 py-2.5" style={{ borderBottom: hasExamInfo ? '1px solid #f1f4f7' : 'none' }}>
              <p className="text-xs font-bold mb-1.5" style={{ color: '#434653' }}>평가 구성</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: '중간', value: eval_.midterm },
                  { label: '기말', value: eval_.final },
                  { label: '과제', value: eval_.assignment },
                  { label: '출석', value: eval_.attendance },
                  { label: '발표', value: eval_.presentation },
                ]
                  .filter((item) => item.value != null && item.value > 0)
                  .map((item) => (
                    <span key={item.label} className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: '#eef1ff', color: '#1a4db2' }}>
                      {item.label} {item.value}%
                    </span>
                  ))}
              </div>
            </div>
          )}
          {/* ?시험 ?일정 + ?깅줉 꾪듉 */}
          {hasExamInfo && (
            <div className="px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-bold" style={{ color: '#434653' }}>시험 일정</p>
                <button
                  onClick={() => handleAutoCreateExam(syllabusId)}
                  disabled={alreadyRegistered || autoCreateExam.isPending}
                  className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-lg transition-colors"
                  style={{
                    background: alreadyRegistered ? '#d1fae5' : '#1a4db2',
                    color: alreadyRegistered ? '#065f46' : '#fff',
                    border: 'none',
                    cursor: alreadyRegistered ? 'default' : 'pointer',
                    opacity: autoCreateExam.isPending ? 0.6 : 1,
                  }}
                >
                  <span className="ms text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {alreadyRegistered ? 'check_circle' : 'add_circle'}
                  </span>
                  {alreadyRegistered ? '등록 완료' : '시험 등록'}
                </button>
              </div>
              {exams.length > 0 ? (
                <div className="space-y-1">
                  {exams.map((e, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs" style={{ color: '#434653' }}>
                      <span className="ms text-xs" style={{ color: '#1a4db2', fontVariationSettings: "'FILL' 1" }}>event</span>
                      <span className="font-semibold">{e.type === 'midterm' ? '중간고사' : e.type === 'final' ? '기말고사' : String(e.type)}</span>
                      <span style={{ color: '#747684' }}>{String(e.date || '')}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs" style={{ color: '#747684' }}>
                  {result.midterm_week && `중간고사: ${result.midterm_week}주차`}
                  {result.midterm_week && result.final_week && ' / '}
                  {result.final_week && `기말고사: ${result.final_week}주차`}
                  {!semesterStartDate && ' (학기 시작일 입력 시 날짜 자동 계산)'}
                </p>
              )}
            </div>
          )}
        </div>
      );
    };

    // ??젣: ?ㅼ젣 DELETE API ?몄텧 + 쒖뺄 state ?숆린??
    const handleRemoveSyllabus = async (id: number) => {
      try {
        await api.delete(`/syllabi/${id}`);
        setUploadedSyllabi((prev) => prev.filter((s) => s.id !== id));
      } catch {
        toast.error('삭제에 실패했습니다.');
      }
    };

    // ??숈깮 + eta 쇰ぉ ?덈뒗 경우: 쇰ぉ ?곌껐 UI
    const useSubjectLinkedUI = isCollegeStudent && etaSubjects.length > 0;

    const backTarget: Phase = isCollegeStudent ? 'eta-review' : 'college-check';

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: 'linear-gradient(135deg, #f7fafd 0%, #eef1ff 100%)' }}>
        {/* ?④꺼??뚯씪 ?낅젰 ??쇰ぉ??낅줈??듭슜 */}
        <input
          ref={syllabusInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            if (pendingUploadSubject) {
              await handleSubjectUpload(pendingUploadSubject, f);
              setPendingUploadSubject(null);
            } else {
              setSyllabusFile(f);
            }
          }}
        />

        <div className="w-full max-w-lg">
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
              <h2 className="font-extrabold text-lg" style={{ color: '#181c1e' }}>강의계획서 업로드</h2>
              <p className="text-xs" style={{ color: '#747684' }}>
                {useSubjectLinkedUI ? '3단계 / 3단계 · 선택 사항' : '선택 사항 · 나중에 추가할 수도 있어요'}
              </p>
            </div>
          </div>

          {/* Progress */}
          {useSubjectLinkedUI && (
            <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#ebeef1' }}>
              <div className="h-full rounded-full" style={{ width: '100%', background: '#1a4db2' }} />
            </div>
          )}

          {/* Info banner */}
          <div className="rounded-2xl p-4 mb-5 flex items-start gap-3" style={{ background: '#eef1ff', border: '1px solid #c3d0ff' }}>
            <span className="ms text-2xl flex-shrink-0 mt-0.5" style={{ color: '#1a4db2', fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
            <div>
              <p className="text-sm font-bold mb-1" style={{ color: '#1a4db2' }}>강의계획서로 AI가 더 정확하게 분석해요</p>
              <p className="text-xs leading-relaxed" style={{ color: '#434653' }}>
                시험 일정, 과제 분량, 주차별 내용을 분석해서 더 스마트한 학습 계획을 만들어요. PDF나 이미지를 지원합니다.
              </p>
            </div>
          </div>

          {/* ?숆린 ?쒖옉???낅젰 */}
          <div className="rounded-2xl p-4 mb-4" style={{ background: '#fff', border: '1px solid #ebeef1', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="ms text-base" style={{ color: '#1a4db2', fontVariationSettings: "'FILL' 1" }}>calendar_today</span>
              <p className="text-sm font-bold" style={{ color: '#181c1e' }}>학기 시작일</p>
              <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: '#f1f4f7', color: '#747684' }}>선택</span>
            </div>
            <p className="text-xs mb-3" style={{ color: '#747684' }}>시험 주차의 실제 날짜를 자동 계산할 때 사용합니다</p>
            <input
              type="date"
              value={semesterStartDate}
              onChange={(e) => setSemesterStartDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border-2 rounded-xl outline-none transition-colors"
              style={{ borderColor: semesterStartDate ? '#1a4db2' : '#ebeef1', color: '#181c1e' }}
              onFocus={(e) => e.target.style.borderColor = '#1a4db2'}
              onBlur={(e) => e.target.style.borderColor = semesterStartDate ? '#1a4db2' : '#ebeef1'}
            />
          </div>

          {/* ?? 쇰ぉ ?곌껐 UI (??숈깮 + eta 쇰ぉ ?덉쓣 ?? ?? */}
          {useSubjectLinkedUI && (
            <div className="rounded-2xl overflow-hidden mb-4" style={{ background: '#fff', border: '1px solid #ebeef1', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid #f1f4f7', background: '#fafbfc' }}>
                <p className="text-sm font-bold" style={{ color: '#181c1e' }}>등록된 과목</p>
                <p className="text-xs" style={{ color: '#747684' }}>{etaSubjects.length}개 과목</p>
              </div>

              <div className="divide-y" style={{ borderColor: '#f1f4f7' }}>
                {etaSubjects.map((subjectName) => {
                  const files = syllabiBySub[subjectName] || [];
                  const isLoading = subjectUploadingMap[subjectName] ?? false;

                  return (
                    <div key={subjectName} className="p-4">
                      {/* 쇰ぉ?+ ?곹깭 */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="ms text-base" style={{ color: '#1a4db2', fontVariationSettings: "'FILL' 1" }}>
                            {files.length > 0 ? 'task_alt' : 'menu_book'}
                          </span>
                          <span className="text-sm font-bold" style={{ color: '#181c1e' }}>{subjectName}</span>
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{
                          background: files.length > 0 ? '#d1fae5' : '#f1f4f7',
                          color: files.length > 0 ? '#065f46' : '#747684',
                        }}>
                          {files.length > 0 ? `${files.length}개 파일` : '없음'}
                        </span>
                      </div>

                      {/* ?낅줈?쒕맂 ?뚯씪 ⑸줉 */}
                      {files.length > 0 && (
                        <div className="space-y-1.5 mb-2">
                          {files.map((f) => (
                            <div key={f.id} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: '#f7fafd', border: '1px solid #ebeef1' }}>
                              <span className="ms text-sm flex-shrink-0" style={{ color: '#1a4db2', fontVariationSettings: "'FILL' 1" }}>description</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold truncate" style={{ color: '#181c1e' }}>{f.original_filename}</p>
                                <p className="text-xs" style={{ color: '#9ca3af' }}>
                                  {formatSize(f.file_size)}{f.file_size ? ' 쨌 ' : ''}{new Date(f.uploaded_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                              <AnalysisBadge syllabusId={f.id} />
                              <button
                                onClick={() => handleRemoveSyllabus(f.id)}
                                className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition-colors"
                                style={{ background: '#fee2e2', color: '#dc2626' }}
                                title="??젣"
                              >
                                <span className="ms text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>close</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ?낅줈??꾪듉 */}
                      <button
                        onClick={() => {
                          setPendingUploadSubject(subjectName);
                          syllabusInputRef.current?.click();
                        }}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                        style={{
                          background: isLoading ? '#f1f4f7' : '#eef1ff',
                          color: isLoading ? '#9ca3af' : '#1a4db2',
                          border: 'none',
                          cursor: isLoading ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {isLoading ? (
                          <>
                            <div className="w-3 h-3 border border-t-transparent rounded-full animate-spin" style={{ borderColor: '#9ca3af', borderTopColor: 'transparent' }} />
                            ?낅줈???..
                          </>
                        ) : (
                          <>
                            <span className="ms text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>attach_file</span>
                            {files.length > 0 ? '파일 추가' : '파일 선택'}
                          </>
                        )}
                      </button>

                      {/* 꾩꽍 곌낵 ?꾨━?(?낅줈?쒕맂 ?뚯씪덈떎) */}
                      {files.map((f) => <AnalysisPreviewPanel key={f.id} syllabusId={f.id} />)}
                    </div>
                  );
                })}
              </div>

              {/* 곸젒 붽? ?좉? */}
              <div className="px-4 py-3" style={{ borderTop: '1px solid #f1f4f7' }}>
                <button
                  onClick={() => setShowManualInput((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold"
                  style={{ color: '#747684', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <span className="ms text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {showManualInput ? 'expand_less' : 'expand_more'}
                  </span>
                  목록에 없는 과목 직접 추가
                </button>
              </div>
            </div>
          )}

          {/* ?? ?섎룞 ?낅젰 ??(꾨??숈깮 ?먮뒗 곸젒 붽? ?좉? ?? ?? */}
          {(!useSubjectLinkedUI || showManualInput) && (
            <div className="rounded-2xl p-4 mb-4" style={{ background: '#fff', border: '1px solid #ebeef1', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
              <p className="text-sm font-bold mb-3" style={{ color: '#181c1e' }}>
                {useSubjectLinkedUI ? '직접 과목 입력' : '강의계획서 추가'}
              </p>
              <div className="space-y-3">
                <input
                  type="text"
                  className="w-full px-3 py-2.5 text-sm border-2 rounded-xl outline-none transition-colors"
                  style={{ borderColor: '#ebeef1' }}
                  onFocus={(e) => e.target.style.borderColor = '#1a4db2'}
                  onBlur={(e) => e.target.style.borderColor = '#ebeef1'}
                  placeholder="과목명 (예: 자료구조, 운영체제)"
                  value={syllabusSubject}
                  onChange={(e) => setSyllabusSubject(e.target.value)}
                />
                <div
                  className="flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed cursor-pointer transition-colors"
                  style={{ borderColor: syllabusFile ? '#1a4db2' : '#d1d5db', background: syllabusFile ? '#eef1ff' : '#fafbfc' }}
                  onClick={() => { setPendingUploadSubject(null); syllabusInputRef.current?.click(); }}
                >
                  <span className="ms text-xl flex-shrink-0" style={{ color: syllabusFile ? '#1a4db2' : '#9ca3af', fontVariationSettings: "'FILL' 1" }}>
                    {syllabusFile ? 'description' : 'upload_file'}
                  </span>
                  <div className="flex-1 min-w-0">
                    {syllabusFile ? (
                      <p className="text-sm font-semibold truncate" style={{ color: '#1a4db2' }}>{syllabusFile.name}</p>
                    ) : (
                      <p className="text-sm" style={{ color: '#9ca3af' }}>PDF, 이미지 파일 선택 (최대 20MB)</p>
                    )}
                  </div>
                  {syllabusFile && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setSyllabusFile(null); }}
                      style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}
                    >×</button>
                  )}
                </div>
                <button
                  onClick={handleManualUpload}
                  disabled={!syllabusSubject.trim() || !syllabusFile || isUploading}
                  className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all"
                  style={{
                    background: (!syllabusSubject.trim() || !syllabusFile || isUploading) ? '#d1d5db' : '#1a4db2',
                    cursor: (!syllabusSubject.trim() || !syllabusFile || isUploading) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isUploading ? '업로드 중...' : '+ 강의계획서 추가'}
                </button>
              </div>

              {/* 꾨??숈깮: ?낅줈?쒕맂 ?뚯씪 ⑸줉 (쇰ぉ ?곌껐 UI?먯꽑 대뱶?먯꽌 ? */}
              {!useSubjectLinkedUI && uploadedSyllabi.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-bold mb-2" style={{ color: '#747684' }}>업로드 완료 ({uploadedSyllabi.length}개)</p>
                  {uploadedSyllabi.map((s) => (
                    <div key={s.id}>
                      <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: '#f7fafd', border: '1px solid #ebeef1' }}>
                        <span className="ms text-lg flex-shrink-0" style={{ color: '#1a4db2', fontVariationSettings: "'FILL' 1" }}>description</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate" style={{ color: '#181c1e' }}>{s.subject_name}</p>
                          <p className="text-xs truncate" style={{ color: '#747684' }}>
                            {s.original_filename}{s.file_size ? ` 쨌 ${formatSize(s.file_size)}` : ''}
                          </p>
                        </div>
                        <AnalysisBadge syllabusId={s.id} />
                        <button
                          onClick={() => handleRemoveSyllabus(s.id)}
                          style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}
                        >×</button>
                      </div>
                      <AnalysisPreviewPanel syllabusId={s.id} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex gap-3">
            <button
              onClick={() => setPhase(isCollegeStudent ? 'external-exam' : 'type-select')}
              className="flex-1 py-3 rounded-xl text-sm font-semibold border"
              style={{ color: '#747684', borderColor: '#ebeef1', background: '#fff' }}
            >
              건너뛰기
            </button>
            <button
              onClick={() => setPhase(isCollegeStudent ? 'external-exam' : 'type-select')}
              className="flex-1 py-3 rounded-xl text-sm font-bold text-white"
              style={{ background: '#1a4db2' }}
            >
              {uploadedSyllabi.length > 0 ? `${uploadedSyllabi.length}개 완료 →` : '나중에 추가하고 계속'}
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
    const EXAM_EXAMPLES = ['토익', '정보처리기사', '수능', '공무원', '어학'];
    const canAddExam = examDraft.name.trim() && examDraft.date;

    const addExam = () => {
      if (!canAddExam) return;
      setExternalExams((prev) => [...prev, { ...examDraft, _id: `ex-${Date.now()}` }]);
      setExamDraft({ name: '', date: '', status: 'studying', progress: '', weak_parts: '' });
    };

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: 'linear-gradient(135deg, #f7fafd 0%, #eef1ff 100%)' }}>
        <div className="w-full max-w-lg">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => setPhase('syllabus-upload')} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#fff', border: '1px solid #ebeef1' }}>
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

            {/* ?낅젰 ?꾨뱶 */}
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
              {/* ?꾩옱 ?곹깭 */}
              <div className="flex gap-2">
                {(['starting', 'studying'] as const).map((s) => (
                  <button key={s} onClick={() => setExamDraft((d) => ({ ...d, status: s }))}
                    className="flex-1 py-2 text-xs rounded-xl font-semibold border-2 transition-colors"
                    style={{ borderColor: examDraft.status === s ? '#1a4db2' : '#ebeef1', background: examDraft.status === s ? '#eef1ff' : '#fff', color: examDraft.status === s ? '#1a4db2' : '#747684' }}>
                    {s === 'starting' ? '처음 시작' : '공부 중'}
                  </button>
                ))}
              </div>
              <input
                className="w-full px-4 py-2.5 text-sm border-2 rounded-xl outline-none"
                style={{ borderColor: '#ebeef1' }}
                placeholder="현재 진도 (예: 3장 완료)"
                value={examDraft.progress}
                onChange={(e) => setExamDraft((d) => ({ ...d, progress: e.target.value }))}
                onFocus={(e) => e.target.style.borderColor = '#1a4db2'}
                onBlur={(e) => e.target.style.borderColor = '#ebeef1'}
              />
              <input
                className="w-full px-4 py-2.5 text-sm border-2 rounded-xl outline-none"
                style={{ borderColor: '#ebeef1' }}
                placeholder="취약 파트 (예: 그래프, DP)"
                value={examDraft.weak_parts}
                onChange={(e) => setExamDraft((d) => ({ ...d, weak_parts: e.target.value }))}
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

          {/* 붽????시험 ⑸줉 */}
          {externalExams.length > 0 && (
            <div className="space-y-2 mb-5">
              {externalExams.map((ex) => (
                <div key={ex._id} className="flex items-center justify-between p-3 rounded-xl" style={{ background: '#eef1ff', border: '1px solid #c3d0ff' }}>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: '#1a4db2' }}>{ex.name}</p>
                    <p className="text-xs" style={{ color: '#434653' }}>{ex.date} · {ex.status === 'starting' ? '처음 시작' : '공부 중'}</p>
                  </div>
                  <button onClick={() => setExternalExams((prev) => prev.filter((e) => e._id !== ex._id))}>
                    <span className="ms text-base" style={{ color: '#747684' }}>close</span>
                  </button>
                </div>
              ))}
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
              onClick={() => setPhase(isCollegeStudent ? 'syllabus-upload' : 'college-check')}
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

  // ?? 꾪똿 ?붾㈃ ??
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