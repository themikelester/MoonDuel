#version 100

precision mediump float;

attribute vec3 a_pos;
attribute vec2 a_uv0;

uniform float u_scrollColor;
uniform float u_scrollAlpha;

uniform vec3 g_camPos;
uniform mat4 g_viewProj;

varying vec2 v_uvColor;
varying vec2 v_uvAlpha;

void main()
{
  v_uvColor = a_uv0;
  v_uvColor.x += u_scrollColor;

  v_uvAlpha = a_uv0;
  v_uvAlpha.x += u_scrollAlpha;

  vec3 pos = a_pos * 100.0 + g_camPos;
  gl_Position = g_viewProj * vec4(pos, 1.0);
}