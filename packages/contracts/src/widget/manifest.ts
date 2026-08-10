/**
 * The widget manifest: what a widget declares about itself.
 *
 * ## This is the third-party contract
 *
 * The first-party widgets in M0 load through exactly this schema, validated by
 * exactly this function. That is `S-10` and `DD-008`: first-party code gets no
 * privileged path. If the clock could skip validation, the first third-party
 * widget would discover a set of requirements nothing had ever enforced.
 *
 * ## Validation is total and reports everything
 *
 * `parseWidgetManifest` accepts `unknown`, because a manifest arrives from a
 * file or a bundle and claiming otherwise would be a lie the type system cannot
 * check. It returns every problem it found rather than the first: an author
 * fixing a manifest one error per attempt is a bad experience, and the errors
 * are independent, so there is no reason to stop at one.
 */

import { err, ok, type Result } from '@devdesk/shared';

import {
  isWidgetCapability,
  NO_CAPABILITIES,
  type WidgetCapability,
} from './capability';
import { type IdentityError, type WidgetId, widgetId } from './identity';
import { formatVersion, parseVersion, type VersionError, type WidgetVersion } from './version';

/**
 * The size a widget wants, in logical pixels.
 *
 * Declared, not enforced — placement is the layout actor's and resize arrives
 * with `AC-WGT-6.1`. It is here because a widget's *preferred* size is a
 * property of the widget rather than of an arrangement, and asking an author to
 * supply it at placement time instead would put it in the wrong file.
 */
export interface WidgetSize {
  readonly width: number;
  readonly height: number;
}

/** Everything a widget declares about itself. */
export interface WidgetManifest {
  readonly id: WidgetId;
  readonly name: string;
  readonly version: WidgetVersion;
  /** Shown wherever the user chooses a widget. */
  readonly description: string;
  /**
   * What the widget needs the platform to arbitrate.
   *
   * Empty for every first-party widget in M0 (`AC-FRE-6.1`). Declared here and
   * enforced in M3 — see `capability.ts`.
   */
  readonly capabilities: readonly WidgetCapability[];
  readonly preferredSize: WidgetSize;
}

/** One thing wrong with a manifest. */
export type ManifestError =
  | { readonly kind: 'not-an-object' }
  | { readonly kind: 'missing'; readonly field: string }
  | { readonly kind: 'wrong-type'; readonly field: string; readonly expected: string }
  | { readonly kind: 'bad-id'; readonly cause: IdentityError }
  | { readonly kind: 'bad-version'; readonly cause: VersionError }
  | { readonly kind: 'unknown-capability'; readonly value: string }
  | { readonly kind: 'duplicate-capability'; readonly value: WidgetCapability }
  | { readonly kind: 'bad-size'; readonly field: string; readonly value: unknown };

/**
 * The largest a widget may ask to be, in logical pixels.
 *
 * A preferred size larger than any plausible display is not a preference, it is
 * a mistake or an attempt to cover the desktop. Checked here rather than at
 * placement so the author hears about it when they write it.
 */
const MAX_DIMENSION = 8192;
const MIN_DIMENSION = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(
  source: Record<string, unknown>,
  field: string,
  problems: ManifestError[],
): string | undefined {
  const value = source[field];
  if (value === undefined || value === null) {
    problems.push({ kind: 'missing', field });
    return undefined;
  }
  if (typeof value !== 'string') {
    problems.push({ kind: 'wrong-type', field, expected: 'string' });
    return undefined;
  }
  if (value.trim().length === 0) {
    problems.push({ kind: 'missing', field });
    return undefined;
  }
  return value.trim();
}

function readCapabilities(
  source: Record<string, unknown>,
  problems: ManifestError[],
): readonly WidgetCapability[] {
  const value = source['capabilities'];

  // Absent is not the same as empty, and both are legal — but they must mean the
  // same thing, decided here and once. An absent list means "none", because the
  // alternative is a manifest that gains capabilities by omission.
  if (value === undefined || value === null) return NO_CAPABILITIES;

  if (!Array.isArray(value)) {
    problems.push({ kind: 'wrong-type', field: 'capabilities', expected: 'array of strings' });
    return NO_CAPABILITIES;
  }

  const accepted: WidgetCapability[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      problems.push({ kind: 'wrong-type', field: 'capabilities[]', expected: 'string' });
      continue;
    }
    if (!isWidgetCapability(entry)) {
      problems.push({ kind: 'unknown-capability', value: entry });
      continue;
    }
    if (accepted.includes(entry)) {
      problems.push({ kind: 'duplicate-capability', value: entry });
      continue;
    }
    accepted.push(entry);
  }

  return Object.freeze(accepted);
}

