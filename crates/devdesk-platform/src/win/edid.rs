//! The manufacturer serial number, read from a display's EDID.
//!
//! The serial is the only identity signal that survives a display being moved to
//! a different port, which is exactly the case a device path cannot cover. It is
//! worth a registry read per display at enumeration time — enumeration happens
//! at startup and on a debounced topology change, not per frame.
//!
//! Every failure here is silent by design: no EDID, an unreadable key, a blob
//! too short to parse, and a panel that shipped with the serial field zeroed all
//! produce `None`. A display without a serial is ordinary, and the layer above
//! is built to assign it a lower identity confidence rather than to fail.

use windows::core::PCWSTR;
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_BINARY};

/// EDID 1.x is 128 bytes; extensions follow but carry nothing needed here.
const EDID_BASE_LEN: usize = 128;
/// The four 18-byte detailed-timing descriptors start here.
const DESCRIPTOR_BASE: usize = 54;
const DESCRIPTOR_LEN: usize = 18;
const DESCRIPTOR_COUNT: usize = 4;
/// The descriptor tag that marks an ASCII serial number.
const TAG_SERIAL_ASCII: u8 = 0xff;

/// Reads the serial number for a monitor device path.
///
/// The path is the Windows `\\?\DISPLAY#...` form returned by DisplayConfig.
pub(super) fn serial_for_device_path(device_path: &str) -> Option<String> {
    let key = registry_key_for(device_path)?;
    let blob = read_edid(&key)?;
    serial_from_edid(&blob)
}

/// Converts a monitor device path to its `Enum` registry key.
///
/// `\\?\DISPLAY#GSM5B08#5&2b4c8d3&0&UID4353#{e6f0…}` becomes
/// `SYSTEM\CurrentControlSet\Enum\DISPLAY\GSM5B08\5&2b4c8d3&0&UID4353\Device Parameters`.
/// The interface GUID suffix is dropped: it names the device interface class,
/// which is the same for every monitor and is not part of the instance path.
fn registry_key_for(device_path: &str) -> Option<String> {
    let trimmed = device_path.strip_prefix(r"\\?\")?;
    let instance = trimmed.split("#{").next()?;

    if instance.is_empty() {
        return None;
    }

    Some(format!(
        r"SYSTEM\CurrentControlSet\Enum\{}\Device Parameters",
        instance.replace('#', r"\")
    ))
}

/// Reads the `EDID` binary value under a device-parameters key.
fn read_edid(subkey: &str) -> Option<Vec<u8>> {
    let subkey_wide = to_wide(subkey);
    let value_wide = to_wide("EDID");

    let mut size = 0u32;

    // SAFETY: both wide strings are NUL-terminated and outlive the call. Passing
    // no data buffer asks only for the size, which is the documented way to
    // learn how much to allocate.
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(subkey_wide.as_ptr()),
            PCWSTR(value_wide.as_ptr()),
            RRF_RT_REG_BINARY,
            None,
            None,
            Some(std::ptr::from_mut(&mut size)),
        )
    };

    if status != ERROR_SUCCESS || size == 0 {
        return None;
    }

    let mut buffer = vec![0u8; size as usize];

    // SAFETY: `buffer` is `size` bytes, which is what the sizing call reported,
    // and `size` is passed again so the call cannot write past it.
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(subkey_wide.as_ptr()),
            PCWSTR(value_wide.as_ptr()),
            RRF_RT_REG_BINARY,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(std::ptr::from_mut(&mut size)),
        )
    };

    if status != ERROR_SUCCESS {
        return None;
    }

    buffer.truncate(size as usize);
    Some(buffer)
}

/// Extracts a serial number from an EDID blob.
///
/// Prefers the ASCII serial descriptor, which is what is printed on the back of
/// the panel and what a user would recognise. Falls back to the 32-bit serial in
/// the header, which more panels populate but which is meaningless to a human.
fn serial_from_edid(blob: &[u8]) -> Option<String> {
    if blob.len() < EDID_BASE_LEN {
        return None;
    }

    for index in 0..DESCRIPTOR_COUNT {
        let start = DESCRIPTOR_BASE + index * DESCRIPTOR_LEN;
        let descriptor = blob.get(start..start + DESCRIPTOR_LEN)?;

        // A descriptor whose first two bytes are zero is a display descriptor
        // rather than a timing block; byte 3 then names which kind.
        if descriptor[0] != 0 || descriptor[1] != 0 || descriptor[3] != TAG_SERIAL_ASCII {
            continue;
        }

        // The spec terminates the field with 0x0A and pads with spaces. Panels
        // that pad with NUL instead are common enough that stopping only at 0x0A
        // would carry the padding into the identity string.
        let text: String = descriptor[5..]
            .iter()
            .take_while(|byte| **byte != 0x0a && **byte != 0x00)
            .map(|byte| char::from(*byte))
            .collect();

        let text = text.trim();
        if !text.is_empty() {
            return Some(text.to_owned());
        }
    }

    // Bytes 12..16, little-endian. Zero means the panel declined to provide one.
    let numeric = u32::from_le_bytes([blob[12], blob[13], blob[14], blob[15]]);
    (numeric != 0).then(|| numeric.to_string())
}

fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank_edid() -> Vec<u8> {
        vec![0u8; EDID_BASE_LEN]
    }

    #[test]
    fn a_device_path_becomes_its_enum_key() {
        let key = registry_key_for(r"\\?\DISPLAY#GSM5B08#5&2b4c8d3&0&UID4353#{e6f07b5f-ee97}");
        assert_eq!(
            key.as_deref(),
            Some(
                r"SYSTEM\CurrentControlSet\Enum\DISPLAY\GSM5B08\5&2b4c8d3&0&UID4353\Device Parameters"
            )
        );
    }

    #[test]
    fn a_path_in_an_unexpected_shape_yields_no_key() {
        // Reading an arbitrary registry path built from an unrecognised string
        // is worse than not reading one.
        assert!(registry_key_for("DISPLAY/GSM5B08").is_none());
        assert!(registry_key_for(r"\\?\").is_none());
    }

    #[test]
    fn the_ascii_descriptor_wins_over_the_numeric_serial() {
        let mut edid = blank_edid();
        edid[12..16].copy_from_slice(&7777u32.to_le_bytes());

        let start = DESCRIPTOR_BASE;
        edid[start + 3] = TAG_SERIAL_ASCII;
        for (slot, byte) in edid[start + 5..start + DESCRIPTOR_LEN]
            .iter_mut()
            .zip(b"ABC123    ")
        {
            *slot = *byte;
        }

        assert_eq!(serial_from_edid(&edid).as_deref(), Some("ABC123"));
    }

    #[test]
    fn the_numeric_serial_is_the_fallback() {
        let mut edid = blank_edid();
        edid[12..16].copy_from_slice(&4242u32.to_le_bytes());
        assert_eq!(serial_from_edid(&edid).as_deref(), Some("4242"));
    }

    #[test]
    fn a_panel_with_no_serial_reports_none() {
        assert_eq!(serial_from_edid(&blank_edid()), None);
        assert_eq!(serial_from_edid(&[0u8; 8]), None);
    }
}
