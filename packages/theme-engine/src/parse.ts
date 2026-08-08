/**
 * Parsing a theme file into a validated {@link ThemeSource}.
 *
 * A theme arrives as untrusted data (TH-1, Trust Zone 3). SEC-2 requires it to
 * be parsed into a validated domain type at the boundary — validate-then-pass-
 * the-raw-value is prohibited, because it permits the shape to change between
 * the check and the use.
 *
 * Every rejection names the offending path so an author can fix it (EM-6). A
 * theme that fails here never partially applies (`AC-THM-7.4`).
 */

import { type Result, err, ok } from '@devdesk/shared';

import {
  LAYERS,
  type ThemeMode,
  type ThemeSource,
  type TokenDefinition,
  type TokenLayerSource,
  type TokenSet,
  isTokenKind,
  tokenId,
} from './token';

/** Why a theme file was rejected. */
export interface ThemeParseError {
  /** Dotted path to the offending value, e.g. `modes.dark.base.color.bg.kind`. */
  readonly path: string;
  readonly reason: string;
}

const MODES: readonly ThemeMode[] = ['light', 'dark'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDefinition(raw: unknown, path: string): Result<TokenDefinition, ThemeParseError> {
  if (!isRecord(raw)) {
    return err({ path, reason: 'expected an object with "kind" and "value"' });
  }

  const kind = raw['kind'];
  if (typeof kind !== 'string') {
    return err({ path: `${path}.kind`, reason: 'expected a string' });
  }
  if (!isTokenKind(kind)) {
    return err({
      path: `${path}.kind`,
      reason: `"${kind}" is not a known token kind. A token with an unknown kind is never accessibility-overridden, so this is rejected rather than ignored.`,
    });
  }

  const value = raw['value'];

  if (typeof value === 'string') {
    return ok({ kind, value: { form: 'literal', value } });
  }

  if (isRecord(value) && typeof value['ref'] === 'string') {
    const fallback = value['fallback'];
    if (fallback !== undefined && typeof fallback !== 'string') {
      return err({ path: `${path}.value.fallback`, reason: 'expected a string' });
    }
    return ok({
      kind,
      value:
        fallback === undefined
          ? { form: 'reference', to: tokenId(value['ref']) }
          : { form: 'reference', to: tokenId(value['ref']), fallback },
    });
  }

  return err({
    path: `${path}.value`,
    reason: 'expected a literal string or an object of the form { "ref": "other.token" }',
  });
}

function parseLayer(raw: unknown, path: string): Result<TokenLayerSource, ThemeParseError> {
  if (raw === undefined) return ok({});
  if (!isRecord(raw)) return err({ path, reason: 'expected an object of token definitions' });

  const out: Record<string, TokenDefinition> = {};
  for (const [name, definition] of Object.entries(raw)) {
    const parsed = parseDefinition(definition, `${path}.${name}`);
    if (!parsed.ok) return parsed;
    out[name] = parsed.value;
  }
  return ok(out);
}

function parseSet(raw: unknown, path: string): Result<TokenSet, ThemeParseError> {
  if (!isRecord(raw)) return err({ path, reason: 'expected an object with token layers' });

  const layers: Partial<Record<(typeof LAYERS)[number], TokenLayerSource>> = {};
  for (const layer of LAYERS) {
    const parsed = parseLayer(raw[layer], `${path}.${layer}`);
    if (!parsed.ok) return parsed;
    layers[layer] = parsed.value;
  }

  return ok({
    base: layers.base ?? {},
    semantic: layers.semantic ?? {},
    component: layers.component ?? {},
  });
}

/**
 * Parses untrusted JSON into a {@link ThemeSource}.
 *
 * Executable content cannot survive this: the parser reads only strings and
 * plain objects, and every other JSON type is rejected. A theme has no shape in
 * which code could be expressed, which is TH-1 enforced by construction rather
 * than by scanning for forbidden keys.
 */
export function parseThemeSource(raw: unknown): Result<ThemeSource, ThemeParseError> {
  if (!isRecord(raw)) return err({ path: '', reason: 'expected a theme object' });

  const id = raw['id'];
  if (typeof id !== 'string' || id.length === 0) {
    return err({ path: 'id', reason: 'expected a non-empty string' });
  }

  const name = raw['name'];
  if (typeof name !== 'string' || name.length === 0) {
    return err({ path: 'name', reason: 'expected a non-empty string' });
  }

  const modes = raw['modes'];
  if (!isRecord(modes)) return err({ path: 'modes', reason: 'expected an object' });

  const parsedModes: Partial<Record<ThemeMode, TokenSet>> = {};
  for (const mode of MODES) {
    if (modes[mode] === undefined) {
      return err({ path: `modes.${mode}`, reason: 'every theme must define light and dark' });
    }
    const parsed = parseSet(modes[mode], `modes.${mode}`);
    if (!parsed.ok) return parsed;
    parsedModes[mode] = parsed.value;
  }

  return ok({
    id,
    name,
    modes: { light: parsedModes.light ?? emptySet(), dark: parsedModes.dark ?? emptySet() },
  });
}

function emptySet(): TokenSet {
  return { base: {}, semantic: {}, component: {} };
}

/** Renders a {@link ThemeParseError} for display (EM-6). */
export function describeThemeParseError(error: ThemeParseError): string {
  const where = error.path === '' ? 'theme file' : `"${error.path}"`;
  return `Invalid ${where}: ${error.reason}`;
}
