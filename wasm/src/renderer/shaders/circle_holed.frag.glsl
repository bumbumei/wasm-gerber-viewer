#version 300 es
precision highp float;
in highp vec2 vPosition;
in highp vec2 vHoleCenter;
in highp float vHoleRadius;
in highp float vEdgeWidth;
uniform lowp vec4 color;
uniform float anti_aliasing;
out lowp vec4 fragColor;
void main() {
    float dist = length(vPosition);
    float holeDist = vHoleRadius > 0.0 ? length(vPosition - vHoleCenter) : 2.0;
    float alpha;
    if (anti_aliasing > 0.5) {
        // Analytic edge coverage for the disc and its hole (see circle.frag.glsl).
        alpha = clamp((1.0 - dist) / vEdgeWidth + 0.5, 0.0, 1.0);
        if (vHoleRadius > 0.0) {
            alpha *= clamp((holeDist - vHoleRadius) / vEdgeWidth + 0.5, 0.0, 1.0);
        }
    } else {
        alpha = dist <= 1.0 && holeDist >= vHoleRadius ? 1.0 : 0.0;
    }
    if (alpha <= 0.0) discard;
    fragColor = color * alpha;
}
