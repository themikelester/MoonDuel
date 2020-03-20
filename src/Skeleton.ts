import { vec3, quat, mat4 } from "gl-matrix";
import { assert, defaultValue, defined, assertDefined } from "./util";
import { GltfSkin, GltfNode, GltfResource } from './resources/Gltf';
import { equalsEpsilon, IdentityMat4 } from "./MathHelpers";
import { Object3D } from "./Object3D";

export class Bone extends Object3D {
    constructor(public nodeId: number) { super(); }
    
    parent: Nullable<Bone> = null;
    children: Bone[] = [];

    clone(recursive: boolean) { 
        const bone = new Bone(this.nodeId).copy(this, recursive);
        bone.parent = this.parent;
        if (!recursive) {
            bone.children = this.children.slice();
        }
        return bone;
    }
}

// --------------------------------------------------------------------------------
// Skin:
// A heirarchy of bones for a specific mesh, the inverse bind matrices which bring each vertex into bone space.
// --------------------------------------------------------------------------------
export class Skin {
    bones: Bone[];
    inverseBindMatrices: mat4[];

    constructor(bones: Bone[], inverseBindMatrices: mat4[]) {
        this.bones = bones;
        this.inverseBindMatrices = inverseBindMatrices;
    }

    static fromGltf(gltf: GltfResource, index: number) {
        const skin = assertDefined(gltf.skins[index]);
        const bones: Bone[] = [];
        const ibms: mat4[] = [];

        // @TODO: Construct the bone array such that parents are guaranteed to come before all of their children
        // @NOTE: This allows hierarchy-dependent operations such as model matrix computation to be carried out linearly over the array
        for (let i = 0; i < skin.joints.length; i++) {
            const jointId = skin.joints[i]; 
            const joint = gltf.nodes[jointId];

            const bone = new Bone(jointId);
            bone.name = defaultValue(joint.name, `Bone${bones.length}`),
            bone.position = joint.translation,
            bone.rotation = joint.rotation,
            bone.scale = assertUniformScale(joint.scale),

            bones.push(bone);
        }
        
        for (let i = 0; i < skin.joints.length; i++) {
            const jointId = skin.joints[i]; 
            const joint = gltf.nodes[jointId];
            if (joint.children) {
                for (let childId of joint.children) {
                    const child = bones.find(b => b.nodeId === childId);
                    // If the node's child is not a bone, ignore it
                    if (defined(child)) {
                        child.parent = bones[i];
                        bones[i].children.push(child);
                    }
                }
            }
        }

        // Inverse bind matrices are in the same order as the skin.joints array
        // This has been re-arranged, so remap them here
        if (skin.inverseBindMatrices) {
            const kMat4Size = 4 * 16;
            for (let i = 0; i < skin.joints.length; i++) {
                ibms[i] = new Float32Array(skin.inverseBindMatrices.buffer, skin.inverseBindMatrices.byteOffset + kMat4Size * i, 16);
            }
        }

        return new Skin(bones, ibms);
    }
}

// --------------------------------------------------------------------------------
// Skeleton:
// A Skin instance where each bone can be posed individually. Manages its own array of matrices.
// These will be manipulated during animation, and loaded into uniform buffers during rendering.
// --------------------------------------------------------------------------------
export class Skeleton {
    bones: Bone[] = []; // Unique copies of the skin's bones that can be manipulated independently
    boneBuffer: Float32Array;
    inverseBindMatrices: mat4[]; // Soft-references to the pose space to bone space transforms held by the skin

    constructor(skin: Skin) {
        // Copy the bones so that they can be manipulated independently of other Skeletons
        this.bones = skin.bones.map(b => b.clone(false));
        this.boneBuffer = new Float32Array(skin.bones.length * 16);
        this.inverseBindMatrices = skin.inverseBindMatrices;
        
        // Remap parents and children from the skin to skeleton bones
        for (const bone of this.bones) {
            if (defined(bone.parent)) bone.parent = assertDefined(this.bones[skin.bones.indexOf(bone.parent)]);
            for (let i = 0; i < bone.children.length; i++) {
                bone.children[i] = assertDefined(this.bones[skin.bones.indexOf(bone.children[i])]);
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
        for (let i = 0; i < this.bones.length; i++) {
            const bone = this.bones[i];
            mat4.multiply(view.subarray(i * 16, i * 16 + 16), bone.matrixWorld, this.inverseBindMatrices[i]);
        }
    }
}

// --------------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------------
function assertUniformScale(scale: vec3): vec3 {
    assert(equalsEpsilon(scale[0], scale[1]) && equalsEpsilon(scale[0], scale[2]));
    return scale;
}
