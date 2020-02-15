attribute vec3 POSITION;

uniform mat4 u_modelMtx;

uniform mat4 g_viewProj;

void main()
{
  vec4 worldPos = u_modelMtx * vec4(POSITION, 1.0);
  gl_Position = g_viewProj * worldPos;
}