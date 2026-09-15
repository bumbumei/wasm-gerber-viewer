//! Standard ODB++ symbol names → apertures.
//!
//! Symbol dimensions are written in thousandths of the job unit (mils in inch
//! jobs, microns in mm jobs); callers pass `scale` = millimetres per thousandth.

use crate::parser::geometry::{triangulate_outline, Primitive};
use crate::parser::{finalize_aperture, Aperture, ApertureKind};

const OUTLINE_ARC_SEGMENTS: usize = 8;
const ELLIPSE_SEGMENTS: usize = 64;

// Every standard symbol family of the ODB++ specification (appendix A),
// longest prefixes first so `donut_sr` is not read as `donut_s` + "r...".
// Families without a dedicated shape still parse as standard symbols and fall
// back to a circle instead of being mistaken for user-defined symbols.
const PREFIXES: &[&str] = &[
    "oblong_ths",
    "radhplate",
    "donut_sr",
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

/// A corner mask: 1 = top-right, 2 = top-left, 3 = bottom-left, 4 = bottom-right.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Corners(u8);

impl Corners {
    pub(crate) const ALL: Corners = Corners(0b1111);

    fn parse(value: &str) -> Corners {
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
    DonutSquare {
        od: f32,
        id: f32,
    },
    DonutSquareRound {
        od: f32,
        id: f32,
    },
    DonutRect {
        ow: f32,
        oh: f32,
        lw: f32,
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
    Thermal {
        od: f32,
        id: f32,
        angle_deg: f32,
        spokes: u32,
        gap: f32,
        square: bool,
    },
    Ellipse {
        w: f32,
        h: f32,
    },
    /// `oval_h<w>x<h>`: an oval of width `w` cut along its long axis, so the
    /// flat edge is at the bottom and the height is `h`.
    HalfOval {
        w: f32,
        h: f32,
    },
    /// `moire<rw>x<rg>x<nr>x<lw>x<ll>x<la>`: concentric rings of width `rw`
    /// separated by `rg`, at most `nr` of them, inside a crosshair of line
    /// width `lw`, length `ll` and angle `la` degrees. The outermost ring's
    /// outer diameter equals the crosshair length, as in the Gerber moire
    /// primitive, and rings are laid inwards from there.
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
    /// A standard family without a dedicated shape; drawn as a circle of
    /// `fallback_diameter` when known.
    Unsupported {
        fallback_diameter: Option<f32>,
    },
}

/// Parse a standard symbol name. Returns `None` when the name is not a
/// standard symbol (i.e. a user-defined symbol).
///
/// A name is only standard when it matches the whole standard grammar:
/// `<family><number>(x[rc]?<number>)*`, or `hole<number>(x<token>)*` for
/// holes. Anything else (`r10_tp`, `rect_custom`, `s1_via`) is a
/// user-defined symbol that lives in `symbols/<name>/features`.
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
            _ => Shape::Unsupported {
                fallback_diameter: None,
            },
        });
    }

    let mut dims: Vec<f32> = Vec::new();
    // (kind, size, value) for `r<size>` / `c<size>` corner flags and the digits after them.
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
                    Ok(value) if value.is_finite() => dims.push(value * scale),
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
            let size = part[1..].parse::<f32>().unwrap_or(0.0) * scale;
            flags.push((part.as_bytes()[0], size, String::new()));
        } else {
            // Not the standard grammar: a user-defined symbol whose name
            // happens to start like a standard family.
            return None;
        }
    }
    let unsupported = || Shape::Unsupported {
        fallback_diameter: dims.first().copied(),
    };
    let dim = |index: usize| dims.get(index).copied();

    Some(match prefix {
        "r" => match dim(0) {
            Some(d) => Shape::Circle { d },
            None => unsupported(),
        },
        "s" => match dim(0) {
            Some(s) => Shape::Rect { w: s, h: s },
            None => unsupported(),
        },
        "rect" => match (dim(0), dim(1)) {
            (Some(w), Some(h)) => match flags.first() {
                None => Shape::Rect { w, h },
                Some((b'r', size, value)) => Shape::RoundedRect {
                    w,
                    h,
                    r: *size,
                    corners: Corners::parse(value),
                },
                Some((_, size, value)) => Shape::ChamferedRect {
                    w,
                    h,
                    c: *size,
                    corners: Corners::parse(value),
                },
            },
            _ => unsupported(),
        },
        "oval" => match (dim(0), dim(1)) {
            (Some(w), Some(h)) => Shape::Oval { w, h },
            _ => unsupported(),
        },
        "oval_h" => match (dim(0), dim(1)) {
            (Some(w), Some(h)) => Shape::HalfOval { w, h },
            _ => unsupported(),
        },
        "moire" => match (dim(0), dim(1), dim(2), dim(3), dim(4), dim(5)) {
            (Some(rw), Some(rg), Some(nr), Some(lw), Some(ll), Some(la)) => Shape::Moire {
                ring_width: rw,
                ring_gap: rg,
                rings: (nr / scale).round().max(0.0) as u32,
                line_width: lw,
                line_length: ll,
                angle_deg: la / scale,
            },
            _ => unsupported(),
        },
        "di" => match (dim(0), dim(1)) {
            (Some(w), Some(h)) => Shape::Diamond { w, h },
            _ => unsupported(),
        },
        "oct" => match (dim(0), dim(1), dim(2)) {
            (Some(w), Some(h), Some(r)) => Shape::Octagon { w, h, r },
            _ => unsupported(),
        },
        "donut_r" => match (dim(0), dim(1)) {
            (Some(od), Some(id)) => Shape::DonutRound { od, id },
            _ => unsupported(),
        },
        "donut_sr" => match (dim(0), dim(1)) {
            (Some(od), Some(id)) => Shape::DonutSquareRound { od, id },
            _ => unsupported(),
        },
        "donut_s" => match (dim(0), dim(1)) {
            (Some(od), Some(id)) => Shape::DonutSquare { od, id },
            _ => unsupported(),
        },
        "donut_rc" => match (dim(0), dim(1), dim(2)) {
            (Some(ow), Some(oh), Some(lw)) => Shape::DonutRect { ow, oh, lw },
            _ => unsupported(),
        },
        "donut_o" => match (dim(0), dim(1), dim(2)) {
            (Some(ow), Some(oh), Some(lw)) => Shape::DonutOval { ow, oh, lw },
            _ => unsupported(),
        },
        "hex_l" | "hex_s" => match (dim(0), dim(1), dim(2)) {
            (Some(w), Some(h), Some(r)) => Shape::Hexagon {
                w,
                h,
                r,
                vertical: prefix == "hex_s",
            },
            _ => unsupported(),
        },
        "tri" => match (dim(0), dim(1)) {
            (Some(base), Some(h)) => Shape::Triangle { base, h },
            _ => unsupported(),
        },
        "thr" | "ths" | "s_ths" => match (dim(0), dim(1), dim(2), dim(3), dim(4)) {
            (Some(od), Some(id), Some(angle), Some(spokes), Some(gap)) => Shape::Thermal {
                od,
                id,
                angle_deg: angle / scale,
                spokes: (spokes / scale).round().max(0.0) as u32,
                gap,
                square: prefix == "s_ths",
            },
            _ => unsupported(),
        },
        "el" => match (dim(0), dim(1)) {
            (Some(w), Some(h)) => Shape::Ellipse { w, h },
            _ => unsupported(),
        },
        "bfr" => match dim(0) {
            Some(d) => Shape::ButterflyRound { d },
            None => unsupported(),
        },
        "bfs" => match dim(0) {
            Some(s) => Shape::ButterflySquare { s },
            None => unsupported(),
        },
        _ => unsupported(),
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
        Shape::DonutSquare { od, id } => Shape::DonutSquare { od: grow(od), id },
        Shape::DonutSquareRound { od, id } => Shape::DonutSquareRound { od: grow(od), id },
        Shape::DonutRect { ow, oh, lw } => Shape::DonutRect {
            ow: grow(ow),
            oh: grow(oh),
            lw,
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
            od,
            id,
            angle_deg,
            spokes,
            gap,
            square,
        } => Shape::Thermal {
            od: grow(od),
            id,
            angle_deg,
            spokes,
            gap,
            square,
        },
        Shape::Ellipse { w, h } => Shape::Ellipse {
            w: grow(w),
            h: grow(h),
        },
        Shape::ButterflyRound { d } => Shape::ButterflyRound { d: grow(d) },
        Shape::ButterflySquare { s } => Shape::ButterflySquare { s: grow(s) },
        Shape::Unsupported { fallback_diameter } => Shape::Unsupported {
            fallback_diameter: fallback_diameter.map(grow),
        },
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
        Shape::Thermal { od, .. } => *od,
        Shape::ButterflyRound { d } => *d,
        Shape::ButterflySquare { s } => *s,
        Shape::Unsupported { fallback_diameter } => fallback_diameter.unwrap_or(0.0),
    }
}

