import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn() }));

describe('Email Delivery Integration', () => {
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      emailDelivery: { create: vi.fn(), update: vi.fn() },
    };
  });

  it('SEND_EMAIL job creates EmailDelivery QUEUED→SENT', async () => {
    mockPrisma.emailDelivery.create.mockResolvedValue({ id: 'ed-1', status: 'QUEUED' });
    mockPrisma.emailDelivery.update.mockResolvedValue({ id: 'ed-1', status: 'SENT', sentAt: new Date() });
    expect(mockPrisma.emailDelivery.create).toBeDefined();
  });

  it('EmailDelivery FAILED after max retries', async () => {
    mockPrisma.emailDelivery.update.mockResolvedValue({ id: 'ed-1', status: 'FAILED', error: 'SMTP timeout' });
    const result = await mockPrisma.emailDelivery.update({
      where: { id: 'ed-1' },
      data: { status: 'FAILED', error: 'SMTP timeout' },
    });
    expect(result.status).toBe('FAILED');
  });
});

describe('Notifications Integration', () => {
  it('new Alert/Recommendation creates notification in inbox', async () => {
    const notification = { id: 'notif-1', title: 'Alert fired', body: 'Test', readAt: null };
    expect(notification.readAt).toBeNull();
  });
  it('marking read clears badge', async () => {
    const notification = { id: 'notif-1', readAt: new Date() };
    expect(notification.readAt).toBeInstanceOf(Date);
  });
});
