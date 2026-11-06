"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import DayTimeline from "./DayTimeline";
import MaterialIcon from "@/components/common/MaterialIcon";
import type { ExamSchedule, Schedule, UserProfile } from "@/types";

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
  profile: Pick<UserProfile, "sleep_start"> | null | undefined;
  remainingToday: Schedule[];
  getDaysUntil: (date: string) => number;
  formatLongDate: (date: Date) => string;
  toLocalDateString: (date: Date) => string;
  minutesToTime: (minutes: number) => string;
  timeToMinutes: (time: string) => number;
  getSchedulesForDate: (
    date: Date,
    target?: "day" | "week" | "month",
  ) => Schedule[];
  exams: ExamSchedule[];
  runAiCommand: (
    action: string,
    prompt: string,
    successMessage: string,
  ) => Promise<void>;
  aiAction: string | null;
  showWeekViewForDate: (date: Date) => void;
  getDisplayColor: (schedule: Schedule) => string;
  formatDuration: (start: number, end: number) => string;
  formatMinutesDuration: (minutes: number) => string;
  setExamForStudyBlocks: (exam: {
    id: number;
    title: string;
    exam_date: string;
  }) => void;
  setIsFreeTimeDialogOpen: (open: boolean) => void;
  selectedDayPrimarySchedule: Schedule | null;
  openClassForm: (schedule?: Schedule) => void;
  isSelectedDayToday: boolean;
  setIsRemainingDialogOpen: (open: boolean) => void;
  issueCount: number;
  setIsIssueDialogOpen: (open: boolean) => void;
  issueItems: { label: string }[];
  toggleComplete: {
    mutate: (input: { id: number; is_completed: boolean }) => void;
  };
  setCertSchedule: (schedule: { id: number; title: string }) => void;
  onReschedule: () => void;
  isRegenerating: boolean;
};

type ScheduleListProps = {
  schedules: Schedule[];
  getDisplayColor: (schedule: Schedule) => string;
  openClassForm: (schedule?: Schedule) => void;
  toggleComplete: {
    mutate: (input: { id: number; is_completed: boolean }) => void;
  };
};

type DailyReportProps = {
  daySchedules: Schedule[];
  dayExams: ExamSchedule[];
  dayFreeWindows: { start: number; end: number }[];
  dayConflictSchedules: { schedule: Schedule }[];
  issueCount: number;
  issueItems: { label: string }[];
  onReschedule: () => void;
  isRegenerating: boolean;
  getDaysUntil: (date: string) => number;
  setExamForStudyBlocks: (exam: {
    id: number;
    title: string;
    exam_date: string;
  }) => void;
};

