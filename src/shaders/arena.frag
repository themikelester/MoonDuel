#version 100
precision mediump float;

uniform vec4 u_backgroundAmbient;
uniform vec4 u_backgroundDiffuse;
uniform sampler2D u_tex;

varying vec2 v_uv;
varying float v_NDotL;

void main()
{
    vec4 tap = texture2D(u_tex, v_uv);

    vec3 amb = u_backgroundAmbient.rgb;
    vec3 diffuse = u_backgroundDiffuse.rgb * v_NDotL;
    
    gl_FragColor = vec4((diffuse + amb) * tap.rgb, 1);
}