/// Shapes with no area (e.g. the `r0` pen some CAM tools use) draw nothing.
pub(crate) fn is_empty_shape(shape: &Shape) -> bool {
    match shape {
        Shape::Circle { d } => *d <= 0.0 || d.is_nan(),
        Shape::Rect { w, h } | Shape::Oval { w, h } => {
            *w <= 0.0 || *h <= 0.0 || w.is_nan() || h.is_nan()
        }
        Shape::Unsupported { fallback_diameter } => !fallback_diameter.is_some_and(|d| d > 0.0),
        _ => false,
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
            oval(&mut aperture, *w, *h, 1.0);
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
        Shape::DonutSquare { od, id } => {
            rect(&mut aperture, *od, *od, 0.0);
            rect_exposure(&mut aperture, *id, *id, 0.0);
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *od, *od);
        }
        Shape::DonutRect { ow, oh, lw } => {
            rect(&mut aperture, *ow, *oh, 0.0);
            rect_exposure(
                &mut aperture,
                (ow - 2.0 * lw).max(0.0),
                (oh - 2.0 * lw).max(0.0),
                0.0,
            );
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *ow, *oh);
        }
        Shape::DonutOval { ow, oh, lw } => {
            oval(&mut aperture, *ow, *oh, 1.0);
            oval(&mut aperture, ow - 2.0 * lw, oh - 2.0 * lw, 0.0);
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *ow, *oh);
        }
        Shape::Thermal {
            od,
            id,
            angle_deg,
            gap,
            ..
        } => {
            aperture.primitives.push(Primitive::Thermal {
                x: 0.0,
                y: 0.0,
                outer_diameter: *od,
                inner_diameter: *id,
                gap_thickness: *gap,
                rotation: angle_deg.to_radians(),
                exposure: 1.0,
            });
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *od, *od);
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
            let r = d / 2.0;
            let mut upper = vec![[0.0, 0.0]];
            upper.extend(arc_points(0.0, 0.0, r, 0.0, 90.0, OUTLINE_ARC_SEGMENTS));
            let mut lower = vec![[0.0, 0.0]];
            lower.extend(arc_points(0.0, 0.0, r, 180.0, 270.0, OUTLINE_ARC_SEGMENTS));
            outline(&mut aperture, &upper);
            outline(&mut aperture, &lower);
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, *d, *d);
        }
        Shape::ButterflySquare { s } => {
            let s = s / 2.0;
            outline(&mut aperture, &[[0.0, 0.0], [s, 0.0], [s, s], [0.0, s]]);
            outline(&mut aperture, &[[0.0, 0.0], [-s, 0.0], [-s, -s], [0.0, -s]]);
            aperture.kind = ApertureKind::Macro;
            set_size(&mut aperture, 2.0 * s, 2.0 * s);
        }
        Shape::Unsupported { fallback_diameter } => {
            if let Some(d) = fallback_diameter.filter(|d| *d > 0.0) {
                circle(&mut aperture, d, 0.0);
                aperture.kind = ApertureKind::Circle;
                aperture.is_solid_circle = true;
                set_size(&mut aperture, d, d);
            }
        }
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

