#version 100
precision mediump float;

uniform sampler2D u_tex;
uniform vec4 u_colorPrim;
uniform vec4 u_colorEnv;

varying vec2 v_uv;

void main()
{
    vec2 tap = texture2D(u_tex, v_uv).ra;
    vec3 color = mix(u_colorEnv.rgb, u_colorPrim.rgb, tap.r);

    gl_FragColor = vec4(color.rgb, u_colorPrim.a * tap.g);
}