// --------------------------------------------------------------------------------
// Module which controls the main camera
// --------------------------------------------------------------------------------
import { Camera } from './Camera';
import { GlobalUniforms } from './GlobalUniforms';
import { vec3, mat4, vec4, vec2 } from 'gl-matrix';
import { InputManager } from './Input';
import { DebugMenu } from './DebugMenu';
import { Clock } from './Clock';
import { clamp, angularDistance, MathConstants, angleXZ, smoothstep } from './MathHelpers';
import { Object3D, Vector3 } from './Object3D';
import { AvatarSystemClient } from './Avatar';
import { criticallyDampedSmoothing, criticallyDampedSmoothingVec } from './Spring';
import { DebugRenderUtils } from './DebugRender';

const scratchVec3A = vec3.create();
const scratchVec3B = vec3.create();
const scratchVec3C = vec3.create();
const scratchVec3D = vec3.create();
const scratchVector3A = new Vector3(vec3.create());
const scratchVec4A = vec4.create();
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
        deps.globalUniforms.buffer.setVec3('g_viewVec', this.camera.forward);
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

    private eyePos: vec3 = vec3.create();

    private posSpring = { pos: vec3.create(), vel: vec3.create(), time: 0.4 };
    private dollySpring = { pos: 0, vel: 0, target: 0, time: 0.6 };
    private yawSpring = { pos: 0, vel: 0, target: 0, time: 0.05 };
    private shoulderSpring = { pos: vec2.create(), vel: vec2.create(), target: vec2.create(), time: 0.4 };

    private minDistance = 500; 
    private maxDistance = 800;

    private headingBlend = 0.5;
    private dollyWeight = 1.0;
    private framingWidth = 0.5; // Camera will keep avatar and target within this width of center, in NDC 

    initialize(deps: Dependencies) {
        // Set up a valid initial state
        const followPos = scratchVector3A.buffer;
        const eyePos = vec3.add(scratchVec3A, followPos, vec3.set(scratchVec3A, 1000, 700, 0));
        
        mat4.lookAt(this.camera.viewMatrix, eyePos, followPos, vec3Up);
        this.camera.viewMatrixUpdated();

        const folder = deps.debugMenu.addFolder('CombatCam');
        folder.add(this, 'headingBlend', 0.0, 1.0);
        folder.add(this, 'dollyWeight', 0.0, 1.0);
        folder.add(this, 'framingWidth', 0.0, 1.0);
        folder.add(this, 'minDistance', 500, 2000, 100);
        folder.add(this, 'maxDistance', 500, 3000, 100);
    }

    public update(deps: Dependencies, targets: CameraTarget[]): boolean {
        const dtSec = deps.clock.renderDt * 0.001;
        const fovX = this.camera.getFovX() * 0.5 * this.framingWidth;
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

        vec3.copy(scratchVec3C, avPos);
        vec4.set(scratchVec4A, this.enPos[0], 0, this.enPos[2], 10);
        scratchVec3C[1] = 0;
        DebugRenderUtils.renderArrows([scratchVec3C], [attackVec], 10, true);
        DebugRenderUtils.renderSpheres([scratchVec4A]);

        // Keep the camera distance between min and max
        this.offset[2] = clamp(this.offset[2], this.minDistance, this.maxDistance);

        // Keep a fixed height
        this.offset[1] = Math.PI * 0.5;

        // Target is always the avatar
        vec3.copy(this.targetPos, avPos);

        // Keep the camera within the shoulder angle limits
        const kMinShoulderAngle = Math.PI * 0.5;
        const kMaxShoulderAngle = Math.PI * 0.85;
        const attackHeading = Math.atan2(attackDir[2], attackDir[0]);
        const shoulderAngle = angularDistance(attackHeading, this.offset[0]);
        const diff = clamp(Math.abs(shoulderAngle), kMinShoulderAngle, kMaxShoulderAngle) * Math.sign(shoulderAngle);
        let azimuthTarget = attackHeading + diff;

        // ... Blending smoothly
        this.shoulderSpring.target[0] = Math.cos(azimuthTarget);
        this.shoulderSpring.target[1] = Math.sin(azimuthTarget);
        criticallyDampedSmoothingVec(this.shoulderSpring.pos, this.shoulderSpring.vel, this.shoulderSpring.target, 
            this.shoulderSpring.time, dtSec);
        this.offset[0] = Math.atan2(this.shoulderSpring.pos[1], this.shoulderSpring.pos[0]);

        // Rotate to put the enemy within framing FOV
        let avView = vec3.negate(scratchVec3B, computeUnitSphericalCoordinates(scratchVec3B, this.offset[0], this.offset[1]));
        let eyePos = vec3.scaleAndAdd(this.eyePos, avPos, avView, -this.offset[2]); 
        // const enView = vec3.subtract(scratchVec3A, this.enPos, eyePos);
        // const enAngle = Math.abs(angleXZ(avView, enView));

        // // Dolly along enemy view vector until avatar is within framing FOV
        // if (enAngle > fovX * 2.0) {
        //     const avTheta = enAngle - fovX * 2.0;
        //     this.dollySpring.target = Math.sin(avTheta) / Math.sin(fovX * 2.0) * this.offset[2];
        // }
        // criticallyDampedSmoothing(this.dollySpring, this.dollySpring.target, this.dollySpring.time, dtSec);
        // eyePos = vec3.scaleAndAdd(this.eyePos, this.eyePos, enView, -this.dollySpring.pos / vec3.length(enView) * this.dollyWeight);

        // // Recompute yaw now that camera has moved
        // avView = vec3.subtract(scratchVec3B, avPos, eyePos);
        // this.yawSpring.target = angleXZ(avView, enView); 
        // criticallyDampedSmoothing(this.yawSpring, this.yawSpring.target, this.yawSpring.time, dtSec);
        // this.ori[0] = this.headingBlend * this.yawSpring.pos;
        
        // Convert to cameras
        mat4.lookAt(this.camera.viewMatrix, this.eyePos, this.targetPos, vec3Up);
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