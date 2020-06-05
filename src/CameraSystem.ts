// --------------------------------------------------------------------------------
// Module which controls the main camera
// --------------------------------------------------------------------------------
import { Camera } from './Camera';
import { GlobalUniforms } from './GlobalUniforms';
import { vec3, mat4, vec4 } from 'gl-matrix';
import { InputManager } from './Input';
import { DebugMenu } from './DebugMenu';
import { Clock } from './Clock';
import { clamp, angularDistance, MathConstants, angleXZ } from './MathHelpers';
import { Object3D, Vector3 } from './Object3D';
import { AvatarSystemClient } from './Avatar';
import { DebugRenderUtils } from './DebugRender';

const scratchVec3A = vec3.create();
const scratchVec3B = vec3.create();
const scratchVec3C = vec3.create();
const scratchVector3A = new Vector3(vec3.create());
const vec3Up = vec3.fromValues(0, 1, 0);

interface Dependencies {
    avatar: AvatarSystemClient;
    debugMenu: DebugMenu;
    globalUniforms: GlobalUniforms;
    clock: Clock;
}


export class CameraTarget {
    readonly pos: vec3 = vec3.create();
    size: number = 1.0;
    pri: number = 2;
}

export class CameraSystem {
    private camPos = vec3.create();
    private combatController: CameraController; 
    private moveController: CameraController; 

    private targets: CameraTarget[] = [];

    constructor(private camera: Camera) {
    }

    initialize(deps: Dependencies) {
        const aspect = window.innerWidth / window.innerHeight;
        this.resize(aspect);

        this.combatController = new CombatCameraController();
        this.combatController.camera = this.camera;
        this.combatController.initialize(deps);

        this.moveController = new FollowCameraController();
        this.moveController.camera = this.camera;
        this.moveController.initialize(deps);
    }

    resize(aspect: number) {
        this.camera.setPerspective(this.camera.fov, aspect, this.camera.near, this.camera.far);
    }

    createCameraTarget() {
        const target = new CameraTarget();
        this.targets.push(target);
        return target;
    }

    update(deps: Dependencies) {
        // @HACK:
        if (this.targets.find(t => t.size > 0 && t.pri === 1)) {
            this.combatController.update(deps, this.targets);
        } else {
            this.moveController.update(deps, this.targets);
        }

        const camPos = this.camera.getPos(this.camPos);
        deps.globalUniforms.buffer.setVec3('g_camPos', camPos);
        deps.globalUniforms.buffer.setMat4('g_proj', this.camera.projectionMatrix);
        deps.globalUniforms.buffer.setMat4('g_viewProj', this.camera.viewProjMatrix);
    }

    toJSON(): string {
        return this.combatController.toJSON() + ',\n' + this.moveController.toJSON();
    }

    fromJSON(data: string) {
        return this.combatController.fromJSON(data) + ',\n' +this.moveController.fromJSON(data);
    }
}

export interface CameraController {
    camera: Camera;

    initialize(deps: Dependencies): void;
    update(deps: Dependencies, targets: CameraTarget[]): boolean;
    
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
        // Set up a valid initial state
        const followPos = scratchVector3A.buffer;
        const eyePos = vec3.add(scratchVec3A, followPos, vec3.set(scratchVec3A, 1000, 700, 0));
        
        mat4.lookAt(this.camera.viewMatrix, eyePos, followPos, vec3Up);
        this.camera.viewMatrixUpdated();

        this.heading = Math.atan2(this.camera.forward[0], this.camera.forward[2]);
        this.pitch = Math.PI * 0.5;
        this.distance = 1000;

