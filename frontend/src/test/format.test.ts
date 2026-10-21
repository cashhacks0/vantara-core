import { describe, expect, it } from 'vitest';
import { bytes, compact, duration, relativeTime, statusTone } from '../lib/format';

describe('format helpers', () => {
  it('formats byte sizes', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(1024)).toBe('1.0 KB');
    expect(bytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(bytes(null)).toBe('—');
  });
  it('compacts large counts', () => {
    expect(compact(1000)).toMatch(/1K/i);
    expect(compact(1200000)).toMatch(/1\.2M/i);
  });
  it('renders relative time labels', () => {
    expect(relativeTime(new Date().toISOString())).toBe('just now');
    expect(relativeTime(null)).toBe('—');
  });
  it('measures durations safely', () => {
    const start = new Date(Date.now() - 2000).toISOString();
    expect(duration(start, new Date().toISOString())).toMatch(/s$/);
    expect(duration(null)).toBe('—');
  });
  it('maps statuses to tones', () => {
    expect(statusTone('completed')).toBe('success');
    expect(statusTone('failed')).toBe('danger');
    expect(statusTone('cancelled')).toBe('warn');
    expect(statusTone('unknown')).toBe('neutral');
  });
});
