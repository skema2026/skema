'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useUpdateProfile } from '@/hooks/useProfile';

type Message = { role: 'ai' | 'user'; text: string };

// 단계별 AI 질문
const STEPS = [
  {
    key: 'occupation',
    question: '안녕하세요! SKEMA에 오신 걸 환영합니다 😊\n\n먼저 직업 또는 신분을 알려주세요.\n(예: 학생, 직장인, 프리랜서 등)',
    hint: '직업을 입력하세요',
    quick: ['학생', '직장인', '프리랜서', '기타'],
  },
  {
    key: 'schedule',
    question: '반복되는 수업이나 고정 일정이 있나요?\n\n있다면 알려주세요. 예를 들어:\n"월수금 9시-11시 알고리즘 수업"\n"화목 14시-16시 영어"\n\n없으면 "없음"이라고 입력해주세요.',
    hint: '수업/고정 일정을 입력하세요 (없으면 "없음")',
    quick: ['없음'],
  },
  {
    key: 'exam',
    question: '가까운 시험 일정이 있나요?\n\n있다면 알려주세요. 예를 들어:\n"4월 15일 알고리즘 중간고사"\n"5월 20일 영어 기말시험"\n\n없으면 "없음"이라고 입력해주세요.',
    hint: '시험 일정을 입력하세요 (없으면 "없음")',
    quick: ['없음'],
  },
  {
    key: 'sleep',
    question: '평소 수면 시간을 알려주세요.\n\n취침 시간과 기상 시간을 입력해주세요. 예를 들어:\n"밤 11시 취침, 아침 7시 기상"\n"새벽 1시 취침, 오전 8시 기상"',
    hint: '수면 시간을 입력하세요',
    quick: ['23시 취침, 7시 기상', '24시 취침, 8시 기상', '1시 취침, 8시 기상'],
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const updateProfile = useUpdateProfile();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 첫 질문 표시
  useEffect(() => {
    setMessages([{ role: 'ai', text: STEPS[0].question }]);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const parseTime = (text: string): { sleep_start: string; sleep_end: string } => {
    // 숫자 추출: "23시 취침, 7시 기상" → sleep_start=23:00, sleep_end=07:00
    const nums = text.match(/\d+/g)?.map(Number) || [];
    const toHHMM = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;
    return {
      sleep_start: nums[0] !== undefined ? toHHMM(nums[0]) : '23:00',
      sleep_end: nums[1] !== undefined ? toHHMM(nums[1]) : '07:00',
    };
  };

  const finishOnboarding = async (finalAnswers: Record<string, string>) => {
    setIsProcessing(true);
    try {
      const sleepTimes = parseTime(finalAnswers.sleep || '');
      await updateProfile.mutateAsync({
        occupation: finalAnswers.occupation || '',
        sleep_start: sleepTimes.sleep_start,
        sleep_end: sleepTimes.sleep_end,
        onboarding_completed: true,
      });

      // 시험 일정 등록 (AI에게 위임)
      const examText = finalAnswers.exam;
      if (examText && examText !== '없음') {
        try {
          await api.post('/ai/chat', {
            message: `다음 시험 일정을 등록해줘: ${examText}`,
            messages: [],
          });
        } catch { /* 실패해도 온보딩은 계속 */ }
      }

      // 수업 일정 등록 (AI에게 위임)
      const scheduleText = finalAnswers.schedule;
      if (scheduleText && scheduleText !== '없음') {
        try {
          await api.post('/ai/chat', {
            message: `다음 수업 일정을 등록해줘: ${scheduleText}`,
            messages: [],
          });
        } catch { /* 실패해도 온보딩은 계속 */ }
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          text: '모든 정보가 저장되었습니다! 이제 SKEMA와 함께 스마트한 시간 관리를 시작해보세요 🎉\n\n잠시 후 대시보드로 이동합니다.',
        },
      ]);
      setIsDone(true);
      setTimeout(() => router.push('/dashboard'), 2000);
    } catch {
      toast.error('설정 저장 중 오류가 발생했습니다');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSend = async (text?: string) => {
    const userText = (text ?? input).trim();
    if (!userText || isProcessing || isDone) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: userText }]);

    const newAnswers = { ...answers, [STEPS[stepIdx].key]: userText };
    setAnswers(newAnswers);

    const nextIdx = stepIdx + 1;

    if (nextIdx < STEPS.length) {
      setStepIdx(nextIdx);
      setTimeout(() => {
        setMessages((prev) => [...prev, { role: 'ai', text: STEPS[nextIdx].question }]);
      }, 400);
    } else {
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          { role: 'ai', text: '감사합니다! 입력하신 정보를 저장하고 있습니다...' },
        ]);
        finishOnboarding(newAnswers);
      }, 400);
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

  const currentStep = STEPS[stepIdx];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-purple-50 p-4">
      <div className="w-full max-w-lg flex flex-col" style={{ height: '80vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ background: 'var(--skema-primary)' }}>
              AI
            </div>
            <div>
              <p className="font-bold text-sm" style={{ color: 'var(--skema-on-surface)' }}>SKEMA 온보딩</p>
              <p className="text-xs text-gray-400">
                {isDone ? '완료' : `${stepIdx + 1} / ${STEPS.length} 단계`}
              </p>
            </div>
          </div>
          {!isDone && (
            <button
              onClick={handleSkip}
              className="text-xs font-semibold text-gray-500 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-lg px-3 py-1.5 transition-all"
            >
              건너뛰기
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full h-1 bg-gray-200 rounded-full mb-4">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${((stepIdx + (isDone ? 1 : 0)) / STEPS.length) * 100}%`, background: 'var(--skema-primary)' }}
          />
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 mb-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'ai' && (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mr-2 mt-1 flex-shrink-0 text-white" style={{ background: 'var(--skema-primary)' }}>
                  AI
                </div>
              )}
              <div
                className="max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed"
                style={
                  msg.role === 'user'
                    ? { background: 'var(--skema-primary)', color: '#fff', borderTopRightRadius: 4 }
                    : { background: '#f1f3f5', color: '#1a1a2e', borderTopLeftRadius: 4 }
                }
              >
                {msg.text}
              </div>
            </div>
          ))}
          {isProcessing && (
            <div className="flex justify-start">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mr-2 mt-1 flex-shrink-0 text-white" style={{ background: 'var(--skema-primary)' }}>AI</div>
              <div className="rounded-2xl rounded-tl-sm px-4 py-3 bg-gray-100">
                <div className="flex gap-1">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Quick replies */}
        {!isDone && !isProcessing && currentStep?.quick && (
          <div className="flex flex-wrap gap-2 mb-3">
            {currentStep.quick.map((q) => (
              <button
                key={q}
                onClick={() => handleSend(q)}
                className="px-3 py-1.5 text-xs rounded-full border-2 font-medium transition-all hover:border-indigo-400 hover:text-indigo-600"
                style={{ borderColor: 'var(--skema-container)', color: 'var(--skema-on-surface-variant)' }}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        {!isDone && (
          <>
            <div className="flex gap-2">
              <input
                className="flex-1 px-4 py-3 text-sm border-2 rounded-xl outline-none focus:border-indigo-400 transition-colors"
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
                  background: (!input.trim() || isProcessing) ? '#d1d5db' : 'var(--skema-primary)',
                  cursor: (!input.trim() || isProcessing) ? 'not-allowed' : 'pointer',
                }}
              >
                전송
              </button>
            </div>
            <button
              onClick={handleSkip}
              disabled={isProcessing}
              className="mt-3 w-full py-2.5 rounded-xl text-sm font-medium text-gray-500 border border-gray-200 hover:border-gray-300 hover:text-gray-700 hover:bg-gray-50 transition-all"
            >
              온보딩 건너뛰기 (나중에 설정에서 변경 가능)
            </button>
          </>
        )}
      </div>
    </div>
  );
}
