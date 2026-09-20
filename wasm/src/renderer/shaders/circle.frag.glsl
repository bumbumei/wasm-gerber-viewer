#version 300 es
precision highp float;
in highp vec2 vPosition;
in highp float vInnerRadius;
in highp float vCoverage;
uniform lowp vec4 color;
out lowp vec4 fragColor;
void main() {
    // Analytic edge coverage: the disc edge is at dist == 1.0 and fwidth
    // gives how much dist changes across one pixel, so alpha ramps over
    // exactly one pixel. A sub-pixel disc gets a proportionally dim pixel
    // instead of being present or absent depending on where its centre falls.
    float dist = length(vPosition);
    float edge = max(fwidth(dist), 0.000001);
    float alpha = clamp((1.0 - dist) / edge + 0.5, 0.0, 1.0);
    if (vInnerRadius > 0.0) {
        alpha *= clamp((dist - vInnerRadius) / edge + 0.5, 0.0, 1.0);
    }
    if (alpha <= 0.0) discard;
    fragColor = color * (vCoverage * alpha);
}
