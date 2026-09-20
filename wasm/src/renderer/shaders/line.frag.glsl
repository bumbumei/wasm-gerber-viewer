#version 300 es
precision highp float;
in highp float vSide;
in highp float vInnerSide;
uniform lowp vec4 color;
out lowp vec4 fragColor;
void main() {
    // Analytic edge coverage across the line body (see circle.frag.glsl).
    float side = abs(vSide);
    float edge = max(fwidth(vSide), 0.000001);
    float alpha = clamp((1.0 - side) / edge + 0.5, 0.0, 1.0);
    if (vInnerSide > 0.0) {
        alpha *= clamp((side - vInnerSide) / edge + 0.5, 0.0, 1.0);
    }
    if (alpha <= 0.0) discard;
    fragColor = color * alpha;
}
