'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useUpdateProfile } from '@/hooks/useProfile';

type Phase = 'type-select' | 'chat' | 'generating' | 'done';
type Message = { role: 'ai' | 'user'; text: string };

const USER_TYPES = [
  {
    id: 'exam_prep',
    label: '시험 준비생',
    icon: 'menu_book',
    desc: '수능, 편입, 자격증 등 시험을 준비 중입니다',
    color: '#c3d0ff',
    iconColor: '#1a4db2',
  },
  {
    id: 'civil_service',
    label: '공시생',
    icon: 'account_balance',
    desc: '공무원 시험을 준비하고 있습니다',
    color: '#ffdcc6',
    iconColor: '#844000',
  },
  {
    id: 'student',
    label: '학생',
    icon: 'school',
    desc: '대학교 또는 대학원에 재학 중입니다',
    color: '#d1fae5',
    iconColor: '#065f46',
  },
  {
    id: 'worker',
    label: '직장인',
    icon: 'work',
    desc: '회사에 다니며 자기계발을 합니다',
    color: '#fef3c7',
    iconColor: '#92400e',
  },
];

const CHAT_STEPS = [
  {
    key: 'goal_tasks',
    question: '어떤 목표나 과목을 주로 공부하시나요?\n\n예시:\n"알고리즘, 운영체제, 영어"\n"행정법, 헌법, 한국사"\n"토익, 자격증 준비"',
    hint: '목표 과목/작업을 입력하세요',
    quick: ['직접 입력할게요'],
  },
  {
    key: 'schedule',
    question: '고정된 수업이나 반복 일정이 있나요?\n\n예시:\n"월수금 9시-11시 알고리즘 수업"\n"화목 14시-16시 영어"\n\n없으면 "없음"을 선택하세요.',
    hint: '고정 일정을 입력하세요',
    quick: ['없음'],
  },
  {
    key: 'exam',
    question: '가까운 시험 일정이 있나요?\n\n예시:\n"4월 15일 알고리즘 중간고사"\n"5월 20일 영어 기말시험"\n\n없으면 "없음"을 선택하세요.',
    hint: '시험 일정을 입력하세요',
    quick: ['없음'],
  },
  {
    key: 'sleep',
    question: '평소 수면 패턴을 알려주세요.\n취침 시간과 기상 시간을 입력해주세요.',
    hint: '예: 밤 11시 취침, 아침 7시 기상',
    quick: ['23시 취침, 7시 기상', '24시 취침, 8시 기상', '1시 취침, 8시 기상'],
  },
];

const MOTIVATIONS: Record<string, string> = {
  exam_prep: '매일 조금씩, 반드시 합격합니다 💪',
  civil_service: '꾸준함이 실력입니다. 오늘도 화이팅! 🔥',
  student: '지금의 노력이 미래를 만듭니다 📚',
  worker: '성장하는 당신, 대단합니다 🌱',
};

