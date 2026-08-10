/**
 * The clock's manifest.
 *
 * Written as data and validated by the same `parseWidgetManifest` a third-party
 * bundle goes through — `S-10` and `DD-008`: first-party code gets no
 * privileged path. If this object were typed as a `WidgetManifest` and used
 * directly, the first third-party widget would discover a set of requirements
 * nothing had ever enforced.
 *
 * **Zero capabilities.** `AC-FRE-6.1` requires the default arrangement to run
 * without asking the user for anything, and the clock reads a clock — there is
 * nothing to ask for. It is declared explicitly rather than omitted so the claim
 * is visible in the file rather than inferred from an absence.
 */
export const CLOCK_MANIFEST = Object.freeze({
  id: 'devdesk.clock',
  name: 'Clock',
  version: '1.0.0',
  description: 'The current time, on your desktop.',
  capabilities: [],
  preferredSize: { width: 240, height: 120 },
});
