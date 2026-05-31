'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';

function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}

export type PushPermission = 'default' | 'granted' | 'denied' | 'unsupported';

const getCurrentPushPermission = (): PushPermission => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission as PushPermission;
};


export function usePushNotifications() {
  const [permission, setPermission] = useState<PushPermission>(getCurrentPushPermission);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if ('serviceWorker' in navigator && Notification.permission === 'granted') {
      navigator.serviceWorker.ready.then((reg) =>
        reg.pushManager.getSubscription().then((sub) => setIsSubscribed(!!sub))
      );
    }
  }, []);

  const subscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    setIsLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PushPermission);
      if (perm !== 'granted') return;

      const { data } = await api.get<{ enabled: boolean; publicKey: string }>('/push/public-key');
      const reg = await navigator.serviceWorker.ready;

      let subscription: PushSubscription;
      if (data.enabled && data.publicKey) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(data.publicKey),
        });
      } else {
        // VAPID 미설정 — 기존 구독이 있으면 재사용, 없으면 무시
        const existing = await reg.pushManager.getSubscription();
        if (!existing) { setIsSubscribed(false); return; }
        subscription = existing;
      }

      const json = subscription.toJSON();
      await api.post('/push/subscriptions', {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      });
      setIsSubscribed(true);
    } catch {
      // permission denied or push not supported
    } finally {
      setIsLoading(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return;
    setIsLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.delete(`/push/subscriptions?endpoint=${encodeURIComponent(sub.endpoint)}`);
        await sub.unsubscribe();
      }
      setIsSubscribed(false);
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  const sendTest = useCallback(async () => {
    await api.post('/push/test');
  }, []);

  return { permission, isSubscribed, isLoading, subscribe, unsubscribe, sendTest };
}

export type NotificationPrefs = {
  reminder_start: boolean;
  reminder_incomplete: boolean;
  reminder_minutes: number;
  exam_alert: boolean;
  motivation: boolean;
  weekly_report: boolean;
  comparison: boolean;
};

const DEFAULT_PREFS: NotificationPrefs = {
  reminder_start: true,
  reminder_incomplete: true,
  reminder_minutes: 30,
  exam_alert: true,
  motivation: true,
  weekly_report: true,
  comparison: false,
};

export function useNotificationPrefs() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<NotificationPrefs>('/notifications/prefs')
      .then(({ data }) => { setPrefs({ ...DEFAULT_PREFS, ...data }); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // functional update로 항상 최신 prefs 기반 → 연속 토글 시 덮어쓰기 방지
  const updatePref = useCallback(<K extends keyof NotificationPrefs>(key: K, value: NotificationPrefs[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      api.put('/notifications/prefs', next).catch(() => {});
      return next;
    });
  }, []);

  return { prefs, loading, updatePref };
}
