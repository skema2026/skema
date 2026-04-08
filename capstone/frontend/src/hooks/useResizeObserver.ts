// src/hooks/useResizeObserver.ts
import { useLayoutEffect, useRef } from "react";

export default function useResizeObserver(
  cb: (rect: DOMRect) => void
) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver(([entry]) => {
      cb(entry.contentRect);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [cb]);

  return ref;
}
