#version 100
precision mediump float;

uniform vec4 u_color;
uniform float u_scroll;
uniform sampler2D u_tex;

varying vec2 v_uv;

void main()
{
    vec4 tapA = texture2D(u_tex, v_uv);
    vec4 tapB = texture2D(u_tex, vec2(v_uv.x + 0.2, v_uv.y));
    vec3 cloudTap = u_color.rgb * (tapA.rgb + tapB.rgb - tapA.rgb * tapB.rgb);
    float cloudAlpha = tapA.a * tapB.a;

    gl_FragColor = vec4(cloudTap, cloudAlpha);
}