#version 100

precision mediump float;

attribute vec3 a_pos;
attribute vec2 a_uv0;

uniform float u_scroll;

uniform vec3 g_camPos;
uniform mat4 g_viewProj;

varying vec2 v_uv;

void main()
{
  v_uv = a_uv0;
  v_uv.x += u_scroll;

  vec3 pos = a_pos * 100.0 + g_camPos;
  gl_Position = g_viewProj * vec4(pos, 1.0);
}