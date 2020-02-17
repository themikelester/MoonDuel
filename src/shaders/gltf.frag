precision mediump float;

uniform sampler2D u_tex0;

varying vec2 v_uv0;

void main()
{
    vec3 tap0 = texture2D(u_tex0, v_uv0).rgb;
    gl_FragColor = vec4(tap0, 1);
}