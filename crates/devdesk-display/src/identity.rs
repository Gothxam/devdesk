//! Which physical display is this, and how sure are we?
//!
//! WD-3 requires monitors to be identified by display-reported identity rather
//! than by enumeration index. In practice no single reported signal is both
//! always present and always stable:
//!
//! | Signal | Present | Survives a port change | Distinguishes identical units |
//! | --- | --- | --- | --- |
//! | EDID serial | usually | **yes** | **yes** |
//! | Device path | usually | no | yes |
//! | Connector | usually | no | no |
//! | Adapter | usually | no | no |
//! | Model | usually | yes | **no** |
//!
//! So identity here is **evidence plus a confidence**, not a string to compare.
//! Two identities that agree on an EDID serial are the same panel. Two that agree
//! only on model and connector are *probably* the same panel, and a caller
//! restoring a layout may reasonably act on that; a caller deciding whether to
//! discard a saved arrangement should not.
//!
//! Three rules make this safe, and each has a test:
//!
//! 1. **An absent signal is never agreement.** Two displays that both report no
//!    serial have not matched on serial. This is the defect the whole design
//!    exists to avoid — it binds every unidentifiable display to the first
//!    layout it finds.
//! 2. **An ambiguous match is no match.** Where two known displays tie at the
//!    same sub-exact confidence, the result is `None`. Binding a layout to the
//!    wrong one of two identical panels is worse than treating the arrangement
//!    as new.
//! 3. **The fallback never claims more than it knows.** A display reporting
//!    nothing distinctive gets a deterministic hash and `Weak` confidence, so a
//!    caller can tell "this is the same display" from "this is the display that
//!    was in the same place".

use serde::{Deserialize, Serialize};

use devdesk_platform::RawMonitorInfo;

use crate::hash::StableHasher;

/// A stable identifier for one physical display.
///
/// Derived from the strongest signal the display reported, so it is stable
/// across the events that reorder enumeration. It is a **key**, not a
/// comparison: two ids being different does not prove two different displays,
/// which is what [`IdentityConfidence`] is for.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct MonitorId(String);

impl MonitorId {
    /// The opaque identifier.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// How strongly two identities are believed to be the same display.
///
/// Ordered, so a caller can require a floor: `confidence >= IdentityConfidence::Probable`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IdentityConfidence {
    /// No signal agreed. Not the same display, as far as anything reported.
    None,
    /// Only the fallback hash agreed: the same model in the same position, with
    /// nothing distinctive reported. Enough to offer a restore, not enough to
    /// perform one silently.
    Weak,
    /// Model, connector, and adapter agreed. The same kind of display on the
    /// same port — which is the same display unless someone swapped one
    /// identical panel for another between sessions.
    Probable,
    /// The device path agreed: the same panel on the same port. Wrong only if
    /// the panel was replaced by an identical model on that exact port.
    Strong,
    /// The EDID serial agreed. This is the same physical unit, wherever it is
    /// plugged in.
    Exact,
}

impl IdentityConfidence {
    /// Whether this is strong enough to reattach a saved layout without asking.
    ///
    /// The floor is `Strong`, not `Probable`. `WD-5` requires an unknown
    /// topology to resolve deterministically *and* offer the user a restore;
    /// silently reattaching on a probable match makes the wrong guess
    /// unnoticeable, which is the failure `AC-DAT-1.1` has no acceptable
    /// nonzero rate for.
    #[must_use]
    pub const fn is_conclusive(self) -> bool {
        matches!(self, Self::Strong | Self::Exact)
    }
}

/// The model of a display: manufacturer plus product code.
///
/// Identifies a *kind* of panel, never a unit. Two of the same monitor report
/// the same model, which is exactly why this alone can never yield `Exact`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ModelId {
    /// The three-letter EDID manufacturer identifier, e.g. `DEL`.
    pub manufacturer: String,
    /// The EDID product code.
    pub product_code: u16,
}

