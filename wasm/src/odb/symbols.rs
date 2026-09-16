//! Standard ODB++ symbol names → apertures.
//!
//! Symbol dimensions are written in thousandths of the job unit (mils in inch
//! jobs, microns in mm jobs); callers pass `scale` = millimetres per thousandth.
//! Angles, spoke counts and corner lists are dimensionless and are not scaled.
//!
//! Every shape is built from positive primitives only: rings and thermals are
//! emitted as the contour pieces that remain between the gaps (as the
//! specification describes them, "holes in symbols are see-through by
//! definition"), never as a solid shape with negative-exposure cut-outs.
//! Geometry follows appendix A of the ODB++Design Format Specification
//! 8.1 Update 4 and its example pictures.

use crate::parser::geometry::{triangulate_outline, Primitive};
use crate::parser::{finalize_aperture, Aperture, ApertureKind};

const OUTLINE_ARC_SEGMENTS: usize = 8;
const ELLIPSE_SEGMENTS: usize = 64;
/// Segments of a full circle used for ring boundaries (donuts, thermals).
const RING_CIRCLE_SEGMENTS: usize = 64;
const EPSILON: f32 = 1e-6;

// Every standard symbol family of the ODB++ specification (appendix A),
// longest prefixes first so `donut_sr` is not read as `donut_s` + "r...".
// Families without a dedicated shape still parse as standard symbols (they are
// reported and not drawn) instead of being mistaken for user-defined symbols.
const PREFIXES: &[&str] = &[
    "oblong_ths",
    "radhplate",
    "donut_sr",
    "cross",
    "dpack",
    "null",
    "donut_rc",
    "donut_r",
    "donut_s",
    "donut_o",
    "fhplate",
    "rhplate",
    "dogbone",
    "oval_h",
    "sr_ths",
    "rc_tho",
    "rc_ths",
    "dshape",
    "hplate",
    "o_ths",
    "s_tho",
    "s_thr",
    "s_ths",
    "hex_l",
    "hex_s",
    "moire",
    "rect",
    "oval",
    "hole",
    "ths",
    "thr",
    "tri",
    "oct",
    "bfr",
    "bfs",
    "el",
    "di",
    "r",
    "s",
];

/// A corner mask: 1 = top-right, 2 = top-left, 3 = bottom-left, 4 = bottom-right
/// (counter-clockwise from the top-right corner, as the specification numbers them).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Corners(u8);

impl Corners {
    pub(crate) const ALL: Corners = Corners(0b1111);

    pub(crate) fn parse(value: &str) -> Corners {
        let mut mask = 0u8;
        for digit in value.bytes() {
            if (b'1'..=b'4').contains(&digit) {
                mask |= 1 << (digit - b'1');
            }
        }
        if mask == 0 {
            Corners::ALL
        } else {
            Corners(mask)
        }
    }

    pub(crate) fn has(self, corner: u8) -> bool {
        self.0 & (1 << (corner - 1)) != 0
    }
}

/// The ring outline of a thermal and how its gaps are cut.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ThermalKind {
    /// `thr`: round ring whose segments end in semicircles.
    RoundRounded,
    /// `ths`: round ring cut straight by the gaps.
    RoundSquared,
    /// `s_ths` (optionally rounded): square ring cut by the gaps.
    Square,
    /// `s_tho`: square ring with the corners left open; only straight bars remain.
    SquareOpen,
    /// `sr_ths`: square outside, round inside.
    SquareRound,
    /// `rc_ths` (optionally rounded): rectangular ring cut by the gaps.
    Rect,
    /// `rc_tho`: rectangular ring with open corners.
    RectOpen,
    /// `o_ths`: oval ring cut by the gaps.
    Oval,
}

/// A standard symbol in millimetres.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Shape {
    Circle {
        d: f32,
    },
    Rect {
        w: f32,
        h: f32,
    },
    RoundedRect {
        w: f32,
        h: f32,
        r: f32,
        corners: Corners,
    },
    ChamferedRect {
        w: f32,
        h: f32,
        c: f32,
        corners: Corners,
    },
    Oval {
        w: f32,
        h: f32,
    },
    Diamond {
        w: f32,
        h: f32,
    },
    Octagon {
        w: f32,
        h: f32,
        r: f32,
    },
    DonutRound {
        od: f32,
        id: f32,
    },
    /// `donut_s<od>x<id>[xr<rad>[x<corners>]]`: a square ring, optionally with
    /// rounded corners (the inner corners use `rad` minus the ring width).
    DonutSquare {
        od: f32,
        id: f32,
        r: f32,
        corners: Corners,
    },
    DonutSquareRound {
        od: f32,
        id: f32,
    },
    /// `donut_rc<ow>x<oh>x<lw>[xr<rad>[x<corners>]]`.
    DonutRect {
        ow: f32,
        oh: f32,
        lw: f32,
        r: f32,
        corners: Corners,
    },
    DonutOval {
        ow: f32,
        oh: f32,
        lw: f32,
    },
    Hexagon {
        w: f32,
        h: f32,
        r: f32,
        vertical: bool,
    },
    Triangle {
        base: f32,
        h: f32,
    },
    /// Every thermal family: a ring of outer size `ow` x `oh` and width `lw`
    /// (for `od`/`id` families `lw = (od - id) / 2`), cut by `spokes` gaps of
    /// width `gap`, the first one centred on `angle_deg` (counter-clockwise
    /// from +x). `r`/`corners` round the corners of square and rectangular rings.
    Thermal {
        ow: f32,
        oh: f32,
        lw: f32,
        angle_deg: f32,
        spokes: u32,
        gap: f32,
        kind: ThermalKind,
        r: f32,
        corners: Corners,
    },
    Ellipse {
        w: f32,
        h: f32,
    },
    /// `oval_h<w>x<h>`: half of an oval, centred on its bounding box, with the
    /// flat end at -x and the round end at +x (specification picture); see
    /// `half_oval_points`.
    HalfOval {
        w: f32,
        h: f32,
    },
    /// `moire<rw>x<rg>x<nr>x<lw>x<ll>x<la>`: a central dot of diameter `rw`
    /// and `nr` concentric rings of width `rw`, each separated by `rg`, plus a
    /// crosshair of line width `lw`, length `ll` and angle `la` degrees with
    /// rounded line ends.
    Moire {
        ring_width: f32,
        ring_gap: f32,
        rings: u32,
        line_width: f32,
        line_length: f32,
        angle_deg: f32,
    },
    ButterflyRound {
        d: f32,
    },
    ButterflySquare {
        s: f32,
    },
    /// A standard family (or parameter form) without a geometry here. It is
    /// reported and draws nothing rather than being approximated.
    Unsupported,
}

