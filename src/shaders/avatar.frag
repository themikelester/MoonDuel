precision mediump float;

varying vec3 v_TexCoord0;
varying vec3 v_TexCoord1;

uniform vec4 u_Color0;
uniform vec4 u_KonstColor0;
uniform vec4 u_KonstColor1;
uniform vec4 u_KonstColor3;
uniform sampler2D u_Texture0;
uniform sampler2D u_Texture1;

// Use the tex tap to blend between two uniform colors
void main(void) {    
    vec4 color;

    // Tap each texture for which we have coordinates
    vec4 tap0 = texture2D(u_Texture0, v_TexCoord0.xy);
    vec4 tap1 = texture2D(u_Texture1, v_TexCoord1.xy);
    
    vec3 albedo = tap0.rgb;

    vec3 light = mix(u_Color0.rgb, u_KonstColor0.rgb, tap1.rrr);
    color.rgb = albedo * light;
    color.a = u_KonstColor3.a * tap0.a;

    color.rgb += u_KonstColor1.rgb * tap1.ggg;

    gl_FragColor = color;
}