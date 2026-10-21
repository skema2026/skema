'use client';

import MaterialIcon from '@/components/common/MaterialIcon';
import type { ExamSchedule, Schedule, UserProfile } from '@/types';

type DayViewProps = {
  dayDate: Date;
  daySchedules: Schedule[];
  dayExams: ExamSchedule[];
  upcomingExams: ExamSchedule[];
  dayFreeWindows: { start: number; end: number }[];
  dayConflictSchedules: { schedule: Schedule }[];
  todayStr: string;
  now: Date;
  wakeStartTime: string;
  wakeStartMinutes: number;
  profile: Pick<UserProfile, 'sleep_start'> | null | undefined;
  remainingToday: Schedule[];
  getDaysUntil: (date: string) => number;
  formatLongDate: (date: Date) => string;
  toLocalDateString: (date: Date) => string;
  minutesToTime: (minutes: number) => string;
  timeToMinutes: (time: string) => number;
  getSchedulesForDate: (date: Date, target?: 'day' | 'week' | 'month') => Schedule[];
  exams: ExamSchedule[];
  runAiCommand: (action: string, prompt: string, successMessage: string) => Promise<void>;
  aiAction: string | null;
  showWeekViewForDate: (date: Date) => void;
  getDisplayColor: (schedule: Schedule) => string;
  formatDuration: (start: number, end: number) => string;
  formatMinutesDuration: (minutes: number) => string;
  setExamForStudyBlocks: (exam: { id: number; title: string; exam_date: string }) => void;
  setIsFreeTimeDialogOpen: (open: boolean) => void;
  selectedDayPrimarySchedule: Schedule | null;
  openClassForm: (schedule?: Schedule) => void;
  isSelectedDayToday: boolean;
  setIsRemainingDialogOpen: (open: boolean) => void;
  issueCount: number;
  setIsIssueDialogOpen: (open: boolean) => void;
  issueItems: { label: string }[];
  toggleComplete: { mutate: (input: { id: number; is_completed: boolean }) => void };
  setCertSchedule: (schedule: { id: number; title: string }) => void;
};