/// Parse a standard symbol name. Returns `None` when the name is not a
/// standard symbol (i.e. a user-defined symbol).
///
/// A name is only standard when it matches the whole standard grammar:
/// `<family><number>(x([rc]?<number>|r|s))*` (a bare `r` or `s` is the
/// round/square style flag of `dogbone`, `cross` and `oblong_ths`), or
/// `hole<number>(x<token>)*` for holes. Anything else (`r10_tp`,
/// `rect_custom`, `s1_via`) is a user-defined symbol that lives in
/// `symbols/<name>/features`.
pub(crate) fn parse_standard_symbol(raw_name: &str, scale: f32) -> Option<Shape> {
    let name = raw_name.trim().to_lowercase();
    let prefix = PREFIXES.iter().copied().find(|candidate| {
        name.starts_with(candidate)
            && name[candidate.len()..]
                .bytes()
                .next()
                .is_some_and(|byte| byte.is_ascii_digit() || byte == b'.')
    })?;
    let rest = &name[prefix.len()..];

    if prefix == "hole" {
        // hole<d>x<plating>x<tol+>x<tol->: only the diameter matters here.
        let diameter = rest
            .split('x')
            .next()
            .and_then(|value| value.parse::<f32>().ok())
            .map(|value| value * scale);
        return Some(match diameter {
            Some(d) if d.is_finite() && d > 0.0 => Shape::Circle { d },
            _ => Shape::Unsupported,
        });
    }

    // Plain numbers, unscaled: lengths are scaled where they are used, angles
    // and counts are not lengths and keep their value.
    let mut values: Vec<f32> = Vec::new();
    // (kind, size, digits) for `r<size>` / `c<size>` corner flags and the corner list after them.
    let mut flags: Vec<(u8, f32, String)> = Vec::new();
    for part in rest.split('x') {
        if part.is_empty() {
            // A dangling separator (`r10x`) is not the standard grammar.
            return None;
        }
        if part
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
        {
            if let Some(flag) = flags.last_mut() {
                flag.2 = part.to_string();
            } else {
                match part.parse::<f32>() {
                    Ok(value) if value.is_finite() => values.push(value),
                    // Digits and dots that do not form a number (`1.2.3`).
                    _ => return None,
                }
            }
        } else if (part.starts_with('r') || part.starts_with('c'))
            && part[1..]
                .bytes()
                .all(|byte| byte.is_ascii_digit() || byte == b'.')
            && part.len() > 1
        {
            let size = part[1..].parse::<f32>().unwrap_or(0.0);
            flags.push((part.as_bytes()[0], size, String::new()));
        } else if part == "r" || part == "s" {
            // Round/square style of stencil symbols and oblong thermals
            // (`dogbone...xr`, `cross...xs`, `oblong_ths...xr`); a following
            // number is the corner radius.
            flags.push((b's', 0.0, String::new()));
        } else {
            // Not the standard grammar: a user-defined symbol whose name
            // happens to start like a standard family.
            return None;
        }
    }
    let len = |index: usize| values.get(index).map(|value| value * scale);
    let num = |index: usize| values.get(index).copied();
    let count = |index: usize| values.get(index).map(|value| value.round().max(0.0) as u32);
    // Rounded corners (`xr<rad>[x<corners>]`) of donuts and thermals.
    let rounding = || match flags.first() {
        Some((b'r', size, value)) => (size * scale, Corners::parse(value)),
        _ => (0.0, Corners::ALL),
    };
    let thermal = |kind: ThermalKind, ow: f32, oh: f32, lw: f32, first: usize| match (
        num(first),
        count(first + 1),
        len(first + 2),
    ) {
        (Some(angle), Some(spokes), Some(gap)) => {
            let (r, corners) = rounding();
            Shape::Thermal {
                ow,
                oh,
                lw,
                angle_deg: angle,
                spokes,
                gap,
                kind,
                r,
                corners,
            }
        }
        _ => Shape::Unsupported,
    };

    Some(match prefix {
        "r" => match len(0) {
            Some(d) => Shape::Circle { d },
            None => Shape::Unsupported,
        },
        "s" => match len(0) {
            Some(s) => Shape::Rect { w: s, h: s },
            None => Shape::Unsupported,
        },
        "rect" => match (len(0), len(1)) {
            (Some(w), Some(h)) => match flags.first() {
                None => Shape::Rect { w, h },
                Some((b'r', size, value)) => Shape::RoundedRect {
                    w,
                    h,
                    r: size * scale,
                    corners: Corners::parse(value),
                },
                Some((_, size, value)) => Shape::ChamferedRect {
                    w,
                    h,
                    c: size * scale,
                    corners: Corners::parse(value),
                },
            },
            _ => Shape::Unsupported,
        },
        "oval" => match (len(0), len(1)) {
            (Some(w), Some(h)) => Shape::Oval { w, h },
            _ => Shape::Unsupported,
        },
        "oval_h" => match (len(0), len(1)) {
            (Some(w), Some(h)) => Shape::HalfOval { w, h },
            _ => Shape::Unsupported,
        },
        "moire" => match (len(0), len(1), count(2), len(3), len(4), num(5)) {
            (Some(rw), Some(rg), Some(nr), Some(lw), Some(ll), Some(la)) => Shape::Moire {
                ring_width: rw,
                ring_gap: rg,
                rings: nr,
                line_width: lw,
                line_length: ll,
                angle_deg: la,
            },
            _ => Shape::Unsupported,
        },
        "di" => match (len(0), len(1)) {
            (Some(w), Some(h)) => Shape::Diamond { w, h },
            _ => Shape::Unsupported,
        },
        "oct" => match (len(0), len(1), len(2)) {
            (Some(w), Some(h), Some(r)) => Shape::Octagon { w, h, r },
            _ => Shape::Unsupported,
        },
        "donut_r" => match (len(0), len(1)) {
            (Some(od), Some(id)) => Shape::DonutRound { od, id },
            _ => Shape::Unsupported,
        },
        "donut_sr" => match (len(0), len(1)) {
            (Some(od), Some(id)) => Shape::DonutSquareRound { od, id },
            _ => Shape::Unsupported,
        },
        "donut_s" => match (len(0), len(1)) {
            (Some(od), Some(id)) => {
                let (r, corners) = rounding();
                Shape::DonutSquare { od, id, r, corners }
            }
            _ => Shape::Unsupported,
        },
        "donut_rc" => match (len(0), len(1), len(2)) {
            (Some(ow), Some(oh), Some(lw)) => {
                let (r, corners) = rounding();
                Shape::DonutRect {
                    ow,
                    oh,
                    lw,
                    r,
                    corners,
                }
            }
            _ => Shape::Unsupported,
        },
        "donut_o" => match (len(0), len(1), len(2)) {
            (Some(ow), Some(oh), Some(lw)) => Shape::DonutOval { ow, oh, lw },
            _ => Shape::Unsupported,
        },
        "hex_l" | "hex_s" => match (len(0), len(1), len(2)) {
            (Some(w), Some(h), Some(r)) => Shape::Hexagon {
                w,
                h,
                r,
                vertical: prefix == "hex_s",
            },
            _ => Shape::Unsupported,
        },
        "tri" => match (len(0), len(1)) {
            (Some(base), Some(h)) => Shape::Triangle { base, h },
            _ => Shape::Unsupported,
        },
        // <od>x<id>x<angle>x<spokes>x<gap>
        "thr" | "ths" | "s_ths" | "s_tho" | "sr_ths" => match (len(0), len(1)) {
            (Some(od), Some(id)) => thermal(
                match prefix {
                    "thr" => ThermalKind::RoundRounded,
                    "ths" => ThermalKind::RoundSquared,
                    "s_ths" => ThermalKind::Square,
                    "s_tho" => ThermalKind::SquareOpen,
                    _ => ThermalKind::SquareRound,
                },
                od,
                od,
                (od - id) / 2.0,
                2,
            ),
            _ => Shape::Unsupported,
        },
        // <w>x<h>x<angle>x<spokes>x<gap>x<air_gap|lw>
        "rc_ths" | "rc_tho" | "o_ths" => match (len(0), len(1), len(5)) {
            (Some(w), Some(h), Some(lw)) => thermal(
                match prefix {
                    "rc_ths" => ThermalKind::Rect,
                    "rc_tho" => ThermalKind::RectOpen,
                    _ => ThermalKind::Oval,
                },
                w,
                h,
                lw,
                2,
            ),
            _ => Shape::Unsupported,
        },
        "el" => match (len(0), len(1)) {
            (Some(w), Some(h)) => Shape::Ellipse { w, h },
            _ => Shape::Unsupported,
        },
        "bfr" => match len(0) {
            Some(d) => Shape::ButterflyRound { d },
            None => Shape::Unsupported,
        },
        "bfs" => match len(0) {
            Some(s) => Shape::ButterflySquare { s },
            None => Shape::Unsupported,
        },
        _ => Shape::Unsupported,
    })
}

