precision mediump float;

uniform sampler2D baseColorTexture;

#ifdef HAS_UV_SET0
varying vec2 v_uv0;
#endif

void main()
{
    gl_FragColor = vec4(1, 0, 0, 1);

    #ifdef HAS_UV_SET0
        vec3 tap0 = texture2D(baseColorTexture, v_uv0).rgb;
        gl_FragColor = vec4(tap0, 1);
    #endif
}