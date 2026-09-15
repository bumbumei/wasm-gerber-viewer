use super::envelope::{parse_envelope, LayerKind, Plating};
use super::features::Units;
use super::features::{parse_features, parse_orient, Fields, Record};
use super::layer::{place_record, Placement};
use super::lzw::{decompress_unix_z, is_unix_z};
use super::symbols::{parse_standard_symbol, shape_to_aperture, Shape, ThermalKind};
use super::tools::parse_tools;
use super::{is_odb_envelope, take_last_diagnostics};
use crate::drill::{parse_drill_with_offset, parse_drill_with_offset_and_interactions};
use crate::interaction::FeatureKind;
use crate::parser::{parse_gerber_payload_with_options, parse_gerber_with_options, GerberParser};

const MILS: f32 = 0.0254;
const MICRONS: f32 = 0.001;

fn assert_approx(actual: f32, expected: f32) {
    assert!(
        (actual - expected).abs() < 1e-4,
        "expected {expected}, got {actual}"
    );
}

fn envelope(kind: &str, features: &str, extra: &[(&str, &str)]) -> String {
    let mut text =
        format!("%ODB++LAYER%\nkind={kind}\nname=TEST\n%ODB++FILE features%\n{features}\n");
    for (name, content) in extra {
        text.push_str(&format!("%ODB++FILE {name}%\n{content}\n"));
    }
    text.push_str("%ODB++END%\n");
    text
}

fn drill_envelope(plating: &str, features: &str, tools: &str) -> String {
    format!(
        "%ODB++LAYER%\nkind=drill\nname=DRILL\nplating={plating}\n%ODB++FILE features%\n{features}\n%ODB++FILE tools%\n{tools}\n%ODB++END%\n"
    )
}

fn layer_bounds(layers: &[crate::geometry::GerberData]) -> (f32, f32, f32, f32) {
    let mut bounds = (
        f32::INFINITY,
        f32::NEG_INFINITY,
        f32::INFINITY,
        f32::NEG_INFINITY,
    );
    for layer in layers {
        bounds.0 = bounds.0.min(layer.boundary.min_x());
        bounds.1 = bounds.1.max(layer.boundary.max_x());
        bounds.2 = bounds.2.min(layer.boundary.min_y());
        bounds.3 = bounds.3.max(layer.boundary.max_y());
    }
    bounds
}

#[test]
fn envelope_round_trip_keeps_every_file() {
    let text = envelope(
        "signal",
        "UNITS=MM\n$0 r600\nP 1 2 0 P 0 0",
        &[
            ("symbols/Fid", "$0 r100\nP 0 0 0 P 0 0"),
            ("tools", "THICKNESS=0"),
        ],
    );
    assert!(is_odb_envelope(&text));
    assert!(is_odb_envelope(&format!("\u{feff}\n{text}")));
    assert!(!is_odb_envelope("%FSLAX24Y24*%"));
    let parsed = parse_envelope(&text).unwrap();
    assert_eq!(parsed.kind, LayerKind::Signal);
    assert_eq!(parsed.name, "TEST");
    assert_eq!(parsed.plating, Plating::All);
    assert!(parsed.features.contains("P 1 2 0 P 0 0"));
    assert_eq!(parsed.tools.map(str::trim), Some("THICKNESS=0"));
    assert_eq!(parsed.symbols.len(), 1);
    assert!(
        parsed.symbols["fid"].contains("r100"),
        "symbol names are lower-cased"
    );
    assert!(
        parse_envelope("%ODB++LAYER%\nkind=signal\n%ODB++FILE features%\nP 0 0 0 P 0 0\n").is_err()
    );
}

