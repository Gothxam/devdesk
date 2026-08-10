import { describe, expect, it } from 'vitest';

import { compareVersions, formatVersion, parseVersion, satisfies } from './version';

function v(value: string) {
  const parsed = parseVersion(value);
  if (!parsed.ok) throw new Error(`fixture version must be valid: ${value}`);
  return parsed.value;
}

describe('parseVersion', () => {
  it('accepts three numbers', () => {
    expect(v('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(v('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 });
    expect(v('10.20.30')).toEqual({ major: 10, minor: 20, patch: 30 });
  });

  it('rejects everything that is not three numbers', () => {
    // Pre-release tags and build metadata express states this platform has no
    // use for yet, and each is a comparison rule that must be right before
    // anything depends on it.
    for (const bad of ['1.2', '1.2.3.4', '1.2.3-beta', '1.2.3+build', 'v1.2.3', '', '-1.0.0']) {
      expect(parseVersion(bad).ok, bad).toBe(false);
    }
  });

  it('round-trips through its canonical string', () => {
    expect(formatVersion(v('4.5.6'))).toBe('4.5.6');
  });
});

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions(v('2.0.0'), v('1.9.9'))).toBeGreaterThan(0);
    expect(compareVersions(v('1.2.0'), v('1.1.9'))).toBeGreaterThan(0);
    expect(compareVersions(v('1.1.2'), v('1.1.1'))).toBeGreaterThan(0);
    expect(compareVersions(v('1.1.1'), v('1.1.1'))).toBe(0);
  });

  it('orders numerically, not as text', () => {
    // "10.0.0" < "9.0.0" is true for strings and false for versions.
    expect(compareVersions(v('10.0.0'), v('9.0.0'))).toBeGreaterThan(0);
  });
});

describe('satisfies', () => {
  it('accepts a newer patch or minor within the same major', () => {
    expect(satisfies(v('1.2.3'), v('1.2.0'))).toBe(true);
    expect(satisfies(v('1.3.0'), v('1.2.0'))).toBe(true);
    expect(satisfies(v('1.2.0'), v('1.2.0'))).toBe(true);
  });

  it('refuses an older version', () => {
    expect(satisfies(v('1.1.0'), v('1.2.0'))).toBe(false);
  });

  it('refuses a different major', () => {
    expect(satisfies(v('2.0.0'), v('1.0.0'))).toBe(false);
    expect(satisfies(v('0.1.0'), v('1.0.0'))).toBe(false);
  });

  it('treats major zero strictly', () => {
    // Below 1.0.0 the minor number is where breaking changes live by
    // convention. Being wrong here loads a widget that fails at runtime, which
    // is harder to diagnose than a refusal at load time.
    expect(satisfies(v('0.2.0'), v('0.1.0'))).toBe(false);
    expect(satisfies(v('0.1.5'), v('0.1.0'))).toBe(true);
  });
});
