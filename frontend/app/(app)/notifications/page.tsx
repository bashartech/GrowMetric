'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import type { NotificationDTO } from '@/lib/types';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadNotifications(); }, []);

  async function loadNotifications() {
    try {
      const result = await api.notifications.list();
      setNotifications(result.notifications ?? []);
    } catch {}
    setLoading(false);
  }

  async function handleMarkRead(id: string) {
    try {
      await api.notifications.markRead(id);
      await loadNotifications();
    } catch {}
  }

  async function handleMarkAllRead() {
    try {
      await api.notifications.markAllRead();
      await loadNotifications();
    } catch {}
  }

  if (loading) return <div className="p-6">Loading notifications...</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Notifications</h1>
        <button onClick={handleMarkAllRead} className="px-4 py-2 bg-muted text-foreground border border-border rounded hover:bg-surface-hover">Mark all read</button>
      </div>
      <div className="space-y-4">
        {notifications.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No notifications.</div>
        ) : (
          notifications.map(notif => (
            <div key={notif.id} className={`border rounded-lg p-4 ${notif.readAt ? 'opacity-60' : 'border-[rgba(59,130,246,0.35)] bg-[rgba(59,130,246,0.15)]'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold">{notif.title}</h3>
                  <p className="text-sm">{notif.body}</p>
                  <span className="text-xs">{new Date(notif.createdAt).toLocaleString()}</span>
                </div>
                {!notif.readAt && (
                  <button onClick={() => handleMarkRead(notif.id)} className="px-3 py-1 text-sm bg-card border rounded">Mark read</button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