#[test]
fn features_parse_units_symbols_and_every_record_type() {
    let features = parse_features(
        "#comment\nUNITS=MM\n$0 r600\n$1 rect1400x800 5\n@0 .string 1\nP 1 2 0 P 0 8 30;0=1\nP 3 4 -1 1 200 N 5 9 45\nL 0 0 10 0 0 P 0\nA 0 0 1 1 1 0 0 P 0 Y\nS P 0\nOB 0 0 I\nOS 10 0\nOC 10 10 5 5 N\nOS 0 0\nOE\nOB 2 2 H\nOS 4 2\nOS 4 4\nOE\nSE\nT 0 0 standard P 0 1 1 1 'x' 1\nB 0 0 x P 0 1 1 1 'y' 1\nZ junk\n",
    );
    assert_eq!(features.units, Units::Mm);
    assert_approx(features.symbol_scale, MICRONS);
    assert_eq!(features.symbols[&1].name, "rect1400x800");
    assert_approx(features.symbols[&1].resize, 5.0);
    assert_eq!(features.records.len(), 7);
    let Record::Pad(pad) = &features.records[0] else {
        panic!()
    };
    assert_approx(pad.x, 1.0);
    assert_approx(pad.orient.angle_deg, 30.0);
    assert!(!pad.orient.mirror);
    let Record::Pad(resized) = &features.records[1] else {
        panic!()
    };
    assert_eq!(resized.sym, 1);
    assert_approx(resized.resize, 200.0);
    assert!(resized.neg);
    assert_eq!(resized.dcode, 5);
    assert!(resized.orient.mirror);
    assert_approx(resized.orient.angle_deg, 45.0);
    let Record::Arc(arc) = &features.records[3] else {
        panic!()
    };
    assert!(arc.cw);
    let Record::Surface(surface) = &features.records[4] else {
        panic!()
    };
    assert_eq!(surface.polygons.len(), 2);
    assert!(surface.polygons[1].hole);
    assert_eq!(surface.polygons[0].segments.len(), 3);
    assert_eq!(features.counts.texts, 1);
    assert_eq!(features.counts.barcodes, 1);
    assert_eq!(features.counts.unknown, 1);

    // Inch is the default and coordinates scale to mm.
    let inch = parse_features("$0 r15.748\nP 1 0 0 P 0 0\n");
    assert_eq!(inch.units, Units::Inch);
    let Record::Pad(pad) = &inch.records[0] else {
        panic!()
    };
    assert_approx(pad.x, 25.4);
    assert_approx(inch.symbol_scale, MILS);

    let orient = |text: &str| parse_orient(&mut Fields::new(text));
    assert_eq!(orient("0").angle_deg, 0.0);
    assert_eq!(orient("6").angle_deg, 180.0);
    assert!(orient("6").mirror);
    assert_eq!(orient("8 -30").angle_deg, 330.0);
    assert!(orient("9 45").mirror);
}

#[test]
fn standard_symbols_resolve_in_both_units() {
    let circle = |name: &str, scale: f32| match parse_standard_symbol(name, scale) {
        Some(Shape::Circle { d }) => d,
        other => panic!("{name} is not a circle: {other:?}"),
    };
    assert_approx(circle("r15.748", MILS), 0.4);
    assert_approx(circle("r1050", MICRONS), 1.05);
    assert!(matches!(
        parse_standard_symbol("s800", MICRONS),
        Some(Shape::Rect { w, h }) if (w - 0.8).abs() < 1e-5 && (h - 0.8).abs() < 1e-5
    ));
    assert!(matches!(
        parse_standard_symbol("rect1400x800xr250x13", MICRONS),
        Some(Shape::RoundedRect { corners, .. }) if corners.has(1) && corners.has(3) && !corners.has(2)
    ));
    assert!(matches!(
        parse_standard_symbol("donut_sr1200x600", MICRONS),
        Some(Shape::DonutSquareRound { .. })
    ));
    assert!(matches!(
        parse_standard_symbol("hole1000x1x2x3", MICRONS),
        Some(Shape::Circle { .. })
    ));
    assert!(matches!(
        parse_standard_symbol("thr1600x1000x45x4x300", MICRONS),
        Some(Shape::Thermal {
            spokes: 4,
            kind: ThermalKind::RoundRounded,
            ..
        })
    ));
    assert!(matches!(
        parse_standard_symbol("moire10x5x3x2x60x45", MICRONS),
        Some(Shape::Moire {
            rings: 3,
            angle_deg,
            ..
        }) if (angle_deg - 45.0).abs() < 1e-4
    ));
    assert!(matches!(
        parse_standard_symbol("oval_h1000x500", MICRONS),
        Some(Shape::HalfOval { w, h }) if (w - 1.0).abs() < 1e-5 && (h - 0.5).abs() < 1e-5
    ));
    assert!(
        matches!(
            parse_standard_symbol("o_ths1000x500x45x4x100x50", MICRONS),
            Some(Shape::Unsupported { .. })
        ),
        "families without a shape still fall back"
    );
    assert_eq!(parse_standard_symbol("CUSTOMD294", MICRONS), None);
    assert_eq!(parse_standard_symbol("silk_kiro", MICRONS), None);
    assert_eq!(parse_standard_symbol("construct+71", MICRONS), None);
    // Names that merely start like a standard family are user symbols.
    assert_eq!(parse_standard_symbol("r10_tp", MICRONS), None);
    assert_eq!(parse_standard_symbol("s1_via", MICRONS), None);
    assert_eq!(parse_standard_symbol("rect_custom", MICRONS), None);
    assert_eq!(parse_standard_symbol("r10x", MICRONS), None);

    let aperture = shape_to_aperture(&Shape::RoundedRect {
        w: 1.4,
        h: 0.8,
        r: 0.25,
        corners: super::symbols::Corners::ALL,
    });
    assert!(!aperture.primitives.is_empty());
    assert_approx(aperture.width, 1.4);
    let donut = shape_to_aperture(&Shape::DonutSquare { od: 1.2, id: 0.6 });
    assert!(donut.has_negative, "square donuts clear their centre");
    let thermal = shape_to_aperture(&Shape::Thermal {
        od: 1.6,
        id: 1.0,
        angle_deg: 45.0,
        spokes: 4,
        gap: 0.3,
        kind: ThermalKind::RoundRounded,
    });
    assert!(!thermal.primitives.is_empty());
    assert!(!thermal.has_negative, "thr is built from positive segments");
    assert_approx(thermal.width, 1.6);
}

