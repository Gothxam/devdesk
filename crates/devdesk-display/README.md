# `devdesk-display`

**Layer:** Rust core — platform · **Published:** no (`publish = false`, ADR-0003 PK-3)

## Owns

Monitor enumeration, the three coordinate spaces and conversions between them, DPI resolution, hotplug debouncing, topology identity and fingerprinting.

## Pipeline

```text
PlatformBackend  →  Topology  →  DisplayGraph  →  consumers
  raw records       identity      spatial index
                    + geometry    (immutable)
```

One direction, one responsibility per stage. The backend says what the system
reported; `enumerate` resolves identity and tags geometry with its space; a
`DisplayGraph` is an immutable spatial index over one topology snapshot. Nothing
flows back up, and no consumer reaches past the graph to the backend.

Changes are **transactional**. `SharedTopology::publish` computes the diff and
builds the new graph outside the lock, then swaps one value, so a consumer
observes either the whole previous arrangement or the whole next one and never a
state in between. Each `TopologyTransaction` carries the generation, both
arrangements, both graphs, and the computed diff.

Identity is **confidence-based**, not string equality. No single reported signal
is both always present and always stable, so a match carries an
`IdentityConfidence` and an ambiguous match resolves to nothing rather than to a
guess.

## Does not own

Window placement policy — that is layout, owned by `devdesk-core`.

## Entry points

`src/lib.rs`. Nothing outside this crate may reach past its public API.

## Governing documents

- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.2.1 — responsibilities
- `docs/architecture/SYSTEM_ARCHITECTURE.md` §6.3 — dependency rules DR-1…DR-8
- `docs/adr/ADR-0003-repository-layout.md` §4.2 — crate placement
