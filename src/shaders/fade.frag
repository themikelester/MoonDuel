#version 100
precision mediump float;

uniform vec4 u_colorA;
uniform vec4 u_colorB;

varying float v_blend;

void main()
{
    vec4 color = mix(u_colorA, u_colorB, v_blend);
    gl_FragColor = color;
}