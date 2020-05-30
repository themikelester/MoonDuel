#version 100
precision mediump float;

uniform sampler2D u_tex;

varying vec2 v_uv;

void main()
{
    vec4 tap = texture2D(u_tex, v_uv);
    gl_FragColor = tap;
}