'use client';

/**
 * 시간표 가져오기 확인 화면에서 한 줄의 일정 종류를 고르는 [수업 | 개인] 버튼 (11/4).
 * 서버가 강의실 없는 알바·스터디 등은 '개인'으로 먼저 골라서 보내고, 사용자가 바꿀 수 있다.
 * 색은 화면 색 규칙(scheduleColor.ts의 SCHEDULE_TYPE_COLORS)과 맞춘다.
 */
export type EtaScheduleKind = 'class' | 'personal';

const OPTIONS: { value: EtaScheduleKind; label: string; color: string }[] = [
  { value: 'class', label: '수업', color: '#3b82f6' },
  { value: 'personal', label: '개인', color: '#ec4899' },
];

interface Props {
  value: EtaScheduleKind;
  onChange: (value: EtaScheduleKind) => void;
  size?: 'sm' | 'md';
}

export function ScheduleKindToggle({ value, onChange, size = 'sm' }: Props) {
  const height = size === 'md' ? 'h-11' : 'h-8';
  return (
    <div
      role="radiogroup"
      aria-label="일정 종류"
      className={`inline-flex w-full overflow-hidden rounded-lg border ${height}`}
      style={{ borderColor: '#ebeef1', background: '#fafbfc' }}
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className="flex-1 text-xs font-bold transition-colors"
            style={{
              background: active ? opt.color : 'transparent',
              color: active ? '#fff' : '#64748b',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function toEtaKind(value: unknown): EtaScheduleKind {
  return value === 'personal' ? 'personal' : 'class';
}
