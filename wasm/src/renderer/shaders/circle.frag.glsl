#version 300 es
precision highp float;
in highp vec2 vPosition;
in highp float vInnerRadius;
in highp float vCoverage;
in highp float vEdgeWidth;
uniform lowp vec4 color;
uniform float anti_aliasing;
out lowp vec4 fragColor;
void main() {
    float dist = length(vPosition);
    float alpha;
    if (anti_aliasing > 0.5) {
        // Analytic edge coverage: the disc edge is at dist == 1.0 and
        // vEdgeWidth is how much dist changes across one pixel, so alpha
        // ramps over exactly one pixel. A sub-pixel disc gets a proportionally dim pixel
        // instead of being present or absent depending on where its centre
        // falls.
        float edge = vEdgeWidth;
        alpha = clamp((1.0 - dist) / edge + 0.5, 0.0, 1.0);
        if (vInnerRadius > 0.0) {
            alpha *= clamp((dist - vInnerRadius) / edge + 0.5, 0.0, 1.0);
        }
    } else {
        alpha = dist <= 1.0 && dist >= vInnerRadius ? 1.0 : 0.0;
    }
    if (alpha <= 0.0) discard;
    // Red (and alpha) carry the displayed coverage after the minimum-width
    // compensation; green carries the shape's own edge coverage, which
    // composite membership tests against 0.5, so a pad held at the minimum
    // stays a composite member although it is drawn dim.
    float displayed = vCoverage * alpha;
    fragColor = vec4(color.r * displayed, color.g * alpha, color.b * alpha, color.a * displayed);
}
