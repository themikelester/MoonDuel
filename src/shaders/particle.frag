#version 100
precision mediump float;

uniform sampler2D u_tex;
uniform vec4 u_colorPrim;
uniform vec4 u_colorEnv;

varying vec2 v_uv;

void main()
{
    vec4 tap = texture2D(u_tex, v_uv);

    // @HACK: When ImageBitmap loads PNGs, it does not seem to write color if alpha is zero. So all of the outside 
    //        of our image is 0 when it should be 1. Will probably need to not use PNGs for this to work.
    if (tap.a < 1.0) tap.rgb = vec3(1.0);

    vec3 color = mix(u_colorEnv.rgb, u_colorPrim.rgb, tap.rgb);
    float alpha = mix(0.0, tap.a, u_colorPrim.a);

    gl_FragColor = vec4(color, alpha);
}