fn rect_exposure(aperture: &mut Aperture, width: f32, height: f32, exposure: f32) {
    if width <= 0.0 || height <= 0.0 {
        return;
    }
    let hw = width / 2.0;
    let hh = height / 2.0;
    for vertices in [
        [[-hw, -hh], [hw, -hh], [hw, hh]],
        [[-hw, -hh], [hw, hh], [-hw, hh]],
    ] {
        aperture.primitives.push(Primitive::Triangle {
            vertices,
            exposure,
            hole_x: 0.0,
            hole_y: 0.0,
            hole_radius: 0.0,
        });
    }
}

fn oval(aperture: &mut Aperture, width: f32, height: f32, exposure: f32) {
    if width <= 0.0 || height <= 0.0 {
        return;
    }
    let short = width.min(height);
    let radius = short / 2.0;
    if (width - height).abs() < 1e-6 {
        aperture.primitives.push(Primitive::Circle {
            x: 0.0,
            y: 0.0,
            radius,
            exposure,
            hole_x: 0.0,
            hole_y: 0.0,
            hole_radius: 0.0,
        });
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
            exposure,
            hole_x: 0.0,
            hole_y: 0.0,
            hole_radius: 0.0,
        });
    }
    rect_exposure(aperture, rect_w, rect_h, exposure);
}

