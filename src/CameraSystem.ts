// --------------------------------------------------------------------------------
// Module which controls the main camera
// --------------------------------------------------------------------------------
import { Camera } from './Camera';
import { GlobalUniforms } from './GlobalUniforms';
import { vec3, mat4 } from 'gl-matrix';
import { InputManager } from './Input';
import { DebugMenu } from './DebugMenu';
import { Clock } from './Clock';
import { clamp } from './MathHelpers';
import { Object3D, Vector3 } from './Object3D';
import { AvatarSystem, Avatar } from './Avatar';

const scratchVec3A = vec3.create();
const scratchVector3A = new Vector3(vec3.create());

interface Dependencies {
    avatar: AvatarSystem;
}

export class CameraSystem {
    private camPos = vec3.create();
    private controller: CameraController; 

    constructor(private camera: Camera) {
    }

    initialize(deps: Dependencies) {
        this.resize(window.innerWidth, window.innerHeight);

        this.controller = new OrbitCameraController();
        this.controller.initialize(deps);
        this.controller.camera = this.camera;
    }

    resize(width: number, height: number) {
        const aspect = width / height;
        this.camera.setPerspective(this.camera.fov, aspect, this.camera.near, this.camera.far);
    }

    update({ globalUniforms, input, clock }: { globalUniforms: GlobalUniforms, input: InputManager, clock: Clock }) {
        this.controller.update(input, clock.dt);

        const camPos = this.camera.getPos(this.camPos);
        globalUniforms.buffer.setVec3('g_camPos', camPos);
        globalUniforms.buffer.setMat4('g_proj', this.camera.projectionMatrix);
        globalUniforms.buffer.setMat4('g_viewProj', this.camera.viewProjMatrix);
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

    initialize(deps: Dependencies): void;
    update(inputManager: InputManager, dt: number): boolean;
    
    toJSON(): string;
    fromJSON(data: any): void;
}

const vec3Up = vec3.fromValues(0, 1, 0);
export class OrbitCameraController implements CameraController {
    public camera: Camera;

    public x: number = -Math.PI / 2;
    public y: number = 2;
    public z: number = -1000;
    public orbitSpeed: number = -0.05;
    public xVel: number = 0;
    public yVel: number = 0;
    public zVel: number = 0;

    // The target may be the cursor, or another object in the scene graph
    public cursor: Object3D = new Object3D();
    public target: Object3D = this.cursor;

    public shouldOrbit: boolean = true;

    initialize(deps: Dependencies) {
        // Follow the local avatar by default
        this.target = deps.avatar.localAvatar;

        const menu = DebugMenu.addFolder('OrbitCamera');
        menu.add(this, 'orbitSpeed', -1.0, 1.0);
        menu.add(this, 'shouldOrbit', -1.0, 1.0);
    }

    public update(inputManager: InputManager, dt: number): boolean {
        const shouldOrbit = this.shouldOrbit;

        const invertXMult = inputManager.invertX ? -1 : 1;
        const invertYMult = inputManager.invertY ? -1 : 1;

        // Get new velocities from inputs.
        if (inputManager.isDragging()) {
            this.xVel += inputManager.dx / -200 * invertXMult;
            this.yVel += inputManager.dy / -200 * invertYMult;
        } else if (shouldOrbit) {
            if (Math.abs(this.xVel) < Math.abs(this.orbitSpeed))
                this.xVel += this.orbitSpeed * 1/50;
        }
        this.zVel += inputManager.dz;
        let keyVelX = 0, keyVelY = 0;
        const isShiftPressed = inputManager.isKeyDown('ShiftLeft') || inputManager.isKeyDown('ShiftRight');

        if (isShiftPressed) {
            this.xVel += -keyVelX;
            this.yVel += -keyVelY;
        }

        this.xVel = clampRange(this.xVel, 2);
        this.yVel = clampRange(this.yVel, 2);

        const updated = this.xVel !== 0 || this.yVel !== 0 || this.zVel !== 0;
        if (updated) {
            // Apply velocities.
            const drag = (inputManager.isDragging() || isShiftPressed) ? 0.92 : 0.96;

            this.x += -this.xVel / 10;
            this.xVel *= drag;

            this.y += -this.yVel / 10;
            this.yVel *= drag;

            this.z += Math.max(Math.log(Math.abs(this.zVel)), 0) * 4 * Math.sign(this.zVel);
            if (inputManager.dz === 0)
                this.zVel *= 0.85;
            if (this.z > -10) {
                this.z = -10;
                this.zVel = 0;
            }

            // Clamp Y to the 0 to prevent going underground
            this.y = clamp(this.y, Math.PI * 0.5, Math.PI * 0.99);

            this.target.getWorldPosition(scratchVector3A);
            const targetPos = scratchVector3A.buffer;
    
            const eyePos = scratchVec3A;
            computeUnitSphericalCoordinates(eyePos, this.x, this.y);
            vec3.scale(eyePos, eyePos, this.z);
            vec3.add(eyePos, eyePos, targetPos);
            mat4.lookAt(this.camera.viewMatrix, eyePos, targetPos, vec3Up);
            mat4.invert(this.camera.cameraMatrix, this.camera.viewMatrix);
            this.camera.viewMatrixUpdated();
        }

        return false;
    }

    toJSON() {
        this.cursor.getWorldPosition(scratchVector3A);
        const cursorPos = scratchVector3A.buffer;
        const xyzPos = new Float32Array([this.x, this.y, this.z, cursorPos[0], cursorPos[1], cursorPos[2]]);
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
        this.cursor.position.set(xyzPos[3], xyzPos[4], xyzPos[5]);
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