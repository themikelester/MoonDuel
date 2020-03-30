#version 300 es

precision mediump float;

in vec2 a_pos;

out vec3 v_worldPos;

uniform float u_gridRadius;
uniform mat4 g_viewProj;

void main()
{
    v_worldPos = vec3(a_pos.x, 0, a_pos.y) * u_gridRadius;

    gl_Position = g_viewProj * vec4(v_worldPos, 1.0);
}