/// Grow a shape's outer dimensions by `delta` millimetres (ODB resize).
pub(crate) fn resize_shape(shape: &Shape, delta: f32) -> Shape {
    if delta == 0.0 {
        return shape.clone();
    }
    let grow = |value: f32| (value + delta).max(0.0);
    match shape.clone() {
        Shape::Circle { d } => Shape::Circle { d: grow(d) },
        Shape::Rect { w, h } => Shape::Rect {
            w: grow(w),
            h: grow(h),
        },
        Shape::RoundedRect { w, h, r, corners } => Shape::RoundedRect {
            w: grow(w),
            h: grow(h),
            r,
            corners,
        },
        Shape::ChamferedRect { w, h, c, corners } => Shape::ChamferedRect {
            w: grow(w),
            h: grow(h),
            c,
            corners,
        },
        Shape::Oval { w, h } => Shape::Oval {
            w: grow(w),
            h: grow(h),
        },
        Shape::Diamond { w, h } => Shape::Diamond {
            w: grow(w),
            h: grow(h),
        },
        Shape::Octagon { w, h, r } => Shape::Octagon {
            w: grow(w),
            h: grow(h),
            r,
        },
        Shape::DonutRound { od, id } => Shape::DonutRound { od: grow(od), id },
        Shape::DonutSquare { od, id, r, corners } => Shape::DonutSquare {
            od: grow(od),
            id,
            r,
            corners,
        },
        Shape::DonutSquareRound { od, id } => Shape::DonutSquareRound { od: grow(od), id },
        Shape::DonutRect {
            ow,
            oh,
            lw,
            r,
            corners,
        } => Shape::DonutRect {
            ow: grow(ow),
            oh: grow(oh),
            lw,
            r,
            corners,
        },
        Shape::DonutOval { ow, oh, lw } => Shape::DonutOval {
            ow: grow(ow),
            oh: grow(oh),
            lw,
        },
        Shape::Hexagon { w, h, r, vertical } => Shape::Hexagon {
            w: grow(w),
            h: grow(h),
            r,
            vertical,
        },
        Shape::Triangle { base, h } => Shape::Triangle {
            base: grow(base),
            h: grow(h),
        },
        Shape::HalfOval { w, h } => Shape::HalfOval {
            w: grow(w),
            h: grow(h),
        },
        Shape::Moire {
            ring_width,
            ring_gap,
            rings,
            line_width,
            line_length,
            angle_deg,
        } => Shape::Moire {
            ring_width,
            ring_gap,
            rings,
            line_width,
            line_length: grow(line_length),
            angle_deg,
        },
        Shape::Thermal {
            ow,
            oh,
            lw,
            angle_deg,
            spokes,
            gap,
            kind,
            r,
            corners,
        } => Shape::Thermal {
            ow: grow(ow),
            oh: grow(oh),
            lw,
            angle_deg,
            spokes,
            gap,
            kind,
            r,
            corners,
        },
        Shape::Ellipse { w, h } => Shape::Ellipse {
            w: grow(w),
            h: grow(h),
        },
        Shape::ButterflyRound { d } => Shape::ButterflyRound { d: grow(d) },
        Shape::ButterflySquare { s } => Shape::ButterflySquare { s: grow(s) },
        Shape::Unsupported => Shape::Unsupported,
    }
}

/// The diameter of a solid round pen, if the shape is one.
pub(crate) fn solid_circle_diameter(shape: &Shape) -> Option<f32> {
    match shape {
        Shape::Circle { d } if *d > 0.0 => Some(*d),
        _ => None,
    }
}

/// Nominal size used when a non-round symbol has to be drawn as a round pen.
pub(crate) fn pen_diameter(shape: &Shape) -> f32 {
    match shape {
        Shape::Circle { d } => *d,
        Shape::Rect { w, h }
        | Shape::RoundedRect { w, h, .. }
        | Shape::ChamferedRect { w, h, .. }
        | Shape::Oval { w, h }
        | Shape::Diamond { w, h }
        | Shape::Octagon { w, h, .. }
        | Shape::Hexagon { w, h, .. }
        | Shape::Ellipse { w, h } => w.min(*h),
        Shape::DonutRound { od, .. }
        | Shape::DonutSquare { od, .. }
        | Shape::DonutSquareRound { od, .. } => *od,
        Shape::DonutRect { ow, oh, .. } | Shape::DonutOval { ow, oh, .. } => ow.min(*oh),
        Shape::Triangle { base, h } => base.min(*h),
        Shape::HalfOval { w, h } => w.min(*h),
        Shape::Moire { line_length, .. } => *line_length,
        Shape::Thermal { ow, oh, .. } => ow.min(*oh),
        Shape::ButterflyRound { d } => *d,
        Shape::ButterflySquare { s } => *s,
        Shape::Unsupported => 0.0,
    }
}

