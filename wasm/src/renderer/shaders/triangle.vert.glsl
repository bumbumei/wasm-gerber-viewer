#version 300 es
precision highp float;
in vec2 position;
in float hole_x_instance;
in float hole_y_instance;
in float hole_radius_instance;
uniform mat3 transform;
uniform vec2 viewport_size;
out highp vec2 vPosition;
out highp vec2 vHoleCenter;
out highp float vHoleRadius;
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

void main() {
    vWorldPerPixel = 1.0 / max(weakestPixelsPerWorld(), 0.000001);
    vec3 transformed = transform * vec3(position, 1.0);
    gl_Position = vec4(transformed.xy, 0.0, 1.0);
    vPosition = position;
    vHoleCenter = vec2(hole_x_instance, hole_y_instance);
    vHoleRadius = hole_radius_instance;
}