fn outline(aperture: &mut Aperture, points: &[[f32; 2]]) {
    if points.len() < 3 {
        return;
    }
    if let Ok(triangles) = triangulate_outline(points, 1.0) {
        aperture.primitives.extend(triangles);
    }
}

// Corner numbering: 1 = top-right, 2 = top-left, 3 = bottom-left, 4 = bottom-right.
const CORNER_SIGNS: [[f32; 2]; 4] = [[1.0, 1.0], [-1.0, 1.0], [-1.0, -1.0], [1.0, -1.0]];
const CORNER_START_ANGLE: [f32; 4] = [0.0, 90.0, 180.0, 270.0];

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

/// Half of an oval cut along its long axis: a flat bottom edge, straight
/// sides and a rounded top with corner radius `min(h, w / 2)`. Centred on its
/// own bounding box like every other symbol.
fn half_oval_points(w: f32, h: f32) -> Vec<[f32; 2]> {
    let r = h.min(w / 2.0).max(0.0);
    let top = h / 2.0;
    let bottom = -h / 2.0;
    let mut points = vec![[-w / 2.0, bottom], [w / 2.0, bottom]];
    if r > 0.0 {
        // Right corner: up the side and over to the top edge, then the left corner.
        points.extend(arc_points(
            w / 2.0 - r,
            top - r,
            r,
            0.0,
            90.0,
            OUTLINE_ARC_SEGMENTS,
        ));
        points.extend(arc_points(
            -w / 2.0 + r,
            top - r,
            r,
            90.0,
            180.0,
            OUTLINE_ARC_SEGMENTS,
        ));
    } else {
        points.push([w / 2.0, top]);
        points.push([-w / 2.0, top]);
    }
    points
}

/// Concentric rings inside a crosshair (ODB++ `moire`).
fn moire(
    aperture: &mut Aperture,
    ring_width: f32,
    ring_gap: f32,
    rings: u32,
    line_width: f32,
    line_length: f32,
    angle_deg: f32,
) {
    let mut outer_radius = line_length / 2.0;
    for _ in 0..rings {
        if outer_radius <= 0.0 || ring_width <= 0.0 {
            break;
        }
        let inner_radius = (outer_radius - ring_width).max(0.0);
        aperture.primitives.push(Primitive::Circle {
            x: 0.0,
            y: 0.0,
            radius: outer_radius,
            exposure: 1.0,
            hole_x: 0.0,
            hole_y: 0.0,
            hole_radius: inner_radius,
        });
        outer_radius = inner_radius - ring_gap;
    }
    if line_width > 0.0 && line_length > 0.0 {
        for extra in [0.0f32, 90.0] {
            let angle = (angle_deg + extra).to_radians();
            let (cos, sin) = (angle.cos(), angle.sin());
            let (hl, hw) = (line_length / 2.0, line_width / 2.0);
            let corners = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]]
                .map(|[x, y]| [x * cos - y * sin, x * sin + y * cos]);
            outline(aperture, &corners);
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
