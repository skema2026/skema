'use client';

import { useState, useEffect } from 'react';

export type NotifPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotifPermission>('default');

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission as NotifPermission);
  }, []);

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
