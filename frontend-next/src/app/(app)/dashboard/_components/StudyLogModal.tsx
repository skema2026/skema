'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { displayTitle } from '@/lib/utils';
import MaterialIcon from '@/components/common/MaterialIcon';
import { useCreateStudyLog } from '@/hooks/useStudyLogs';
import type { GroupOut } from '@/hooks/useGroups';

type StudyLogSchedule = { id: number; title: string };
type RecordState = 'idle' | 'requesting' | 'recording' | 'done';

type StudyLogModalProps = {
  schedule: StudyLogSchedule | null;
  groups: GroupOut[];
  onClose: () => void;
};

export default function StudyLogModal({
  schedule,
  groups,
  onClose,
}: StudyLogModalProps) {
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [caption, setCaption] = useState('');
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [countdown, setCountdown] = useState(3);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createStudyLog = useCreateStudyLog();

  const resetModal = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setFile(null);
    setPreview(null);
    setRecordState('idle');
    setCaption('');
    setGroupIds([]);
  }, []);

  const closeModal = () => {
    resetModal();
    onClose();
  };

  const scheduleId = schedule?.id;
  useEffect(() => {
    if (scheduleId !== undefined) setGroupIds(groups.map((group) => group.id));
  }, [scheduleId, groups]);

  const liveVideoCallbackRef = useCallback((node: HTMLVideoElement | null) => {
    liveVideoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.play().catch(() => {});
    }
  }, []);

  const flipCamera = () => {
    setFacingMode((previous) => previous === 'user' ? 'environment' : 'user');
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecordState('idle');
  };

  const startRecording = async (facing: 'user' | 'environment' = facingMode) => {
    setRecordState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing } },
        audio: true,
      });
      streamRef.current = stream;
      const mimeType =
        MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' :
        MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' :
        MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' :
        MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const baseType = mimeType.split(';')[0];
        const blob = new Blob(chunks, { type: baseType });
        const recording = new File([blob], `cert.${extension}`, { type: baseType });
        setFile(recording);
        setPreview(URL.createObjectURL(blob));
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecordState('done');
      };
      setRecordState('recording');
      setCountdown(3);
      recorder.start(100);
      let remaining = 3;
      const timer = setInterval(() => {
        remaining--;
        setCountdown(remaining);
        if (remaining <= 0) {
          clearInterval(timer);
          recorder.stop();
        }
      }, 1000);
    } catch {
      toast.error('카메라와 마이크 권한을 허용해 주세요');
      setRecordState('idle');
    }
  };

  const submitLog = async () => {
    if (!schedule) return;
    if (!file && !caption.trim()) {
      toast.error('영상이나 한마디를 넣어 주세요');
      return;
    }

    const makeForm = (groupId?: number) => {
      const form = new FormData();
      if (file) form.append('video', file);
      form.append('schedule_id', String(schedule.id));
      if (caption.trim()) form.append('caption', caption.trim());
      if (groupId) form.append('group_id', String(groupId));
      return form;
    };

    try {
      const targets = groupIds.length > 0 ? groupIds : [undefined];
      await Promise.all(
        targets.map((groupId) => createStudyLog.mutateAsync(makeForm(groupId))),
      );
      toast.success('기록을 남겼어요');
      closeModal();
    } catch {
      toast.error('기록을 올리지 못했어요');
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => {
          const selectedFile = event.target.files?.[0];
          if (selectedFile) {
            setFile(selectedFile);
            setPreview(URL.createObjectURL(selectedFile));
            setRecordState('done');
          }
          event.target.value = '';
        }}
      />
      {schedule && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#0f1e3a]/30 sm:items-center">
          <div className="w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-[0_12px_32px_rgba(15,30,58,0.12)] sm:rounded-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[17px] font-semibold text-[#0f1e3a]">기록 남기기</p>
                <p className="mt-0.5 truncate text-[13px] text-[#5f6f88]">{displayTitle(schedule.title)} 완료</p>
              </div>
              <button type="button" onClick={closeModal} aria-label="닫기" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#5f6f88] transition-colors hover:bg-[#edf3fc]">
                <MaterialIcon icon="close" size={20} color="currentColor" />
              </button>
            </div>

            {groups.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-[13px] text-[#44536b]">
                  올릴 그룹 <span className="text-[#5f6f88]">· 여러 개 고를 수 있어요</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {groups.map((group) => {
                    const selected = groupIds.includes(group.id);
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => setGroupIds((previous) => (
                          selected
                            ? previous.filter((id) => id !== group.id)
                            : [...previous, group.id]
                        ))}
                        className={`h-8 rounded-lg border px-3 text-[13px] transition-colors ${selected ? 'border-[#2a6fe3] bg-[#eaf2ff] font-medium text-[#1f63d6]' : 'border-[#0f1e3a]/10 bg-white text-[#44536b] hover:bg-[#f5f8fd]'}`}
                      >
                        {group.name}
                      </button>
                    );
                  })}
                </div>
                {groupIds.length === 0 && (
                  <p className="mt-2 text-[12px] text-[#5f6f88]">그룹을 안 고르면 내 기록에만 남아요</p>
                )}
              </div>
            )}

            <div className="mb-4 overflow-hidden rounded-xl bg-[#0f1e3a]" style={{ aspectRatio: '4/3' }}>
              {recordState === 'idle' && (
                <div className="relative flex h-full flex-col items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={flipCamera}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white transition-colors hover:bg-white/25"
                  >
                    <MaterialIcon icon="flip_camera_ios" size={16} color="currentColor" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void startRecording(facingMode)}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-[#2a6fe3] transition-transform active:scale-95"
                  >
                    <MaterialIcon icon="videocam" size={24} color="#fff" />
                  </button>
                  <p className="text-[13px] text-white/70">
                    3초 촬영 · {facingMode === 'user' ? '전면' : '후면'} 카메라
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-[13px] text-white/80 transition-colors hover:bg-white/20"
                  >
                    <MaterialIcon icon="upload_file" size={16} color="currentColor" />
                    파일에서 올리기
                  </button>
                </div>
              )}
              {recordState === 'requesting' && (
                <div className="flex h-full items-center justify-center">
                  <p className="text-[14px] text-white">카메라 권한을 요청하는 중</p>
                </div>
              )}
              {recordState === 'recording' && (
                <div className="relative h-full">
                  <video ref={liveVideoCallbackRef} autoPlay muted playsInline className="h-full w-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="font-mono text-[72px] font-medium tabular-nums text-white">{countdown}</span>
                  </div>
                  <div className="absolute left-2 top-2 flex h-6 items-center gap-1.5 rounded-md bg-[#dc2626] px-2">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                    <span className="text-[12px] text-white">녹화 중</span>
                  </div>
                </div>
              )}
              {recordState === 'done' && preview && (
                <div className="relative h-full">
                  <video src={preview} controls playsInline className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      setPreview(null);
                      setRecordState('idle');
                    }}
                    aria-label="다시 찍기"
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-black/50 text-white"
                  >
                    <MaterialIcon icon="refresh" size={16} color="currentColor" />
                  </button>
                </div>
              )}
            </div>

            <textarea
              placeholder="한마디 · 선택"
              value={caption}
              onChange={(event) => setCaption(event.target.value.slice(0, 200))}
              rows={2}
              className="mb-4 w-full resize-none rounded-[10px] border border-[#0f1e3a]/10 bg-white px-3 py-2.5 text-[15px] text-[#0f1e3a] transition-colors placeholder:text-[#98a6ba] focus:border-[#2a6fe3] focus:outline-none focus:ring-3 focus:ring-[#2a6fe3]/15"
            />

            <div className="flex gap-2">
              <button
                type="button"
                disabled={createStudyLog.isPending || recordState === 'recording' || recordState === 'requesting'}
                onClick={() => void submitLog()}
                className="h-11 flex-1 rounded-[10px] bg-[#2a6fe3] text-[15px] font-medium text-white transition-colors hover:bg-[#1f63d6] disabled:opacity-40"
              >
                {createStudyLog.isPending ? '등록하는 중' : '기록 남기기'}
              </button>
              <button
                type="button"
                onClick={closeModal}
                className="h-11 rounded-[10px] border border-[#0f1e3a]/10 px-4 text-[15px] text-[#0f1e3a] transition-colors hover:bg-[#edf3fc]"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
