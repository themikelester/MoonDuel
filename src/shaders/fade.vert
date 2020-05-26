#version 100

precision mediump float;

attribute vec3 a_pos;

uniform float u_height;
uniform float u_yOffset;

uniform mat4 g_viewProj;

varying float v_blend;

void main()
{
    v_blend = a_pos.y;

    vec3 pos = a_pos;
    pos.y = pos.y * u_height + u_yOffset;

    gl_Position = g_viewProj * vec4(pos * 100.0, 1.0);
}