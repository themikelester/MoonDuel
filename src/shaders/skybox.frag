#version 100
precision mediump float;

uniform vec4 u_color;
uniform float u_scroll;
uniform sampler2D u_tex;

varying vec2 v_uvColor;
varying vec2 v_uvAlpha;

void main()
{
    vec3 tapA = texture2D(u_tex, v_uvColor).rgb;
    vec3 tapB = texture2D(u_tex, vec2(v_uvColor.x + 0.2, v_uvColor.y)).rgb;
    vec3 cloudTap = u_color.rgb * (tapA + tapB - tapA * tapB);

    float alphaA = texture2D(u_tex, v_uvAlpha).a;
    float alphaB = texture2D(u_tex, vec2(v_uvAlpha.x + 0.2, v_uvAlpha.y)).a;
    float cloudAlpha = alphaA * alphaB;

    gl_FragColor = vec4(cloudTap, cloudAlpha);
}