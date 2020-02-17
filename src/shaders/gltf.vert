attribute vec3 a_pos;
attribute vec2 a_uv0;

uniform mat4 u_modelMtx;

uniform mat4 g_viewProj;

varying vec2 v_uv0;

void main()
{
  v_uv0 = a_uv0;
  vec4 worldPos = u_modelMtx * vec4(a_pos, 1.0);
  gl_Position = g_viewProj * worldPos;
}