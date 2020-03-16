import { vec3, quat, mat4 } from "gl-matrix";
import { assert, defaultValue, defined, assertDefined } from "./util";
import { GltfSkin, GltfNode, GltfResource } from './resources/Gltf';
import { equalsEpsilon } from "./MathHelpers";

export interface Bone {
    name: string;
    
    translation: vec3;
    rotation: quat;
    scale: vec3;
    
    local: mat4; // Bone space to parent space
    model: mat4; // Bind space to model space (concatenation of all toParents above this bone)

    parent?: Bone;
}

// A heirarchy of bones for a specific mesh, the inverse bind matrices which bring each vertex into bone space.
export class Skin {
    bones: Bone[];
    inverseBindMatrices: mat4[];

    constructor(bones: Bone[], inverseBindMatrices: mat4[]) {
        this.bones = bones;
        this.inverseBindMatrices = inverseBindMatrices;
    }

    static fromGltf(gltf: GltfResource, index: number) {
        const skin = assertDefined(gltf.skins[index]);
        const nodeBoneMap: { [nodeId: number]: number } = {};
        const bones: Bone[] = [];
        const ibms: mat4[] = [];

        function toBone(jointId: number, parent?: Bone) {
            const joint = gltf.nodes[jointId];
            const bone = {
                name: defaultValue(joint.name, `Bone${bones.length}`),
                parent,
                translation: joint.translation,
                rotation: joint.rotation,
                scale: assertUniformScale(joint.scale),
                local: mat4.create(),
                model: mat4.create(),
            };

            nodeBoneMap[jointId] = bones.length;
            bones.push(bone);
            
            if (defined(joint.children)) {
                for (let i = 0; i < joint.children.length; i++) {
                    toBone(joint.children[i], bone);
                }
            }
        }

        // Construct the bone array such that parents are guaranteed to come before all of their children
        // @NOTE: This allows hierarchy-dependent operations such as model matrix computation to be carried out linearly over the array
        const rootJointId = defaultValue(skin.skeleton, skin.joints[0]);
        toBone(rootJointId, undefined);
        assert(bones.length === skin.joints.length, `Unreachable joints. Perhaps node ${rootJointId} is not the skeleton root?`);

        // Inverse bind matrices are in the same order as the skin.joints array
        // This has been re-arranged, so remap them here
        const jointRemap = skin.joints.map(j => nodeBoneMap[j]);
        if (skin.inverseBindMatrices) {
            const kMat4Size = 4 * 16;
            for (let i = 0; i < skin.joints.length; i++) {
                const index = jointRemap[i];
                ibms[index] = new Float32Array(skin.inverseBindMatrices.buffer, skin.inverseBindMatrices.byteOffset + kMat4Size * i, 16);
            }
        }

        return new Skin(bones, ibms);
    }
}

// A Skin instance where each bone can be posed individually. Manages its own array of matrices.
// These will be manipulated during animation, and loaded into uniform buffers during rendering.
export class Skeleton {
    bones: Bone[];
    boneBuffer: Float32Array; // Column-major packed float array containing mat4's for every bone

    constructor(bones: Bone[]) {
        // Copy the bones so that they can be manipulated independently of other Skeletons
        this.bones = bones.slice( 0 );
        this.boneBuffer = new Float32Array(bones.length * 16);
        
        for (let i = 0; i < this.bones.length; i++) {
            const bone = this.bones[i];
            bone.local = mat4.fromRotationTranslationScale(mat4.create(), bone.rotation, bone.translation, bone.scale);
            bone.model = this.boneBuffer.subarray(i * 16, i * 16 + 16); // Bone's model matrix maps directly into boneBuffer
        }
    }

    evaluate() {
        for (let i = 0; i < this.bones.length; i++) {
            const bone = this.bones[i];
            mat4.fromRotationTranslationScale(bone.local, bone.rotation, bone.translation, bone.scale);

            if (bone.parent) {
                // assert(!bone.parent.dirty)
                mat4.multiply(bone.model, bone.parent.model, bone.local);
            } else mat4.copy(bone.model, bone.local);
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
