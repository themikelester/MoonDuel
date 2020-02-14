// --------------------------------------------------------------------------------
// Module which controls the main camera
// --------------------------------------------------------------------------------
import { Camera } from './Camera';
import { GlobalUniforms } from './GlobalUniforms';
import { vec3, mat4 } from 'gl-matrix';

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();

export class CameraSystem {
    private camPos = vec3.create();

    constructor(private camera: Camera) {
    }

    initialize() {
        this.resize(window.innerWidth, window.innerHeight);

        const eyePos = vec3.set(scratchVec3a, 0, 0, -2);
        const center = vec3.set(scratchVec3b, 0, 0, 0);
        const up = vec3.set(scratchVec3b, 0, 1, 0);

        mat4.lookAt(this.camera.cameraMatrix, eyePos, center, up);
        mat4.invert(this.camera.viewMatrix, this.camera.cameraMatrix);

        this.camera.viewMatrixUpdated();
    }

    resize(width: number, height: number) {
        const aspect = width / height;
        this.camera.setPerspective(this.camera.fov, aspect, this.camera.near, this.camera.far);
    }

    update({ globalUniforms }: { globalUniforms: GlobalUniforms }) {
        const camPos = this.camera.getPos(this.camPos);

        globalUniforms.setUniform('g_camPos', new Float32Array([camPos[0], camPos[1], camPos[2]]));
        globalUniforms.setUniform('g_proj', Float32Array.from(this.camera.projectionMatrix));
        globalUniforms.setUniform('g_viewProj', Float32Array.from(this.camera.viewProjMatrix));
    }
}