fn covers(aperture: &crate::parser::Aperture, x: f32, y: f32) -> bool {
    use crate::parser::geometry::Primitive;
    let mut inside = false;
    for primitive in &aperture.primitives {
        let (hit, exposure) = match primitive {
            Primitive::Circle {
                x: cx,
                y: cy,
                radius,
                exposure,
                hole_radius,
                ..
            } => {
                let d = ((x - cx).powi(2) + (y - cy).powi(2)).sqrt();
                (d <= *radius && d >= *hole_radius, *exposure)
            }
            Primitive::Triangle {
                vertices, exposure, ..
            } => {
                let [a, b, c] = vertices;
                let sign = |p: [f32; 2], q: [f32; 2]| {
                    (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])
                };
                let (s1, s2, s3) = (sign(*a, *b), sign(*b, *c), sign(*c, *a));
                let neg = s1 < 0.0 || s2 < 0.0 || s3 < 0.0;
                let pos = s1 > 0.0 || s2 > 0.0 || s3 > 0.0;
                (!(neg && pos), *exposure)
            }
            _ => (false, 1.0),
        };
        if hit {
            inside = exposure > 0.0;
        }
    }
    inside
}

#[test]
fn symbol_geometry_matches_reference_viewer() {
    // Butterflies fill the upper-left and lower-right quadrants.
    let bfr = shape_to_aperture(&Shape::ButterflyRound { d: 2.0 });
    assert!(covers(&bfr, -0.5, 0.5));
    assert!(covers(&bfr, 0.5, -0.5));
    assert!(!covers(&bfr, 0.5, 0.5));
    assert!(!covers(&bfr, -0.5, -0.5));
    let bfs = shape_to_aperture(&Shape::ButterflySquare { s: 2.0 });
    assert!(covers(&bfs, -0.9, 0.9));
    assert!(covers(&bfs, 0.9, -0.9));
    assert!(!covers(&bfs, 0.9, 0.9));
    assert!(!covers(&bfs, -0.9, -0.9));

    // Half oval: round end towards +x when wider than tall, apex at x = h.
    let wide = shape_to_aperture(&Shape::HalfOval { w: 3.0, h: 1.0 });
    assert!(covers(&wide, -1.9, 0.0));
    assert!(covers(&wide, 0.95, 0.0));
    assert!(!covers(&wide, 1.05, 0.0));
    assert!(!covers(&wide, 0.9, 0.45));
    assert!(covers(&wide, -1.0, 0.45));
    let tall = shape_to_aperture(&Shape::HalfOval { w: 1.0, h: 3.0 });
    assert!(covers(&tall, 0.0, -1.9));
    assert!(covers(&tall, 0.0, 0.95));
    assert!(!covers(&tall, 0.0, 1.05));

    // Thermal rings are open at the spoke angles and solid between them.
    let thr = shape_to_aperture(&Shape::Thermal {
        od: 2.0,
        id: 1.0,
        angle_deg: 0.0,
        spokes: 4,
        gap: 0.2,
        kind: ThermalKind::RoundRounded,
    });
    assert!(!covers(&thr, 0.75, 0.0), "gap centred on 0 degrees");
    assert!(!covers(&thr, 0.0, 0.75), "gap centred on 90 degrees");
    let (c45, s45) = (45f32.to_radians().cos(), 45f32.to_radians().sin());
    assert!(covers(&thr, 0.75 * c45, 0.75 * s45), "solid at 45 degrees");
    assert!(!covers(&thr, 0.0, 0.0), "centre is open");
    let ths = shape_to_aperture(&Shape::Thermal {
        od: 2.0,
        id: 1.0,
        angle_deg: 45.0,
        spokes: 4,
        gap: 0.2,
        kind: ThermalKind::RoundSquared,
    });
    assert!(
        !covers(&ths, 0.75 * c45, 0.75 * s45),
        "gap centred on 45 degrees"
    );
    assert!(covers(&ths, 0.75, 0.0), "solid at 0 degrees");
    let s_ths = shape_to_aperture(&Shape::Thermal {
        od: 2.0,
        id: 1.0,
        angle_deg: 0.0,
        spokes: 4,
        gap: 0.2,
        kind: ThermalKind::Square,
    });
    assert!(covers(&s_ths, 0.9, 0.9), "square ring reaches its corner");
    assert!(!covers(&s_ths, 0.75, 0.0), "gap centred on 0 degrees");
    assert!(!covers(&s_ths, 0.0, 0.0), "square centre is open");
    let rc_ths = shape_to_aperture(&Shape::RectThermal {
        w: 4.0,
        h: 2.0,
        angle_deg: 45.0,
        spokes: 4,
        gap: 0.2,
        air_gap: 0.3,
    });
    assert!(covers(&rc_ths, 0.0, 0.85), "long side is solid");
    assert!(!covers(&rc_ths, 1.85, 0.85), "diagonal gap cuts the corner");
    assert!(!covers(&rc_ths, 0.0, 0.0));

    // Moire: dot, then rings separated by the gap, from the centre outwards.
    let moire = shape_to_aperture(&Shape::Moire {
        ring_width: 0.2,
        ring_gap: 0.3,
        rings: 2,
        line_width: 0.1,
        line_length: 3.0,
        angle_deg: 0.0,
    });
    // Probe along 45 degrees, away from the crosshair lines.
    let at = |r: f32| (r * c45, r * s45);
    let on_ring = |r: f32| {
        let (x, y) = at(r);
        covers(&moire, x, y)
    };
    assert!(on_ring(0.05), "centre dot");
    assert!(!on_ring(0.25), "first gap");
    assert!(on_ring(0.5), "first ring 0.4..0.6");
    assert!(!on_ring(0.8), "second gap 0.6..0.9");
    assert!(on_ring(1.0), "second ring 0.9..1.1");
    assert!(!on_ring(1.2), "nothing past the last ring");
    assert!(
        covers(&moire, 1.4, 0.0),
        "crosshair reaches the line length"
    );
    assert!(!covers(&moire, 1.4, 0.4));
}

