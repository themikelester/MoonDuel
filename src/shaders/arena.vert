#version 100

precision mediump float;

attribute vec3 a_pos;
attribute vec3 a_normal;
attribute vec2 a_uv0;

uniform mat4 u_model;
uniform mat4 g_viewProj;

varying vec2 v_uv;
varying vec3 v_norm;

void main()
{
    v_uv = a_uv0;
    v_norm = mat3(u_model) * a_normal;
    gl_Position = g_viewProj * u_model * vec4(a_pos, 1.0);


}