#version 300 es
precision highp float;
in highp vec2 vPosition;
in highp vec2 vHoleCenter;
in highp float vHoleRadius;
in highp float vCoverage;
uniform lowp vec4 color;
out lowp vec4 fragColor;
void main() {
    float alpha = 1.0;
    if (vHoleRadius > 0.0) {
        // Analytic edge coverage for the hole; the outer edges are triangle
        // edges and get their anti-aliasing from multisampling.
        float holeDist = length(vPosition - vHoleCenter);
        alpha = clamp((holeDist - vHoleRadius) / max(fwidth(holeDist), 0.000001) + 0.5, 0.0, 1.0);
        if (alpha <= 0.0) discard;
    }
    fragColor = color * (vCoverage * alpha);
}