/// Shapes with no area (e.g. the `r0` pen some CAM tools use), with a missing
/// or non-finite dimension, or without a geometry here draw nothing.
pub(crate) fn is_empty_shape(shape: &Shape) -> bool {
    let positive = |values: &[f32]| values.iter().all(|value| value.is_finite() && *value > 0.0);
    match shape {
        Shape::Circle { d } => !positive(&[*d]),
        Shape::Rect { w, h }
        | Shape::Oval { w, h }
        | Shape::Diamond { w, h }
        | Shape::Ellipse { w, h }
        | Shape::HalfOval { w, h } => !positive(&[*w, *h]),
        Shape::RoundedRect { w, h, r, .. } => !positive(&[*w, *h]) || !r.is_finite(),
        Shape::ChamferedRect { w, h, c, .. } => !positive(&[*w, *h]) || !c.is_finite(),
        Shape::Octagon { w, h, r } | Shape::Hexagon { w, h, r, .. } => {
            !positive(&[*w, *h]) || !r.is_finite()
        }
        Shape::Triangle { base, h } => !positive(&[*base, *h]),
        Shape::DonutRound { od, id }
        | Shape::DonutSquareRound { od, id }
        | Shape::DonutSquare { od, id, .. } => !positive(&[*od]) || !id.is_finite(),
        Shape::DonutRect { ow, oh, lw, .. } | Shape::DonutOval { ow, oh, lw } => {
            !positive(&[*ow, *oh, *lw])
        }
        Shape::Thermal {
            ow,
            oh,
            lw,
            angle_deg,
            gap,
            r,
            ..
        } => {
            !positive(&[*ow, *oh, *lw])
                || !angle_deg.is_finite()
                || !gap.is_finite()
                || !r.is_finite()
        }
        Shape::Moire {
            ring_width,
            ring_gap,
            line_width,
            line_length,
            angle_deg,
            ..
        } => {
            let finite = [
                *ring_width,
                *ring_gap,
                *line_width,
                *line_length,
                *angle_deg,
            ]
            .iter()
            .all(|value| value.is_finite());
            !finite || (*ring_width <= 0.0 && (*line_width <= 0.0 || *line_length <= 0.0))
        }
        Shape::ButterflyRound { d } => !positive(&[*d]),
        Shape::ButterflySquare { s } => !positive(&[*s]),
        Shape::Unsupported => true,
    }
}

/// A key that identifies equal shapes so one aperture serves every pad that
/// uses the same symbol and resize.
pub(crate) fn shape_key(shape: &Shape) -> String {
    format!("{shape:?}")
}

/// Build the aperture (primitives in millimetres, centred on the origin) for a shape.
pub(crate) fn shape_to_aperture(shape: &Shape) -> Aperture {
    let mut aperture = Aperture::new(0.0);
    match shape {
        Shape::Circle { d } => {
            circle(&mut aperture, *d, 0.0);
            aperture.kind = ApertureKind::Circle;
            aperture.is_solid_circle = true;
            set_size(&mut aperture, *d, *d);
        }
        Shape::Rect { w, h } => {
            rect(&mut aperture, *w, *h, 0.0);
            aperture.kind = ApertureKind::Rectangle;
            set_size(&mut aperture, *w, *h);
        }
        Shape::Oval { w, h } => {
            oval(&mut aperture, *w, *h);
            aperture.kind = ApertureKind::Obround;
            set_size(&mut aperture, *w, *h);
        }
        Shape::DonutRound { od, id } => {
            circle(&mut aperture, *od, *id);
            aperture.kind = ApertureKind::Circle;
            aperture.hole_diameter = *id;
            set_size(&mut aperture, *od, *od);
        }
        Shape::DonutSquareRound { od, id } => {
            rect(&mut aperture, *od, *od, *id);
            aperture.kind = ApertureKind::Rectangle;
            aperture.hole_diameter = *id;
            set_size(&mut aperture, *od, *od);
        }
        Shape::DonutSquare { od, id, r, corners } => {
            let lw = (od - id) / 2.0;
            ring(
                &mut aperture,
                &rect_ring_boundary(*od, *od, *r, *corners),
                inner_boundary(*id, *id, r - lw, *corners),
                &[],
            );
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *od, *od);
        }
        Shape::DonutRect {
            ow,
            oh,
            lw,
            r,
            corners,
        } => {
            ring(
                &mut aperture,
                &rect_ring_boundary(*ow, *oh, *r, *corners),
                inner_boundary(ow - 2.0 * lw, oh - 2.0 * lw, r - lw, *corners),
                &[],
            );
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *ow, *oh);
        }
        Shape::DonutOval { ow, oh, lw } => {
            ring(
                &mut aperture,
                &oval_points(*ow, *oh),
                oval_inner_boundary(ow - 2.0 * lw, oh - 2.0 * lw),
                &[],
            );
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *ow, *oh);
        }
        Shape::Thermal {
            ow,
            oh,
            lw,
            angle_deg,
            spokes,
            gap,
            kind,
            r,
            corners,
        } => {
            let (ow, oh, lw) = (*ow, *oh, *lw);
            let (iw, ih) = (ow - 2.0 * lw, oh - 2.0 * lw);
            match kind {
                ThermalKind::RoundRounded => {
                    round_thermal_rounded(&mut aperture, ow, iw, *angle_deg, *spokes, *gap)
                }
                ThermalKind::RoundSquared => ring(
                    &mut aperture,
                    &circle_points(ow),
                    (iw > 0.0).then(|| circle_points(iw)),
                    &thermal_cuts(ow, oh, *angle_deg, *spokes, *gap, false),
                ),
                ThermalKind::Square | ThermalKind::Rect => ring(
                    &mut aperture,
                    &rect_ring_boundary(ow, oh, *r, *corners),
                    inner_boundary(iw, ih, r - lw, *corners),
                    &thermal_cuts(ow, oh, *angle_deg, *spokes, *gap, true),
                ),
                ThermalKind::SquareRound => ring(
                    &mut aperture,
                    &rect_ring_boundary(ow, oh, 0.0, Corners::ALL),
                    (iw > 0.0).then(|| circle_points(iw)),
                    &thermal_cuts(ow, oh, *angle_deg, *spokes, *gap, true),
                ),
                ThermalKind::Oval => ring(
                    &mut aperture,
                    &oval_points(ow, oh),
                    oval_inner_boundary(iw, ih),
                    &thermal_cuts(ow, oh, *angle_deg, *spokes, *gap, false),
                ),
                ThermalKind::SquareOpen | ThermalKind::RectOpen => open_corner_bars(
                    &mut aperture,
                    ow,
                    oh,
                    lw,
                    &thermal_cuts(ow, oh, *angle_deg, *spokes, *gap, true),
                ),
            }
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, ow, oh);
        }
        Shape::RoundedRect { w, h, r, corners } => {
            outline(&mut aperture, &rounded_rect_points(*w, *h, *r, *corners));
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *w, *h);
        }
        Shape::ChamferedRect { w, h, c, corners } => {
            outline(&mut aperture, &chamfered_rect_points(*w, *h, *c, *corners));
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *w, *h);
        }
        Shape::Diamond { w, h } => {
            outline(
                &mut aperture,
                &[
                    [w / 2.0, 0.0],
                    [0.0, h / 2.0],
                    [-w / 2.0, 0.0],
                    [0.0, -h / 2.0],
                ],
            );
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *w, *h);
        }
        Shape::Octagon { w, h, r } => {
            outline(
                &mut aperture,
                &chamfered_rect_points(*w, *h, *r, Corners::ALL),
            );
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *w, *h);
        }
        Shape::Hexagon { w, h, r, vertical } => {
            let (w, h, r) = (*w, *h, *r);
            let points = if *vertical {
                [
                    [0.0, h / 2.0],
                    [-w / 2.0, h / 2.0 - r],
                    [-w / 2.0, -(h / 2.0 - r)],
                    [0.0, -h / 2.0],
                    [w / 2.0, -(h / 2.0 - r)],
                    [w / 2.0, h / 2.0 - r],
                ]
            } else {
                [
                    [w / 2.0, 0.0],
                    [w / 2.0 - r, h / 2.0],
                    [-(w / 2.0 - r), h / 2.0],
                    [-w / 2.0, 0.0],
                    [-(w / 2.0 - r), -h / 2.0],
                    [w / 2.0 - r, -h / 2.0],
                ]
            };
            outline(&mut aperture, &points);
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, w, h);
        }
        Shape::HalfOval { w, h } => {
            outline(&mut aperture, &half_oval_points(*w, *h));
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *w, *h);
        }
        Shape::Moire {
            ring_width,
            ring_gap,
            rings,
            line_width,
            line_length,
            angle_deg,
        } => {
            moire(
                &mut aperture,
                *ring_width,
                *ring_gap,
                *rings,
                *line_width,
                *line_length,
                *angle_deg,
            );
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *line_length, *line_length);
        }
        Shape::Triangle { base, h } => {
            outline(
                &mut aperture,
                &[
                    [-base / 2.0, -h / 2.0],
                    [base / 2.0, -h / 2.0],
                    [0.0, h / 2.0],
                ],
            );
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *base, *h);
        }
        Shape::Ellipse { w, h } => {
            outline(&mut aperture, &ellipse_points(*w, *h));
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *w, *h);
        }
        Shape::ButterflyRound { d } => {
            // The filled quadrants are the upper-left and lower-right ones.
            let r = d / 2.0;
            let mut upper_left = vec![[0.0, 0.0]];
            upper_left.extend(arc_points(0.0, 0.0, r, 90.0, 180.0, OUTLINE_ARC_SEGMENTS));
            let mut lower_right = vec![[0.0, 0.0]];
            lower_right.extend(arc_points(0.0, 0.0, r, 270.0, 360.0, OUTLINE_ARC_SEGMENTS));
            outline(&mut aperture, &upper_left);
            outline(&mut aperture, &lower_right);
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *d, *d);
        }
        Shape::ButterflySquare { s } => {
            let s = s / 2.0;
            outline(&mut aperture, &[[-s, 0.0], [0.0, 0.0], [0.0, s], [-s, s]]);
            outline(&mut aperture, &[[0.0, -s], [s, -s], [s, 0.0], [0.0, 0.0]]);
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, 2.0 * s, 2.0 * s);
        }
        Shape::Unsupported => {}
    }
    finalize_aperture(&mut aperture);
    aperture
}

