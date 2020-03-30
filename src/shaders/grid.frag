#version 300 es
precision mediump float;

in vec3 v_worldPos;
out vec4 o_fragColor;

uniform vec4 u_baseColor;
uniform vec4 u_lineColor;
uniform float u_gridUnit;
uniform float u_gridRadius;

void main()
{
    // Pick a coordinate to visualize in a grid
    vec2 coord = v_worldPos.xz / u_gridUnit;

    // Compute anti-aliased world-space grid lines
    vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
    float line = min(grid.x, grid.y);

    // Just visualize the grid lines directly
    float lineAmount = 1.0 - min(line, 1.0);
    vec4 color = mix(u_baseColor, u_lineColor, lineAmount);

    float opacity = smoothstep(u_gridRadius * 0.7, u_gridRadius, length(v_worldPos)); 
    color = mix( color, vec4(0), opacity);

    o_fragColor = color;
}