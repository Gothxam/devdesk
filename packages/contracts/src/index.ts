/**
 * `@devdesk/contracts` — public surface.
 *
 * The IPC contract is **generated from the Rust command signatures**, never
 * hand-written on both sides (GEN-1, DD-003). A hand-maintained mirror drifts
 * silently, and silent drift at a trust boundary is a security problem rather
 * than a typing inconvenience (AP-13).
 *
 * Regenerate: `cargo run -p devdesk-app --bin export-contract`
 */

export * from './generated/contract';