fn set_size(aperture: &mut Aperture, width: f32, height: f32) {
    aperture.width = width;
    aperture.height = height;
    aperture.radius = width.max(height) / 2.0;
}

fn circle(aperture: &mut Aperture, diameter: f32, hole_diameter: f32) {
    aperture.primitives.push(Primitive::Circle {
        x: 0.0,
        y: 0.0,
        radius: diameter / 2.0,
        exposure: 1.0,
        hole_x: 0.0,
        hole_y: 0.0,
        hole_radius: hole_diameter / 2.0,
    });
}

fn rect(aperture: &mut Aperture, width: f32, height: f32, hole_diameter: f32) {
    let hw = width / 2.0;
    let hh = height / 2.0;
    let hole_radius = hole_diameter / 2.0;
    aperture.primitives.push(Primitive::Triangle {
        vertices: [[-hw, -hh], [hw, -hh], [hw, hh]],
        exposure: 1.0,
        hole_x: 0.0,
        hole_y: 0.0,
        hole_radius,
    });
    aperture.primitives.push(Primitive::Triangle {
        vertices: [[-hw, -hh], [hw, hh], [-hw, hh]],
        exposure: 1.0,
        hole_x: 0.0,
        hole_y: 0.0,
        hole_radius,
    });
}

/// A solid obround: two end circles and the rectangle between them.
fn oval(aperture: &mut Aperture, width: f32, height: f32) {
    if width <= 0.0 || height <= 0.0 {
        return;
    }
    let radius = width.min(height) / 2.0;
    if (width - height).abs() < EPSILON {
        circle(aperture, width, 0.0);
        return;
    }
    let (dx, dy, rect_w, rect_h) = if width > height {
        ((width - height) / 2.0, 0.0, width - height, height)
    } else {
        (0.0, (height - width) / 2.0, width, height - width)
    };
    for sign in [-1.0f32, 1.0] {
        aperture.primitives.push(Primitive::Circle {
            x: sign * dx,
            y: sign * dy,
            radius,
            exposure: 1.0,
            hole_x: 0.0,
            hole_y: 0.0,
            hole_radius: 0.0,
        });
    }
    rect(aperture, rect_w, rect_h, 0.0);
}

/// Triangulate a simple polygon into positive primitives.
fn outline(aperture: &mut Aperture, points: &[[f32; 2]]) {
    let points = dedupe(points);
    if points.len() < 3 {
        return;
    }
    if let Ok(triangles) = triangulate_outline(&points, 1.0) {
        aperture.primitives.extend(triangles);
    }
}

/// Drop consecutive (and closing) duplicate points.
fn dedupe(points: &[[f32; 2]]) -> Vec<[f32; 2]> {
    let mut out: Vec<[f32; 2]> = Vec::with_capacity(points.len());
    for point in points {
        if out.last().is_some_and(|last| {
            (last[0] - point[0]).abs() < EPSILON && (last[1] - point[1]).abs() < EPSILON
        }) {
            continue;
        }
        out.push(*point);
    }
    while out.len() > 1 {
        let (first, last) = (out[0], out[out.len() - 1]);
        if (first[0] - last[0]).abs() < EPSILON && (first[1] - last[1]).abs() < EPSILON {
            out.pop();
        } else {
            break;
        }
    }
    out
}

// Corner numbering: 1 = top-right, 2 = top-left, 3 = bottom-left, 4 = bottom-right.
const CORNER_SIGNS: [[f32; 2]; 4] = [[1.0, 1.0], [-1.0, 1.0], [-1.0, -1.0], [1.0, -1.0]];
const CORNER_START_ANGLE: [f32; 4] = [0.0, 90.0, 180.0, 270.0];

/// Counter-clockwise outline of a rectangle whose selected corners are
/// rounded with `r` (plain corners when `r <= 0`).
fn rounded_rect_points(w: f32, h: f32, r: f32, corners: Corners) -> Vec<[f32; 2]> {
    let radius = r.min(w / 2.0).min(h / 2.0);
    let mut points = Vec::new();
    for corner in 1..=4u8 {
        let [sx, sy] = CORNER_SIGNS[(corner - 1) as usize];
        if corners.has(corner) && radius > 0.0 {
            let cx = sx * (w / 2.0 - radius);
            let cy = sy * (h / 2.0 - radius);
            let start = CORNER_START_ANGLE[(corner - 1) as usize];
            points.extend(arc_points(
                cx,
                cy,
                radius,
                start,
                start + 90.0,
                OUTLINE_ARC_SEGMENTS,
            ));
        } else {
            points.push([sx * (w / 2.0), sy * (h / 2.0)]);
        }
    }
    points
}

