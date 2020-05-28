#version 100

precision mediump float;

attribute vec3 a_pos;
attribute vec3 a_normal;
attribute vec2 a_uv0;

uniform vec3 u_baseLightPos;
uniform mat4 u_model;
uniform mat4 g_viewProj;

varying vec2 v_uv;
varying float v_NDotL;

void main()
{
    v_uv = a_uv0;

    vec4 pos = u_model * vec4(a_pos, 1.0);
    
    vec3 n = normalize(mat3(u_model) * a_normal);
    vec3 l = normalize(u_baseLightPos - pos.xyz);
    v_NDotL = dot(n, l);

    gl_Position = g_viewProj * pos;


}