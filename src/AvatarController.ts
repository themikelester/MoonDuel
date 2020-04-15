import { Avatar, AvatarState, AvatarFlags } from "./Avatar";
import { Clock } from "./Clock";
import { vec3 } from "gl-matrix";
import { InputManager, UserCommand, InputAction } from "./Input";
import { Vector3 } from "./Object3D";
import { clamp, angularDistance } from "./MathHelpers";

const scratchVec3A = vec3.create();
const scratchVec3B = vec3.create();
const scratchVector3A = new Vector3(scratchVec3A);

export const kAvatarWalkSpeed = 150; // Units per second
export const kAvatarRunSpeed = 600; // Units per second
const kWalkAcceleration = 600;
const kRunAcceleration = 3000;

/**
 * Drive each Avatar's skeleton, position, oriention, and animation
 */
export class AvatarController {
    localController = new LocalController();

    prevState: AvatarState = new AvatarState();

    avatars: Avatar[];
    local: Avatar;

    initialize(avatars: Avatar[]) {
        this.avatars = avatars;
        this.local = avatars[0];
        this.localController.initialize(this.local);
    }

    updateFixed({ clock, input }: { clock: Clock, input: InputManager }) {
        // const debugActive = this.debugMenu.update(clock);
        // if (debugActive) { return; }

        const inputCmd = input.getUserCommand();
        const dtSec = clock.simStep / 1000.0;
        const state = this.localController.update(this.prevState, dtSec, inputCmd);

        return state;
    }
}

class LocalController {
    avatar: Avatar;

    speed: number = 0;
    velocity: vec3 = vec3.create();
    velocityTarget: vec3 = vec3.create();
    
    orientation: vec3 = vec3.create();
    orientationTarget: vec3 = vec3.create();

    uTurning: boolean = false;
    walking: boolean = false;

    initialize(avatar: Avatar) {
        this.avatar = avatar;
    }
    
    update(prevState: AvatarState, dtSec: number, input: UserCommand): AvatarState {
        this.avatar.updateMatrixWorld();
        vec3.set(this.orientation, this.avatar.matrixWorld.elements[8], this.avatar.matrixWorld.elements[9], this.avatar.matrixWorld.elements[10]);

        const inputDir = this.getCameraRelativeMovementDirection(input, scratchVec3B);
        const inputActive = vec3.length(inputDir) > 0.1;
        const inputShouldWalk = input.actions & InputAction.Walk;
        
        // Velocity
        const accel = inputShouldWalk ? kWalkAcceleration : kRunAcceleration;
        const maxSpeed = inputShouldWalk ? kAvatarWalkSpeed : kAvatarRunSpeed;

        const dSpeed = (inputActive ? accel : -accel) * dtSec;
        const targetSpeed = clamp(this.speed + dSpeed, 0, maxSpeed); 

        this.speed += clamp(
            targetSpeed - this.speed, 
            -accel * dtSec,
            accel * dtSec,
        );

        this.velocityTarget = vec3.copy(this.velocityTarget, this.orientation);
        this.velocity = vec3.scale(this.velocity, this.velocityTarget, this.speed);

        // Position
        const pos = vec3.scaleAndAdd(vec3.create(), prevState.pos, this.velocity, dtSec);
        this.avatar.position.addScaledVector(scratchVector3A.setBuffer(this.velocity), dtSec);

        // Orientation
        let shouldTurn = inputActive;

        let standingTurnSpeed = Math.PI * 3.75; // 4 30ms frames to turn 90 degrees
        let walkingTurnSpeed = Math.PI * 1.875; // 8 30ms frames to turn 90 degrees
        let runningTurnSpeed = Math.PI * 1.875; // 8 30ms frames to turn 90 degrees
        
        // State transitions
        if (this.uTurning) {
            // Uturn complete when we achieve the initial orientation target
            if (vec3.dot(this.orientation, this.orientationTarget) > 0.99) {
                this.uTurning = false;
            }
        } else {
            // Start a 180 if we have a sharp input pointing directly away from our current orientation 
            if (vec3.dot(inputDir, this.orientationTarget) < -0.99) {
                this.uTurning = true;
                vec3.copy(this.orientationTarget, inputDir);
            }
        }

        this.walking = this.speed > 0;

        // State evaluations
        let turnSpeedRadsPerSec = this.walking ? walkingTurnSpeed : standingTurnSpeed;
        if (this.uTurning) {
            shouldTurn = true; // Don't require user input to complete the 180
            turnSpeedRadsPerSec *= 2.0;
            this.orientationTarget = this.orientationTarget; // Don't update orientation target
        } else {
            if (inputActive) vec3.copy(this.orientationTarget, inputDir);
        }
        
        // Each frame, turn towards the input direction by a fixed amount, but only if the input is pressed. 
        // It takes 8 16ms frames to turn 90 degrees. So a full rotation takes about half of a second.
        if (shouldTurn) {
            const heading = Math.atan2(this.avatar.matrixWorld.elements[8], this.avatar.matrixWorld.elements[10]);
            const targetHeading = Math.atan2(this.orientationTarget[0], this.orientationTarget[2]);
            
            let angleDelta = angularDistance(heading, targetHeading);
            const turnCap = turnSpeedRadsPerSec * dtSec;

            this.avatar.rotateY(clamp(angleDelta, -turnCap, turnCap));
        }

        this.avatar.updateMatrix();

        let flags = 0;
        if (inputShouldWalk) flags |= AvatarFlags.IsWalking;
        if (this.uTurning) flags |= AvatarFlags.IsUTurning;
        const state: AvatarState = {
            pos,
            velocity: this.velocity,
            flags
        }
        return state;
    }

    private getWorldRelativeMovementDirection(input: UserCommand, result: vec3): vec3 {
        const x = input.horizontalAxis;
        const z = input.verticalAxis;
        return vec3.normalize(result, vec3.set(result, x, 0, z));
    }

    private getCameraRelativeMovementDirection(input: UserCommand, result: vec3): vec3 {
        const local = this.getWorldRelativeMovementDirection(input, result);
        const flatView = vec3.normalize(scratchVec3A, vec3.set(scratchVec3A, input.headingX, 0, input.headingZ));
        
        // 2D change of basis to the camera's sans-Y
        return vec3.set(result, 
            local[0] * -flatView[2] + local[2] * flatView[0],
            0,
            local[0] * flatView[0] + local[2] * flatView[2]
        );
    }
}