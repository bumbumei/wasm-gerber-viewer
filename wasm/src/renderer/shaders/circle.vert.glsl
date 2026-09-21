#version 300 es
precision highp float;
in vec2 position;
in float center_x_instance;
in float center_y_instance;
in float radius_instance;
uniform mat3 transform;
uniform vec2 viewport_size;
uniform float minimum_feature_pixels;
uniform float anti_aliasing;
uniform float inner_outline_pixels;
uniform float inner_outline_world;
out highp vec2 vPosition;
out highp float vInnerRadius;
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
    // Minimum visibility: a pad is never drawn narrower than the chosen
    // number of pixels, so dense arrays stay visible when zoomed out. The
    // rasteriser samples pixel centres, and a disc only always contains one
    // when its radius is at least sqrt(2)/2 px, so that is the floor once the
    // option is on (a 1 px disc would still miss about a fifth of the pads).
    float minimumRadius = minimum_feature_pixels > 0.0
        ? max(0.5 * minimum_feature_pixels, 0.70710678) / pixelsPerWorld
        : 0.0;
    float trueRadius = max(radius_instance, 0.0);
    float baseRadius = max(trueRadius, minimumRadius);
    // A pad held at the minimum is drawn larger than it is, so its coverage
    // is scaled down by the size ratio. Coverage adds up in the layer mask,
    // so a dense array reads as a lighter texture instead of a solid block,
    // while single pads stay clearly visible (the exact area ratio makes a
    // 20 % copper array almost vanish on a dark background). A zero-size pen
    // (r0) keeps one visible pixel.
    vCoverage = trueRadius > 0.0 ? trueRadius / baseRadius : 1.0;
    float outlineWorldRadius = inner_outline_world + inner_outline_pixels / pixelsPerWorld;
    float effectiveRadius = baseRadius + outlineWorldRadius;
    // Anti-aliasing: the quad grows by half a pixel so the fragment shader's
    // soft edge has room outside the true radius, which stays at
    // length(vPosition) == 1.0.
    float fringe = anti_aliasing > 0.5 ? 0.5 / pixelsPerWorld : 0.0;
    float drawnRadius = effectiveRadius + fringe;
    vec2 scaledPos = position * drawnRadius + center;
    vec3 transformed = transform * vec3(scaledPos, 1.0);
    gl_Position = vec4(transformed.xy, 0.0, 1.0);
    vPosition = position * (drawnRadius / max(effectiveRadius, 0.000000001));
    vInnerRadius = outlineWorldRadius > 0.0 && effectiveRadius > 0.000001
        ? baseRadius / effectiveRadius
        : 0.0;
}
