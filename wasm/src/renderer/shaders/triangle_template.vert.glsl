#version 300 es
precision highp float;
in vec2 position;
in float instance_x;
in float instance_y;
uniform mat3 transform;
uniform vec2 viewport_size;
uniform float minimum_feature_pixels;
// Half of the template's smaller bounding-box side, in world units.
uniform float template_half_extent;
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
    // Minimum visibility: when the flashed shape would be narrower than the
    // chosen number of pixels, the whole template is scaled up about its
    // flash point so the pad stays visible. As for circles, the floor is
    // sqrt(2)/2 px so the shape always contains a pixel centre.
    float pixelsPerWorld = max(weakestPixelsPerWorld(), 0.000001);
    float minimumHalfExtent = minimum_feature_pixels > 0.0
        ? max(0.5 * minimum_feature_pixels, 0.70710678) / pixelsPerWorld
        : 0.0;
    float scale = template_half_extent > 0.000001
        ? max(1.0, minimumHalfExtent / template_half_extent)
        : 1.0;
    // Coverage scaled by the area ratio of the enlargement (see circle.vert.glsl).
    vCoverage = 1.0 / (scale * scale);
    vec2 worldPosition = position * scale + vec2(instance_x, instance_y);
    vec3 transformed = transform * vec3(worldPosition, 1.0);
    gl_Position = vec4(transformed.xy, 0.0, 1.0);
}
