//! Display enumeration on Windows.

use std::collections::HashMap;

use windows::core::{BOOL, PCWSTR};
use windows::Win32::Devices::Display::{
    DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig,
    DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
    DISPLAYCONFIG_DEVICE_INFO_HEADER, DISPLAYCONFIG_MODE_INFO,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EXTERNAL,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_USB_TUNNEL, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DVI,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HD15, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_VIRTUAL,
    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_WIRED, DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL,
    DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_SOURCE_DEVICE_NAME, DISPLAYCONFIG_TARGET_DEVICE_NAME,
    QDC_ONLY_ACTIVE_PATHS,
};
use windows::Win32::Foundation::{ERROR_SUCCESS, LPARAM, LUID, RECT};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, EnumDisplaySettingsW, GetMonitorInfoW, DEVMODEW, ENUM_CURRENT_SETTINGS,
    HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};

use crate::display::{Connector, ConnectorKind, RawMonitorInfo, RawRect};
use crate::error::PlatformError;

use super::edid;

/// `MONITORINFOF_PRIMARY` from `winuser.h`.
///
/// Declared here rather than imported: the metadata exposes the flag word as a
/// bare `u32` with no named constant, and inlining `1` at the comparison site
/// would leave the meaning to a reader's memory.
const MONITORINFOF_PRIMARY: u32 = 0x0000_0001;

/// The DPI Windows reports for a display at 100%.
const DPI_AT_100_PERCENT: u32 = 96;

/// Lists the attached displays.
pub(super) fn enumerate() -> Result<Vec<RawMonitorInfo>, PlatformError> {
    let handles = enumerate_handles()?;

    // Queried once for the whole enumeration, not once per monitor: it is a
    // whole-system snapshot, and re-reading it per display would let the
    // arrangement change underneath a single enumeration.
    let targets = query_display_config().unwrap_or_default();

    let mut monitors = Vec::with_capacity(handles.len());

    for (index, handle) in handles.into_iter().enumerate() {
        let Some(info) = monitor_info(handle) else {
            // One unreadable display must not cost the caller the other three.
            // The layer above sees a smaller topology, which is true, rather
            // than an error, which would be a lie about the whole machine.
            continue;
        };

        let device_name = wide_to_string(&info.szDevice);
        let target = targets.get(&device_name);

        let index_u32 = u32::try_from(index).unwrap_or(u32::MAX);

        monitors.push(RawMonitorInfo {
            device_path: target.and_then(|t| t.device_path.clone()),
            adapter: target.map(|t| t.adapter.clone()),
            serial: target
                .and_then(|t| t.device_path.as_deref())
                .and_then(edid::serial_for_device_path),
            connector: target.and_then(|t| t.connector),
            manufacturer: target.and_then(|t| t.manufacturer.clone()),
            product_code: target.and_then(|t| t.product_code),
            friendly_name: target.and_then(|t| t.friendly_name.clone()),
            os_device_name: Some(device_name.clone()),
            bounds: rect_to_raw(info.monitorInfo.rcMonitor),
            work_area: rect_to_raw(info.monitorInfo.rcWork),
            dpi: effective_dpi(handle),
            refresh_millihertz: target
                .and_then(|t| t.refresh_millihertz)
                .or_else(|| refresh_from_display_settings(&info.szDevice)),
            is_primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
            os_enumeration_index: index_u32,
        });
    }

    Ok(monitors)
}

/// Collects the `HMONITOR` handles for every attached display.
fn enumerate_handles() -> Result<Vec<HMONITOR>, PlatformError> {
    let mut handles: Vec<HMONITOR> = Vec::new();

    // SAFETY: `handles` outlives the call — `EnumDisplayMonitors` is synchronous
    // and the callback runs only for its duration. The pointer is the only thing
    // passed through `LPARAM`, and the callback casts it back to the same type.
    let ok = unsafe {
        EnumDisplayMonitors(
            None,
            None,
            Some(collect_handle),
            LPARAM(std::ptr::from_mut(&mut handles) as isize),
        )
    };

    if !ok.as_bool() {
        return Err(PlatformError::OsCall {
            call: "EnumDisplayMonitors",
            code: last_error(),
        });
    }

    Ok(handles)
}

