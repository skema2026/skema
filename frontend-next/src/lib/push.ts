import { api } from '@/lib/api';

type PublicKeyResponse = {
  enabled: boolean;
  publicKey: string;
};

const isPushSupported = () => (
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window
);

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

const getRegistration = async () => {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register('/sw.js');
};

export async function getPushAvailability() {
  if (!isPushSupported()) {
    return { supported: false, enabled: false, subscribed: false, reason: 'unsupported' as const };
  }
  if (!window.isSecureContext) {
    return { supported: false, enabled: false, subscribed: false, reason: 'insecure' as const };
  }

  const { data } = await api.get<PublicKeyResponse>('/push/public-key');
  const registration = await getRegistration();
  const subscription = await registration.pushManager.getSubscription();
  return {
    supported: true,
    enabled: data.enabled,
    subscribed: !!subscription,
    reason: null,
  };
}

export async function subscribeToPush() {
  if (!isPushSupported()) {
    throw new Error('unsupported');
  }
  if (!window.isSecureContext) {
    throw new Error('insecure');
  }

  const permission = await window.Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('permission_denied');
  }

  const { data } = await api.get<PublicKeyResponse>('/push/public-key');
  if (!data.enabled || !data.publicKey) {
    throw new Error('server_disabled');
  }

  const registration = await getRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    });
  }

  await api.post('/push/subscriptions', subscription.toJSON());
  return subscription;
}

export async function unsubscribeFromPush() {
  if (!isPushSupported() || !window.isSecureContext) return;

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  await api.delete('/push/subscriptions', {
    params: { endpoint: subscription.endpoint },
  });
  await subscription.unsubscribe();
}

export async function sendTestPush() {
  const { data } = await api.post('/push/test');
  return data as { sent?: number; failed?: number; disabled?: boolean };
}