export default function DayView({
  dayDate,
  daySchedules,
  dayExams,
  upcomingExams,
  dayFreeWindows,
  dayConflictSchedules,
  todayStr,
  now,
  wakeStartTime,
  wakeStartMinutes,
  profile,
  remainingToday,
  getDaysUntil,
  formatLongDate,
  toLocalDateString,
  minutesToTime,
  timeToMinutes,
  getSchedulesForDate,
  exams,
  runAiCommand,
  aiAction,
  showWeekViewForDate,
  getDisplayColor,
  formatDuration,
  formatMinutesDuration,
  setExamForStudyBlocks,
  setIsFreeTimeDialogOpen,
  selectedDayPrimarySchedule,
  openClassForm,
  isSelectedDayToday,
  setIsRemainingDialogOpen,
  issueCount,
  setIsIssueDialogOpen,
  issueItems,
  toggleComplete,
  setCertSchedule,
}: DayViewProps) {
  return (
                        <div className="h-full overflow-y-auto bg-[#f8fbff] p-4">
                          <div className="mb-3 rounded-lg border border-blue-100 bg-white p-3 shadow-sm">
                            {/* 1행: 날짜 + 버튼 */}
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="whitespace-nowrap text-xs font-black text-blue-600">하루 진행표</p>
                                <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  const isToday = toLocalDateString(dayDate) === todayStr;
                                  const doneCnt = daySchedules.filter(s => s.is_completed).length;
                                  const pct = daySchedules.length > 0 ? Math.round((doneCnt / daySchedules.length) * 100) : 0;
                                  const fmt = (s: Schedule) =>
                                    `- [${s.is_completed ? '완료' : '미완료'}] ${s.start_time}-${s.end_time} ${s.title} (${s.schedule_type ?? '일정'}${s.location ? `, ${s.location}` : ''})`;
                                  const scheduleLines = daySchedules.length > 0
                                    ? daySchedules.map(fmt).join('\n')
                                    : '- 일정 없음';
                                  const dayExamLines = dayExams.length > 0
                                    ? dayExams.map(e => `- ${e.title}${e.exam_time ? ` (${e.exam_time})` : ''}${e.location ? ` @${e.location}` : ''}`).join('\n')
                                    : '';
                                  const upcomingExamLines = upcomingExams
                                    .filter(e => e.exam_date !== toLocalDateString(dayDate))
                                    .slice(0, 3)
                                    .map(e => `- ${e.title} (${e.exam_date}, D-${getDaysUntil(e.exam_date)})`).join('\n');
                                  const freeTimeLine = dayFreeWindows.length > 0
                                    ? dayFreeWindows.map(w => `${minutesToTime(w.start)}-${minutesToTime(w.end)}`).join(', ')
                                    : '없음';
                                  const conflictLine = dayConflictSchedules.length > 0
                                    ? dayConflictSchedules.map(({ schedule }) => schedule.title).join(', ')
                                    : '없음';

                                  const header = isToday
                                    ? `현재 시각: ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}\n날짜: ${toLocalDateString(dayDate)} (오늘)`
                                    : `날짜: ${toLocalDateString(dayDate)}`;

                                  const prompt = `${header}
    완료율: ${doneCnt}/${daySchedules.length}개 (${pct}%)
    기상/취침: ${wakeStartTime} / ${profile?.sleep_start ?? '23:00'}
    빈 시간대: ${freeTimeLine}
    겹치는 일정: ${conflictLine}
    ${dayExamLines ? `\n당일 시험:\n${dayExamLines}` : ''}${upcomingExamLines ? `\n\n다가오는 시험:\n${upcomingExamLines}` : ''}

    일정 목록:
    ${scheduleLines}

    위 데이터를 정확히 참고해서 한국어로 자연스럽게 정리해줘. 정확히 아래 3가지 항목으로 답해줘:
    ① ${isToday ? '지금 당장 할 것' : '이 날 가장 중요한 것'} — 미완료 일정 중 우선순위, 시험 D-day 임박 여부 반영
    ② 빈 시간 활용 — 위의 "빈 시간대"를 그대로 인용해서 무엇을 하면 좋을지
    ③ 주의할 점 — 겹치는 일정, 무리한 일정, 빠뜨리기 쉬운 것 등

    각 항목은 1-2문장으로 짧고 구체적으로 작성해줘. 모르는 정보를 추측하지 말고 위 데이터만 참고해.`;

                                  runAiCommand('today-plan', prompt, '하루 시간표를 정리했습니다');
                                }}
                                disabled={aiAction !== null}
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"
                              >
                                <MaterialIcon icon="smart_toy" size={15} color="#fff" />
                                {aiAction === 'today-plan' ? '정리 중...' : '하루 정리'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const nextDay = new Date(dayDate);
                                  nextDay.setDate(dayDate.getDate() + 1);
                                  const nextDayStr = toLocalDateString(nextDay);
                                  const nextSchedules = getSchedulesForDate(nextDay, 'day');
                                  const nextExams = exams.filter(e => e.exam_date === nextDayStr);
                                  const nextScheduleLines = nextSchedules.length > 0
                                    ? nextSchedules.map(s => `- ${s.start_time}-${s.end_time} ${s.title} (${s.schedule_type ?? '일정'}${s.location ? `, ${s.location}` : ''})`).join('\n')
                                    : '- 일정 없음';
                                  const tomorrowExamLines = nextExams.length > 0
                                    ? nextExams.map(e => `- ${e.title}${e.exam_time ? ` (${e.exam_time})` : ''}${e.location ? ` @${e.location}` : ''}`).join('\n')
                                    : '';
                                  const remainingLines = remainingToday.length > 0
                                    ? remainingToday.map(s => `- ${s.start_time}-${s.end_time} ${s.title}`).join('\n')
                                    : '- 없음';
                                  const upcomingExamLines = upcomingExams
                                    .filter(e => e.exam_date !== nextDayStr)
                                    .slice(0, 3)
                                    .map(e => `- ${e.title} (${e.exam_date}, D-${getDaysUntil(e.exam_date)})`).join('\n');
                                  const refDate = toLocalDateString(dayDate);
                                  const isRefToday = refDate === todayStr;

                                  const prompt = `${isRefToday ? `현재 시각: ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}\n` : ''}기준 날짜: ${refDate}${isRefToday ? ' (오늘)' : ''}
    다음 날(내일): ${nextDayStr}
    ${tomorrowExamLines ? `\n내일 시험:\n${tomorrowExamLines}\n` : ''}
    내일 일정:
    ${nextScheduleLines}

    ${isRefToday ? '오늘 남은 미완료 일정' : '기준 날 미완료 일정'}:
    ${remainingLines}
    ${upcomingExamLines ? `\n다가오는 시험:\n${upcomingExamLines}\n` : ''}

    위 데이터를 정확히 참고해서 "내일을 위해 ${isRefToday ? '오늘' : '기준 날'} 미리 해둘 것"을 정리해줘. 정확히 아래 3가지 항목으로 답해줘:
    ① 미리 챙겨야 할 것 — 내일 일정/시험에 필요한 준비물, 자료, 마감
    ② 오늘 마무리할 것 — ${isRefToday ? '오늘' : '기준 날'} 남은 미완료 일정 중 내일에 영향 줄 수 있는 것
    ③ 주의할 점 — 일찍 일어나야 하는지, 시험이 임박했는지, 무리한 일정인지 등

    각 항목은 1-2문장으로 구체적으로. 모르는 정보를 추측하지 말고 위 데이터만 참고해.`;

                                  runAiCommand('tomorrow-plan', prompt, '내일 준비 사항을 정리했습니다');
                                }}
                                disabled={aiAction !== null}
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
                              >
                                <MaterialIcon icon="event" size={15} color="#fff" />
                                {aiAction === 'tomorrow-plan' ? '준비 중...' : '내일 준비'}
                              </button>
                              </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => showWeekViewForDate(dayDate)}
                                  className="text-left transition hover:opacity-70"
                                  title="주간 보기로 전환"
                                >
                                  <h2 className="text-lg font-black text-slate-950 whitespace-nowrap">{formatLongDate(dayDate)}</h2>
                                </button>
                              </div>
                            </div>

                            {/* 2행: 완료율 + 진행바 */}
                            {(() => {
                              const done = daySchedules.filter(s => s.is_completed).length;
                              const total = daySchedules.length;
                              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                              let msg = '';
                              if (total === 0) msg = '일정을 추가해보세요';
                              else if (pct === 100) msg = '모든 일정 완료';
                              else if (pct >= 70) msg = `거의 다 왔어요 · ${total - done}개 남음`;
                              else msg = `${done}/${total}개 완료`;
                              return (
                                <div className="mt-2 flex items-center gap-3">
                                  <div className="flex-1">
                                    <div className="h-1.5 w-full rounded-full bg-slate-100">
                                      <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
                                    </div>
                                  </div>
                                  <span className="shrink-0 text-[11px] font-bold text-slate-400">{msg}</span>
                                </div>
                              );
                            })()}

                            {/* 3행: 타임라인 바 */}
                            {daySchedules.length > 0 && (() => {
                              const dayStart = wakeStartMinutes;
                              const dayEnd = 24 * 60;
                              const total = dayEnd - dayStart;
                              return (
                                <div className="mt-2">
                                  <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                                    {daySchedules.map(s => {
                                      const start = Math.max(timeToMinutes(s.start_time), dayStart);
                                      const end = Math.min(timeToMinutes(s.end_time), dayEnd);
                                      if (end <= start) return null;
                                      const left = ((start - dayStart) / total) * 100;
                                      const width = ((end - start) / total) * 100;
                                      const periodColor = getDisplayColor(s);
                                      return (
                                        <div key={s.id} className="absolute h-full opacity-80"
                                          style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%`, background: s.is_completed ? '#86efac' : periodColor }} />
                                      );
                                    })}
                                  </div>
                                  <div className="mt-0.5 flex justify-between text-[9px] font-bold text-slate-300">
                                    <span>{minutesToTime(dayStart)}</span><span>24:00</span>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* 4행: 칩 스트립 (시험·겹침·빈시간 등) */}
                            {(() => {
                              const chips: { label: string; color: string; bg: string; border: string; onClick?: () => void }[] = [];
                              if (dayExams.length > 0) dayExams.forEach(e => chips.push({ label: `오늘 시험 · ${e.title}`, color: '#7c2d12', bg: '#fef3c7', border: '#fcd34d' }));
                              // 시험 D-day 칩 — exam_date 기준 중복 제거
                              const seenExamDates = new Set<string>();
                              upcomingExams.filter(e => e.exam_date !== toLocalDateString(dayDate)).forEach(e => {
                                if (seenExamDates.has(e.exam_date)) return;
                                seenExamDates.add(e.exam_date);
                                const d = getDaysUntil(e.exam_date);
                                if (d <= 14 && d > 0) chips.push({
                                  label: `${e.title} D-${d}`,
                                  color: d <= 3 ? '#991b1b' : '#92400e',
                                  bg: d <= 3 ? '#fee2e2' : '#fef3c7',
                                  border: d <= 3 ? '#fca5a5' : '#fcd34d',
                                  onClick: () => setExamForStudyBlocks({ id: e.id, title: e.title, exam_date: e.exam_date }),
                                });
                              });
                              if (dayConflictSchedules.length > 0) chips.push({ label: `겹치는 일정 ${dayConflictSchedules.length}개`, color: '#9a3412', bg: '#fff7ed', border: '#fdba74' });
                              if (dayFreeWindows.length > 0) {
                                const freeMin = dayFreeWindows.reduce((s, w) => s + w.end - w.start, 0);
                                chips.push({ label: `빈 시간 ${formatMinutesDuration(freeMin)}`, color: '#1e40af', bg: '#eff6ff', border: '#bfdbfe', onClick: () => setIsFreeTimeDialogOpen(true) });
                              }
                              if (chips.length === 0) return null;
                              return (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {chips.map((chip, i) => (
                                    <button key={i} type="button" onClick={chip.onClick}
                                      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-black transition hover:opacity-80"
                                      style={{ color: chip.color, background: chip.bg, border: `1px solid ${chip.border}`, cursor: chip.onClick ? 'pointer' : 'default' }}>
                                      {chip.label}
                                    </button>
                                  ))}
                                </div>
                              );
                            })()}

                            <div className="mt-3 grid gap-1.5 grid-cols-3">
                              <button
                                type="button"
                                onClick={() => selectedDayPrimarySchedule ? openClassForm(selectedDayPrimarySchedule) : openClassForm()}
                                className="rounded-lg border border-blue-100 bg-blue-50/70 px-2 py-2 text-left transition hover:border-blue-300 hover:bg-blue-50"
                              >
                                <p className="text-[10px] font-black text-blue-600 leading-tight">{isSelectedDayToday ? '다음 일정' : '첫 일정'}</p>
                                <p className="mt-1 truncate text-xs font-black text-slate-950">
                                  {selectedDayPrimarySchedule ? selectedDayPrimarySchedule.title : '없음'}
                                </p>
                                <p className="truncate text-[10px] font-bold text-slate-400 leading-tight">
                                  {selectedDayPrimarySchedule
                                    ? `${selectedDayPrimarySchedule.start_time}–${selectedDayPrimarySchedule.end_time}`
                                    : '일정 없음'}
                                </p>
                              </button>

                              <button
                                type="button"
                                onClick={remainingToday.length > 0 ? () => setIsRemainingDialogOpen(true) : undefined}
                                className="rounded-lg border border-blue-100 bg-blue-50/70 px-2 py-2 text-left transition hover:border-blue-300 hover:bg-blue-50"
                              >
                                <p className="text-[10px] font-black text-blue-600 leading-tight">
                                  해야할 일{!isSelectedDayToday && <span className="text-slate-400"> (오늘)</span>}
                                </p>
                                <p className="mt-1 text-xs font-black text-slate-950">
                                  {remainingToday.length > 0 ? `${remainingToday.length}개` : '모두 완료'}
                                </p>
                                <p className="truncate text-[10px] font-bold text-slate-400 leading-tight">
                                  {remainingToday.length > 0 ? remainingToday[0].title : '미완료 없음'}
                                </p>
                              </button>

                              <button
                                type="button"
                                onClick={issueCount > 0 ? () => setIsIssueDialogOpen(true) : undefined}
                                className={`rounded-lg border px-2 py-2 text-left transition ${issueCount > 0 ? 'border-amber-200 bg-amber-50/60 hover:bg-amber-50' : 'border-blue-100 bg-blue-50/70 hover:bg-blue-50'}`}
                              >
                                <p className={`text-[10px] font-black leading-tight ${issueCount > 0 ? 'text-amber-600' : 'text-blue-600'}`}>
                                  확인 필요{!isSelectedDayToday && <span className="text-slate-400"> (오늘)</span>}
                                </p>
                                <p className="mt-1 text-xs font-black text-slate-950">
                                  {issueCount > 0 ? `${issueCount}개` : '정상'}
                                </p>
                                <p className="truncate text-[10px] font-bold text-slate-400 leading-tight">
                                  {issueItems[0]?.label ?? '이상 없음'}
                                </p>
                              </button>
                            </div>
                          </div>

                          {dayExams.length > 0 && (
                            <div className="mb-3 space-y-2">
                              {dayExams.map((exam) => (
                                <button
                                  key={exam.id}
                                  type="button"
                                  onClick={() => setExamForStudyBlocks({ id: exam.id, title: exam.title, exam_date: exam.exam_date })}
                                  className="flex w-full items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left transition hover:border-amber-300 hover:bg-amber-100"
                                >
                                  <span>
                                    <span className="block text-sm font-black text-amber-950">{exam.title}</span>
                                    <span className="text-xs font-bold text-amber-700">
                                      {exam.exam_time || '시간 미정'}{exam.location ? ` · ${exam.location}` : ''}
                                    </span>
                                  </span>
                                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-black text-amber-800">
                                    <MaterialIcon icon="menu_book" size={14} color="#b45309" />
                                    공부 배치
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}

                          {dayConflictSchedules.length > 0 && (
                            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-4">
                              <div className="flex items-start gap-3">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white">
                                  <MaterialIcon icon="warning" size={18} color="#dc2626" />
                                </span>
                                <div className="min-w-0">
                                  <p className="text-sm font-black text-red-900">겹치는 일정이 있습니다</p>
                                  <p className="mt-1 text-xs font-bold text-red-700">
                                    {dayConflictSchedules.map(({ schedule }) => schedule.title).join(', ')}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          {daySchedules.length === 0 && dayExams.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-blue-100 bg-white p-10 text-center shadow-sm">
                              <MaterialIcon icon="calendar_month" size={42} color="#93c5fd" />
                              <p className="mt-3 text-lg font-black text-slate-950">이 날은 비어 있습니다</p>
                              <p className="mt-1 text-sm font-bold text-slate-500">직접 일정을 추가하거나 AI에게 빈 시간을 채워달라고 요청하세요.</p>
                                <div className="mt-5 flex flex-wrap justify-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openClassForm()}
                                  className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-blue-400 px-5 py-2 text-sm font-bold text-white shadow-sm hover:opacity-90"
                                >
                                  <MaterialIcon icon="add" size={16} color="#fff" />
                                  일정 추가
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
                              <section className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm">
                                <div className="mb-3 flex items-center justify-between">
                                  <h3 className="text-sm font-black text-slate-950">오늘 일정</h3>
                                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-black text-blue-700">{daySchedules.length}개</span>
                                </div>
                                {daySchedules.length === 0 ? (
                                  <div className="rounded-lg border border-dashed border-blue-100 bg-[#fbfdff] p-4 text-sm font-bold text-slate-400">
                                    일정이 없습니다
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {daySchedules.map((schedule) => {
                                      const start = timeToMinutes(schedule.start_time);
                                      const end = timeToMinutes(schedule.end_time);
                                      const done = schedule.is_completed;
                                      const periodColor = getDisplayColor(schedule);
                                      return (
                                        <div
                                          key={schedule.id}
                                          className={`flex items-start gap-3 rounded-lg border p-3 transition ${done ? 'border-slate-100 bg-slate-50' : 'border-blue-50 bg-[#fbfdff] shadow-sm'}`}
                                          style={{ borderLeft: `4px solid ${done ? '#cbd5e1' : periodColor}` }}
                                        >
                                          <div className="flex shrink-0 flex-col items-center gap-1">
                                            <button
                                              type="button"
                                              onClick={() => toggleComplete.mutate({ id: schedule.id, is_completed: !done })}
                                              className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition ${done ? 'border-emerald-400 bg-emerald-400' : 'border-slate-300 hover:border-blue-400'}`}
                                            >
                                              {done && (
                                                <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                                                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                              )}
                                            </button>
                                            {done && (
                                              <button
                                                type="button"
                                                title="영상 기록 올리기"
                                                onClick={() => setCertSchedule({ id: schedule.id, title: schedule.title })}
                                                className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-50 text-blue-500 transition hover:bg-blue-100"
                                              >
                                                <MaterialIcon icon="videocam" size={12} color="currentColor" />
                                              </button>
                                            )}
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => openClassForm(schedule)}
                                            className="min-w-0 flex-1 text-left"
                                          >
                                            <span className={`block truncate text-sm font-black ${done ? 'text-slate-400 line-through' : 'text-slate-950'}`}>
                                              {schedule.title}
                                            </span>
                                            <span className="mt-0.5 flex flex-wrap items-center gap-2">
                                              <span className="text-xs font-bold" style={{ color: done ? '#94a3b8' : periodColor }}>
                                                {schedule.start_time}–{schedule.end_time}
                                              </span>
                                              {schedule.location && (
                                                <span className="text-xs font-bold text-slate-400">{schedule.location}</span>
                                              )}
                                              <span className="text-xs font-bold text-slate-300">{formatDuration(start, end)}</span>
                                            </span>
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </section>

                              <aside className="space-y-3">

                                <section className="rounded-lg border border-blue-100 bg-white p-4 shadow-sm">
                                  <div className="mb-3 flex items-center gap-2">
                                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
                                      <MaterialIcon icon="bar_chart" size={17} color="#2563eb" />
                                    </span>
                                    <h3 className="text-base font-black text-slate-950">오늘 리포트</h3>
                                  </div>

                                  {(() => {
                                    const total = daySchedules.length;
                                    const done = daySchedules.filter(s => s.is_completed).length;
                                    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                                    const totalMin = daySchedules.reduce((s, sc) => s + Math.max(0, timeToMinutes(sc.end_time) - timeToMinutes(sc.start_time)), 0);
                                    const freeMin = dayFreeWindows.reduce((s, w) => s + (w.end - w.start), 0);
                                    const busyPeriod = (() => {
                                      const morn = daySchedules.filter(s => timeToMinutes(s.start_time) < 12 * 60).length;
                                      const aftn = daySchedules.filter(s => { const m = timeToMinutes(s.start_time); return m >= 12 * 60 && m < 18 * 60; }).length;
                                      const evng = daySchedules.filter(s => timeToMinutes(s.start_time) >= 18 * 60).length;
                                      if (morn >= aftn && morn >= evng) return '오전';
                                      if (aftn >= evng) return '오후';
                                      return '저녁';
                                    })();

                                    return (
                                      <div className="space-y-3">
                                        <div>
                                          <div className="mb-1 flex items-center justify-between">
                                            <span className="text-xs font-black text-slate-500">완료율</span>
                                            <span className="text-xs font-black text-slate-950">{pct}%</span>
                                          </div>
                                          <div className="h-2 w-full rounded-full bg-slate-100">
                                            <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${pct}%` }} />
                                          </div>
                                          <p className="mt-0.5 text-[11px] font-bold text-slate-400">{done}/{total}개 완료</p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                          <div className="rounded-lg bg-blue-50 px-3 py-2">
                                            <p className="text-[10px] font-black text-blue-500">일정 시간</p>
                                            <p className="mt-0.5 text-sm font-black text-slate-950">{formatMinutesDuration(totalMin)}</p>
                                          </div>
                                          <div className="rounded-lg bg-slate-50 px-3 py-2">
                                            <p className="text-[10px] font-black text-slate-500">빈 시간</p>
                                            <p className="mt-0.5 text-sm font-black text-slate-950">{formatMinutesDuration(freeMin)}</p>
                                          </div>
                                        </div>
                                        {total > 0 && (
                                          <p className="text-[11px] font-bold text-slate-500">
                                            오늘은 <span className="font-black text-slate-800">{busyPeriod}</span>에 일정이 집중돼 있어요
                                          </p>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const refDate = toLocalDateString(dayDate);
                                            const isRefToday = refDate === todayStr;
                                            const doneLines = daySchedules.filter(s => s.is_completed)
                                              .map(s => `- ${s.start_time}-${s.end_time} ${s.title} (${s.schedule_type ?? '일정'})`).join('\n') || '- 없음';
                                            const missedLines = daySchedules.filter(s => !s.is_completed)
                                              .map(s => `- ${s.start_time}-${s.end_time} ${s.title} (${s.schedule_type ?? '일정'})`).join('\n') || '- 없음';

                                            const reportPrompt = `${isRefToday ? `현재 시각: ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}\n` : ''}평가 대상 날짜: ${refDate}${isRefToday ? ' (오늘)' : ''}
    전체 완료율: ${done}/${total}개 (${pct}%)
    일정 점유 시간: ${formatMinutesDuration(totalMin)}
    빈 시간: ${formatMinutesDuration(freeMin)}
    일정 몰린 시간대: ${busyPeriod}

    완료된 일정:
    ${doneLines}

    미완료 일정:
    ${missedLines}

    위 데이터를 정확히 참고해서 한국어로 2~3문장으로 자연스럽게 평가해줘.
    - 완료율과 분위기 한 줄
    - 시간 활용에서 잘한 점 또는 아쉬운 점 한 줄
    - 개선 제안 한 줄
    모르는 정보는 추측하지 말고 위 데이터만 참고해.`;

                                            runAiCommand('day-report', reportPrompt, 'AI 평가가 완료됐습니다');
                                          }}
                                          disabled={aiAction !== null}
                                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2.5 text-xs font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
                                        >
                                          <MaterialIcon icon="smart_toy" size={15} color="#fff" />
                                          {aiAction === 'day-report' ? '평가 중...' : 'AI 평가 받기'}
                                        </button>
                                      </div>
                                    );
                                  })()}
                                </section>

                              </aside>
                            </div>
                          )}
                        </div>
  );
}