function ScheduleList({
  schedules,
  getDisplayColor,
  openClassForm,
  toggleComplete,
}: ScheduleListProps) {
  if (schedules.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/60 p-4 text-center text-sm font-semibold text-slate-500">
        오늘 일정이 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {schedules.map((schedule) => {
        const periodColor = getDisplayColor(schedule);
        const isDone = schedule.is_completed;

        return (
          <div
            key={schedule.id}
            data-schedule-id={schedule.id}
            className={`flex items-start gap-3 rounded-2xl border px-3 py-2.5 ${
              isDone ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white"
            }`}
            style={{ borderLeft: `4px solid ${isDone ? "#cbd5e1" : periodColor}` }}
          >
            <button
              type="button"
              aria-label={`${schedule.title} 완료 여부`}
              aria-pressed={isDone}
              onClick={() =>
                toggleComplete.mutate({
                  id: schedule.id,
                  is_completed: !isDone,
                })
              }
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                isDone ? "border-emerald-400 bg-emerald-400" : "border-slate-300 bg-white"
              }`}
            >
              {isDone && (
                <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M2 6l3 3 5-5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={() => openClassForm(schedule)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`truncate text-sm font-black ${
                    isDone ? "text-slate-400 line-through" : "text-slate-900"
                  }`}
                >
                  {schedule.title}
                </span>
                <span
                  className={`rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black ${
                    isDone ? "text-emerald-500" : "text-slate-600"
                  }`}
                >
                  {isDone ? "완료" : "예정"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] font-semibold text-slate-500">
                <span>{schedule.start_time}</span>
                <span>·</span>
                <span>{schedule.end_time}</span>
                {schedule.location && (
                  <>
                    <span>·</span>
                    <span className="truncate">{schedule.location}</span>
                  </>
                )}
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function DailyReport({
  daySchedules,
  dayExams,
  dayFreeWindows,
  dayConflictSchedules,
  issueCount,
  issueItems,
  onReschedule,
  isRegenerating,
  getDaysUntil,
  setExamForStudyBlocks,
}: DailyReportProps) {
  const total = daySchedules.length;
  const done = daySchedules.filter((schedule) => schedule.is_completed).length;
  const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;
  const freeMinutes = dayFreeWindows.reduce(
    (sum, window) => sum + (window.end - window.start),
    0,
  );
  const nextExam = dayExams[0];

  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50/80 p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">
            완료율
          </p>
          <p className="mt-2 text-lg font-black text-slate-900">{completionRate}%</p>
          <p className="text-[10px] font-semibold text-slate-500">{done}/{total}</p>
        </div>
        <div className="rounded-2xl border border-blue-400 bg-slate-100 p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
            여유시간
          </p>
          <p className="mt-2 text-lg font-black text-slate-900">
            {Math.max(Math.floor(freeMinutes / 60), 0)}h
          </p>
          <p className="text-[10px] font-semibold text-slate-500">
            {freeMinutes}분
          </p>
        </div>
        <div className="rounded-2xl border border-amber-400 bg-amber-50 p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-amber-600">
            확인
          </p>
          <p className="mt-2 text-lg font-black text-slate-900">{issueCount}</p>
          <p className="text-[10px] font-semibold text-slate-500">
            {issueCount > 0 ? "검토 필요" : "정상"}
          </p>
        </div>
      </div>

      <div className="bg-slate-50 p-3">
        {nextExam ? (
          <button
            type="button"
            onClick={() =>
              setExamForStudyBlocks({
                id: nextExam.id,
                title: nextExam.title,
                exam_date: nextExam.exam_date,
              })
            }
            className="flex w-full items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left"
          >
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-amber-700">
                오늘 시험
              </p>
              <p className="mt-1 text-sm font-black text-slate-900">{nextExam.title}</p>
            </div>
            <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-700">
              D-{getDaysUntil(nextExam.exam_date)}
            </span>
          </button>
        ) : (
          <div className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500">
            오늘 예정된 시험이 없습니다.
          </div>
        )}

        {dayConflictSchedules.length > 0 && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-red-600">
              겹치는 일정
            </p>
            <p className="mt-1 text-xs font-bold text-red-700">
              {dayConflictSchedules.map(({ schedule }) => schedule.title).join(", ")}
            </p>
          </div>
        )}

        {issueCount > 0 && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-amber-700">
              체크 필요
            </p>
            <p className="mt-1 text-xs font-bold text-amber-800">
              {issueItems[0]?.label ?? "추가 검토가 필요해요."}
            </p>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onReschedule}
        disabled={isRegenerating}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-3 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
      >
        <MaterialIcon icon="autorenew" size={16} color="#fff" />
        {isRegenerating ? "다시 짜는 중..." : "다시 짜기"}
      </button>
    </div>
  );
}

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
  profile,
  getDaysUntil,
  formatLongDate,
  toLocalDateString,
  minutesToTime,
  timeToMinutes,
  runAiCommand,
  aiAction,
  getDisplayColor,
  setExamForStudyBlocks,
  openClassForm,
  isSelectedDayToday,
  issueCount,
  issueItems,
  toggleComplete,
  onReschedule,
  isRegenerating,
}: DayViewProps) {
  const [showReport, setShowReport] = useState(true);
  const focusKeyRef = useRef<string | null>(null);

  const completed = daySchedules.filter((schedule) => schedule.is_completed).length;
  const total = daySchedules.length;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const focusSchedule = useMemo(() => {
    if (daySchedules.length === 0) return null;
    const sorted = [...daySchedules].sort(
      (a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time),
    );

    if (isSelectedDayToday) {
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      return (
        sorted.find((schedule) => timeToMinutes(schedule.start_time) >= nowMinutes) ??
        sorted[0]
      );
    }

    return sorted[0];
  }, [daySchedules, isSelectedDayToday, now, timeToMinutes]);

  useEffect(() => {
    if (!focusSchedule) return;

    const focusKey = `${toLocalDateString(dayDate)}-${focusSchedule.id}`;
    if (focusKeyRef.current === focusKey) return;
    focusKeyRef.current = focusKey;

    const container = document.querySelector(
      '[data-day-scroll-container="true"]',
    ) as HTMLElement | null;
    const target = container?.querySelector(
      `[data-schedule-id="${focusSchedule.id}"]`,
    ) as HTMLElement | null;

    if (!container || !target) return;

    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({
        top: Math.max(target.offsetTop - 120, 0),
        behavior: "auto",
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [dayDate, focusSchedule, toLocalDateString]);

  const todaySummaryText = `${total}개 일정 · 완료 ${completed}개`;

  const handleMorningPlan = async () => {
    const isToday = toLocalDateString(dayDate) === todayStr;
    const doneCnt = daySchedules.filter((schedule) => schedule.is_completed).length;
    const pct = total > 0 ? Math.round((doneCnt / total) * 100) : 0;
    const fmt = (schedule: Schedule) =>
      `- [${schedule.is_completed ? "완료" : "미완료"}] ${schedule.start_time}-${schedule.end_time} ${schedule.title} (${schedule.schedule_type ?? "일정"}${schedule.location ? `, ${schedule.location}` : ""})`;
    const scheduleLines = total > 0 ? daySchedules.map(fmt).join("\n") : "- 일정 없음";
    const dayExamLines =
      dayExams.length > 0
        ? dayExams
            .map(
              (exam) =>
                `- ${exam.title}${exam.exam_time ? ` (${exam.exam_time})` : ""}${exam.location ? ` @${exam.location}` : ""}`,
            )
            .join("\n")
        : "";
    const upcomingExamLines = upcomingExams
      .filter((exam) => exam.exam_date !== toLocalDateString(dayDate))
      .slice(0, 3)
      .map(
        (exam) => `- ${exam.title} (${exam.exam_date}, D-${getDaysUntil(exam.exam_date)})`,
      )
      .join("\n");
    const freeTimeLine =
      dayFreeWindows.length > 0
        ? dayFreeWindows
            .map((window) => `${minutesToTime(window.start)}-${minutesToTime(window.end)}`)
            .join(", ")
        : "없음";
    const conflictLine =
      dayConflictSchedules.length > 0
        ? dayConflictSchedules.map(({ schedule }) => schedule.title).join(", ")
        : "없음";

    const header = isToday
      ? `현재 시각: ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}\n날짜: ${toLocalDateString(dayDate)} (오늘)`
      : `날짜: ${toLocalDateString(dayDate)}`;

    const prompt = `${header}
완료율: ${doneCnt}/${total}개 (${pct}%)
기상/취침: ${wakeStartTime} / ${profile?.sleep_start ?? "23:00"}
빈 시간대: ${freeTimeLine}
겹치는 일정: ${conflictLine}
${dayExamLines ? `\n당일 시험:\n${dayExamLines}` : ""}${upcomingExamLines ? `\n\n다가오는 시험:\n${upcomingExamLines}` : ""}

일정 목록:
${scheduleLines}

위 데이터를 정확히 참고해서 한국어로 자연스럽게 정리해줘. 정확히 아래 3가지 항목으로 답해줘:
① ${isToday ? "지금 당장 할 것" : "이 날 가장 중요한 것"} — 미완료 일정 중 우선순위, 시험 D-day 임박 여부 반영
② 빈 시간 활용 — 위의 "빈 시간대"를 그대로 인용해서 무엇을 하면 좋을지
③ 주의할 점 — 겹치는 일정, 무리한 일정, 빠뜨리기 쉬운 것 등

각 항목은 1-2문장으로 짧고 구체적으로 작성해줘. 모르는 정보를 추측하지 말고 위 데이터만 참고해.`;

    await runAiCommand("today-plan", prompt, "하루 시간표를 정리했습니다");
  };

  return (
    <div
      data-day-scroll-container="true"
      className="h-full overflow-y-auto bg-[#f8fbff] px-3 pb-6 pt-3 sm:px-4"
    >
      <div className="space-y-3">
        <header className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-600">
                {isSelectedDayToday ? "today" : "day"}
              </p>
              <h2 className="mt-1 text-lg font-black text-slate-900">
                {formatLongDate(dayDate)}
              </h2>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleMorningPlan}
                disabled={aiAction !== null}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-black text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                <MaterialIcon icon="smart_toy" size={13} color="#fff" />
                {aiAction === "today-plan" ? "정리 중..." : "하루 정리"}
              </button>
              <button
                type="button"
                onClick={onReschedule}
                disabled={isRegenerating}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[11px] font-black text-white transition hover:bg-slate-900 disabled:opacity-50"
              >
                <MaterialIcon icon="autorenew" size={13} color="#fff" />
                {isRegenerating ? "생성 중" : "다시 짜기"}
              </button>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
            <span className="text-sm font-black text-slate-900">{todaySummaryText}</span>
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">
              {completionRate}%
            </span>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                timeline
              </p>
              <h3 className="text-base font-black text-slate-900">오늘 타임라인</h3>
            </div>
            <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">
              {isSelectedDayToday ? "현재 시간 기준" : "첫 일정부터"}
            </span>
          </div>

          <DayTimeline
            schedules={daySchedules}
            freeWindows={dayFreeWindows}
            isToday={isSelectedDayToday}
            onScheduleClick={(schedule) => openClassForm(schedule)}
            onToggleComplete={(schedule) =>
              toggleComplete.mutate({
                id: schedule.id,
                is_completed: !schedule.is_completed,
              })
            }
            getDisplayColor={getDisplayColor}
          />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                checklist
              </p>
              <h3 className="text-base font-black text-slate-900">오늘 일정 체크리스트</h3>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">
              {total}개
            </span>
          </div>

          <ScheduleList
            schedules={daySchedules}
            getDisplayColor={getDisplayColor}
            openClassForm={openClassForm}
            toggleComplete={toggleComplete}
          />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-3">
          <button
            type="button"
            onClick={() => setShowReport((value) => !value)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                report
              </p>
              <h3 className="text-base font-black text-slate-900">오늘 리포트</h3>
            </div>
            <span className="flex items-center gap-1 text-[11px] font-black text-slate-500">
              핵심 수치
              <MaterialIcon
                icon={showReport ? "expand_less" : "expand_more"}
                size={16}
                color="#64748b"
              />
            </span>
          </button>

          {showReport && (
            <DailyReport
              daySchedules={daySchedules}
              dayExams={dayExams}
              dayFreeWindows={dayFreeWindows}
              dayConflictSchedules={dayConflictSchedules}
              issueCount={issueCount}
              issueItems={issueItems}
              onReschedule={onReschedule}
              isRegenerating={isRegenerating}
              getDaysUntil={getDaysUntil}
              setExamForStudyBlocks={setExamForStudyBlocks}
            />
          )}
        </section>
      </div>
    </div>
  );
}