/// The `EnumDisplayMonitors` callback.
///
/// # Safety
///
/// `lparam` must be a `*mut Vec<HMONITOR>` valid for the duration of the
/// enclosing `EnumDisplayMonitors` call.
unsafe extern "system" fn collect_handle(
    monitor: HMONITOR,
    _hdc: HDC,
    _clip: *mut RECT,
    lparam: LPARAM,
) -> BOOL {
    let out = lparam.0 as *mut Vec<HMONITOR>;
    if let Some(handles) = unsafe { out.as_mut() } {
        handles.push(monitor);
    }
    // Continue enumerating. Stopping early on a bad pointer would hide the
    // defect behind a short monitor list.
    BOOL(1)
}

/// Geometry, work area, primary flag, and GDI device name for one display.
fn monitor_info(monitor: HMONITOR) -> Option<MONITORINFOEXW> {
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = u32::try_from(size_of::<MONITORINFOEXW>()).unwrap_or(0);

    // SAFETY: `info` is a correctly sized `MONITORINFOEXW` with `cbSize` set,
    // which is how Win32 distinguishes it from the shorter `MONITORINFO`.
    let ok =
        unsafe { GetMonitorInfoW(monitor, std::ptr::from_mut(&mut info).cast::<MONITORINFO>()) };

    ok.as_bool().then_some(info)
}

/// The effective DPI for one display.
///
/// Falls back to 96 — 100% — when the shell refuses. A display whose scale is
/// unknown must not be assigned a zero or absent one: every downstream
/// conversion divides by it.
fn effective_dpi(monitor: HMONITOR) -> u32 {
    let mut dpi_x = 0u32;
    let mut dpi_y = 0u32;

    // SAFETY: both out-parameters are live local `u32`s.
    let result = unsafe {
        GetDpiForMonitor(
            monitor,
            MDT_EFFECTIVE_DPI,
            std::ptr::from_mut(&mut dpi_x),
            std::ptr::from_mut(&mut dpi_y),
        )
    };

    if result.is_err() || dpi_x == 0 {
        return DPI_AT_100_PERCENT;
    }

    // The x and y axes are equal on every configuration Windows produces; x is
    // taken as the scale rather than averaging, so a hypothetical anisotropic
    // display reports something explicable rather than an invented mean.
    dpi_x
}

/// Refresh rate from the GDI display settings, in millihertz.
///
/// The fallback path. `dmDisplayFrequency` is whole hertz, so 59.94 Hz arrives
/// as 59 or 60 — the DisplayConfig rational is preferred wherever it exists.
fn refresh_from_display_settings(device: &[u16; 32]) -> Option<u32> {
    let mut mode = DEVMODEW {
        dmSize: u16::try_from(size_of::<DEVMODEW>()).unwrap_or(0),
        ..Default::default()
    };

    // SAFETY: `device` is a NUL-terminated wide string from `MONITORINFOEXW`,
    // and `mode` is a correctly sized `DEVMODEW`.
    let ok = unsafe {
        EnumDisplaySettingsW(
            PCWSTR(device.as_ptr()),
            ENUM_CURRENT_SETTINGS,
            std::ptr::from_mut(&mut mode),
        )
    };

    if !ok.as_bool() || mode.dmDisplayFrequency <= 1 {
        // 0 and 1 both mean "the hardware default" in this API, not a rate.
        return None;
    }

    mode.dmDisplayFrequency.checked_mul(1000)
}

/// What DisplayConfig knows about one display target.
#[derive(Debug, Clone, Default)]
struct TargetInfo {
    device_path: Option<String>,
    adapter: String,
    connector: Option<Connector>,
    manufacturer: Option<String>,
    product_code: Option<u16>,
    friendly_name: Option<String>,
    refresh_millihertz: Option<u32>,
}

