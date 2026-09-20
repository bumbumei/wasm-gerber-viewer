#version 300 es
precision highp float;
in vec2 position;
in float center_x_instance;
in float center_y_instance;
in float radius_instance;
in float hole_x_instance;
in float hole_y_instance;
in float hole_radius_instance;
uniform mat3 transform;
uniform vec2 viewport_size;
uniform float minimum_feature_pixels;
out highp vec2 vPosition;
out highp vec2 vHoleCenter;
out highp float vHoleRadius;
out highp float vCoverage;

// The smallest on-screen scale of the current transform, in pixels per world
// unit (the shorter axis when the view is anisotropic).
float weakestPixelsPerWorld() {
    vec2 pixelScale = viewport_size * 0.5;
    vec2 axisX = (mat2(transform) * vec2(1.0, 0.0)) * pixelScale;
    vec2 axisY = (mat2(transform) * vec2(0.0, 1.0)) * pixelScale;
    float a = dot(axisX, axisX);
    float b = dot(axisX, axisY);
    float d = dot(axisY, axisY);
    float trace = a + d;
    float discriminant = sqrt(max((a - d) * (a - d) + 4.0 * b * b, 0.0));
    float weakestScaleSquared = max((trace - discriminant) * 0.5, 0.0);
    return sqrt(weakestScaleSquared);
}

void main() {
    vec2 center = vec2(center_x_instance, center_y_instance);
    float pixelsPerWorld = max(weakestPixelsPerWorld(), 0.000001);
    // Minimum visibility (see circle.vert.glsl). The hole keeps its world
    // size, so it fades out first when the pad is held at the minimum.
    float minimumRadius = minimum_feature_pixels > 0.0
        ? max(0.5 * minimum_feature_pixels, 0.70710678) / pixelsPerWorld
        : 0.0;
    float trueRadius = max(radius_instance, 0.0);
    float effectiveRadius = max(trueRadius, minimumRadius);
    // Coverage scaled by the area ratio when the pad is held at the minimum
    // (see circle.vert.glsl).
    vCoverage = trueRadius > 0.0
        ? (trueRadius * trueRadius) / (effectiveRadius * effectiveRadius)
        : 1.0;
    vec2 scaledPos = position * effectiveRadius + center;
    vec3 transformed = transform * vec3(scaledPos, 1.0);
    gl_Position = vec4(transformed.xy, 0.0, 1.0);
    vPosition = position;
    float safeRadius = max(effectiveRadius, 0.000000001);
    vHoleCenter = (vec2(hole_x_instance, hole_y_instance) - center) / safeRadius;
    vHoleRadius = hole_radius_instance / safeRadius;
}