fn chamfered_rect_points(w: f32, h: f32, c: f32, corners: Corners) -> Vec<[f32; 2]> {
    let cut = c.min(w / 2.0).min(h / 2.0);
    let mut points = Vec::new();
    for corner in 1..=4u8 {
        let [sx, sy] = CORNER_SIGNS[(corner - 1) as usize];
        if corners.has(corner) && cut > 0.0 {
            // Counter-clockwise order around the outline.
            let odd = corner == 1 || corner == 3;
            let first = if odd {
                [sx * (w / 2.0), sy * (h / 2.0 - cut)]
            } else {
                [sx * (w / 2.0 - cut), sy * (h / 2.0)]
            };
            let second = if odd {
                [sx * (w / 2.0 - cut), sy * (h / 2.0)]
            } else {
                [sx * (w / 2.0), sy * (h / 2.0 - cut)]
            };
            points.push(first);
            points.push(second);
        } else {
            points.push([sx * (w / 2.0), sy * (h / 2.0)]);
        }
    }
    points
}

fn ellipse_points(w: f32, h: f32) -> Vec<[f32; 2]> {
    (0..ELLIPSE_SEGMENTS)
        .map(|index| {
            let angle = index as f32 / ELLIPSE_SEGMENTS as f32 * std::f32::consts::TAU;
            [(w / 2.0) * angle.cos(), (h / 2.0) * angle.sin()]
        })
        .collect()
}

/// Counter-clockwise outline of a circle of diameter `d`.
fn circle_points(d: f32) -> Vec<[f32; 2]> {
    arc_points(0.0, 0.0, d / 2.0, 0.0, 360.0, RING_CIRCLE_SEGMENTS)
}

/// Counter-clockwise outline of an obround (semicircular ends).
fn oval_points(w: f32, h: f32) -> Vec<[f32; 2]> {
    rounded_rect_points(w, h, w.min(h) / 2.0, Corners::ALL)
}

/// Outer boundary of a square or rectangular ring (rounded when `r > 0`).
fn rect_ring_boundary(w: f32, h: f32, r: f32, corners: Corners) -> Vec<[f32; 2]> {
    rounded_rect_points(w, h, r.max(0.0), corners)
}

/// Inner boundary of a square or rectangular ring, or `None` when the ring
/// has no opening (inner size zero or negative).
fn inner_boundary(w: f32, h: f32, r: f32, corners: Corners) -> Option<Vec<[f32; 2]>> {
    (w > 0.0 && h > 0.0).then(|| rounded_rect_points(w, h, r.max(0.0), corners))
}

fn oval_inner_boundary(w: f32, h: f32) -> Option<Vec<[f32; 2]>> {
    (w > 0.0 && h > 0.0).then(|| oval_points(w, h))
}

/// Half of an oval, centred on its `w` x `h` bounding box, as the
/// specification picture shows it: the flat end is at -x and the round end at
/// +x. When the box is at least as wide as it is tall the round end is a
/// semicircle of diameter `h`; otherwise it is the right half of a `2w` x `h`
/// oval, i.e. the two +x corners are rounded with radius `w`.
fn half_oval_points(w: f32, h: f32) -> Vec<[f32; 2]> {
    let (hw, hh) = (w / 2.0, h / 2.0);
    let mut points = Vec::new();
    if 2.0 * w >= h {
        let r = hh;
        points.push([-hw, -hh]);
        points.push([hw - r, -hh]);
        points.extend(arc_points(
            hw - r,
            0.0,
            r,
            -90.0,
            90.0,
            2 * OUTLINE_ARC_SEGMENTS,
        ));
        points.push([-hw, hh]);
    } else {
        let r = w;
        points.push([-hw, -hh]);
        points.extend(arc_points(
            -hw,
            -(hh - r),
            r,
            -90.0,
            0.0,
            OUTLINE_ARC_SEGMENTS,
        ));
        points.extend(arc_points(-hw, hh - r, r, 0.0, 90.0, OUTLINE_ARC_SEGMENTS));
        points.push([-hw, hh]);
    }
    points
}

/// A central dot and concentric rings inside a crosshair (ODB++ `moire`):
/// dot of diameter `rw`, then `nr` rings of width `rw` separated by `rg`.
fn moire(
    aperture: &mut Aperture,
    ring_width: f32,
    ring_gap: f32,
    rings: u32,
    line_width: f32,
    line_length: f32,
    angle_deg: f32,
) {
    if ring_width > 0.0 {
        circle(aperture, ring_width, 0.0);
        let mut inner = ring_width / 2.0;
        for _ in 0..rings {
            inner += ring_gap;
            let outer = inner + ring_width;
            aperture.primitives.push(Primitive::Circle {
                x: 0.0,
                y: 0.0,
                radius: outer,
                exposure: 1.0,
                hole_x: 0.0,
                hole_y: 0.0,
                hole_radius: inner,
            });
            inner = outer;
        }
    }
    if line_width > 0.0 && line_length > 0.0 {
        for extra in [0.0f32, 90.0] {
            let angle = (angle_deg + extra).to_radians();
            let (cos, sin) = (angle.cos(), angle.sin());
            let (hl, hw) = (line_length / 2.0, line_width / 2.0);
            let corners = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]]
                .map(|[x, y]| [x * cos - y * sin, x * sin + y * cos]);
            outline(aperture, &corners);
            for end in [-hl, hl] {
                aperture.primitives.push(Primitive::Circle {
                    x: end * cos,
                    y: end * sin,
                    radius: hw,
                    exposure: 1.0,
                    hole_x: 0.0,
                    hole_y: 0.0,
                    hole_radius: 0.0,
                });
            }
        }
    }
}

/// `thr`: ring segments with rounded ends. Each segment is a sector of the
/// ring plus end caps of radius `(od - id) / 4` on the ring's centre line; the
/// gap half-angle keeps the caps `gap` apart.
fn round_thermal_rounded(
    aperture: &mut Aperture,
    od: f32,
    id: f32,
    angle_deg: f32,
    spokes: u32,
    gap: f32,
) {
    if od <= 0.0 {
        return;
    }
    let id = id.max(0.0);
    if spokes == 0 || gap <= 0.0 {
        ring(
            aperture,
            &circle_points(od),
            (id > 0.0).then(|| circle_points(id)),
            &[],
        );
        return;
    }
    let cap_radius = (od - id) / 4.0;
    let mid_radius = (od + id) / 4.0;
    let half_gap = (gap / 2.0 + cap_radius).atan2(mid_radius).to_degrees();
    let pie = 360.0 / spokes as f32;
    let span = pie - 2.0 * half_gap;
    if span <= 0.0 {
        return;
    }
    let segments = (span / 6.0).ceil().max(2.0) as usize;
    for index in 0..spokes {
        let start = angle_deg + index as f32 * pie + half_gap;
        let end = start + span;
        let mut points = arc_points(0.0, 0.0, od / 2.0, start, end, segments);
        if id > 0.0 {
            points.extend(arc_points(0.0, 0.0, id / 2.0, end, start, segments));
        } else {
            points.push([0.0, 0.0]);
        }
        outline(aperture, &points);
        for angle in [start, end] {
            let radians = angle.to_radians();
            aperture.primitives.push(Primitive::Circle {
                x: mid_radius * radians.cos(),
                y: mid_radius * radians.sin(),
                radius: cap_radius,
                exposure: 1.0,
                hole_x: 0.0,
                hole_y: 0.0,
                hole_radius: 0.0,
            });
        }
    }
}

