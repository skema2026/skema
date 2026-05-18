'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { AIChat } from '@/components/ai-chat/AIChat';
import MaterialIcon from '@/components/common/MaterialIcon';

type ChatDockSide = 'left' | 'right';

interface FloatingChatDrag {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

interface FloatingAIChatProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CHAT_BUTTON_SIZE = 64;
const CHAT_EDGE_MARGIN = 16;
const CHAT_PANEL_GAP = 12;
const CHAT_PANEL_MAX_WIDTH = 420;
const CHAT_PANEL_MAX_HEIGHT = 620;
const SNAP_TRANSITION = 'left 260ms cubic-bezier(0.22, 1, 0.36, 1), top 260ms cubic-bezier(0.22, 1, 0.36, 1)';

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export function FloatingAIChat({ open, onOpenChange }: FloatingAIChatProps) {
  const [dockSide, setDockSide] = useState<ChatDockSide>('right');
  const [buttonPosition, setButtonPosition] = useState({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isSnapping, setIsSnapping] = useState(false);
  const dragRef = useRef<FloatingChatDrag | null>(null);

  const toggleChat = useCallback(() => {
    onOpenChange(!open);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncViewport = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setViewport({ width, height });
      setButtonPosition((current) => {
        const isInitial = current.x === 0 && current.y === 0;
        const nextX = isInitial
          ? width - CHAT_BUTTON_SIZE - CHAT_EDGE_MARGIN
          : clamp(current.x, CHAT_EDGE_MARGIN, width - CHAT_BUTTON_SIZE - CHAT_EDGE_MARGIN);
        const nextY = isInitial
          ? height - CHAT_BUTTON_SIZE - 96
          : clamp(current.y, 72, height - CHAT_BUTTON_SIZE - CHAT_EDGE_MARGIN);
        setDockSide(nextX + CHAT_BUTTON_SIZE / 2 < width / 2 ? 'left' : 'right');
        return { x: nextX, y: nextY };
      });
    };

    syncViewport();
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const moveChat = (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      if (!drag || !viewport.width || !viewport.height) return;

      const deltaX = clientX - drag.startX;
      const deltaY = clientY - drag.startY;
      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) drag.moved = true;

      setButtonPosition({
        x: clamp(drag.originX + deltaX, CHAT_EDGE_MARGIN, viewport.width - CHAT_BUTTON_SIZE - CHAT_EDGE_MARGIN),
        y: clamp(drag.originY + deltaY, 72, viewport.height - CHAT_BUTTON_SIZE - CHAT_EDGE_MARGIN),
      });
    };

    const finishChatDrag = (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      if (!drag || !viewport.width || !viewport.height) return;

      const didMove = drag.moved;
      const finalX = clamp(
        drag.originX + clientX - drag.startX,
        CHAT_EDGE_MARGIN,
        viewport.width - CHAT_BUTTON_SIZE - CHAT_EDGE_MARGIN,
      );
      const finalY = clamp(
        drag.originY + clientY - drag.startY,
        72,
        viewport.height - CHAT_BUTTON_SIZE - CHAT_EDGE_MARGIN,
      );
      dragRef.current = null;
      setIsDragging(false);

      if (!didMove) {
        toggleChat();
        return;
      }

      const nextDockSide: ChatDockSide =
        finalX + CHAT_BUTTON_SIZE / 2 < viewport.width / 2 ? 'left' : 'right';
      setIsSnapping(true);
      setDockSide(nextDockSide);
      setButtonPosition({
        x: nextDockSide === 'left'
          ? CHAT_EDGE_MARGIN
          : viewport.width - CHAT_BUTTON_SIZE - CHAT_EDGE_MARGIN,
        y: finalY,
      });
      window.setTimeout(() => setIsSnapping(false), 280);
    };

    const handleMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      moveChat(event.clientX, event.clientY);
    };
    const handleMouseUp = (event: MouseEvent) => {
      finishChatDrag(event.clientX, event.clientY);
    };
    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      moveChat(touch.clientX, touch.clientY);
    };
    const handleTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      finishChatDrag(touch.clientX, touch.clientY);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, viewport.width, viewport.height, toggleChat]);

  const startDrag = (clientX: number, clientY: number) => {
    dragRef.current = {
      startX: clientX,
      startY: clientY,
      originX: buttonPosition.x,
      originY: buttonPosition.y,
      moved: false,
    };
    setIsDragging(true);
    setIsSnapping(false);
  };

  const handleMouseDown = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    startDrag(event.clientX, event.clientY);
  };

  const handleTouchStart = (event: ReactTouchEvent<HTMLButtonElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    startDrag(touch.clientX, touch.clientY);
  };

  const panelWidth = viewport.width
    ? Math.min(CHAT_PANEL_MAX_WIDTH, Math.max(300, viewport.width - CHAT_BUTTON_SIZE - CHAT_PANEL_GAP * 4))
    : CHAT_PANEL_MAX_WIDTH;
  const panelHeight = viewport.height
    ? Math.min(CHAT_PANEL_MAX_HEIGHT, viewport.height - CHAT_EDGE_MARGIN * 2)
    : CHAT_PANEL_MAX_HEIGHT;
  const panelTop = viewport.height
    ? clamp(buttonPosition.y - 24, CHAT_EDGE_MARGIN, viewport.height - panelHeight - CHAT_EDGE_MARGIN)
    : CHAT_EDGE_MARGIN;
  const panelLeft =
    dockSide === 'left'
      ? clamp(
          buttonPosition.x + CHAT_BUTTON_SIZE + CHAT_PANEL_GAP,
          CHAT_EDGE_MARGIN,
          Math.max(CHAT_EDGE_MARGIN, viewport.width - panelWidth - CHAT_EDGE_MARGIN),
        )
      : clamp(
          buttonPosition.x - panelWidth - CHAT_PANEL_GAP,
          CHAT_EDGE_MARGIN,
          Math.max(CHAT_EDGE_MARGIN, viewport.width - panelWidth - CHAT_EDGE_MARGIN),
        );
  const positionTransition = isDragging ? 'none' : SNAP_TRANSITION;

  if (!viewport.width) return null;

  return (
    <>
      {open && (
        <div
          className="fixed z-50 overflow-hidden rounded-lg border border-blue-100 bg-white shadow-2xl"
          style={{
            left: panelLeft,
            top: panelTop,
            width: panelWidth,
            height: panelHeight,
            transition: positionTransition,
            willChange: isDragging || isSnapping ? 'left, top' : undefined,
          }}
        >
          <AIChat
            onClose={() => onOpenChange(false)}
            className="border-l-0"
            height={panelHeight}
          />
        </div>
      )}

      <button
        type="button"
        aria-label="AI 채팅 버튼"
        aria-pressed={open}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className="fixed z-[60] flex items-center justify-center rounded-full bg-blue-600 text-white shadow-2xl ring-4 ring-white transition hover:bg-blue-700 active:scale-95"
        style={{
          left: buttonPosition.x,
          top: buttonPosition.y,
          width: CHAT_BUTTON_SIZE,
          height: CHAT_BUTTON_SIZE,
          touchAction: 'none',
          cursor: isDragging ? 'grabbing' : 'grab',
          transition: positionTransition,
          willChange: isDragging || isSnapping ? 'left, top' : undefined,
        }}
      >
        <span className="relative flex h-full w-full items-center justify-center">
          <MaterialIcon icon={open ? 'close' : 'smart_toy'} size={26} color="#fff" />
          {!open && (
            <span className="absolute -right-1 -top-1 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-black text-blue-700">
              AI
            </span>
          )}
        </span>
      </button>
    </>
  );
}
