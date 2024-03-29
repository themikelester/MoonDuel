#version 100
precision mediump float;

uniform vec4 u_color;
uniform sampler2D u_atlas;

varying vec2 v_uv;

void main()
{
  vec4 tap = texture2D(u_atlas, v_uv);
  gl_FragColor = vec4(tap);
}