import { vec3, quat, mat4 } from "gl-matrix";
import { assert, defaultValue, defined, assertDefined } from "./util";
import { IdentityMat4 } from "./MathHelpers";
import { Object3D, IObject3D } from "./Object3D";

export interface IBone extends IObject3D {    
    nodeId: number;
    parent: Nullable<IBone>;
    children: IBone[];
}

export class Bone extends Object3D implements IBone {
    constructor(public nodeId: number) { super(); }
    
    copy(source: IBone): this { 
        this.name = source.name;
        this.nodeId = source.nodeId;

        vec3.copy(this.position, source.position);
        quat.copy(this.rotation, source.rotation);
        vec3.copy(this.scale, source.scale);

        this.matrix = mat4.copy(this.matrix, source.matrix);
        this.matrixWorld = mat4.copy(this.matrixWorld, source.matrixWorld);

        this.children = [];
        this.parent = null;

        return this;
    }
}

// --------------------------------------------------------------------------------
// Skin:
// A heirarchy of bones for a specific mesh, the inverse bind matrices which bring each vertex into bone space.
// --------------------------------------------------------------------------------
export interface Skin {
    bones: IBone[];
    inverseBindMatrices?: mat4[];
}

// --------------------------------------------------------------------------------
// Skeleton:
// A Skin instance where each bone can be posed individually. Manages its own array of matrices.
// These will be manipulated during animation, and loaded into uniform buffers during rendering.
// --------------------------------------------------------------------------------
export class Skeleton {
    bones: Bone[] = []; // Unique copies of the skin's bones that can be manipulated independently
    boneBuffer: Float32Array;
    inverseBindMatrices?: mat4[]; // Soft-references to the pose space to bone space transforms held by the skin

    constructor(skin: Skin) {
        // Copy the bones so that they can be manipulated independently of other Skeletons
        this.bones = skin.bones.map(b => new Bone(b.nodeId).copy(b));

        this.boneBuffer = new Float32Array(skin.bones.length * 16);
        this.inverseBindMatrices = defaultValue(skin.inverseBindMatrices, undefined);
        assert(!defined(this.inverseBindMatrices) || this.bones.length === this.inverseBindMatrices.length);
        
        // Remap parents and children from the skin to skeleton bones
        for (let i = 0; i < this.bones.length; i++) {
            const src = skin.bones[i];
            const dst = this.bones[i];
            if (defined(src.parent)) dst.parent = assertDefined(this.bones[skin.bones.indexOf(src.parent)]);
            for (let i = 0; i < src.children.length; i++) {
                dst.children[i] = assertDefined(this.bones[skin.bones.indexOf(src.children[i])]);
            }        
        }
    }

    evaluate(rootTransform?: mat4) {
        const root = this.bones[0];
        this.evaluateBone(root, defaultValue(rootTransform, IdentityMat4));
    }

    evaluateBone(bone: Bone, parentToWorld: mat4) {
        mat4.fromRotationTranslationScale(bone.matrix, bone.rotation, bone.position, bone.scale);
        const localToWorld = mat4.multiply(bone.matrixWorld, parentToWorld, bone.matrix);
        if (bone.children) {
            for (const child of bone.children) {
                this.evaluateBone(child, localToWorld);
            }
        }
    }

    writeToBuffer(view: Float32Array) {
        // Write the bind space to model space transforms to an ArrayBuffer view. This is expected to be part of a uniform buffer.
        // @NOTE: A Bone's model matrix transforms from bone to model space, and the inverse bind matrices from bind to bone space
        if (defined(this.inverseBindMatrices)) {
            for (let i = 0; i < this.bones.length; i++) {
                const bone = this.bones[i];
                mat4.multiply(view.subarray(i * 16, i * 16 + 16), bone.matrixWorld, this.inverseBindMatrices[i]);
            }
        } else {
            view.set(this.boneBuffer);
        }
    }
}