impl ModelId {
    fn token(&self) -> String {
        format!("{}-{:04x}", self.manufacturer, self.product_code)
    }
}

/// Everything reported about which display this is.
///
/// Every field is optional because every one of them is genuinely absent on some
/// real configuration. `fallback` is not: it is always computed, from whatever
/// did arrive, so that even a display reporting nothing has a deterministic key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MonitorIdentity {
    /// A path that is stable while the display stays on its current port.
    device_path: Option<String>,
    /// The display adapter and output. Stable within a boot, not across one —
    /// the LUID it derives from is regenerated — so it participates in
    /// `Probable` and never in `Strong`.
    adapter: Option<String>,
    /// The EDID serial. The only signal that survives a port change.
    serial: Option<String>,
    /// The physical connector, rendered as a token such as `hdmi0`.
    connector: Option<String>,
    /// Manufacturer and product code.
    model: Option<ModelId>,
    /// A deterministic digest of everything above plus position, always present.
    fallback: String,
    /// The derived key.
    id: MonitorId,
}

impl MonitorIdentity {
    /// Builds an identity from what the platform reported.
    #[must_use]
    pub fn from_raw(raw: &RawMonitorInfo) -> Self {
        let model = match (raw.manufacturer.as_ref(), raw.product_code) {
            (Some(manufacturer), Some(product_code)) => Some(ModelId {
                manufacturer: manufacturer.clone(),
                product_code,
            }),
            _ => None,
        };

        let connector = raw.connector.map(|connector| connector.to_string());
        let fallback = fallback_hash(raw, model.as_ref(), connector.as_deref());

        let id = derive_id(
            raw.serial.as_deref(),
            model.as_ref(),
            raw.device_path.as_deref(),
            &fallback,
        );

        Self {
            device_path: raw.device_path.clone(),
            adapter: raw.adapter.clone(),
            serial: raw.serial.clone(),
            connector,
            model,
            fallback,
            id,
        }
    }

    /// The derived key.
    #[must_use]
    pub const fn id(&self) -> &MonitorId {
        &self.id
    }

    #[must_use]
    pub fn device_path(&self) -> Option<&str> {
        self.device_path.as_deref()
    }

    #[must_use]
    pub fn adapter(&self) -> Option<&str> {
        self.adapter.as_deref()
    }

    #[must_use]
    pub fn serial(&self) -> Option<&str> {
        self.serial.as_deref()
    }

    #[must_use]
    pub fn connector(&self) -> Option<&str> {
        self.connector.as_deref()
    }

    #[must_use]
    pub const fn model(&self) -> Option<&ModelId> {
        self.model.as_ref()
    }

    #[must_use]
    pub fn fallback_hash(&self) -> &str {
        &self.fallback
    }

    /// The best confidence this identity could ever produce against anything.
    ///
    /// Lets a caller state up front that a display cannot be conclusively
    /// re-identified, rather than discovering it at match time on the one
    /// occasion it matters.
    #[must_use]
    pub fn strength(&self) -> IdentityConfidence {
        if self.serial.is_some() && self.model.is_some() {
            IdentityConfidence::Exact
        } else if self.device_path.is_some() {
            IdentityConfidence::Strong
        } else if self.model.is_some() && self.connector.is_some() {
            IdentityConfidence::Probable
        } else {
            IdentityConfidence::Weak
        }
    }

    /// How strongly this identity matches another.
    ///
    /// Symmetric, and never treats two absent signals as agreement.
    #[must_use]
    pub fn confidence_against(&self, other: &Self) -> IdentityConfidence {
        // The serial identifies a unit, but only together with a model: serial
        // numbers are unique per manufacturer, not globally, and "1" is a real
        // serial on more than one panel.
        if both_agree(self.serial.as_deref(), other.serial.as_deref())
            && self.model == other.model
            && self.model.is_some()
        {
            return IdentityConfidence::Exact;
        }

        if both_agree(self.device_path.as_deref(), other.device_path.as_deref()) {
            return IdentityConfidence::Strong;
        }

        if self.model.is_some()
            && self.model == other.model
            && both_agree(self.connector.as_deref(), other.connector.as_deref())
            && both_agree(self.adapter.as_deref(), other.adapter.as_deref())
        {
            return IdentityConfidence::Probable;
        }

        if self.fallback == other.fallback {
            return IdentityConfidence::Weak;
        }

        IdentityConfidence::None
    }
}