/// One spoke gap of a thermal: a band of width `2 * half_width` that starts at
/// `origin` and runs outwards along `dir` (unit vector).
#[derive(Clone, Copy, Debug)]
struct Cut {
    origin: [f32; 2],
    dir: [f32; 2],
    half_width: f32,
}

impl Cut {
    fn normal(&self) -> [f32; 2] {
        [-self.dir[1], self.dir[0]]
    }

    /// Start point of the band edge on the counter-clockwise (+) or clockwise (-) side.
    fn edge_origin(&self, side: f32) -> [f32; 2] {
        let n = self.normal();
        [
            self.origin[0] + side * n[0] * self.half_width,
            self.origin[1] + side * n[1] * self.half_width,
        ]
    }

    fn angle_deg(&self) -> f32 {
        let angle = self.dir[1].atan2(self.dir[0]).to_degrees();
        if angle < 0.0 {
            angle + 360.0
        } else {
            angle
        }
    }
}

/// The spoke gaps of a thermal of outer size `ow` x `oh`, sorted by angle.
/// With `corner_offset`, a diagonal gap of a rectangle is moved along the
/// longer side so it passes through the ring's corner, as the specification
/// pictures of `rc_ths` / `rc_tho` show.
fn thermal_cuts(
    ow: f32,
    oh: f32,
    angle_deg: f32,
    spokes: u32,
    gap: f32,
    corner_offset: bool,
) -> Vec<Cut> {
    if spokes == 0 || gap <= 0.0 {
        return Vec::new();
    }
    let pie = 360.0 / spokes as f32;
    let mut cuts: Vec<Cut> = (0..spokes)
        .map(|index| {
            let angle = angle_deg + index as f32 * pie;
            let radians = angle.to_radians();
            let dir = [radians.cos(), radians.sin()];
            let mut origin = [0.0, 0.0];
            if corner_offset && (ow - oh).abs() > EPSILON {
                let snapped = (angle / 45.0).round() as i32;
                if snapped % 2 != 0 {
                    // Diagonal: shift along the longer side by half the difference.
                    if ow > oh {
                        origin[0] = (ow - oh) / 2.0 * dir[0].signum();
                    } else {
                        origin[1] = (oh - ow) / 2.0 * dir[1].signum();
                    }
                }
            }
            Cut {
                origin,
                dir,
                half_width: gap / 2.0,
            }
        })
        .collect();
    cuts.sort_by(|a, b| a.angle_deg().total_cmp(&b.angle_deg()));
    cuts
}

/// Where a ray leaves a closed polyline: (edge index, position along the
/// edge, point, distance along the ray). The farthest crossing is returned so
/// a start point inside the polygon gives the exit point.
fn ray_exit(
    points: &[[f32; 2]],
    origin: [f32; 2],
    dir: [f32; 2],
) -> Option<(usize, f32, [f32; 2], f32)> {
    let n = points.len();
    let mut best: Option<(usize, f32, [f32; 2], f32)> = None;
    for k in 0..n {
        let p = points[k];
        let q = points[(k + 1) % n];
        let e = [q[0] - p[0], q[1] - p[1]];
        let denom = dir[0] * e[1] - dir[1] * e[0];
        if denom.abs() < 1e-12 {
            continue;
        }
        let w = [p[0] - origin[0], p[1] - origin[1]];
        let s = (w[0] * e[1] - w[1] * e[0]) / denom;
        let u = (w[0] * dir[1] - w[1] * dir[0]) / denom;
        if s > EPSILON && (-EPSILON..1.0 - EPSILON).contains(&u) {
            let point = [origin[0] + s * dir[0], origin[1] + s * dir[1]];
            if best.is_none_or(|(_, _, _, best_s)| s > best_s) {
                best = Some((k, u.clamp(0.0, 1.0), point, s));
            }
        }
    }
    best
}

/// Intersection of two lines given by a point and a direction.
fn line_intersection(o1: [f32; 2], d1: [f32; 2], o2: [f32; 2], d2: [f32; 2]) -> Option<[f32; 2]> {
    let denom = d1[0] * d2[1] - d1[1] * d2[0];
    if denom.abs() < 1e-9 {
        return None;
    }
    let w = [o2[0] - o1[0], o2[1] - o1[1]];
    let s = (w[0] * d2[1] - w[1] * d2[0]) / denom;
    Some([o1[0] + s * d1[0], o1[1] + s * d1[1]])
}

fn signed_area(points: &[[f32; 2]]) -> f32 {
    let n = points.len();
    (0..n)
        .map(|k| {
            let p = points[k];
            let q = points[(k + 1) % n];
            p[0] * q[1] - q[0] * p[1]
        })
        .sum::<f32>()
        / 2.0
}

fn counter_clockwise(points: &[[f32; 2]]) -> Vec<[f32; 2]> {
    let mut points = dedupe(points);
    if signed_area(&points) < 0.0 {
        points.reverse();
    }
    points
}

/// Walk a counter-clockwise polyline forwards from one crossing to another.
fn walk_forward(
    points: &[[f32; 2]],
    from: (usize, f32, [f32; 2]),
    to: (usize, f32, [f32; 2]),
) -> Vec<[f32; 2]> {
    let n = points.len();
    let mut out = vec![from.2];
    if !(from.0 == to.0 && to.1 >= from.1) {
        let mut idx = (from.0 + 1) % n;
        loop {
            out.push(points[idx]);
            if idx == to.0 {
                break;
            }
            idx = (idx + 1) % n;
        }
    }
    out.push(to.2);
    out
}

/// Walk a counter-clockwise polyline backwards from one crossing to another.
fn walk_backward(
    points: &[[f32; 2]],
    from: (usize, f32, [f32; 2]),
    to: (usize, f32, [f32; 2]),
) -> Vec<[f32; 2]> {
    let n = points.len();
    let mut out = vec![from.2];
    if !(from.0 == to.0 && to.1 <= from.1) {
        let mut idx = from.0;
        let stop = (to.0 + 1) % n;
        loop {
            out.push(points[idx]);
            if idx == stop {
                break;
            }
            idx = (idx + n - 1) % n;
        }
    }
    out.push(to.2);
    out
}

