'use client';

import { useState } from 'react';

export type NotifPermission = 'default' | 'granted' | 'denied' | 'unsupported';

const getCurrentPermission = (): NotifPermission => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission as NotifPermission;
};

export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotifPermission>(getCurrentPermission);

  const requestPermission = async (): Promise<NotifPermission> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    const result = await Notification.requestPermission();
    setPermission(result as NotifPermission);
    return result as NotifPermission;
  };

  const sendTestNotification = () => {
    if (permission !== 'granted') return;
    new Notification('Skema 알림 테스트 ✅', {
      body: '알림이 정상적으로 작동합니다!',
      icon: '/icon-192.png',
    });
  };

  return { permission, requestPermission, sendTestNotification };
}