/// One resolved candidate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdentityMatch {
    /// Where in the supplied slice the match was found.
    pub index: usize,
    /// How strongly it matched.
    pub confidence: IdentityConfidence,
}

/// Finds which known display a candidate is, if any.
///
/// Returns `None` when nothing matched **and** when two known displays tie at
/// the best confidence found. A tie means two displays are indistinguishable
/// from what they reported, and picking one would bind a layout to the wrong
/// panel roughly half the time — a silent arrangement change, which `AC-DAT-1.1`
/// has no acceptable nonzero rate for.
///
/// A tie at `Exact` cannot be resolved either, but it also cannot legitimately
/// occur: it would mean two displays reporting one serial and model, which is a
/// duplicate entry rather than an ambiguity.
#[must_use]
pub fn resolve(known: &[MonitorIdentity], candidate: &MonitorIdentity) -> Option<IdentityMatch> {
    let mut best = IdentityConfidence::None;
    let mut best_index = 0usize;
    let mut ties = 0usize;

    for (index, identity) in known.iter().enumerate() {
        let confidence = identity.confidence_against(candidate);

        if confidence == IdentityConfidence::None {
            continue;
        }

        if confidence > best {
            best = confidence;
            best_index = index;
            ties = 1;
        } else if confidence == best {
            ties += 1;
        }
    }

    if best == IdentityConfidence::None || ties > 1 {
        return None;
    }

    Some(IdentityMatch {
        index: best_index,
        confidence: best,
    })
}

/// Whether two optional signals are both present and equal.
///
/// The whole point: `None == None` is `true` in Rust and **false** here. Two
/// displays that both declined to report a serial have not agreed on one.
fn both_agree(left: Option<&str>, right: Option<&str>) -> bool {
    matches!((left, right), (Some(a), Some(b)) if a == b)
}

/// The key, derived from the strongest signal present.
///
/// Prefixed by the signal it came from so that a key can be read and understood,
/// and so a serial-derived key can never collide with a path-derived one.
fn derive_id(
    serial: Option<&str>,
    model: Option<&ModelId>,
    device_path: Option<&str>,
    fallback: &str,
) -> MonitorId {
    if let (Some(serial), Some(model)) = (serial, model) {
        return MonitorId(format!("unit:{}:{serial}", model.token()));
    }

    if let Some(path) = device_path {
        return MonitorId(format!("port:{path}"));
    }

    MonitorId(format!("weak:{fallback}"))
}

/// A deterministic digest for a display with nothing distinctive to report.
///
/// Includes the OS device name and enumeration index, which are **not** identity
/// on their own (WD-3) and are used here only because this is the branch where
/// nothing better exists. It also includes size but not origin: a display that
/// was dragged to the other side of the desktop is still the same display, and
/// including its position would make every rearrangement look like new hardware.
fn fallback_hash(raw: &RawMonitorInfo, model: Option<&ModelId>, connector: Option<&str>) -> String {
    let mut hasher = StableHasher::new();

    hasher.write_optional_field(model.map(ModelId::token).as_deref());
    hasher.write_optional_field(connector);
    hasher.write_optional_field(raw.adapter.as_deref());
    hasher.write_optional_field(raw.os_device_name.as_deref());
    hasher.write_u32(raw.bounds.width);
    hasher.write_u32(raw.bounds.height);
    hasher.write_u32(raw.os_enumeration_index);

    hasher.finish_hex()
}