#[test]
fn tools_files_scale_sizes_by_their_units() {
    let tools = parse_tools(
        "UNITS=MM\nTHICKNESS=0\nTOOLS {\n    NUM=1\n    TYPE=VIA\n    FINISH_SIZE=300\n}\nTOOLS {\n    NUM=2\n    TYPE=NON_PLATED\n    FINISH_SIZE=1000\n}\n",
        Units::Inch,
    );
    assert_eq!(tools.units, Units::Mm);
    assert_eq!(tools.tools.len(), 2);
    assert_approx(tools.tools[0].finish_size_mm.unwrap(), 0.3);
    assert_eq!(tools.tools[1].tool_type, super::tools::ToolType::NonPlated);
    let inch = parse_tools(
        "TOOLS {\n NUM=1\n TYPE=PLATED\n FINISH_SIZE=39.37\n}\n",
        Units::Inch,
    );
    assert_approx(inch.tools[0].finish_size_mm.unwrap(), 1.0);
}

#[test]
fn pads_flash_with_odb_orientation() {
    // A 2 x 1 mm rectangle rotated 90 degrees clockwise spans 1 x 2 mm.
    let text = envelope(
        "signal",
        "UNITS=MM\n$0 rect2000x1000\nP 10 10 0 P 0 1\n",
        &[],
    );
    let layers = parse_gerber_with_options(&text, true, 1).unwrap();
    let (min_x, max_x, min_y, max_y) = layer_bounds(&layers);
    assert_approx(max_x - min_x, 1.0);
    assert_approx(max_y - min_y, 2.0);
    assert_approx((min_x + max_x) / 2.0, 10.0);

    // Mirrored pads keep their angle; a rotated pad off-axis lands where the
    // clockwise convention says (a 4 x 0.2 bar at 8 30 leans down to the right).
    let text = envelope(
        "signal",
        "UNITS=MM\n$0 rect4000x200\nP 0 0 0 P 0 8 30\n",
        &[],
    );
    let payload = parse_gerber_payload_with_options(&text, true, 1).unwrap();
    let feature = &payload.interaction_layer.unwrap().features[0];
    assert_eq!(feature.descriptor.kind, FeatureKind::Flash);
    let (_, max_x, min_y, _) = layer_bounds(&payload.render_layers);
    assert!(max_x > 1.6, "bar reaches right");
    assert!(min_y < -0.9, "right end is rotated clockwise (downwards)");
}

