/**
 * Vitest suite for Stage 7A surface card dynamic widgets, calendar math,
 * session uptime, leap year handling, and unavailable metrics.
 */

import { describe, expect, it } from 'vitest';
import { formatSessionUptime, getCalendarMonthData } from './surface-card';

describe('Stage 7A Dynamic Widget Mathematics & Telemetry', () => {
  describe('getCalendarMonthData', () => {
    it('calculates 31-day month length and first weekday offset correctly for August 2026', () => {
      const aug2026 = new Date('2026-08-15T12:00:00');
      const data = getCalendarMonthData(aug2026);

      expect(data.monthName).toContain('August');
      expect(data.year).toBe(2026);
      expect(data.today).toBe(15);
      expect(data.totalDays).toBe(31);

      // Aug 1, 2026 is Saturday (index 6)
      expect(data.firstWeekday).toBe(6);
      expect(data.grid.filter((cell) => cell === null).length).toBe(6);
      expect(data.grid.filter((cell) => cell !== null).length).toBe(31);
    });

    it('handles 28-day February in non-leap year (2025)', () => {
      const feb2025 = new Date('2025-02-10T12:00:00');
      const data = getCalendarMonthData(feb2025);

      expect(data.totalDays).toBe(28);
      expect(data.grid.filter((cell) => cell !== null).length).toBe(28);
    });

    it('handles 29-day February in leap year (2024)', () => {
      const feb2024 = new Date('2024-02-10T12:00:00');
      const data = getCalendarMonthData(feb2024);

      expect(data.totalDays).toBe(29);
      expect(data.grid.filter((cell) => cell !== null).length).toBe(29);
    });

    it('handles 30-day month (April 2026)', () => {
      const apr2026 = new Date('2026-04-05T12:00:00');
      const data = getCalendarMonthData(apr2026);

      expect(data.totalDays).toBe(30);
      expect(data.grid.filter((cell) => cell !== null).length).toBe(30);
    });
  });

  describe('formatSessionUptime', () => {
    it('formats milliseconds into HH:MM:SS format', () => {
      expect(formatSessionUptime(0)).toBe('00:00:00');
      expect(formatSessionUptime(45000)).toBe('00:00:45');
      expect(formatSessionUptime(125000)).toBe('00:02:05');
      expect(formatSessionUptime(3665000)).toBe('01:01:05');
    });

    it('handles negative or invalid elapsed values gracefully', () => {
      expect(formatSessionUptime(-5000)).toBe('00:00:00');
    });
  });
});
