// --------------------------------------------------------------------------------
// Module which controls the main camera
// --------------------------------------------------------------------------------
import { Camera } from './Camera';
import { GlobalUniforms } from './GlobalUniforms';
import { vec3, mat4 } from 'gl-matrix';
import { InputManager } from './Input';
import { DebugMenu } from './DebugMenu';
import { Clock } from './Clock';
import { clamp, angularDistance, MathConstants } from './MathHelpers';
import { Object3D, Vector3 } from './Object3D';
import { AvatarSystem, Avatar } from './Avatar';
import { assert } from './util';

const scratchVec3A = vec3.create();
const scratchVec3B = vec3.create();
const scratchVector3A = new Vector3(vec3.create());
const vec3Up = vec3.fromValues(0, 1, 0);

interface Dependencies {
    avatar: AvatarSystem;
}

export class CameraSystem {
    private camPos = vec3.create();
    private controller: CameraController; 

    constructor(private camera: Camera) {
    }

    initialize(deps: Dependencies) {
        const aspect = window.innerWidth / window.innerHeight;
        this.resize(aspect);

        this.controller = new FollowCameraController();
        this.controller.camera = this.camera;
        this.controller.initialize(deps);
    }

    resize(aspect: number) {
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

export class FollowCameraController implements CameraController {
    public camera: Camera;
    public follow: Object3D;

    private heading: number;
    private pitch: number;
    private distance: number;

    private minDistance = 500; 
    private maxDistance = 800;

    initialize(deps: Dependencies) {
        // Follow the local avatar by default
        this.follow = deps.avatar.localAvatar;

        // Set up a valid initial state
        const followPos = scratchVector3A.buffer;
        const eyePos = vec3.add(scratchVec3A, followPos, vec3.set(scratchVec3A, 1000, 700, 0));
        
        mat4.lookAt(this.camera.viewMatrix, eyePos, followPos, vec3Up);
        this.camera.viewMatrixUpdated();

        this.heading = Math.atan2(this.camera.forward[0], this.camera.forward[2]);
        this.pitch = Math.PI * 0.5;
        this.distance = 1000;

        const debugMenu = DebugMenu.addFolder('FollowCam');
        debugMenu.add(this, 'pitch', 0.0, Math.PI * 0.5, Math.PI * 0.01);
        debugMenu.add(this, 'minDistance', 500, 2000, 100);
        debugMenu.add(this, 'maxDistance', 500, 3000, 100);
    }

    public update(inputManager: InputManager, dt: number): boolean {
        const kFollowHeightBias = 250;

        this.follow.getWorldPosition(scratchVector3A);
        const followPos = vec3.add(scratchVector3A.buffer, scratchVector3A.buffer, vec3.set(scratchVec3B, 0, kFollowHeightBias, 0));
        const camPos = this.camera.getPos(scratchVec3A);
        const camToTarget = vec3.subtract(scratchVec3A, followPos, camPos);
        const camDist = vec3.length(camToTarget);
        
        // Rotate to keep the follow target centered
        const camToTargetHeading = Math.atan2(camToTarget[2], camToTarget[0]);
        let angleDelta = angularDistance(this.heading, camToTargetHeading);
        this.heading = (this.heading + angleDelta) % MathConstants.TAU;

        // Keep the camera distance between min and max
        this.distance = clamp(camDist, this.minDistance, this.maxDistance);

        const eyeOffsetUnit = computeUnitSphericalCoordinates(scratchVec3A, this.heading + Math.PI, this.pitch);
        const eyeOffset = vec3.scale(scratchVec3A, eyeOffsetUnit, this.distance);
        const eyePos = vec3.add(scratchVec3A, followPos, eyeOffset);

        mat4.lookAt(this.camera.viewMatrix, eyePos, followPos, vec3Up);
        this.camera.viewMatrixUpdated();

        return false;
    }

    toJSON() {
        return '';
    }

    fromJSON(data: string) {
    }
}

function clampRange(v: number, lim: number): number {
    return Math.max(-lim, Math.min(v, lim));
}

function computeUnitSphericalCoordinates(dst: vec3, azimuthal: number, polar: number): vec3 {
    // https://en.wikipedia.org/wiki/Spherical_coordinate_system
    // https://en.wikipedia.org/wiki/List_of_common_coordinate_transformations#From_spherical_coordinates
    // Wikipedia uses the (wrong) convention of Z-up tho...

    const sinP = Math.sin(polar);
    dst[0] = sinP * Math.cos(azimuthal);
    dst[1] = Math.cos(polar);
    dst[2] = sinP * Math.sin(azimuthal);

    return dst;
}