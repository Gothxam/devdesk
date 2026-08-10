/**
 * A widget's version.
 *
 * Semantic versioning's three numbers and nothing else — no pre-release tags, no
 * build metadata. Those exist to express states this platform has no use for
 * yet, and every one of them is a comparison rule that has to be right before
 * anything depends on it. They can be added when something needs them; removing
 * them later would be a breaking change to every manifest ever written.
 *
 * Version is compared, not just stored: `AC-WGT` compatibility and the M3
 * contract negotiation both need to answer "is this newer" and "is this
 * compatible", and a string comparison answers neither — `"10.0.0" < "9.0.0"` is
 * true for strings and false for versions.
 */

import { err, ok, type Result } from '@devdesk/shared';

/** A three-number version. */
export interface WidgetVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Why a version string was rejected. */
export type VersionError =
  | { readonly kind: 'malformed'; readonly value: string }
  | { readonly kind: 'negative'; readonly value: string };

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** Parses `major.minor.patch`. */
export function parseVersion(value: string): Result<WidgetVersion, VersionError> {
  const match = VERSION.exec(value.trim());
  if (!match) return err({ kind: 'malformed', value });

  const [, major, minor, patch] = match;
  const parsed = {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };

  // The regex already excludes a sign, so this catches only the unrepresentable.
  if (!Number.isSafeInteger(parsed.major + parsed.minor + parsed.patch)) {
    return err({ kind: 'negative', value });
  }

  return ok(Object.freeze(parsed));
}

/** Renders a version back to its canonical string. */
export function formatVersion(version: WidgetVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/** Orders two versions: negative if `a` is older, positive if newer, 0 if equal. */
export function compareVersions(a: WidgetVersion, b: WidgetVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Whether `candidate` can stand in for something built against `required`.
 *
 * Same major, and at least the required minor and patch — the ordinary semver
 * reading. Major zero is treated strictly: below 1.0.0 the minor number is where
 * breaking changes live by convention, so `0.2.0` does not satisfy `0.1.0`.
 * Being wrong in this direction loads a widget that then fails at runtime, which
 * is far harder to diagnose than a refusal at load time.
 */
export function satisfies(candidate: WidgetVersion, required: WidgetVersion): boolean {
  if (candidate.major !== required.major) return false;
  if (candidate.major === 0 && candidate.minor !== required.minor) return false;
  return compareVersions(candidate, required) >= 0;
}
