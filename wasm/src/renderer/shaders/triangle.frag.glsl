#version 300 es
precision highp float;
in highp vec2 vPosition;
in highp vec2 vHoleCenter;
in highp float vHoleRadius;
in highp float vCoverage;
in highp float vWorldPerPixel;
uniform lowp vec4 color;
uniform float anti_aliasing;
out lowp vec4 fragColor;
void main() {
    float alpha = 1.0;
    if (vHoleRadius > 0.0) {
        float holeDist = length(vPosition - vHoleCenter);
        if (anti_aliasing > 0.5) {
            // Analytic edge coverage for the hole; the outer edges are
            // triangle edges and get their anti-aliasing from multisampling.
            alpha = clamp((holeDist - vHoleRadius) / vWorldPerPixel + 0.5, 0.0, 1.0);
        } else {
            alpha = holeDist >= vHoleRadius ? 1.0 : 0.0;
        }
        if (alpha <= 0.0) discard;
    }
    // Red: edge coverage for composite membership; alpha: displayed coverage.
    float displayed = vCoverage * alpha;
    fragColor = vec4(color.r * displayed, color.g * alpha, color.b * alpha, color.a * displayed);
}
