# `tests/integration/`

See [`../README.md`](../README.md) for scope and cadence.

Cross-crate suites: they exercise several crates against each other, which is
what makes them integration tests rather than unit tests. Each is wired as a
`[[test]]` target on the crate it primarily exercises, so the file stays where
`ADR-0003` `RL-14` puts it without a crate being added — which `RL-4` would make
an ADR amendment.

## Window subsystem

Four suites over `devdesk-platform` → `devdesk-display` → `devdesk-core`, all
sharing `support.rs` for display fixtures and a recording command sink.

| Suite | Asks |
| --- | --- |
| `window_lifecycle.rs` | Does the sequence work? |
| `window_races.rs` | Does it still work when interrupted, repeated, or run from two threads? |
| `window_recovery.rs` | What happens at the ends — creation refused, removal, reuse? |
| `window_properties.rs` | Do the invariants hold over sequences nobody wrote by hand? |

### Everything is asserted over the command log

Not over internal state. What a user experiences is the sequence of commands the
windowing system received, and a subsystem can have perfectly consistent state
while having asked for the wrong things in the wrong order. The recording sink
answers four questions directly: was anything shown before it was created, was
anything created or shown twice, was anything shown that had not painted, and
did any command address a window that was destroyed.

`window_properties.rs` adds the invariant that ties the two halves together — a
surface that has painted is either shown **or** owed a show, never both and
never neither. State and log can each look correct in isolation while disagreeing
about which surfaces they describe, and only an exclusive-or catches that.

### The generator is seeded

`window_properties.rs` uses a fixed-seed xorshift, not the system RNG. A property
test that fails once and passes on re-run tells you nothing; this one fails
identically every time and prints the seed, step index, and operation, so a
failing sequence replays exactly.