/// Emit the pieces of a ring (outer boundary minus optional inner boundary)
/// that remain between the spoke gaps, each as one positive contour. Without
/// gaps the ring is split into two halves so every piece stays a simple polygon.
fn ring(aperture: &mut Aperture, outer: &[[f32; 2]], inner: Option<Vec<[f32; 2]>>, cuts: &[Cut]) {
    let outer = counter_clockwise(outer);
    if outer.len() < 3 {
        return;
    }
    let inner = inner
        .map(|points| counter_clockwise(&points))
        .filter(|points| points.len() >= 3);
    let seams;
    let cuts = if cuts.is_empty() {
        seams = [
            Cut {
                origin: [0.0, 0.0],
                dir: [1.0, 0.0],
                half_width: 0.0,
            },
            Cut {
                origin: [0.0, 0.0],
                dir: [-1.0, 0.0],
                half_width: 0.0,
            },
        ];
        &seams[..]
    } else {
        cuts
    };
    let n = cuts.len();
    for i in 0..n {
        let start_cut = cuts[i];
        let end_cut = cuts[(i + 1) % n];
        let start_origin = start_cut.edge_origin(1.0);
        let end_origin = end_cut.edge_origin(-1.0);
        let (Some(outer_start), Some(outer_end)) = (
            ray_exit(&outer, start_origin, start_cut.dir),
            ray_exit(&outer, end_origin, end_cut.dir),
        ) else {
            continue;
        };
        let mut points = walk_forward(
            &outer,
            (outer_start.0, outer_start.1, outer_start.2),
            (outer_end.0, outer_end.1, outer_end.2),
        );
        let inner_hits = inner.as_ref().map(|inner| {
            (
                ray_exit(inner, end_origin, end_cut.dir),
                ray_exit(inner, start_origin, start_cut.dir),
            )
        });
        match inner_hits {
            Some((Some(inner_end), Some(inner_start))) => {
                points.extend(walk_backward(
                    inner.as_ref().unwrap(),
                    (inner_end.0, inner_end.1, inner_end.2),
                    (inner_start.0, inner_start.1, inner_start.2),
                ));
            }
            _ => {
                // The gaps are wider than the opening (or there is none): the
                // piece ends where the two gap edges meet, if that is inside
                // the outer boundary; parallel edges simply close the piece.
                if let Some(apex) =
                    line_intersection(start_origin, start_cut.dir, end_origin, end_cut.dir)
                {
                    let along = (apex[0] - start_origin[0]) * start_cut.dir[0]
                        + (apex[1] - start_origin[1]) * start_cut.dir[1];
                    if along >= outer_start.3 {
                        continue;
                    }
                    points.push(apex);
                }
            }
        }
        outline(aperture, &points);
    }
}

/// `s_tho` / `rc_tho`: the four straight bars of a ring whose corners are left
/// open. Each bar spans the inner edge of its side at full ring width, and a
/// spoke gap removes the part of the bar between the points where the gap's
/// edges meet the bar's inner edge (a perpendicular cut, as in the
/// specification pictures).
fn open_corner_bars(aperture: &mut Aperture, ow: f32, oh: f32, lw: f32, cuts: &[Cut]) {
    let (iw, ih) = (ow - 2.0 * lw, oh - 2.0 * lw);
    if iw <= 0.0 || ih <= 0.0 || lw <= 0.0 {
        return;
    }
    // (inner edge base point, unit axis along the bar, half extent, outward normal)
    let bars = [
        ([0.0, ih / 2.0], [1.0, 0.0], iw / 2.0, [0.0, 1.0]),
        ([0.0, -ih / 2.0], [1.0, 0.0], iw / 2.0, [0.0, -1.0]),
        ([-iw / 2.0, 0.0], [0.0, 1.0], ih / 2.0, [-1.0, 0.0]),
        ([iw / 2.0, 0.0], [0.0, 1.0], ih / 2.0, [1.0, 0.0]),
    ];
    for (base, axis, half, outward) in bars {
        let mut intervals: Vec<(f32, f32)> = vec![(-half, half)];
        for cut in cuts {
            let along =
                |point: [f32; 2]| (point[0] - base[0]) * axis[0] + (point[1] - base[1]) * axis[1];
            let cross = cut.dir[0] * axis[1] - cut.dir[1] * axis[0];
            let removed = if cross.abs() < 1e-6 {
                // Gap parallel to the bar: it removes the bar beyond the gap
                // origin when the band covers the inner edge.
                let distance =
                    (base[0] - cut.origin[0]) * outward[0] + (base[1] - cut.origin[1]) * outward[1];
                let same_side = cut.dir[0] * outward[0] + cut.dir[1] * outward[1];
                if distance.abs() <= cut.half_width + EPSILON && same_side.abs() < 1e-6 {
                    let start = along(cut.origin);
                    let forward = cut.dir[0] * axis[0] + cut.dir[1] * axis[1] > 0.0;
                    Some(if forward {
                        (start, f32::INFINITY)
                    } else {
                        (f32::NEG_INFINITY, start)
                    })
                } else {
                    None
                }
            } else {
                let hit = |side: f32| {
                    let origin = cut.edge_origin(side);
                    line_intersection(origin, cut.dir, base, axis).map(along)
                };
                match (hit(1.0), hit(-1.0)) {
                    (Some(a), Some(b)) => {
                        // Only the half-band that runs outwards from the origin cuts.
                        let mid =
                            line_intersection(cut.origin, cut.dir, base, axis).unwrap_or(base);
                        let outward_hit = (mid[0] - cut.origin[0]) * cut.dir[0]
                            + (mid[1] - cut.origin[1]) * cut.dir[1];
                        (outward_hit > -EPSILON).then(|| (a.min(b), a.max(b)))
                    }
                    _ => None,
                }
            };
            if let Some((lo, hi)) = removed {
                intervals = intervals
                    .into_iter()
                    .flat_map(|(a, b)| {
                        let mut kept = Vec::new();
                        if lo > a {
                            kept.push((a, lo.min(b)));
                        }
                        if hi < b {
                            kept.push((hi.max(a), b));
                        }
                        kept
                    })
                    .filter(|(a, b)| b - a > EPSILON)
                    .collect();
            }
        }
        for (a, b) in intervals {
            let corner = |t: f32, depth: f32| {
                [
                    base[0] + axis[0] * t + outward[0] * depth,
                    base[1] + axis[1] * t + outward[1] * depth,
                ]
            };
            outline(
                aperture,
                &[corner(a, 0.0), corner(b, 0.0), corner(b, lw), corner(a, lw)],
            );
        }
    }
}

fn arc_points(
    cx: f32,
    cy: f32,
    radius: f32,
    start_deg: f32,
    end_deg: f32,
    segments: usize,
) -> Vec<[f32; 2]> {
    (0..=segments)
        .map(|index| {
            let angle =
                (start_deg + (end_deg - start_deg) * index as f32 / segments as f32).to_radians();
            [cx + radius * angle.cos(), cy + radius * angle.sin()]
        })
        .collect()
}
