pub(crate) fn format_count(value: usize) -> String {
    let digits = value.to_string();
    let mut formatted = String::with_capacity(digits.len() + digits.len() / 3);
    let first_group_len = digits.len() % 3;

    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && index >= first_group_len && (index - first_group_len).is_multiple_of(3) {
            formatted.push(',');
        }
        formatted.push(ch);
    }

    formatted
}

pub(crate) fn format_bytes(bytes: usize) -> String {
    const KIB: f64 = 1024.0;
    const MIB: f64 = KIB * 1024.0;
    const GIB: f64 = MIB * 1024.0;
    let bytes = bytes as f64;

    if bytes >= GIB {
        format!("{:.1} GB", bytes / GIB)
    } else if bytes >= MIB {
        format!("{:.1} MB", bytes / MIB)
    } else if bytes >= KIB {
        format!("{:.1} KB", bytes / KIB)
    } else {
        format!("{} B", bytes as usize)
    }
}

/// Element count as the `u32` that typed-array lengths and the compact offset
/// tables carry. A 64-bit build can hold more elements than a `u32` counts, so
/// the overflow is reported instead of truncated.
pub(crate) fn checked_u32_len(len: usize, context: &str) -> Result<u32, String> {
    u32::try_from(len).map_err(|_| {
        format!(
            "Gerber layer is too large: {context} holds {} values, exceeding the u32 range",
            format_count(len)
        )
    })
}

#[cfg(test)]
mod tests;
