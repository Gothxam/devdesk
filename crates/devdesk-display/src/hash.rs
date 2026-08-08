//! A hash that means the same thing next year.
//!
//! Identity keys and topology fingerprints are **persisted** (WD-4): a layout
//! saved today is looked up by fingerprint after the next upgrade.
//! `DefaultHasher` cannot be used for that. Its documentation is explicit that
//! the algorithm may change between Rust releases, which would silently
//! re-fingerprint every arrangement a user has and orphan every layout bound to
//! one — `PS-3` reintroduced by a toolchain bump.
//!
//! FNV-1a is chosen for being small, dependency-free, and specified. It is not a
//! cryptographic hash and nothing here depends on it being one: a fingerprint is
//! a lookup key, never a security boundary, and an attacker able to choose a
//! user's monitor arrangement has already won by other means.

const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
const PRIME: u64 = 0x0000_0100_0000_01b3;

/// An incremental FNV-1a hasher with a fixed, versionless algorithm.
#[derive(Debug, Clone, Copy)]
pub struct StableHasher(u64);

impl Default for StableHasher {
    fn default() -> Self {
        Self::new()
    }
}

impl StableHasher {
    #[must_use]
    pub const fn new() -> Self {
        Self(OFFSET_BASIS)
    }

    /// Mixes in raw bytes.
    pub fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(PRIME);
        }
    }

    /// Mixes in a string, followed by a separator.
    ///
    /// The separator is what stops `("ab", "c")` and `("a", "bc")` from hashing
    /// alike — a real collision when identity fields are concatenated and one of
    /// them is user-controlled.
    pub fn write_field(&mut self, value: &str) {
        self.write(value.as_bytes());
        self.write(&[0x1f]);
    }

    /// Mixes in an optional string, distinguishing absent from empty.
    ///
    /// An absent serial and an empty one are different facts: one panel declined
    /// to report, the other reported nothing. Collapsing them would let two
    /// displays agree on a signal neither of them has.
    pub fn write_optional_field(&mut self, value: Option<&str>) {
        match value {
            Some(text) => {
                self.write(&[0x01]);
                self.write_field(text);
            }
            None => self.write(&[0x00, 0x1f]),
        }
    }

    pub fn write_i32(&mut self, value: i32) {
        self.write(&value.to_le_bytes());
    }

    pub fn write_u32(&mut self, value: u32) {
        self.write(&value.to_le_bytes());
    }

    pub fn write_bool(&mut self, value: bool) {
        self.write(&[u8::from(value)]);
    }

    /// Mixes in an `f64` by its bit pattern.
    ///
    /// Scale factors are validated non-`NaN` at construction, so the one case
    /// where bit equality diverges from value equality cannot arise here.
    pub fn write_f64(&mut self, value: f64) {
        self.write(&value.to_bits().to_le_bytes());
    }

    /// The digest, rendered as sixteen lowercase hex digits.
    #[must_use]
    pub fn finish_hex(self) -> String {
        format!("{:016x}", self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(fields: &[&str]) -> String {
        let mut hasher = StableHasher::new();
        for field in fields {
            hasher.write_field(field);
        }
        hasher.finish_hex()
    }

    #[test]
    fn the_digest_is_pinned_to_a_known_value() {
        // A change to this number changes every persisted fingerprint. It is
        // asserted so that a change is a deliberate migration rather than a
        // silently different build.
        let mut hasher = StableHasher::new();
        hasher.write(b"devdesk");
        assert_eq!(hasher.finish_hex(), "a352dc80d7e93ec5");
    }

    #[test]
    fn field_separation_prevents_a_concatenation_collision() {
        assert_ne!(hex(&["ab", "c"]), hex(&["a", "bc"]));
    }

    #[test]
    fn absent_and_empty_are_different_facts() {
        let mut absent = StableHasher::new();
        absent.write_optional_field(None);

        let mut empty = StableHasher::new();
        empty.write_optional_field(Some(""));

        assert_ne!(absent.finish_hex(), empty.finish_hex());
    }
}
