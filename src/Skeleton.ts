import { vec3, quat, mat4 } from "gl-matrix";
import { assert, defaultValue } from "./util";
import { GltfSkin } from './resources/Gltf';
import { equalsEpsilon } from "./MathHelpers";

export interface Bone {
    name: string;
    translation: vec3;
    rotation: quat;
    scale: number;
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

    static fromGltf(skin: GltfSkin) {
        const bones: Bone[] = skin.joints.map((joint, idx) => ({
            name: defaultValue(joint.name, `Bone${idx}`),
            translation: joint.translation,
            rotation: joint.rotation,
            scale: assertUniformScale(joint.scale),
        }));

        const ibms = [];
        if (skin.inverseBindMatrices) {
            const kMat4Size = 4 * 16;
            for (let i = 0; i < skin.joints.length; i++) {
                ibms[i] = new Float32Array(skin.inverseBindMatrices.buffer, skin.inverseBindMatrices.byteOffset + kMat4Size * i, 16);
            }
        }

        return new Skin(bones, ibms);
    }
}

// A Skin instance where each bone can be posed individually. Manages its own array of matrices.
// These will be manipulated during animation, and loaded into uniform buffers during rendering.
export class Skeleton {
    bones: Bone[];
    boneMatrices: Float32Array;

    constructor(bones: Bone[]) {
        // Copy the bones so that they can be manipulated independently of other Skeletons
        this.bones = bones.slice( 0 );
        this.boneMatrices = new Float32Array(bones.length * 16);

        for (let i = 0; i < bones.length; i++) {
            mat4.identity(this.boneMatrices.subarray(i * 16, i * 16 + 16));
        }
    }
}

// --------------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------------
function assertUniformScale(scale: vec3): number {
    assert(equalsEpsilon(scale[0], scale[1]) && equalsEpsilon(scale[0], scale[2]));
    return scale[0];
}
