#version 300 es
precision highp float;
in vec2 position;
in float hole_x_instance;
in float hole_y_instance;
in float hole_radius_instance;
// Centre and half size of the bounding box of the triangle this vertex
// belongs to, so a sub-pixel region (a pad drawn as a polygon) can be held
// at the minimum feature width like a flashed pad.
in float region_center_x;
in float region_center_y;
in float region_half_width;
in float region_half_height;
uniform mat3 transform;
uniform vec2 viewport_size;
uniform float minimum_feature_pixels;
out highp vec2 vPosition;
out highp vec2 vHoleCenter;
out highp float vHoleRadius;
out highp float vCoverage;
// World units per pixel for the hole edge ramp (see circle.vert.glsl).
out highp float vWorldPerPixel;

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

// Minimum visibility for a filled shape: how much each bounding-box axis has
// to grow so the shape is at least sqrt(2)/2 px across (the smallest size that
// always contains a pixel centre) or the chosen minimum, whichever is larger.
// Each axis is scaled on its own, so a thin bar only widens and never grows
// along its length. Returns 1.0 on an axis that is already large enough.
vec2 minimumScale(vec2 halfSize, float pixelsPerWorld) {
    if (minimum_feature_pixels <= 0.0) return vec2(1.0);
    float minimumHalf = max(0.5 * minimum_feature_pixels, 0.70710678) / pixelsPerWorld;
    return vec2(
        halfSize.x > 0.000001 ? max(1.0, minimumHalf / halfSize.x) : 1.0,
        halfSize.y > 0.000001 ? max(1.0, minimumHalf / halfSize.y) : 1.0);
}

void main() {
    float pixelsPerWorld = max(weakestPixelsPerWorld(), 0.000001);
    vWorldPerPixel = 1.0 / pixelsPerWorld;
    vec2 scale = minimumScale(vec2(region_half_width, region_half_height), pixelsPerWorld);
    vec2 center = vec2(region_center_x, region_center_y);
    vec2 scaledPosition = center + (position - center) * scale;
    vec3 transformed = transform * vec3(scaledPosition, 1.0);
    gl_Position = vec4(transformed.xy, 0.0, 1.0);
    vPosition = position;
    vHoleCenter = vec2(hole_x_instance, hole_y_instance);
    vHoleRadius = hole_radius_instance;
    // Coverage falls with the size ratio of the enlargement (see circle.vert.glsl).
    vCoverage = 1.0 / sqrt(scale.x * scale.y);
}
