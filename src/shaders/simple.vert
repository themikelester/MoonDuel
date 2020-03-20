#version 100

precision mediump float;

attribute vec3 a_pos;

uniform mat4 u_model;
uniform mat4 g_viewProj;

void main()
{
    gl_Position = g_viewProj * u_model * vec4(a_pos, 1.0);
}