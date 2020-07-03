#version 100

precision mediump float;

attribute vec2 a_pos;

// Instanced
attribute vec2 a_origin;
attribute vec2 a_size;

void main()
{
  gl_Position = vec4(a_origin + a_pos * a_size, 0.0, 1.0);
}