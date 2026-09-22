#version 300 es
precision highp float;
in vec2 position;
uniform mat3 transform;
uniform vec2 viewport_size;
uniform float minimum_feature_pixels;
// Oriented frame of the path region being drawn, so a region smaller than the
// minimum feature width is scaled up about its own centre.
uniform vec2 region_center;
// Angle of the region's principal axis: a thin slot is measured across its
// own thickness whatever its rotation, not across an axis-aligned box.
uniform float region_angle;
uniform vec2 region_half_size;

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
    return max(sqrt(weakestScaleSquared), 0.000001);
}

// Rotate a vector by an angle (radians).
vec2 rotateBy(vec2 v, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

vec2 minimumScale(vec2 halfSize, float pixelsPerWorld) {
    if (minimum_feature_pixels <= 0.0) return vec2(1.0);
    float minimumHalf = max(0.5 * minimum_feature_pixels, 0.70710678) / pixelsPerWorld;
    return vec2(halfSize.x > 0.000001 ? max(1.0, minimumHalf / halfSize.x) : 1.0,
                halfSize.y > 0.000001 ? max(1.0, minimumHalf / halfSize.y) : 1.0);
}

void main() {
    // Option off: the vertex passes through untouched, as before the option.
    vec2 scaledPosition = position;
    if (minimum_feature_pixels > 0.0) {
        vec2 scale = minimumScale(region_half_size, weakestPixelsPerWorld());
        vec2 local = rotateBy(position - region_center, -region_angle) * scale;
        scaledPosition = region_center + rotateBy(local, region_angle);
    }
    vec3 transformed = transform * vec3(scaledPosition, 1.0);
    gl_Position = vec4(transformed.xy, 0.0, 1.0);
}
