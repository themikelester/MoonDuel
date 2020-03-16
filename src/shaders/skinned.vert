precision mediump float;

#ifndef k_MaxBones
#   defined k_MaxBones 32
#endif

attribute vec3 a_pos;
attribute vec4 a_joints;
attribute vec4 a_weights;

uniform mat4 g_viewProj;
uniform mat4 u_bones[k_MaxBones];

void main()
{
    vec4 pos = vec4(a_pos, 1.0);
    vec4 modelPos = 
        (u_bones[int(a_joints.x)] * pos * a_weights.x) + 
        (u_bones[int(a_joints.y)] * pos * a_weights.y) + 
        (u_bones[int(a_joints.z)] * pos * a_weights.z) + 
        (u_bones[int(a_joints.w)] * pos * a_weights.w);

    gl_Position = g_viewProj * modelPos;
}