export default function OnboardingPage() {
  const router = useRouter();
  const updateProfile = useUpdateProfile();

  const [phase, setPhase] = useState<Phase>('type-select');
  const [selectedType, setSelectedType] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [generatingStep, setGeneratingStep] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  const GENERATING_STEPS = [
    '입력하신 정보를 분석하고 있습니다...',
    '최적의 시간표를 설계하고 있습니다...',
    '시험 일정과 수면 패턴을 반영하고 있습니다...',
    'SKEMA가 준비되었습니다! 🎉',
  ];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 유저 타입 선택 후 채팅 시작
  const handleTypeSelect = (typeId: string) => {
    setSelectedType(typeId);
    const typeLabel = USER_TYPES.find((t) => t.id === typeId)?.label || '';
    setPhase('chat');
    setMessages([
      {
        role: 'ai',
        text: `${typeLabel}이시군요! 반갑습니다 😊\n\n${MOTIVATIONS[typeId] || ''}\n\n몇 가지 질문에 답해주시면 AI가 맞춤 시간표를 만들어드릴게요.`,
      },
      { role: 'ai', text: CHAT_STEPS[0].question },
    ]);
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

    // 생성 단계 애니메이션
    for (let i = 0; i < GENERATING_STEPS.length; i++) {
      setGeneratingStep(i);
      await new Promise((r) => setTimeout(r, i === GENERATING_STEPS.length - 1 ? 800 : 1200));
    }

    try {
      const sleepTimes = parseTime(finalAnswers.sleep || '');
      await updateProfile.mutateAsync({
        user_type: selectedType,
        occupation: USER_TYPES.find((t) => t.id === selectedType)?.label || '',
        sleep_start: sleepTimes.sleep_start,
        sleep_end: sleepTimes.sleep_end,
        goal_tasks: finalAnswers.goal_tasks || '',
        onboarding_completed: true,
      });

      // AI로 일정 등록
      const scheduleText = finalAnswers.schedule;
      if (scheduleText && scheduleText !== '없음') {
        try {
          await api.post('/ai/chat', {
            message: `다음 수업/고정 일정을 등록해줘: ${scheduleText}`,
            messages: [],
          });
        } catch { /* 실패해도 온보딩은 계속 */ }
      }

      const examText = finalAnswers.exam;
      if (examText && examText !== '없음') {
        try {
          await api.post('/ai/chat', {
            message: `다음 시험 일정을 등록해줘: ${examText}`,
            messages: [],
          });
        } catch { /* 실패해도 온보딩은 계속 */ }
      }

      setPhase('done');
      setTimeout(() => router.push('/dashboard'), 1800);
    } catch {
      toast.error('설정 저장 중 오류가 발생했습니다');
      setPhase('chat');
    }
  };

  const handleSend = async (text?: string) => {
    const userText = (text ?? input).trim();
    if (!userText || isProcessing) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: userText }]);

    const newAnswers = { ...answers, [CHAT_STEPS[stepIdx].key]: userText };
    setAnswers(newAnswers);
    const nextIdx = stepIdx + 1;

    if (nextIdx < CHAT_STEPS.length) {
      setStepIdx(nextIdx);
      setIsProcessing(true);
      setTimeout(() => {
        setMessages((prev) => [...prev, { role: 'ai', text: CHAT_STEPS[nextIdx].question }]);
        setIsProcessing(false);
      }, 500);
    } else {
      setIsProcessing(true);
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          { role: 'ai', text: '완벽합니다! AI가 맞춤 시간표를 생성하고 있습니다 ✨' },
        ]);
        setIsProcessing(false);
        finishOnboarding(newAnswers);
      }, 500);
    }
  };

  const handleSkip = () => {
    updateProfile.mutate(
      { onboarding_completed: true },
      {
        onSuccess: () => router.push('/dashboard'),
        onError: () => router.push('/dashboard'),
      }
    );
  };

  // ── 유저 타입 선택 화면 ──
  if (phase === 'type-select') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: 'linear-gradient(135deg, #f7fafd 0%, #eef1ff 100%)' }}>
        <div className="w-full max-w-lg">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ background: '#1a4db2' }}>
              <span className="ms text-white text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>schedule</span>
            </div>
            <h1 className="text-2xl font-extrabold mb-2" style={{ color: '#181c1e' }}>SKEMA에 오신 걸 환영합니다!</h1>
            <p className="text-sm" style={{ color: '#434653' }}>나에게 맞는 유형을 선택하면 AI가 최적의 시간표를 설계해드립니다.</p>
          </div>

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

  // ── AI 시간표 생성 중 화면 ──
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
            {phase === 'done' ? 'SKEMA 준비 완료! 🎉' : 'AI가 시간표를 짜는 중...'}
          </h2>

          {phase !== 'done' && (
            <div className="space-y-2 mt-6">
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
            <p className="text-sm mt-4" style={{ color: '#434653' }}>대시보드로 이동합니다...</p>
          )}
        </div>
      </div>
    );
  }

  // ── 채팅 화면 ──
  const currentStep = CHAT_STEPS[stepIdx];
  const progress = ((stepIdx) / CHAT_STEPS.length) * 100;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #f7fafd 0%, #eef1ff 100%)' }}>
      <div className="w-full max-w-lg flex flex-col" style={{ height: '85vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPhase('type-select')}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors"
            >
              <span className="ms text-lg" style={{ color: '#434653' }}>arrow_back</span>
            </button>
            <div>
              <p className="font-bold text-sm" style={{ color: '#181c1e' }}>
                {USER_TYPES.find((t) => t.id === selectedType)?.label} 맞춤 설정
              </p>
              <p className="text-xs" style={{ color: '#747684' }}>{stepIdx + 1} / {CHAT_STEPS.length} 단계</p>
            </div>
          </div>
          <button
            onClick={handleSkip}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors"
            style={{ color: '#747684', borderColor: '#ebeef1' }}
          >
            건너뛰기
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
            placeholder={currentStep?.hint || '입력하세요...'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={isProcessing}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isProcessing}
            className="px-5 py-3 rounded-xl text-sm font-bold text-white transition-all"
            style={{
              background: (!input.trim() || isProcessing) ? '#d1d5db' : '#1a4db2',
              cursor: (!input.trim() || isProcessing) ? 'not-allowed' : 'pointer',
            }}
          >
            전송
          </button>
        </div>
      </div>
    </div>
  );
}
