'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import type { NotificationDTO } from '@/lib/types/notifications';

interface Props {
  onCountChange: (count: number) => void;
}

export function NotificationBadge({ onCountChange }: Props) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const result = await api.notifications.list();
        const unread = (result.notifications ?? []).filter((n: NotificationDTO) => !n.readAt).length;
        setCount(unread);
        onCountChange(unread);
      } catch {}
    }
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [onCountChange]);

  if (count === 0) return null;

  return (
    <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-[var(--destructive)] rounded-full">
      {count > 9 ? '9+' : count}
    </span>
  );
}
