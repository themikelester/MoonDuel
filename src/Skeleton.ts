import { vec3, quat, mat4 } from "gl-matrix";
import { assert, defaultValue, defined, assertDefined } from "./util";
import { IdentityMat4 } from "./MathHelpers";
import { Object3D } from "./Object3D";

type Bone = Object3D;

// --------------------------------------------------------------------------------
// Skeleton:
// A Skin instance where each bone can be posed individually. Manages its own array of matrices.
// These will be manipulated during animation, and loaded into uniform buffers during rendering.
// --------------------------------------------------------------------------------
export class Skeleton {
    bones: Bone[] = []; // Unique copies of the skin's bones that can be manipulated independently
    boneBuffer: Float32Array;
    inverseBindMatrices?: mat4[]; // Soft-references to the pose space to bone space transforms held by the skin

    constructor(bones: Bone[], inverseBindMatrices?: mat4[]) {
        // Copy the bones so that they can be manipulated independently of other Skeletons
        this.bones = bones

        this.boneBuffer = new Float32Array(bones.length * 16);
        this.inverseBindMatrices = inverseBindMatrices;
        assert(!defined(this.inverseBindMatrices) || this.bones.length === this.inverseBindMatrices.length);
    }

    evaluate(rootTransform?: mat4) {
        const root = this.bones[0];
        root.updateMatrixWorld();
    }

    writeToBuffer(view: Float32Array) {
        // Write the bind space to model space transforms to an ArrayBuffer view. This is expected to be part of a uniform buffer.
        // @NOTE: A Bone's model matrix transforms from bone to model space, and the inverse bind matrices from bind to bone space
        if (defined(this.inverseBindMatrices)) {
            for (let i = 0; i < this.bones.length; i++) {
                const bone = this.bones[i];
                mat4.multiply(view.subarray(i * 16, i * 16 + 16), new Float32Array(bone.matrixWorld.elements), this.inverseBindMatrices[i]);
            }
        } else {
            view.set(this.boneBuffer);
        }
    }
}
