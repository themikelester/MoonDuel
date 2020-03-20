import { vec3, quat, mat4 } from "gl-matrix";
import { assert, defaultValue, defined, assertDefined } from "./util";
import { GltfSkin, GltfNode, GltfResource } from './resources/Gltf';
import { equalsEpsilon, IdentityMat4 } from "./MathHelpers";

export interface Bone {
    name: string;
    
    translation: vec3;
    rotation: quat;
    scale: vec3;
    
    local: mat4; // Bone space to parent space
    model: mat4; // Bone space to model space (concatenation of all toParents above this bone)

    // @TODO: If we guarantee that parents come before children in the bone array, we can just store parent
    parent: Nullable<Bone>;
    children: Bone[];

    // @HACK:
    nodeId: number;
    dirty?: boolean;
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
        for (let i = skin.joints.length-1; i >= 0; i--) {
            const jointId = skin.joints[i]; 
            const joint = gltf.nodes[jointId];
            bones[i] = {
                name: defaultValue(joint.name, `Bone${bones.length}`),
                translation: joint.translation,
                rotation: joint.rotation,
                scale: assertUniformScale(joint.scale),
                local: mat4.create(),
                model: mat4.create(),
                nodeId: jointId,
                parent: null,
                children: [],
            };
        }
        
        for (let i = 0; i < skin.joints.length; i++) {
            const jointId = skin.joints[i]; 
            const joint = gltf.nodes[jointId];
            if (joint.children) {
                bones[i].children = [];
                for (let childId of joint.children) {
                    const child = bones.find(b => b.nodeId === childId);
                    // If the node's child is not a bone, ignore it
                    if (defined(child)) {
                        child.parent = bones[i];
                        bones[i].children!.push(child!);
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
        this.boneBuffer = new Float32Array(skin.bones.length * 16);
        this.inverseBindMatrices = skin.inverseBindMatrices;
        
        for (let i = 0; i < skin.bones.length; i++) {
            this.bones[i] = {
                ...skin.bones[i],

                translation: vec3.clone(skin.bones[i].translation),
                rotation: quat.clone(skin.bones[i].rotation),
                scale: vec3.clone(skin.bones[i].scale),

                local: mat4.create(),
                model: mat4.create(),
            }
        }

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
        mat4.fromRotationTranslationScale(bone.local, bone.rotation, bone.translation, bone.scale);
        const localToWorld = mat4.multiply(bone.model, parentToWorld, bone.local);
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
            mat4.multiply(view.subarray(i * 16, i * 16 + 16), bone.model, this.inverseBindMatrices[i]);
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
