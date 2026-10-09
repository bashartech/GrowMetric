import { describe, it, expect, vi } from 'vitest';
import { reportStorageKey } from '../../src/modules/reports/report.service.js';

vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn() }));

/**
 * The PDF is served through an authenticated route, so `pdfUrl` holds a storage
 * key. Rows written before that change hold a `/uploads/...` URL and must keep
 * working.
 */
describe('Report storage keys', () => {
  it('passes a storage key through unchanged', () => {
    expect(reportStorageKey('org-1/reports/report-1.pdf')).toBe(
      'org-1/reports/report-1.pdf',
    );
  });

  it('converts a legacy /uploads URL to a storage key', () => {
    expect(reportStorageKey('/uploads/reports/legacy.pdf')).toBe('reports/legacy.pdf');
  });

  it('returns null for a missing or unusable value', () => {
    expect(reportStorageKey(null)).toBeNull();
    expect(reportStorageKey(undefined)).toBeNull();
    expect(reportStorageKey('')).toBeNull();
    // A bare path is not a storage key and must not be resolved on disk.
    expect(reportStorageKey('/etc/passwd')).toBeNull();
  });
});
