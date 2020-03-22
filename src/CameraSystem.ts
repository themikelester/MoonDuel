// --------------------------------------------------------------------------------
// Module which controls the main camera
// --------------------------------------------------------------------------------
import { Camera } from './Camera';
import { GlobalUniforms } from './GlobalUniforms';
import { vec3, mat4 } from 'gl-matrix';
import { InputManager } from './Input';
import { DebugMenu } from './DebugMenu';
import { Clock } from './Clock';

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();

export class CameraSystem {
    private camPos = vec3.create();
    private controller: CameraController; 

    constructor(private camera: Camera) {
    }

    initialize() {
        this.resize(window.innerWidth, window.innerHeight);

        this.controller = new OrbitCameraController();
        this.controller.camera = this.camera;
    }

    resize(width: number, height: number) {
        const aspect = width / height;
        this.camera.setPerspective(this.camera.fov, aspect, this.camera.near, this.camera.far);
    }

    update({ globalUniforms, input, clock }: { globalUniforms: GlobalUniforms, input: InputManager, clock: Clock }) {
        this.controller.update(input, clock.dt);

        const camPos = this.camera.getPos(this.camPos);
        globalUniforms.setUniform('g_camPos', new Float32Array([camPos[0], camPos[1], camPos[2]]));
        globalUniforms.setUniform('g_proj', Float32Array.from(this.camera.projectionMatrix));
        globalUniforms.setUniform('g_viewProj', Float32Array.from(this.camera.viewProjMatrix));
    }

    toJSON(): string {
        return this.controller.toJSON();
    }

    fromJSON(data: string) {
        return this.controller.fromJSON(data);
    }
}

export interface CameraController {
    camera: Camera;
    update(inputManager: InputManager, dt: number): boolean;
    toJSON(): string;
    fromJSON(data: any): void;
}

const vec3Up = vec3.fromValues(0, 1, 0);
export class OrbitCameraController implements CameraController {
    public camera: Camera;

    public x: number = -Math.PI / 2;
    public y: number = 2;
    public z: number = -4;
    public orbitSpeed: number = -0.05;
    public xVel: number = 0;
    public yVel: number = 0;
    public zVel: number = 0;

    public translation = vec3.create();
    public txVel: number = 0;
    public tyVel: number = 0;
    public shouldOrbit: boolean = true;

    constructor() {
        const menu = DebugMenu.addFolder('OrbitCamera');
        menu.add(this, 'orbitSpeed', -1.0, 1.0);
        menu.add(this, 'shouldOrbit', -1.0, 1.0);
    }

    public update(inputManager: InputManager, dt: number): boolean {
        const shouldOrbit = this.shouldOrbit;

        const invertXMult = inputManager.invertX ? -1 : 1;
        const invertYMult = inputManager.invertY ? -1 : 1;

        // Get new velocities from inputs.
        if (inputManager.button === 1) {
            this.txVel += inputManager.dx * (-10 - Math.min(this.z, 0.01)) / -5000;
            this.tyVel += inputManager.dy * (-10 - Math.min(this.z, 0.01)) /  5000;
        } else if (inputManager.isDragging()) {
            this.xVel += inputManager.dx / -200 * invertXMult;
            this.yVel += inputManager.dy / -200 * invertYMult;
        } else if (shouldOrbit) {
            if (Math.abs(this.xVel) < Math.abs(this.orbitSpeed))
                this.xVel += this.orbitSpeed * 1/50;
        }
        this.zVel += inputManager.dz;
        let keyVelX = 0, keyVelY = 0;
        if (inputManager.isKeyDown('KeyA'))
            keyVelX += 0.02;
        if (inputManager.isKeyDown('KeyD'))
            keyVelX -= 0.02;
        if (inputManager.isKeyDown('KeyW'))
            keyVelY += 0.02;
        if (inputManager.isKeyDown('KeyS'))
            keyVelY -= 0.02;
        const isShiftPressed = inputManager.isKeyDown('ShiftLeft') || inputManager.isKeyDown('ShiftRight');

        if (isShiftPressed) {
            this.xVel += -keyVelX;
            this.yVel += -keyVelY;
        } else {
            this.txVel += keyVelX;
            this.tyVel += -keyVelY;
        }

        this.xVel = clampRange(this.xVel, 2);
        this.yVel = clampRange(this.yVel, 2);

        const updated = this.xVel !== 0 || this.yVel !== 0 || this.zVel !== 0 || this.txVel !== 0 || this.tyVel !== 0;
        if (updated) {
            // Apply velocities.
            const drag = (inputManager.isDragging() || isShiftPressed) ? 0.92 : 0.96;

            this.x += -this.xVel / 10;
            this.xVel *= drag;

            this.y += -this.yVel / 10;
            this.yVel *= drag;

            this.txVel *= drag;
            this.tyVel *= drag;

            this.z += Math.max(Math.log(Math.abs(this.zVel)), 0) * 4 * Math.sign(this.zVel);
            if (inputManager.dz === 0)
                this.zVel *= 0.85;
            if (this.z > -10) {
                this.z = -10;
                this.zVel = 0;
            }

            vec3.set(scratchVec3a, this.camera.cameraMatrix[0], this.camera.cameraMatrix[1], this.camera.cameraMatrix[2]);
            vec3.scaleAndAdd(this.translation, this.translation, scratchVec3a, this.txVel);

            vec3.set(scratchVec3a, this.camera.cameraMatrix[4], this.camera.cameraMatrix[5], this.camera.cameraMatrix[6]);
            vec3.scaleAndAdd(this.translation, this.translation, scratchVec3a, this.tyVel);

            const eyePos = scratchVec3a;
            computeUnitSphericalCoordinates(eyePos, this.x, this.y);
            vec3.scale(eyePos, eyePos, this.z);
            vec3.add(eyePos, eyePos, this.translation);
            mat4.lookAt(this.camera.viewMatrix, eyePos, this.translation, vec3Up);
            mat4.invert(this.camera.cameraMatrix, this.camera.viewMatrix);
            this.camera.viewMatrixUpdated();
        }

        return false;
    }

    toJSON() {
        const xyzPos = new Float32Array([this.x, this.y, this.z, this.translation[0], this.translation[1], this.translation[2]]);
        return btoa(String.fromCharCode.apply(null, new Uint8Array(xyzPos.buffer)));
    }

    fromJSON(data: string) {
        const byteString = atob(data);
        const bufView = new Uint8Array(6 * 4);
        for (let i = 0, strLen = byteString.length; i < strLen; i++) { bufView[i] = byteString.charCodeAt(i); }
        const xyzPos = new Float32Array(bufView.buffer);
        this.x = xyzPos[0];
        this.y = xyzPos[1];
        this.z = xyzPos[2];
        vec3.copy(this.translation, xyzPos.subarray(3));
    }
}

function clampRange(v: number, lim: number): number {
    return Math.max(-lim, Math.min(v, lim));
}

function computeUnitSphericalCoordinates(dst: vec3, azimuthal: number, polar: number): void {
    // https://en.wikipedia.org/wiki/Spherical_coordinate_system
    // https://en.wikipedia.org/wiki/List_of_common_coordinate_transformations#From_spherical_coordinates
    // Wikipedia uses the (wrong) convention of Z-up tho...

    const sinP = Math.sin(polar);
    dst[0] = sinP * Math.cos(azimuthal);
    dst[1] = Math.cos(polar);
    dst[2] = sinP * Math.sin(azimuthal);
}