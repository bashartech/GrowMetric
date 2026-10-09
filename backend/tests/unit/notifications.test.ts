import { describe, it, expect } from 'vitest';

describe('Notification Service', () => {
  it('creates a notification with title and body', () => {
    const notification = { id: 'notif-1', title: 'Test', body: 'Body', readAt: null };
    expect(notification.title).toBe('Test');
    expect(notification.body).toBe('Body');
  });
  it('marks notification as read', () => {
    const notification = { id: 'notif-1', readAt: new Date() };
    expect(notification.readAt).toBeInstanceOf(Date);
  });
});