/// Reads the active display paths, keyed by GDI device name.
///
/// Returns `None` rather than an error: DisplayConfig is an enrichment pass. A
/// machine where it fails still has displays, and refusing to enumerate them
/// would trade a weaker identity for no desktop at all.
fn query_display_config() -> Option<HashMap<String, TargetInfo>> {
    let mut path_count = 0u32;
    let mut mode_count = 0u32;

    // SAFETY: both out-parameters are live local `u32`s.
    let sized = unsafe {
        GetDisplayConfigBufferSizes(
            QDC_ONLY_ACTIVE_PATHS,
            std::ptr::from_mut(&mut path_count),
            std::ptr::from_mut(&mut mode_count),
        )
    };
    if sized != ERROR_SUCCESS || path_count == 0 {
        return None;
    }

    let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
    let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];

    // SAFETY: both buffers are sized by the call above and are passed with the
    // counts that describe them.
    let queried = unsafe {
        QueryDisplayConfig(
            QDC_ONLY_ACTIVE_PATHS,
            std::ptr::from_mut(&mut path_count),
            paths.as_mut_ptr(),
            std::ptr::from_mut(&mut mode_count),
            modes.as_mut_ptr(),
            None,
        )
    };
    if queried != ERROR_SUCCESS {
        return None;
    }

    paths.truncate(path_count as usize);

    let mut by_device = HashMap::with_capacity(paths.len());

    for path in &paths {
        let Some(device_name) = source_device_name(path.sourceInfo.adapterId, path.sourceInfo.id)
        else {
            continue;
        };

        let mut info = TargetInfo {
            adapter: format_adapter(path.sourceInfo.adapterId, path.sourceInfo.id),
            refresh_millihertz: rational_to_millihertz(
                path.targetInfo.refreshRate.Numerator,
                path.targetInfo.refreshRate.Denominator,
            ),
            ..TargetInfo::default()
        };

        if let Some(target) = target_device_name(path.targetInfo.adapterId, path.targetInfo.id) {
            info.device_path =
                Some(wide_to_string(&target.monitorDevicePath)).filter(|path| !path.is_empty());
            info.friendly_name = Some(wide_to_string(&target.monitorFriendlyDeviceName))
                .filter(|name| !name.is_empty());
            info.manufacturer = decode_edid_manufacturer(target.edidManufactureId);
            info.product_code = (target.edidProductCodeId != 0).then_some(target.edidProductCodeId);
            info.connector = Some(Connector {
                kind: connector_kind(target.outputTechnology.0),
                instance: target.connectorInstance,
            });
        }

        by_device.insert(device_name, info);
    }

    Some(by_device)
}

/// The GDI device name (`\\.\DISPLAY1`) for one DisplayConfig source.
fn source_device_name(adapter: LUID, id: u32) -> Option<String> {
    let mut request = DISPLAYCONFIG_SOURCE_DEVICE_NAME {
        header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
            r#type: DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
            size: u32::try_from(size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>()).unwrap_or(0),
            adapterId: adapter,
            id,
        },
        ..Default::default()
    };

    // SAFETY: the header declares the request type and the exact struct size,
    // which is the contract `DisplayConfigGetDeviceInfo` dispatches on.
    let status = unsafe { DisplayConfigGetDeviceInfo(std::ptr::from_mut(&mut request).cast()) };
    if status != 0 {
        return None;
    }

    Some(wide_to_string(&request.viewGdiDeviceName)).filter(|name| !name.is_empty())
}

/// The device path, friendly name, EDID ids, and connector for one target.
fn target_device_name(adapter: LUID, id: u32) -> Option<DISPLAYCONFIG_TARGET_DEVICE_NAME> {
    let mut request = DISPLAYCONFIG_TARGET_DEVICE_NAME {
        header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
            r#type: DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
            size: u32::try_from(size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>()).unwrap_or(0),
            adapterId: adapter,
            id,
        },
        ..Default::default()
    };

    // SAFETY: as above — the header carries the type and size the call requires.
    let status = unsafe { DisplayConfigGetDeviceInfo(std::ptr::from_mut(&mut request).cast()) };

    (status == 0).then_some(request)
}

/// An adapter identifier that is stable within a boot.
///
/// The LUID is regenerated across reboots, so this is deliberately **not** an
/// identity signal on its own. It distinguishes two outputs of one GPU within a
/// session, which is what disambiguates identical panels during hotplug.
fn format_adapter(adapter: LUID, source_id: u32) -> String {
    format!(
        "{:08x}{:08x}:{source_id}",
        adapter.HighPart as u32, adapter.LowPart
    )
}

