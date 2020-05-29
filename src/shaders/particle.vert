#version 100

precision mediump float;

attribute vec3 a_pos;
attribute vec2 a_uv0;

uniform mat4 u_modelView;
uniform mat4 g_proj;

varying vec2 v_uv;

void main()
{
    v_uv = a_uv0;

    vec4 camPos = u_modelView * vec4(a_pos, 1.0);

    gl_Position = g_proj * camPos;
}