function readSize(
  source: Record<string, unknown>,
  problems: ManifestError[],
): WidgetSize | undefined {
  const value = source['preferredSize'];

  if (value === undefined || value === null) {
    problems.push({ kind: 'missing', field: 'preferredSize' });
    return undefined;
  }
  if (!isRecord(value)) {
    problems.push({ kind: 'wrong-type', field: 'preferredSize', expected: '{ width, height }' });
    return undefined;
  }

  const dimensions: Record<string, number> = {};
  for (const field of ['width', 'height'] as const) {
    const raw = value[field];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      problems.push({ kind: 'bad-size', field, value: raw });
      continue;
    }
    if (raw < MIN_DIMENSION || raw > MAX_DIMENSION) {
      problems.push({ kind: 'bad-size', field, value: raw });
      continue;
    }
    dimensions[field] = raw;
  }

  if (dimensions['width'] === undefined || dimensions['height'] === undefined) return undefined;
  return Object.freeze({ width: dimensions['width'], height: dimensions['height'] });
}

/**
 * Validates an untrusted manifest.
 *
 * Returns **every** problem found, not the first.
 */
export function parseWidgetManifest(
  source: unknown,
): Result<WidgetManifest, readonly ManifestError[]> {
  if (!isRecord(source)) return err(Object.freeze([{ kind: 'not-an-object' } as const]));

  const problems: ManifestError[] = [];

  const rawId = readString(source, 'id', problems);
  let id: WidgetId | undefined;
  if (rawId !== undefined) {
    const parsed = widgetId(rawId);
    if (parsed.ok) id = parsed.value;
    else problems.push({ kind: 'bad-id', cause: parsed.error });
  }

  const name = readString(source, 'name', problems);
  const description = readString(source, 'description', problems);

  const rawVersion = readString(source, 'version', problems);
  let version: WidgetVersion | undefined;
  if (rawVersion !== undefined) {
    const parsed = parseVersion(rawVersion);
    if (parsed.ok) version = parsed.value;
    else problems.push({ kind: 'bad-version', cause: parsed.error });
  }

  const capabilities = readCapabilities(source, problems);
  const preferredSize = readSize(source, problems);

  if (problems.length > 0 || !id || !name || !description || !version || !preferredSize) {
    return err(Object.freeze(problems));
  }

  return ok(
    Object.freeze({
      id,
      name,
      version,
      description,
      capabilities,
      preferredSize,
    }),
  );
}

/** Renders a manifest problem as something an author can act on. */
export function describeManifestError(problem: ManifestError): string {
  switch (problem.kind) {
    case 'not-an-object':
      return 'a manifest must be a JSON object';
    case 'missing':
      return `missing required field "${problem.field}"`;
    case 'wrong-type':
      return `"${problem.field}" must be ${problem.expected}`;
    case 'bad-id':
      return problem.cause.kind === 'malformed'
        ? `"id" must be ${problem.cause.expected}`
        : `"id" is invalid (${problem.cause.kind})`;
    case 'bad-version':
      return `"version" must be major.minor.patch, got "${problem.cause.value}"`;
    case 'unknown-capability':
      return `"${problem.value}" is not a capability this platform can enforce`;
    case 'duplicate-capability':
      return `"${problem.value}" is declared more than once`;
    case 'bad-size':
      return `"preferredSize.${problem.field}" must be between ${MIN_DIMENSION} and ${MAX_DIMENSION}, got ${String(problem.value)}`;
  }
}

/** A one-line summary, for a log or a rejection notice. */
export function describeManifest(manifest: WidgetManifest): string {
  return `${manifest.id} ${formatVersion(manifest.version)} (${manifest.capabilities.length} capabilities)`;
}
