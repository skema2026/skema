'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useExams, useCreateExam, useDeleteExam } from '@/hooks/useExams';
import { formatDate } from '@/lib/utils';
import { ExamSchedule } from '@/types';
import { api } from '@/lib/api';

function getDaysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const examDate = new Date(dateStr);
  examDate.setHours(0, 0, 0, 0);
  return Math.ceil((examDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function ExamBadge({ days }: { days: number }) {
  if (days < 0) return <Badge variant="secondary">종료</Badge>;
  if (days === 0) return <Badge className="bg-red-500 hover:bg-red-600">오늘</Badge>;
  if (days <= 3) return <Badge className="bg-orange-500 hover:bg-orange-600">{days}일 후</Badge>;
  if (days <= 7) return <Badge className="bg-yellow-500 hover:bg-yellow-600">{days}일 후</Badge>;
  return <Badge variant="outline">{days}일 후</Badge>;
}

const defaultForm = {
  title: '',
  subject: '',
  exam_date: '',
  exam_time: '',
  location: '',
};

export function ExamList() {
  const { data: exams, isLoading } = useExams();
  const createExam = useCreateExam();
  const deleteExam = useDeleteExam();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!form.title.trim()) newErrors.title = '시험 이름을 입력해주세요';
    if (!form.exam_date) newErrors.exam_date = '시험 날짜를 선택해주세요';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const payload: Omit<ExamSchedule, 'id' | 'user_id'> = {
      title: form.title,
      subject: form.subject || undefined,
      exam_date: form.exam_date,
      exam_time: form.exam_time || undefined,
      location: form.location || undefined,
    };

    createExam.mutate(payload, {
      onSuccess: async (exam) => {
        setIsOpen(false);
        setForm(defaultForm);
        setErrors({});
        toast.success('시험 일정이 추가되었습니다. AI가 준비 일정을 생성하는 중...');
        setIsGenerating(true);
        try {
          const subject = exam.subject || exam.title;
          const msg = `시험 '${exam.title}'${exam.subject ? ` (${exam.subject})` : ''} 날짜는 ${exam.exam_date}야. 내 현재 시간표를 분석해서 이 시험에 맞는 준비 학습 일정을 시간표 빈 시간에 자동으로 만들어줘. 시험 D-7부터 시작하고, 가까울수록 강도를 높여서 배치해줘.`;
          await api.post('/ai/chat', { message: msg, messages: [] });
          queryClient.invalidateQueries({ queryKey: ['schedules'] });
          toast.success(`${subject} 시험 준비 일정이 시간표에 추가되었습니다 📚`);
        } catch {
          toast.error('준비 일정 자동 생성에 실패했습니다. AI 채팅에서 직접 요청해보세요.');
        } finally {
          setIsGenerating(false);
        }
      },
      onError: () => toast.error('추가 중 오류가 발생했습니다'),
    });
  };

  const handleDelete = (id: number) => {
    if (confirm('시험 일정을 삭제하시겠습니까?')) {
      deleteExam.mutate(id, {
        onSuccess: () => toast.success('시험 일정이 삭제되었습니다'),
        onError: () => toast.error('삭제 중 오류가 발생했습니다'),
      });
    }
  };

  const handleRegenerate = async (exam: ExamSchedule) => {
    setIsGenerating(true);
    try {
      const msg = `시험 '${exam.title}'${exam.subject ? ` (${exam.subject})` : ''} 날짜는 ${exam.exam_date}야. 내 현재 시간표를 분석해서 이 시험에 맞는 준비 학습 일정을 시간표 빈 시간에 자동으로 만들어줘. 시험 D-7부터 시작하고, 가까울수록 강도를 높여서 배치해줘.`;
      await api.post('/ai/chat', { message: msg, messages: [] });
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
      toast.success('준비 일정이 재생성되었습니다 📚');
    } catch {
      toast.error('생성 중 오류가 발생했습니다');
    } finally {
      setIsGenerating(false);
    }
  };

  const sortedExams = [...(exams || [])].sort(
    (a, b) => new Date(a.exam_date).getTime() - new Date(b.exam_date).getTime()
  );

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--skema-on-surface)' }}>시험 일정</h2>
          <p style={{ fontSize: 11, color: 'var(--skema-outline-strong)', marginTop: 2 }}>
            시험을 추가하면 AI가 자동으로 준비 일정을 시간표에 배치합니다
          </p>
        </div>
        <button
          onClick={() => setIsOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--skema-primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          + 시험 추가
        </button>
      </div>

      {/* AI 생성 중 배너 */}
      {isGenerating && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 12, background: '#eef1ff', border: '1px solid var(--skema-secondary-container)', marginBottom: 16 }}>
          <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2.5px solid var(--skema-primary)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--skema-primary)' }}>AI가 준비 일정을 분석 중입니다...</p>
            <p style={{ fontSize: 11, color: 'var(--skema-on-surface-variant)', marginTop: 1 }}>시험까지 남은 기간에 맞춰 공부 블록을 배치하고 있습니다</p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8" style={{ color: 'var(--skema-outline-strong)', fontSize: 13 }}>로딩 중...</div>
      ) : sortedExams.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📅</div>
          <p style={{ fontSize: 13, color: 'var(--skema-outline-strong)' }}>등록된 시험 일정이 없습니다</p>
          <p style={{ fontSize: 12, color: 'var(--skema-outline-strong)', marginTop: 4, opacity: 0.7 }}>시험을 추가하면 AI가 자동으로 준비 일정을 만들어드려요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedExams.map((exam) => {
            const days = getDaysUntil(exam.exam_date);
            const urgency = days <= 3 ? '#fef2f2' : days <= 7 ? '#fffbeb' : '#f7fafd';
            return (
              <div
                key={exam.id}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--skema-container)', background: urgency, gap: 12 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--skema-on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exam.title}</p>
                    {exam.subject && (
                      <span style={{ fontSize: 11, fontWeight: 600, background: 'var(--skema-secondary-container)', color: 'var(--skema-primary)', borderRadius: 6, padding: '1px 7px', flexShrink: 0 }}>{exam.subject}</span>
                    )}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--skema-outline-strong)' }}>
                    {formatDate(exam.exam_date)}
                    {exam.exam_time && ` ${exam.exam_time}`}
                    {exam.location && ` • ${exam.location}`}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <ExamBadge days={days} />
                  <button
                    onClick={() => handleRegenerate(exam)}
                    disabled={isGenerating}
                    title="AI 준비 일정 재생성"
                    style={{ fontSize: 11, fontWeight: 600, color: 'var(--skema-primary)', background: '#eef1ff', border: 'none', borderRadius: 8, padding: '4px 10px', cursor: isGenerating ? 'not-allowed' : 'pointer', opacity: isGenerating ? 0.5 : 1 }}
                  >
                    AI 재생성
                  </button>
                  <button
                    onClick={() => handleDelete(exam.id)}
                    style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) { setForm(defaultForm); setErrors({}); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>시험 일정 추가</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="exam-title">시험 이름 *</Label>
              <Input
                id="exam-title"
                placeholder="예: 중간고사, 기말시험"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className={errors.title ? 'border-red-500' : ''}
              />
              {errors.title && <p className="text-red-500 text-xs">{errors.title}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="subject">과목 (선택)</Label>
              <Input
                id="subject"
                placeholder="예: 수학, 영어"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exam-date">시험 날짜 *</Label>
              <Input
                id="exam-date"
                type="date"
                value={form.exam_date}
                onChange={(e) => setForm({ ...form, exam_date: e.target.value })}
                className={errors.exam_date ? 'border-red-500' : ''}
              />
              {errors.exam_date && <p className="text-red-500 text-xs">{errors.exam_date}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="exam-time">시험 시간 (선택)</Label>
                <Input
                  id="exam-time"
                  type="time"
                  value={form.exam_time}
                  onChange={(e) => setForm({ ...form, exam_time: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exam-location">장소 (선택)</Label>
                <Input
                  id="exam-location"
                  placeholder="시험 장소"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                취소
              </Button>
              <Button type="submit" disabled={createExam.isPending} style={{ background: 'var(--skema-primary)', color: '#fff' }}>
                {createExam.isPending ? '저장 중...' : 'AI 준비 일정까지 자동 생성'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
