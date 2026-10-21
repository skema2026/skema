'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
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
      toast.error('카메라/마이크 권한을 허용해주세요.');
      setRecordState('idle');
    }
  };

  const submitLog = async () => {
    if (!schedule) return;
    if (!file && !caption.trim()) {
      toast.error('영상 또는 한 마디를 입력해주세요.');
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
      toast.success('기록이 올라갔어요!');
      closeModal();
    } catch {
      toast.error('업로드에 실패했습니다.');
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
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-sm rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-base font-black text-slate-950">기록 남기기</p>
                <p className="text-xs font-bold text-blue-600">{schedule.title} 완료</p>
              </div>
              <button type="button" onClick={closeModal} className="text-slate-400">
                <MaterialIcon icon="close" size={20} color="currentColor" />
              </button>
            </div>

            {groups.length > 0 && (
              <div className="mb-3">
                <p className="mb-1.5 text-[11px] font-black text-slate-400">
                  올릴 그룹 <span className="text-slate-300">(복수 선택 가능 · 내 기록에도 자동 표시)</span>
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
                        className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${selected ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}
                      >
                        {group.name}
                      </button>
                    );
                  })}
                </div>
                {groupIds.length === 0 && (
                  <p className="mt-1 text-[11px] text-slate-400">그룹 미선택 → 내 기록에만 저장</p>
                )}
              </div>
            )}

            <div className="mb-3 overflow-hidden rounded-2xl bg-slate-900" style={{ aspectRatio: '4/3' }}>
              {recordState === 'idle' && (
                <div className="relative flex h-full flex-col items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={flipCamera}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-slate-700/80 text-white"
                  >
                    <MaterialIcon icon="flip_camera_ios" size={16} color="currentColor" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void startRecording(facingMode)}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 shadow-lg transition active:scale-95"
                  >
                    <MaterialIcon icon="videocam" size={24} color="#fff" />
                  </button>
                  <p className="text-xs font-black text-slate-400">
                    3초 촬영 · {facingMode === 'user' ? '전면' : '후면'} 카메라
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-full bg-slate-800 px-3 py-1.5 text-xs font-black text-slate-300"
                  >
                    <MaterialIcon icon="upload_file" size={12} color="currentColor" />
                    파일에서 올리기
                  </button>
                </div>
              )}
              {recordState === 'requesting' && (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm font-black text-white">카메라 권한 요청 중...</p>
                </div>
              )}
              {recordState === 'recording' && (
                <div className="relative h-full">
                  <video ref={liveVideoCallbackRef} autoPlay muted playsInline className="h-full w-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[72px] font-black text-white drop-shadow-lg">{countdown}</span>
                  </div>
                  <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                    <span className="text-[10px] font-black text-white">REC</span>
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
                    className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                  >
                    <MaterialIcon icon="refresh" size={12} color="currentColor" />
                  </button>
                </div>
              )}
            </div>

            <textarea
              placeholder="한 마디 남기기 (선택사항)"
              value={caption}
              onChange={(event) => setCaption(event.target.value.slice(0, 200))}
              rows={2}
              className="mb-3 w-full resize-none rounded-xl border border-blue-100 bg-[#fbfdff] px-3 py-2 text-sm font-bold text-slate-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />

            <div className="flex gap-2">
              <button
                type="button"
                disabled={createStudyLog.isPending || recordState === 'recording' || recordState === 'requesting'}
                onClick={() => void submitLog()}
                className="flex-1 rounded-xl bg-blue-600 py-3 text-sm font-black text-white disabled:opacity-40"
              >
                {createStudyLog.isPending ? '등록 중...' : '기록 남기기'}
              </button>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-xl border border-slate-200 px-3 py-3 text-sm font-black text-slate-700"
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