#[test]
fn lines_arcs_and_surfaces_become_geometry() {
    let features = "UNITS=MM\n$0 r200\n$1 s300\n$2 rect1000x500\nL 0 0 10 0 0 P 0\nL 0 5 10 5 1 P 0\nL 3 3 3 3 1 P 0\nL 0 8 10 8 2 P 0\nA 20 0 22 2 20 2 0 P 0 N\nA 30 0 30 0 31 0 0 P 0 Y\nS P 0\nOB 0 20 I\nOS 0 30\nOS 10 30\nOC 12 28 10 28 Y\nOS 12 20\nOS 0 20\nOE\nOB 2 22 H\nOS 6 22\nOS 6 26\nOS 2 26\nOS 2 22\nOE\nSE\n";
    let text = envelope("signal", features, &[]);
    let payload = parse_gerber_payload_with_options(&text, true, 1).unwrap();
    let kinds: Vec<FeatureKind> = payload
        .interaction_layer
        .as_ref()
        .unwrap()
        .features
        .iter()
        .map(|feature| feature.descriptor.kind.clone())
        .collect();
    assert_eq!(
        kinds,
        vec![
            FeatureKind::Draw,
            FeatureKind::Draw,
            FeatureKind::Flash,
            FeatureKind::Draw,
            FeatureKind::ArcDraw,
            FeatureKind::ArcDraw,
            FeatureKind::Region,
        ]
    );
    let (min_x, max_x, min_y, max_y) = layer_bounds(&payload.render_layers);
    // The rect pen line is drawn round with the smaller dimension (0.5 mm).
    assert_approx(min_x, -0.25);
    // The full circle at (31, 0) with radius 1 plus half the 0.2 mm pen.
    assert_approx(max_x, 32.1);
    assert_approx(min_y, -1.1);
    assert_approx(max_y, 30.0);
    assert_eq!(
        take_last_diagnostics().as_deref(),
        Some("Skipped or approximated: 1 line with non-round symbols drawn round")
    );

    // The hole survives in approximate mode too: the island is triangulated
    // with its hole, so no triangle covers the hole centre.
    let layers = parse_gerber_with_options(&text, false, 1).unwrap();
    let mut covers_hole = false;
    let mut covers_island = false;
    for layer in &layers {
        for triangle in layer.triangles.vertices.chunks_exact(6) {
            let tri = [
                [triangle[0], triangle[1]],
                [triangle[2], triangle[3]],
                [triangle[4], triangle[5]],
            ];
            covers_hole |= point_in_triangle([4.0, 24.0], tri);
            covers_island |= point_in_triangle([8.0, 24.0], tri);
        }
    }
    assert!(covers_island, "island filled");
    assert!(!covers_hole, "hole left open");
}

fn point_in_triangle(p: [f32; 2], t: [[f32; 2]; 3]) -> bool {
    let sign = |a: [f32; 2], b: [f32; 2], c: [f32; 2]| {
        (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1])
    };
    let d1 = sign(p, t[0], t[1]);
    let d2 = sign(p, t[1], t[2]);
    let d3 = sign(p, t[2], t[0]);
    let has_neg = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
    let has_pos = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
    !(has_neg && has_pos)
}

