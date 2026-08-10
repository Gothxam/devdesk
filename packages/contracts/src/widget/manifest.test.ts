import { describe, expect, it } from 'vitest';

import { describeManifestError, parseWidgetManifest, type ManifestError } from './manifest';

const VALID = {
  id: 'devdesk.clock',
  name: 'Clock',
  version: '1.0.0',
  description: 'The time, on your desktop.',
  capabilities: [],
  preferredSize: { width: 240, height: 120 },
};

function kinds(problems: readonly ManifestError[]): string[] {
  return problems.map((problem) => problem.kind);
}

describe('parseWidgetManifest', () => {
  it('accepts a complete manifest and freezes it', () => {
    const parsed = parseWidgetManifest(VALID);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.id).toBe('devdesk.clock');
    expect(parsed.value.version).toEqual({ major: 1, minor: 0, patch: 0 });
    expect(Object.isFrozen(parsed.value)).toBe(true);
    expect(Object.isFrozen(parsed.value.capabilities)).toBe(true);
  });

  it('rejects anything that is not an object', () => {
    for (const bad of [null, undefined, 42, 'a manifest', [], true]) {
      const parsed = parseWidgetManifest(bad);
      expect(parsed.ok, String(bad)).toBe(false);
    }
  });

  it('reports every problem rather than the first', () => {
    // An author fixing a manifest one error per attempt is a bad experience,
    // and these errors are independent.
    const parsed = parseWidgetManifest({
      id: 'Clock',
      version: 'one',
      preferredSize: { width: 0, height: 99_999 },
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;

    expect(parsed.error.length).toBeGreaterThanOrEqual(5);
    expect(kinds(parsed.error)).toContain('bad-id');
    expect(kinds(parsed.error)).toContain('bad-version');
    expect(kinds(parsed.error)).toContain('missing');
    expect(kinds(parsed.error)).toContain('bad-size');
  });

  it('treats an absent capability list as none, not as unrestricted', () => {
    // Absent and empty must mean the same thing, decided once here. The
    // alternative is a manifest that gains capabilities by omission.
    const { capabilities: _omitted, ...withoutCapabilities } = VALID;
    const parsed = parseWidgetManifest(withoutCapabilities);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.capabilities).toEqual([]);
  });

  it('rejects a capability the platform cannot enforce', () => {
    // SEC-2. An open string would let a manifest request
    // `filesystem.everything` and be accepted by a validator with no idea what
    // it means.
    const parsed = parseWidgetManifest({
      ...VALID,
      capabilities: ['filesystem.everything'],
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(kinds(parsed.error)).toContain('unknown-capability');
  });

  it('accepts capabilities the platform knows', () => {
    const parsed = parseWidgetManifest({
      ...VALID,
      capabilities: ['system.metrics', 'clipboard.read'],
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.capabilities).toEqual(['system.metrics', 'clipboard.read']);
  });

  it('rejects a capability declared twice', () => {
    const parsed = parseWidgetManifest({
      ...VALID,
      capabilities: ['system.metrics', 'system.metrics'],
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(kinds(parsed.error)).toContain('duplicate-capability');
  });

  it('rejects a preferred size that could cover the desktop', () => {
    const parsed = parseWidgetManifest({
      ...VALID,
      preferredSize: { width: 99_999, height: 99_999 },
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(kinds(parsed.error)).toContain('bad-size');
  });

  it('rejects a preferred size too small to interact with', () => {
    const parsed = parseWidgetManifest({ ...VALID, preferredSize: { width: 4, height: 4 } });
    expect(parsed.ok).toBe(false);
  });

  it('rejects a non-numeric or non-finite dimension', () => {
    for (const bad of [{ width: '240', height: 120 }, { width: Number.NaN, height: 120 }]) {
      expect(parseWidgetManifest({ ...VALID, preferredSize: bad }).ok).toBe(false);
    }
  });

  it('rejects a blank required string', () => {
    for (const field of ['name', 'description'] as const) {
      const parsed = parseWidgetManifest({ ...VALID, [field]: '   ' });
      expect(parsed.ok, field).toBe(false);
      if (!parsed.ok) expect(kinds(parsed.error)).toContain('missing');
    }
  });

  it('describes every problem in terms an author can act on', () => {
    const parsed = parseWidgetManifest({ id: 'Clock', capabilities: ['nope'] });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;

    for (const problem of parsed.error) {
      const described = describeManifestError(problem);
      expect(described.length).toBeGreaterThan(0);
      expect(described).not.toContain('undefined');
    }
  });

  it('validates a first-party manifest by the same path as any other', () => {
    // S-10, DD-008: first-party code gets no privileged path. If the clock could
    // skip validation, the first third-party widget would discover requirements
    // nothing had ever enforced.
    const firstParty = parseWidgetManifest(VALID);
    const thirdParty = parseWidgetManifest({ ...VALID, id: 'com.acme.clock' });

    expect(firstParty.ok).toBe(true);
    expect(thirdParty.ok).toBe(true);
  });
});
