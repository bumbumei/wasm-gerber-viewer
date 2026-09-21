#version 300 es
precision highp float;
in highp float vCoverage;
uniform lowp vec4 color;
out lowp vec4 fragColor;
void main() {
    // Red: presence for composite membership; alpha: displayed coverage.
    fragColor = vec4(color.rgb, color.a * vCoverage);
}
