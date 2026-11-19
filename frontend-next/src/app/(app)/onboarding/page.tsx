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

const GENERATING_STEPS = [
  '입력한 내용을 정리하는 중',
  '비어 있는 시간을 찾는 중',
  '시험 날짜에 맞춰 공부 블록을 놓는 중',
  '거의 다 됐어요',
];

export default function OnboardingPage() {
  const router = useRouter();
  const updateProfile = useUpdateProfile();
  const { data: profile } = useProfile();
  // 지금 이 화면에서 온보딩을 끝내는 중이면(저장·공부 블록 배치 중) 대시보드로 먼저 보내지 않는다
  const finishingRef = useRef(false);

  // 11/19: 이미 온보딩을 끝낸 계정은 언제 들어와도 대시보드로 보낸다.
  // (예전에는 sessionStorage 표시가 남아 있으면 같은 탭에서 다시 로그인했을 때 온보딩 화면에 머물렀다)
  useEffect(() => {
    if (!profile?.onboarding_completed || finishingRef.current) return;
    router.replace('/dashboard');
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
  const [generatingStep, setGeneratingStep] = useState(0);
  const [showEtaOverwriteConfirm, setShowEtaOverwriteConfirm] = useState(false);


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

  const finishOnboarding = async (
    finalAnswers: Record<string, string>,
    directSleep?: { sleep_start: string; sleep_end: string }
  ) => {
    finishingRef.current = true;
    setPhase('generating');
    for (let i = 0; i < GENERATING_STEPS.length; i++) {
      setGeneratingStep(i);
      await new Promise((r) => setTimeout(r, i === GENERATING_STEPS.length - 1 ? 800 : 1200));
    }

    try {
      const sleepTimes = directSleep ?? { sleep_start: sleepStart, sleep_end: sleepEnd };
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

        // 11/19: 일반 유형도 시험을 넣었으면 대학생과 똑같이 공부 블록을 자동 배치한다.
        // (채팅에서는 공부 설정을 묻지 않으므로 기본값: 시험 14일 전부터, 주 3일, 하루 2시간)
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
      }

      setPhase('done');
      // replace: 대시보드에서 뒤로 가기를 눌러도 온보딩으로 돌아오지 않게 (11/19)
      setTimeout(() => router.replace('/dashboard'), 1800);
    } catch {
      toast.error('\uc124\uc815 \uc800\uc7a5 \uc911 \uc624\ub958\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4');
      setPhase('sleep');
    }
  };

  const handleTypeSelect = (typeId: string) => {
    setSelectedType(typeId);
    setPhase('external-exam');
  };

  /** personal-schedule 완료 후 수면 시간 단계로 */
  const handleCollegeStartChat = () => {
    setPhase('sleep');
  };

  const handleSkip = () => {
    updateProfile.mutate(
      { onboarding_completed: true, is_college_student: isCollegeStudent ?? false },
      {
        onSuccess: () => router.replace('/dashboard'),
        onError: () => router.replace('/dashboard'),
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
                // 11/19: 채팅 대신 입력칸 화면으로 (유형 → 시험 → 반복 일정 → 수면 시간)
                setIsCollegeStudent(false);
                setSelectedType('');
                setPhase('type-select');
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
              <h2 className="font-semibold text-lg" style={{ color: '#0f1e3a' }}>{isCollegeStudent ? '추가 시험 입력' : '시험 입력'}</h2>
              <p className="text-xs" style={{ color: '#44536b' }}>{isCollegeStudent ? '3단계 / 5단계' : '2단계 / 4단계'}</p>
            </div>
          </div>
          <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#dfe7f3' }}>
            <div className="h-full rounded-full" style={{ width: isCollegeStudent ? '60%' : '50%', background: '#2a6fe3' }} />
          </div>

          <p className="text-sm font-medium mb-4" style={{ color: '#44536b' }}>
            {isCollegeStudent ? '별도로 준비 중인 시험이 있나요?' : '준비 중인 시험이 있나요?'}{' '}
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
              <p className="text-xs" style={{ color: '#44536b' }}>{isCollegeStudent ? '4단계 / 5단계' : '3단계 / 4단계'}</p>
            </div>
          </div>
          <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#dfe7f3' }}>
            <div className="h-full rounded-full" style={{ width: isCollegeStudent ? '80%' : '75%', background: '#2a6fe3' }} />
          </div>

          <p className="text-sm font-medium mb-4" style={{ color: '#44536b' }}>
            {isCollegeStudent ? '학업 외에 중요한 일정이 있나요?' : '매주 반복되는 일정이 있나요? (학원·업무·운동 등)'}{' '}
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
                {isCollegeStudent ? '2단계 / 2단계' : '1단계 / 4단계'}
              </p>
            </div>
          </div>

          {/* Progress */}
          <div className="w-full h-1.5 rounded-full mb-6" style={{ background: '#dfe7f3' }}>
            <div className="h-full rounded-full" style={{ width: isCollegeStudent ? '100%' : '25%', background: '#2a6fe3' }} />
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
            onClick={() => { setSelectedType(''); setPhase('external-exam'); }}
            className="w-full py-3 text-sm font-medium rounded-xl border transition-colors"
            style={{ color: '#44536b', borderColor: '#dfe7f3' }}
          >
            건너뛰기
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
              <p className="text-xs" style={{ color: '#44536b' }}>{isCollegeStudent ? '5단계 / 5단계' : '4단계 / 4단계'}</p>
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

  return null;
}