/// Converts a rational refresh rate to millihertz.
///
/// 60000/1001 becomes 59_940 rather than 59 or 60. `PB-R1` is refresh-relative,
/// and the difference between 16.68 ms and 16.67 ms compounds across a frame
/// budget measured over a second.
fn rational_to_millihertz(numerator: u32, denominator: u32) -> Option<u32> {
    if numerator == 0 || denominator == 0 {
        return None;
    }
    let millihertz = u64::from(numerator) * 1000 / u64::from(denominator);
    u32::try_from(millihertz).ok().filter(|hz| *hz > 0)
}

/// Decodes the three-letter EDID manufacturer id, e.g. `DEL` or `GSM`.
///
/// The field is three 5-bit letters packed into a big-endian 16-bit word, with
/// 1 meaning `A`. Byte order is swapped first because the value arrives in the
/// host order Windows read it into, not the order EDID stores it.
fn decode_edid_manufacturer(packed: u16) -> Option<String> {
    if packed == 0 {
        return None;
    }

    let value = packed.swap_bytes();
    let mut out = String::with_capacity(3);

    for shift in [10u16, 5, 0] {
        let letter = ((value >> shift) & 0x1f) as u8;
        if !(1..=26).contains(&letter) {
            return None;
        }
        out.push(char::from(b'A' + letter - 1));
    }

    Some(out)
}

/// Maps a Windows output technology to a connector.
fn connector_kind(technology: i32) -> ConnectorKind {
    match technology {
        t if t == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HD15.0 => ConnectorKind::Vga,
        t if t == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DVI.0 => ConnectorKind::Dvi,
        t if t == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI.0 => ConnectorKind::Hdmi,
        t if t == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EXTERNAL.0
            || t == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_USB_TUNNEL.0 =>
        {
            ConnectorKind::DisplayPort
        }
        t if t == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED.0
            || t == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL.0 =>
        {
            ConnectorKind::Embedded
        }
        t if t == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_VIRTUAL.0
            || t == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_WIRED.0 =>
        {
            ConnectorKind::Virtual
        }
        _ => ConnectorKind::Other,
    }
}

fn rect_to_raw(rect: RECT) -> RawRect {
    RawRect {
        x: rect.left,
        y: rect.top,
        width: rect.right.saturating_sub(rect.left).unsigned_abs(),
        height: rect.bottom.saturating_sub(rect.top).unsigned_abs(),
    }
}

/// Reads a fixed-size wide buffer up to its first NUL.
pub(super) fn wide_to_string(buffer: &[u16]) -> String {
    let end = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..end])
}

fn last_error() -> u32 {
    // SAFETY: reads this thread's last-error value; no pointers involved.
    unsafe { windows::Win32::Foundation::GetLastError() }.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edid_manufacturer_decodes_a_known_identifier() {
        // 0x10AC is Dell, stored big-endian in EDID and byte-swapped on read.
        assert_eq!(decode_edid_manufacturer(0xac10).as_deref(), Some("DEL"));
        assert_eq!(decode_edid_manufacturer(0).as_deref(), None);
    }

    #[test]
    fn rational_refresh_keeps_the_fractional_rate() {
        // 60000/1001 is 59.94 Hz. Rounding it to 60 makes a frame budget wrong.
        assert_eq!(rational_to_millihertz(60_000, 1001), Some(59_940));
        assert_eq!(rational_to_millihertz(144, 1), Some(144_000));
        assert_eq!(rational_to_millihertz(60, 0), None);
        assert_eq!(rational_to_millihertz(0, 1), None);
    }

    #[test]
    fn wide_buffers_stop_at_the_terminator() {
        let mut buffer = [0u16; 8];
        for (slot, ch) in buffer.iter_mut().zip("ab".encode_utf16()) {
            *slot = ch;
        }
        assert_eq!(wide_to_string(&buffer), "ab");
    }

    #[test]
    fn a_rect_with_a_negative_origin_keeps_its_extent() {
        // The left-hand monitor of a two-monitor desktop has a negative origin,
        // and a width computed by subtraction must not wrap.
        let raw = rect_to_raw(RECT {
            left: -1920,
            top: 0,
            right: 0,
            bottom: 1080,
        });
        assert_eq!(raw.x, -1920);
        assert_eq!(raw.width, 1920);
        assert_eq!(raw.height, 1080);
    }
}
