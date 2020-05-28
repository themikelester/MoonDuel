#version 100
precision mediump float;

uniform vec3 u_baseLightPos;
uniform vec4 u_backgroundAmbient;
uniform vec4 u_backgroundDiffuse;
uniform sampler2D u_tex;

varying vec2 v_uv;
varying vec3 v_norm;

void main()
{
    vec4 tap = texture2D(u_tex, v_uv);

    vec3 lightPos = u_baseLightPos;
    float nDotL = dot(normalize(v_norm), normalize(lightPos));
    vec3 amb = u_backgroundAmbient.rgb;
    vec3 diffuse = u_backgroundDiffuse.rgb * nDotL;
    
    gl_FragColor = vec4((diffuse + amb) * tap.rgb, 1);
}