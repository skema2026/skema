'use client';

import MaterialIcon from '@/components/common/MaterialIcon';
import { getWeekStart } from '@/components/timetable/Timetable';
import type { ExamSchedule, Schedule } from '@/types';

type WeekAgendaDay = {
  date: Date;
  dateStr: string;
  schedules: Schedule[];
  exams: ExamSchedule[];
};

type AiActionsProps = {
  weekStart: Date;
  weekAgendaDays: WeekAgendaDay[];
  todayStr: string;
  upcomingExams: ExamSchedule[];
  getDaysUntil: (date: string) => number;
  timeToMinutes: (time: string) => number;
  runAiCommand: (action: string, prompt: string, successMessage: string) => Promise<void>;
  aiAction: string | null;
};

export default function AiActions({
  weekStart,
  weekAgendaDays,
  todayStr,
  upcomingExams,
  getDaysUntil,
  timeToMinutes,
  runAiCommand,
  aiAction,
}: AiActionsProps) {
  const summarizeWeek = () => {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const toLocalDateString = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const weekStartStr = toLocalDateString(weekStart);
    const weekEndStr = toLocalDateString(weekEnd);
    const today = new Date();
    const todayWeekStartStr = toLocalDateString(
      getWeekStart(new Date(today.getFullYear(), today.getMonth(), today.getDate())),
    );
    const isCurrentWeek = weekStartStr === todayWeekStartStr;

    let totalSchedules = 0;
    let totalDone = 0;
    const periodCount = { 오전: 0, 오후: 0, 저녁: 0 };
    const typeCount: Record<string, { total: number; done: number }> = {};
    const dayLines: string[] = [];
    const missedSamples: string[] = [];

    weekAgendaDays.forEach((day) => {
      const weekday = ['월', '화', '수', '목', '금', '토', '일'][
        (day.date.getDay() + 6) % 7
      ];
      const dayDone = day.schedules.filter((schedule) => schedule.is_completed).length;
      totalSchedules += day.schedules.length;
      totalDone += dayDone;

      day.schedules.forEach((schedule) => {
        const startMinutes = timeToMinutes(schedule.start_time);
        if (startMinutes < 12 * 60) periodCount.오전++;
        else if (startMinutes < 18 * 60) periodCount.오후++;
        else periodCount.저녁++;

        const type = schedule.schedule_type ?? '일정';
        if (!typeCount[type]) typeCount[type] = { total: 0, done: 0 };
        typeCount[type].total++;
        if (schedule.is_completed) typeCount[type].done++;

        if (!schedule.is_completed && day.dateStr < todayStr && missedSamples.length < 5) {
          missedSamples.push(`${day.dateStr}(${weekday}) ${schedule.title}`);
        }
      });

      dayLines.push(
        `- ${day.dateStr}(${weekday}): ${day.schedules.length}개 (완료 ${dayDone}개)${day.exams.length > 0 ? `, 시험 ${day.exams.length}개` : ''}`,
      );
    });

    const pct = totalSchedules > 0 ? Math.round((totalDone / totalSchedules) * 100) : 0;
    const typeLines = Object.entries(typeCount)
      .map(([type, value]) => `- ${type}: ${value.done}/${value.total}개 (${value.total > 0 ? Math.round((value.done / value.total) * 100) : 0}%)`)
      .join('\n') || '- 없음';
    const periodLine = `오전 ${periodCount.오전}개 / 오후 ${periodCount.오후}개 / 저녁 ${periodCount.저녁}개`;
    const upcomingExamLines = upcomingExams
      .slice(0, 3)
      .map((exam) => `- ${exam.title} (${exam.exam_date}, D-${getDaysUntil(exam.exam_date)})`)
      .join('\n') || '- 없음';
    const missedLines = missedSamples.length > 0
      ? missedSamples.map((sample) => `- ${sample}`).join('\n')
      : '- 없음';

    const prompt = `주간 요약 분석 요청
주간 기간: ${weekStartStr} ~ ${weekEndStr} (월~일${isCurrentWeek ? ', 현재 진행 중인 주' : ''})

전체 완료율: ${totalDone}/${totalSchedules}개 (${pct}%)

요일별 일정 수:
${dayLines.join('\n')}

시간대별 일정 분포: ${periodLine}

유형별 완료 현황:
${typeLines}

지나간 날의 미완료 일정 (최대 5개):
${missedLines}

다가오는 시험:
${upcomingExamLines}

위 데이터를 정확히 참고해서 한국어로 자연스럽게 답해줘. 정확히 아래 4가지로:
① 이번 주 요약 한 줄 — 전체적인 완료율과 분위기
② 미룬 패턴 — 어떤 종류/요일/시간대가 자주 미뤄지는지 (위 데이터만 참고)
③ 집중이 잘 된 시간대 — 시간대별 분포와 유형별 완료율을 보고 추측
④ 남은 주에 대한 조언 — 다가오는 시험·미완료를 고려해서 무엇을 할지

각 항목은 1-2문장으로 구체적으로. 모르는 정보는 추측하지 말고 위 데이터만 참고해.`;

    void runAiCommand('weekly-summary', prompt, '이번 주 요약을 정리했습니다');
  };

  return (
    <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-[0_10px_30px_-5px_rgba(0,82,255,0.08)]">
      <p className="mb-3 text-[11px] font-black text-slate-400">AI 작업</p>
      <div className="flex flex-col gap-2">
        <button
          key="weekly-summary"
          type="button"
          onClick={summarizeWeek}
          disabled={aiAction !== null}
          className="flex items-center gap-3 rounded-xl border border-blue-100 bg-[#fbfdff] p-3 text-left transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50">
            <MaterialIcon icon="bar_chart" size={18} color="#2563eb" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-black text-slate-950">
              {aiAction === 'weekly-summary' ? 'AI 처리 중...' : '이번 주 요약'}
            </span>
            <span className="block truncate text-[11px] font-bold text-slate-400">
              완료율·미룬 일정·집중 시간대 분석
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