#[test]
fn negative_features_open_clear_polarity_layers() {
    let text = envelope(
        "signal",
        "UNITS=MM\n$0 r1000\n$1 r400\nP 0 0 0 P 0 0\nP 0 0 1 N 0 0\nP 5 0 0 P 0 0\n",
        &[],
    );
    let layers = parse_gerber_with_options(&text, true, 1).unwrap();
    let polarities: Vec<bool> = layers.iter().map(|layer| layer.is_negative).collect();
    assert_eq!(polarities, vec![false, true, false]);
}

#[test]
fn profile_layers_are_stroked_not_filled() {
    let text = envelope(
        "profile",
        "UNITS=MM\nS P 0\nOB 0 0 I\nOS 0 30\nOS 40 30\nOS 40 4\nOC 36 0 36 4 Y\nOS 0 0\nOE\nSE\n",
        &[],
    );
    let layers = parse_gerber_with_options(&text, true, 1).unwrap();
    let (min_x, max_x, min_y, max_y) = layer_bounds(&layers);
    assert_approx(min_x, -0.05);
    assert_approx(max_x, 40.05);
    assert_approx(min_y, -0.05);
    assert_approx(max_y, 30.05);
    let triangles: usize = layers
        .iter()
        .map(|layer| layer.triangles.vertices.len())
        .sum();
    assert_eq!(triangles, 0, "an outline has no filled area");
    assert!(
        layers.iter().any(|layer| !layer.arcs.x.is_empty()),
        "the corner stays an arc"
    );
}

#[test]
fn user_symbols_expand_in_place_with_nesting_and_polarity() {
    let text = envelope(
        "signal",
        "UNITS=MM\n$0 fid\n$1 missing\nP 10 10 0 P 0 0\nP 20 20 0 N 0 8 45\nP 30 30 1 P 0 0\nP 40 40 -1 0 100 P 0 0\n",
        &[
            ("symbols/ring", "UNITS=MM\n$0 r200\nA 1 0 1 0 0 0 0 P 0 Y\n"),
            (
                "symbols/fid",
                "UNITS=MM\n$0 r500\n$1 ring\n$2 r0\nP 0 0 0 P 0 0\nP 0 0 1 P 0 0\nL 0 0 0.5 0 2 P 0\nT 0 0 standard P 0 1 1 1 'x' 1\n",
            ),
        ],
    );
    let payload = parse_gerber_payload_with_options(&text, true, 1).unwrap();
    let features = &payload.interaction_layer.as_ref().unwrap().features;
    let flashes = features
        .iter()
        .filter(|feature| feature.descriptor.kind == FeatureKind::Flash)
        .count();
    let arcs = features
        .iter()
        .filter(|feature| feature.descriptor.kind == FeatureKind::ArcDraw)
        .count();
    assert_eq!(flashes, 3, "one r500 dot per expansion; r0 draws nothing");
    assert_eq!(arcs, 3, "the nested ring is expanded each time");
    assert!(
        payload.render_layers.iter().any(|layer| layer.is_negative),
        "negative pad clears its symbol"
    );
    let (min_x, max_x, _, _) = layer_bounds(&payload.render_layers);
    assert_approx(min_x, 10.0 - 1.1);
    assert_approx(max_x, 40.0 + 1.1);
    let diagnostics = take_last_diagnostics().unwrap();
    assert!(diagnostics.contains("3 text records"), "{diagnostics}");
    assert!(
        diagnostics.contains("(missing; symbol not found in job)"),
        "{diagnostics}"
    );
    assert!(
        diagnostics.contains("resize ignored on user-defined symbols (fid)"),
        "{diagnostics}"
    );
}

#[test]
fn user_symbols_named_like_standard_families_are_expanded() {
    // The maintainer's case: `r10_tp` is a user symbol, not `r10`.
    let text = envelope(
        "signal",
        "UNITS=MM\n$0 r10_tp\nP 5 5 0 P 0 0\n",
        &[("symbols/r10_tp", "UNITS=MM\n$0 r500\nP 0 0 0 P 0 0\n")],
    );
    let layers = parse_gerber_with_options(&text, true, 1).unwrap();
    let (min_x, max_x, _, _) = layer_bounds(&layers);
    assert_approx(min_x, 4.75);
    assert_approx(max_x, 5.25);
    assert_eq!(take_last_diagnostics(), None, "nothing skipped");
}

