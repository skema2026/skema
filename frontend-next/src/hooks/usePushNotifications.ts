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

const getStoredReminderEnabled = () => (
  typeof window === 'undefined'
    ? true
    : localStorage.getItem('skema_notif_enabled') !== 'false'
);

const getStoredReminderMinutes = () => {
  if (typeof window === 'undefined') return 30;
  const minutes = parseInt(localStorage.getItem('skema_notif_minutes') || '30', 10);
  return Number.isFinite(minutes) ? minutes : 30;
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
  motivation: boolean;
  weekly_report: boolean;
  reminder: boolean;
  comparison: boolean;
  exam_alert: boolean;
};

const DEFAULT_PREFS: NotificationPrefs = {
  motivation: true,
  weekly_report: true,
  reminder: true,
  comparison: true,
  exam_alert: true,
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

  const updatePref = useCallback(async (key: keyof NotificationPrefs, value: boolean) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    await api.put('/notifications/prefs', next);
  }, [prefs]);

  return { prefs, loading, updatePref };
}

export function useReminderSettings() {
  const [enabled, setEnabled] = useState(getStoredReminderEnabled);
  const [minutes, setMinutes] = useState(getStoredReminderMinutes);

  const setNotifEnabled = useCallback((val: boolean) => {
    setEnabled(val);
    localStorage.setItem('skema_notif_enabled', val ? 'true' : 'false');
  }, []);

  const setNotifMinutes = useCallback((val: number) => {
    setMinutes(val);
    localStorage.setItem('skema_notif_minutes', String(val));
  }, []);

  return { enabled, minutes, setNotifEnabled, setNotifMinutes };
}
