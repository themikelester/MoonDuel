// Attributes
attribute vec3 a_pos; 
attribute vec3 a_normal;
attribute vec2 a_uv0;
attribute vec4 a_joints;
attribute vec4 a_weights;

// Varyings
varying vec3 v_TexCoord0;
varying vec3 v_TexCoord1;

// Uniforms
uniform mat4 u_viewProj;
uniform mat4 u_model;
uniform sampler2D u_jointTex;
uniform float u_jointCount;
uniform vec4 u_ColorMatReg0;
uniform vec4 u_ColorAmbReg0;

//--------------------------------------------------------------------------------
// Skinning
//--------------------------------------------------------------------------------
mat4 getJointMatrix(float index) {
    float v = (index + 0.5) / u_jointCount;
    return mat4(
    texture2D(u_jointTex, vec2(((0.5 + 0.0) / 4.), v)), texture2D(u_jointTex, vec2(((0.5 + 1.0) / 4.), v)), texture2D(u_jointTex, vec2(((0.5 + 2.0) / 4.), v)), texture2D(u_jointTex, vec2(((0.5 + 3.0) / 4.), v))
    );
}
mat4 computeSkinningMatrix() {
    return
    (getJointMatrix(a_joints.x) * a_weights.x) + 
    (getJointMatrix(a_joints.y) * a_weights.y) + 
    (getJointMatrix(a_joints.z) * a_weights.z) + 
    (getJointMatrix(a_joints.w) * a_weights.w);
}
//--------------------------------------------------------------------------------
// Lighting
//--------------------------------------------------------------------------------
uniform vec4 u_LightColors[2];
uniform mat4 u_LightTransforms[2];
uniform vec3 u_LightDistAttens[2];
uniform vec3 u_LightCosAttens[2];
float ApplyAttenuation(vec3 t_Coeff, float t_Value) {
    return dot(t_Coeff, vec3(1.0, t_Value, t_Value*t_Value));
}
// // Diffuse Function: CLAMP, Attenuation Function: SPEC
vec3 calcLightDiffuseSpecular(vec3 pos, vec3 norm, vec3 ambientColor) {
    vec3 color = ambientColor;
    for (int i = 0; i < 2; i++) {
        vec3 lightPos = u_LightTransforms[i][3].xyz;
        vec3 lightColor = u_LightColors[i].xyz;
        vec3 lightDir = u_LightTransforms[i][2].xyz;
        vec3 lightCosAtten = u_LightCosAttens[i];
        vec3 lightDistAtten = u_LightDistAttens[i];
        vec3 Lvec = lightPos - pos;
        float Ldist2 = dot(Lvec, Lvec);
        float Ldist = sqrt(Ldist2);
        vec3 Ldir = Lvec / Ldist;
        float NdotL = dot(norm, Ldir);
        float diffuse = max(NdotL, 0.0);
        float attenuation = NdotL >= 0.0 ? max(0.0, dot(norm, lightDir)) : 0.0;
        attenuation = ApplyAttenuation(lightCosAtten, attenuation) / ApplyAttenuation(lightDistAtten, attenuation);
        color += diffuse * attenuation * lightColor;
    }
    return color;
}

//--------------------------------------------------------------------------------
// Main shader
//--------------------------------------------------------------------------------
void main(void) {
    // Skinning
    mat4 t_ModelMtx = computeSkinningMatrix();
    vec4 t_WorldPos = t_ModelMtx * vec4(a_pos, 1.0);
    
    // Position transform
    gl_Position = u_viewProj * t_WorldPos;
    
    // Normal transform
    mat3 normalWorld = mat3(t_ModelMtx);
    vec3 t_WorldNorm = normalize(normalWorld * a_normal);
    
    // Lighting
    vec4 t_Light0 = vec4(1.0);
    t_Light0.rgb = calcLightDiffuseSpecular(t_WorldPos.xyz, t_WorldNorm, u_ColorAmbReg0.rgb);
    
    // Vertex Colors
    vec4 v_Color0;
    v_Color0.rgb = u_ColorMatReg0.rgb * t_Light0.rgb;
    v_Color0.a = u_ColorMatReg0.a * t_Light0.a;
    
    // UV (TexGen)
    v_TexCoord0 = vec3(a_uv0, 1.0);
    v_TexCoord1 = vec3(v_Color0.rg, 1.0);
}