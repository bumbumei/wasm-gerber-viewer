#version 300 es
precision highp float;
uniform lowp vec4 color;
in float vCoverage;
out lowp vec4 fragColor;
void main() {
    // Red: presence for composite membership; alpha: displayed coverage.
    fragColor = vec4(color.r * vCoverage, color.g, color.b, color.a * vCoverage);
}
