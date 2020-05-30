#version 100
precision mediump float;

uniform sampler2D u_tex;
uniform vec4 u_colorPrim;
uniform vec4 u_colorEnv;

varying vec2 v_uv;

void main()
{
    vec4 tap = texture2D(u_tex, v_uv);

    vec3 color = mix(u_colorEnv.rgb, u_colorPrim.rgb, tap.rgb);
    float alpha = mix(0.0, tap.a, u_colorPrim.a);

    gl_FragColor = vec4(color, alpha);
}