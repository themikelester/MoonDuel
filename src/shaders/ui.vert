#version 100

precision mediump float;

uniform float u_invAtlasSize;

attribute vec2 a_pos;

// Instanced
attribute vec2 a_origin;
attribute vec2 a_size;
attribute vec4 a_uv;

varying vec2 v_uv;

void main()
{
  v_uv = u_invAtlasSize * (a_uv.xy + a_uv.zw * a_pos);
  gl_Position = vec4(a_origin + a_pos * a_size, 0.0, 1.0);
}