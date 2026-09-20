#version 300 es
precision highp float;
in vec2 position;
in float instance_x;
in float instance_y;
uniform mat3 transform;
uniform vec2 viewport_size;
uniform float minimum_feature_pixels;
// Half size of the template's bounding box, in world units.
uniform vec2 template_half_size;
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
    // Minimum visibility: a flashed template narrower than the minimum is
    // scaled up about its flash point, each axis on its own, so the pad
    // stays visible without a thin shape growing along its length.
    float pixelsPerWorld = max(weakestPixelsPerWorld(), 0.000001);
    vec2 scale = minimumScale(template_half_size, pixelsPerWorld);
    vec2 worldPosition = position * scale + vec2(instance_x, instance_y);
    vec3 transformed = transform * vec3(worldPosition, 1.0);
    gl_Position = vec4(transformed.xy, 0.0, 1.0);
    vCoverage = 1.0 / sqrt(scale.x * scale.y);
}
