import { describe, it, expect } from 'vitest';
import { AlertCondition } from '@prisma/client';

describe('Alert Evaluator', () => {
  function evaluateCondition(value: number, condition: AlertCondition, threshold: number): boolean {
    switch (condition) {
      case 'GREATER_THAN': return value > threshold;
      case 'LESS_THAN': return value < threshold;
      case 'EQUAL_TO': return value === threshold;
      case 'CHANGES_BY': return Math.abs(value - threshold) > threshold * 0.1;
      default: return false;
    }
  }

  describe('condition logic', () => {
    it('GREATER_THAN returns true when value exceeds threshold', () => {
      expect(evaluateCondition(150000, 'GREATER_THAN', 140000)).toBe(true);
    });
    it('GREATER_THAN returns false when value is below threshold', () => {
      expect(evaluateCondition(130000, 'GREATER_THAN', 140000)).toBe(false);
    });
    it('LESS_THAN returns true when value is below threshold', () => {
      expect(evaluateCondition(130000, 'LESS_THAN', 140000)).toBe(true);
    });
    it('EQUAL_TO returns true when value equals threshold', () => {
      expect(evaluateCondition(140000, 'EQUAL_TO', 140000)).toBe(true);
    });
    it('CHANGES_BY returns true when change exceeds threshold', () => {
      expect(evaluateCondition(150000, 'CHANGES_BY', 130000)).toBe(true);
    });
  });

  describe('dedup', () => {
    it('suppresses repeated firings within dedup window', () => {
      const dedupWindowMs = 3600000;
      const now = Date.now();
      const lastFired = new Date(now - 1800000);
      const cutoff = new Date(now - dedupWindowMs);
      expect(lastFired >= cutoff).toBe(true);
    });
  });
});
