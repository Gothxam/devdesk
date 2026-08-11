# Bundled fonts

`fonts.css` declares Inter and JetBrains Mono against files in this directory.

**The `.woff2` binaries are not committed.** They cannot be generated, and
fetching them is the network access `AC-OFF-2.1` forbids. The stylesheet
degrades honestly without them: every stack falls back to a system face, so the
desktop renders correctly on a clean checkout.

## To ship the intended typography

Download the WOFF2 subsets and place them here:

| File | Source |
| --- | --- |
| `inter-400.woff2`, `inter-500.woff2`, `inter-600.woff2`, `inter-700.woff2` | [Inter](https://github.com/rsms/inter/releases) |
| `jetbrains-mono-400.woff2`, `jetbrains-mono-500.woff2` | [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono/releases) |

Both are SIL Open Font License 1.1, which permits redistribution inside an
application bundle. Keep the licence text alongside the binaries.

## Why not a CDN

Three ratified rules, any one of which is sufficient:

- `AC-OFF-2.1` — zero outbound network requests with default settings.
- `AC-OFF-1.1` — install and first run succeed with no network adapter.
- The app's CSP (`tauri.conf.json`) sets `style-src 'self'` and `font-src 'self'`,
  so a remote stylesheet and its faces are blocked by the browser regardless.