        const folder = deps.debugMenu.addFolder('FollowCam');
        folder.add(this, 'pitch', 0.0, Math.PI * 0.5, Math.PI * 0.01);
        folder.add(this, 'minDistance', 500, 2000, 100);
        folder.add(this, 'maxDistance', 500, 3000, 100);
    }

    public update(deps: Dependencies): boolean {
        const kFollowHeightBias = 250;

        // Follow the local avatar by default
        this.follow = deps.avatar.localAvatar;
        if (!this.follow) return false;

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

export class CombatCameraController implements CameraController {
    public camera: Camera;

    targetPos: vec3 = vec3.create();
    offset: vec3 = vec3.create();
    ori: vec3 = vec3.create();

    enPos: vec3 = vec3.create();

    private minDistance = 500; 
    private maxDistance = 800;

    private headingBlend = 0.5;

    initialize(deps: Dependencies) {
        // Set up a valid initial state
        const followPos = scratchVector3A.buffer;
        const eyePos = vec3.add(scratchVec3A, followPos, vec3.set(scratchVec3A, 1000, 700, 0));
        
        mat4.lookAt(this.camera.viewMatrix, eyePos, followPos, vec3Up);
        this.camera.viewMatrixUpdated();

        const folder = deps.debugMenu.addFolder('CombatCam');
        folder.add(this, 'headingBlend', 0.0, 1.0);
    }

    public update(deps: Dependencies, targets: CameraTarget[]): boolean {
        const dtSec = deps.clock.renderDt * 0.001;
        let avPos: vec3 = vec3.zero(scratchVec3A);
        let enPos: vec3 = vec3.zero(scratchVec3B);

        for (const target of targets) {
            if (target.pri === 1) { enPos = target.pos; }
            if (target.pri === 0) { avPos = target.pos; }
        }

        // Fade in the enemy position
        const kBlendSpeed = 5000;
        const blendVec = vec3.subtract(scratchVec3A, enPos, this.enPos);
        const blendSpeed = Math.min(1.0, kBlendSpeed * dtSec / vec3.length(blendVec));
        vec3.scaleAndAdd(this.enPos, this.enPos, blendVec, blendSpeed);

        // Vector from the avatar towards the targeted enemy
        const attackVec = vec3.subtract(scratchVec3A, this.enPos, avPos);
        const attackDist = vec3.length(attackVec);
        const attackDir = vec3.scale(scratchVec3B, attackVec, 1.0 / attackDist);

        // Keep the camera distance between min and max
        this.offset[2] = clamp(this.offset[2], this.minDistance, this.maxDistance);

        // Keep a fixed height
        this.offset[1] = Math.PI * 0.5;

        // Target is always the avatar
        vec3.copy(this.targetPos, avPos);

        // Keep the camera within the shoulder angle limits
        const kMinShoulderAngle = Math.PI * 0.15;
        const kMaxShoulderAngle = Math.PI * 0.5;
        const attackHeading = Math.atan2(attackDir[2], attackDir[0]);
        const shoulderAngle = angularDistance(attackHeading, this.offset[0] - Math.PI);
        const angleDiff = clamp(Math.abs(shoulderAngle), kMinShoulderAngle, kMaxShoulderAngle) - Math.abs(shoulderAngle);
        this.offset[0] += angleDiff * Math.sign(shoulderAngle);

        // Compute eye position
        const eyeOffsetUnit = vec3.negate(scratchVec3B, computeUnitSphericalCoordinates(scratchVec3B, this.offset[0], this.offset[1]));
        const eyeOffset = vec3.scale(scratchVec3A, eyeOffsetUnit, this.offset[2]);
        const eyePos = vec3.subtract(scratchVec3A, this.targetPos, eyeOffset);

        // Orient the camera to look at the halfway point along the attack vector
        const enViewVec = vec3.sub(scratchVec3C, enPos, eyePos);
        const enAngle = angleXZ(eyeOffsetUnit, enViewVec);
        this.ori[0] = this.headingBlend * enAngle;

        // Convert to camera
        mat4.lookAt(this.camera.viewMatrix, eyePos, this.targetPos, vec3Up);
        this.camera.viewMatrixUpdated();
        mat4.rotateY(this.camera.cameraMatrix, this.camera.cameraMatrix, this.ori[0]);
        mat4.invert(this.camera.viewMatrix, this.camera.cameraMatrix);
        this.camera.viewMatrixUpdated();

        return false;
    }

    toJSON() {
        return '';
    }

    fromJSON(data: string) {
    }
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