#[test]
fn degenerate_square_lines_flash_instead_of_producing_nan() {
    let text = envelope(
        "signal",
        "UNITS=MM\n$0 s400\nL 3 3 3 3 0 P 0\nL 7 7 7.00000001 7 0 P 0\n",
        &[],
    );
    let layers = parse_gerber_with_options(&text, true, 1).unwrap();
    for layer in &layers {
        assert!(layer
            .triangles
            .vertices
            .iter()
            .all(|value| value.is_finite()));
        assert!(layer.boundary.min_x().is_finite() && layer.boundary.max_y().is_finite());
    }
    let (min_x, max_x, _, _) = layer_bounds(&layers);
    assert_approx(min_x, 2.8);
    assert_approx(max_x, 7.2);
}

#[test]
fn placement_composes_orientation_and_mirrors_arcs() {
    let symbol = parse_features(
        "UNITS=MM\n$0 rect1000x500\n$1 r100\nP 1 0 0 P 0 8 30\nA 1 0 0 1 0 0 1 P 0 N\n",
    );
    let (Record::Pad(pad), Record::Arc(arc)) = (&symbol.records[0], &symbol.records[1]) else {
        panic!()
    };

    let plain = parse_features("UNITS=MM\n$0 x\nP 5 5 0 P 0 1\n");
    let Record::Pad(outer) = &plain.records[0] else {
        panic!()
    };
    let placement = Placement::new(outer);
    let Record::Pad(placed) = place_record(&Record::Pad(pad.clone()), &placement) else {
        panic!()
    };
    assert_approx(placed.x, 5.0);
    assert_approx(placed.y, 4.0);
    assert_approx(placed.orient.angle_deg, 120.0);
    assert!(!placed.orient.mirror);

    let mirrored_outer = parse_features("UNITS=MM\n$0 x\nP 0 0 0 N 0 9 90\n");
    let Record::Pad(outer) = &mirrored_outer.records[0] else {
        panic!()
    };
    let placement = Placement::new(outer);
    let Record::Pad(placed) = place_record(&Record::Pad(pad.clone()), &placement) else {
        panic!()
    };
    assert_approx(placed.orient.angle_deg, 300.0);
    assert!(placed.orient.mirror);
    assert!(placed.neg);
    let Record::Arc(placed_arc) = place_record(&Record::Arc(arc.clone()), &placement) else {
        panic!()
    };
    assert!(placed_arc.cw, "mirroring reverses the arc direction");
    assert_approx(placed_arc.xc, 0.0);
}

#[test]
fn drill_layers_split_by_plating_and_keep_slots_and_arcs() {
    let features = "UNITS=MM\n$0 r300\n$1 r1000\n$2 r600\nP 1 1 0 P 1 0\nP 2 2 0 P 1 0\nP 5 5 1 P 2 0\nL 8 8 12 8 2 P 3 0\nA 20 0 24 4 20 4 2 P 3 0 N\nS P 0\nOB 0 0 I\nOS 1 0\nOS 1 1\nOE\nSE\n";
    let tools = "UNITS=MM\nTOOLS {\n NUM=1\n TYPE=VIA\n FINISH_SIZE=300\n}\nTOOLS {\n NUM=2\n TYPE=NON_PLATED\n FINISH_SIZE=1000\n}\nTOOLS {\n NUM=3\n TYPE=PLATED\n FINISH_SIZE=600\n}\n";

    let plated = parse_drill_with_offset_and_interactions(
        &drill_envelope("plated", features, tools),
        0.0,
        0.0,
        0.0,
    )
    .unwrap();
    assert_eq!(plated.metadata.hit_count, 2);
    assert_eq!(plated.metadata.slot_count, 2, "one slot and one arc cut");
    assert_eq!(plated.metadata.tools.len(), 2);
    assert_approx(plated.metadata.tools[0].diameter_mm, 0.3);
    assert!(
        !plated.fill_layer.arcs.x.is_empty(),
        "the rout arc stays an arc"
    );
    assert_eq!(
        take_last_diagnostics().as_deref(),
        Some("Skipped or approximated: 1 surface")
    );

    let non_plated = parse_drill_with_offset(
        &drill_envelope("non_plated", features, tools),
        0.0,
        0.0,
        0.0,
    )
    .unwrap();
    assert_eq!(non_plated.metadata.hit_count, 1);
    assert_approx(non_plated.metadata.tools[0].diameter_mm, 1.0);

    let all =
        parse_drill_with_offset(&drill_envelope("all", features, tools), 0.0, 5.0, 0.0).unwrap();
    assert_eq!(all.metadata.hit_count, 3);
    assert_approx(all.fill_layer.boundary.min_x(), 5.0 + 1.0 - 0.15);

    // A tools file without UNITS follows the layer's units (mm here), so the
    // 1000 finish size is 1 mm and matches the non-plated tool by size.
    let tools_no_units = "TOOLS {\n NUM=2\n TYPE=NON_PLATED\n FINISH_SIZE=1000\n}\n";
    let by_size = parse_drill_with_offset(
        &drill_envelope(
            "non_plated",
            "UNITS=MM\n$0 r1000\nP 5 5 0 P 9 0\n",
            tools_no_units,
        ),
        0.0,
        0.0,
        0.0,
    )
    .unwrap();
    assert_eq!(
        by_size.metadata.hit_count, 1,
        "matched by size in layer units"
    );
}

