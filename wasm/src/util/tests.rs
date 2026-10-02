use super::{checked_u32_len, format_bytes, format_count};

#[test]
fn u32_length_conversion_rejects_counts_beyond_the_u32_range() {
    assert_eq!(checked_u32_len(0, "test array"), Ok(0));
    assert_eq!(
        checked_u32_len(u32::MAX as usize, "test array"),
        Ok(u32::MAX)
    );
    #[cfg(target_pointer_width = "64")]
    {
        let message = checked_u32_len(u32::MAX as usize + 1, "test array").unwrap_err();
        assert_eq!(
            message,
            "Gerber layer is too large: test array holds 4,294,967,296 values, exceeding the u32 range"
        );
    }
}

#[test]
fn count_formatting_groups_digits_without_underflow() {
    assert_eq!(format_count(0), "0");
    assert_eq!(format_count(12), "12");
    assert_eq!(format_count(123), "123");
    assert_eq!(format_count(1_234), "1,234");
    assert_eq!(format_count(12_345), "12,345");
    assert_eq!(format_count(123_456), "123,456");
    assert_eq!(format_count(24_000_000), "24,000,000");
}

#[test]
fn byte_formatting_uses_binary_thresholds() {
    assert_eq!(format_bytes(0), "0 B");
    assert_eq!(format_bytes(1023), "1023 B");
    assert_eq!(format_bytes(1024), "1.0 KB");
    assert_eq!(format_bytes(1024 * 1024), "1.0 MB");
    assert_eq!(format_bytes(1024 * 1024 * 1024), "1.0 GB");
}