/// The text every `.Z` fixture in `testdata/` was made from (by the test
/// encoder that is cross-checked against GNU `gzip -d`).
fn lzw_fixture_text() -> Vec<u8> {
    let mut text = String::new();
    for index in 0..600u64 {
        text.push_str(&format!(
            "P {} {} {} P 0 {}\n",
            (index * 7919) % 1000,
            (index * 104729) % 1000,
            index % 13,
            index % 9
        ));
    }
    text.into_bytes()
}

#[test]
fn unix_z_streams_decode_across_width_growth_clear_and_narrow_tables() {
    let expected = lzw_fixture_text();
    assert!(expected.len() > 10_000);
    for (name, bytes) in [
        (
            "growth.Z (12-bit)",
            &include_bytes!("testdata/growth.Z")[..],
        ),
        (
            "clear.Z (16-bit, CLEAR every 700 codes)",
            &include_bytes!("testdata/clear.Z")[..],
        ),
        (
            "narrow.Z (9-bit, table fills)",
            &include_bytes!("testdata/narrow.Z")[..],
        ),
    ] {
        let output = decompress_unix_z(bytes, usize::MAX).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(output == expected, "{name} round trip");
    }
    assert_eq!(
        decompress_unix_z(include_bytes!("testdata/kwkwk.Z"), usize::MAX).unwrap(),
        b"abababababababab"
    );
    assert!(
        decompress_unix_z(include_bytes!("testdata/empty.Z"), usize::MAX)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn unix_z_rejects_bad_input_and_caps_output() {
    assert!(!is_unix_z(&[1, 2, 3]));
    assert!(decompress_unix_z(&[1, 2, 3], usize::MAX)
        .unwrap_err()
        .contains("not in UNIX compress"));
    assert!(
        decompress_unix_z(&[0x1f, 0x9d, 0x08], usize::MAX).is_err(),
        "bad code width"
    );
    let error = decompress_unix_z(include_bytes!("testdata/growth.Z"), 100).unwrap_err();
    assert!(error.contains("could not be decompressed"), "{error}");
    // A code that is not defined yet is corrupt data, not a panic.
    let mut corrupt = include_bytes!("testdata/growth.Z").to_vec();
    corrupt[3] = 0xff;
    corrupt[4] = 0xff;
    assert!(decompress_unix_z(&corrupt, usize::MAX).is_err());
}

#[test]
fn envelope_errors_and_empty_layers() {
    // Error paths stay `String`s until the WASM boundary, so they can be
    // checked natively here.
    let error = parse_envelope("%ODB++LAYER%\nkind=bogus\n%ODB++END%\n")
        .err()
        .expect("bogus kind must fail");
    assert!(error.contains("unknown kind"), "{error}");
    let error = parse_envelope("%ODB++LAYER%\nkind=signal\n%ODB++FILE features%\nP 0 0 0 P 0 0\n")
        .err()
        .expect("missing end marker must fail");
    assert!(error.contains("truncated"), "{error}");

    // Nothing drawable yields no layers; the WASM entry point turns that into
    // the usual "no geometry" error.
    let empty = envelope("signal", "UNITS=MM\n$0 r0\nP 0 0 0 P 0 0\n", &[]);
    let mut parser = GerberParser::with_options(true, 1);
    assert!(parser.parse(&empty).unwrap().is_empty());
}
