import * as Gfx from '../gfx/GfxTypes';
import { assert, defaultValue, defined, assertDefined } from '../util';
import * as GlTf from './Gltf.d';
import { vec3, quat, mat4 } from 'gl-matrix';
import { Resource, ResourceLoader, ResourceStatus, ResourceLoadingContext } from './Resource';
import { IMesh } from '../Mesh';
import { QuaternionKeyframeTrack, InterpolationModes, InterpolateLinear, AnimationClip, VectorKeyframeTrack, InterpolateDiscrete, Interpolant, KeyframeTrack } from './Animation';
import { Object3D } from '../Object3D';

// Get the type of the object that a Promise would pass to Promise.then()
// See https://stackoverflow.com/questions/48011353/how-to-unwrap-type-of-a-promise
type ThenArg<T> = T extends PromiseLike<infer U> ? U : T;

// --------------------------------------------------------------------------------
// GLB (Binary GLTF decoding)
// --------------------------------------------------------------------------------
const BINARY_HEADER_MAGIC = 'glTF';
const BINARY_HEADER_LENGTH = 12;
const BINARY_CHUNK_TYPES = { JSON: 0x4e4f534a, BIN: 0x004e4942 };

// @TODO: This should be shared with the whole engine
let textDecoder = new TextDecoder();
function decodeText(array: ArrayBufferView | ArrayBuffer): string {
    return textDecoder.decode(array);
}

class GLTFBinaryData {
    json: string;
    binaryChunk: Uint8Array;

    constructor(data: ArrayBuffer) {
        const headerView = new DataView(data, 0, BINARY_HEADER_LENGTH);
        const chunkView = new DataView(data, BINARY_HEADER_LENGTH);

        const header = {
            magic: decodeText(new Uint8Array(data, 0, 4)),
            version: headerView.getUint32(4, true),
            length: headerView.getUint32(8, true),
        };

        if (header.magic !== BINARY_HEADER_MAGIC) {
            throw new Error('Unsupported glTF-Binary header.');
        } else if (header.version < 2.0) {
            throw new Error('Unsupported legacy binary file detected.');
        }

        let chunkIndex = 0;
        while (chunkIndex < chunkView.byteLength) {
            const chunkLength = chunkView.getUint32(chunkIndex, true);
            chunkIndex += 4;
            const chunkType = chunkView.getUint32(chunkIndex, true);
            chunkIndex += 4;

            switch (chunkType) {
                case BINARY_CHUNK_TYPES.JSON:
                    {
                        const contentArray = new Uint8Array(data, BINARY_HEADER_LENGTH + chunkIndex, chunkLength);
                        this.json = decodeText(contentArray);
                    }
                    break;

                case BINARY_CHUNK_TYPES.BIN:
                    {
                        const byteOffset = BINARY_HEADER_LENGTH + chunkIndex;
                        this.binaryChunk = new Uint8Array(data, byteOffset, chunkLength);
                    }
                    break;

                default:
                    {
                        console.warn('Skipping unexpected glTF-Binary chunk type:', chunkType);
                    }
                    break;
            }

            chunkIndex += chunkLength;
        }

        assert(!!this.json, 'glTF-Binary: JSON content not found.');
    }
}

// --------------------------------------------------------------------------------
// GLTF Asset
// --------------------------------------------------------------------------------
export class GltfAsset {
    public gltf: GlTf.GlTf;

    private bufferData: Uint8Array[];

    constructor(gltf: GlTf.GlTf, bufferData: Uint8Array[]) {
        this.gltf = gltf;
        this.bufferData = bufferData;
    }

    /**
     * Fetch the data for a buffer view. Pass in the `bufferView` property of an
     * `Accessor`.
     * NOTE: To avoid any unnessary copies, the data is returned as a `Uint8Array` instead of an `ArrayBuffer`.
     */
    bufferViewData(index: GlTf.GlTfId): Uint8Array {
        if (!this.gltf.bufferViews) {
            throw new Error('No buffer views found.');
        }
        const bufferView = this.gltf.bufferViews[index];
        const bufferData = assertDefined(this.bufferData[bufferView.buffer], `No data for buffer ${bufferView.buffer}`);
        const byteLength = bufferView.byteLength || 0;
        const byteOffset = bufferView.byteOffset || 0;

        // For GLB files, the 'base buffer' is the whole GLB file, including the json part.
        // Therefore we have to consider bufferData's offset within its buffer it as well.
        // For non-GLB files it will be 0.
        const baseBuffer = bufferData.buffer;
        const baseBufferByteOffset = bufferData.byteOffset;

        return new Uint8Array(baseBuffer, baseBufferByteOffset + byteOffset, byteLength);
    }

    /**
     * Fetch the data associated with the accessor. Equivalent to `bufferViewData` for most accessors; special cases:
     * - `accessor.bufferView` is undefined: create a buffer initialized with zeroes.
     * - `accessor.sparse` is defined: Copy underlying buffer view and apply values from `sparse`.
     */
    accessorData(index: GlTf.GlTfId): ArrayBufferView {
        if (!this.gltf.accessors) {
            /* istanbul ignore next */
            throw new Error('No accessors views found.');
        }
        const acc = this.gltf.accessors[index];
        const elementsPerType = GLTF_ELEMENTS_PER_TYPE[acc.type];
        let data;

        const typedArray = GLTF_COMPONENT_TYPE_ARRAYS[acc.componentType];
        const byteSize = typedArray.BYTES_PER_ELEMENT * elementsPerType * acc.count;
        if (acc.bufferView !== undefined) {
            const bufferView = this.bufferViewData(acc.bufferView);
            data = new typedArray(
                bufferView.buffer, 
                bufferView.byteOffset + defaultValue(acc.byteOffset, 0), 
                acc.count * elementsPerType
            );
        } else {
            data = new typedArray(byteSize);
        }

        if (acc.sparse) {
            // parse sparse data
            const { count, indices, values } = acc.sparse;
            let typedArray = GLTF_COMPONENT_TYPE_ARRAYS[indices.componentType];
            let bufferViewData = this.bufferViewData(indices.bufferView);
            const indexData = new typedArray(
                bufferViewData.buffer,
                bufferViewData.byteOffset + (indices.byteOffset || 0),
                count,
            );

            typedArray = GLTF_COMPONENT_TYPE_ARRAYS[acc.componentType];
            bufferViewData = this.bufferViewData(values.bufferView);
            const valueData = new typedArray(
                this.bufferViewData(values.bufferView).buffer,
                bufferViewData.byteOffset + (values.byteOffset || 0),
                count * elementsPerType,
            );

            // copy base data and change it
            if (acc.bufferView) {
                // no copy necessary if no bufferView since data was created above
                data = new Uint8Array(data);
            }

            const typedData = new GLTF_COMPONENT_TYPE_ARRAYS[acc.componentType](data.buffer);
            for (let i = 0; i < count; i++) {
                for (let j = 0; j < elementsPerType; j++) {
                    typedData[elementsPerType * indexData[i] + j] = valueData[elementsPerType * i + j];
                }
            }
        }

        return data;
    }
}



// --------------------------------------------------------------------------------
// GLTF Loader
// --------------------------------------------------------------------------------
export interface GltfTechnique {
    shaderId: Gfx.Id;
    attributes: { [name: string]: { semantic: string }};
    uniforms: { [name: string]: {
        type: Gfx.Type;
        count?: number;
        node?: number;
        semantic?: string;
        value?: any;
    }}
}

export interface Sampler {
    nodeId: number;
    type: InterpolationModes | undefined;
    times: Float32Array;
    values: Float32Array;
}

export interface GltfAnimation {
    name: string;
    maxTime: number;
    scales: Sampler[];
    rotations: Sampler[];
    translations: Sampler[];
    weights: Sampler[];

    clip?: AnimationClip;
}

export interface GltfBufferView extends Gfx.BufferView {
    buffer: Gfx.Id;
    type: Gfx.BufferType;
    name: string;
}

export interface GltfPrimitive {
    mesh: IMesh;

    depthMode?: Gfx.Id;
    cullMode?: Gfx.CullMode;
    materialIndex: number;
}

export interface GltfMesh {
    name: string;
    id: number;
    primitives: GltfPrimitive[];
}

export class GltfNode extends Object3D {
    morphWeight: number;
    meshId?: number;
    skinId?: number;

    clone(recursive = false): this {
        const node = super.clone(recursive);
        node.morphWeight = this.morphWeight;
        node.meshId = this.meshId;
        node.skinId = this.skinId;
        return node;
    }
}

export interface GltfSkin {
    name?: string;
    inverseBindMatrices?: mat4[];
    skeleton?: number;
    joints: number[];
}

export interface GltfMaterial {
    name: string;
    renderFormat: Gfx.RenderFormat;
    cullMode: Gfx.CullMode;
    
    technique?: GltfTechnique;
    values?: { [uniformName: string]: any };
}

export interface GltfTexture {
    desc: Gfx.TextureDescriptor,
    name: string,
    id: Gfx.Id;
}

function translateAccessorToType(type: string, componentType: number): Gfx.Type {
    let gfxType: Gfx.Type;

    switch (componentType) {
        case 5120:
            gfxType = Gfx.Type.Char;
            break;
        case 5121:
            gfxType = Gfx.Type.Uchar;
            break;
        case 5122:
            gfxType = Gfx.Type.Short;
            break;
        case 5123:
            gfxType = Gfx.Type.Ushort;
            break;
        case 5125:
            gfxType = Gfx.Type.Uint;
            break;
        case 5126:
            gfxType = Gfx.Type.Float;
            break;
        default:
            throw new Error('Invalid GLTF component type');
    }

    switch (type) {
        case 'SCALAR':
            gfxType += 0;
            break;
        case 'VEC2':
            gfxType += 1;
            break;
        case 'VEC3':
            gfxType += 2;
            break;
        case 'VEC4':
            gfxType += 3;
            break;
        case 'MAT2':
            throw new Error('2x2 Matrice not yet supported');
        case 'MAT3':
            gfxType = Gfx.Type.Float3x3;
            break;
        case 'MAT4':
            gfxType = Gfx.Type.Float4x4;
            break;
    }

    return gfxType;
}

function translateTypeToType(type: number): Gfx.Type {
    switch (type) {
        case 5124: return Gfx.Type.Int;
        case 5126: return Gfx.Type.Float;
        case 35664: return Gfx.Type.Float2;
        case 35665: return Gfx.Type.Float3;
        case 35666: return Gfx.Type.Float4;
        case 35667: return Gfx.Type.Int2
        case 35668: return Gfx.Type.Int3
        case 35669: return Gfx.Type.Int4
        case 35675: return Gfx.Type.Float3x3;
        case 35676: return Gfx.Type.Float4x4;
        case 35678: return Gfx.Type.Texture2D;
        default:
            throw new Error('Invalid GLTF component type');
    }
}

function translateModeToPrimitiveType(mode: number): Gfx.PrimitiveType {
    switch (mode) {
        case 0:
            return Gfx.PrimitiveType.Points;
        case 1:
            return Gfx.PrimitiveType.Lines;
        case 2:
            return Gfx.PrimitiveType.LineLoop;
        case 3:
            return Gfx.PrimitiveType.LineStrip;
        case 4:
            return Gfx.PrimitiveType.Triangles;
        case 5:
            return Gfx.PrimitiveType.TriangleStrip;
        case 6:
            return Gfx.PrimitiveType.TriangleFan;
        default:
            throw new Error('Invalid GLTF primitive mode');
    }
}

/** Spec: https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#sampler */
const GLTF_SAMPLER_MAG_FILTER: { [index: number]: any } = {
    9728: Gfx.TextureFilter.Nearest,
    9729: Gfx.TextureFilter.Linear,
};

const GLTF_SAMPLER_MIN_FILTER: { [index: number]: any } = {
    9728: Gfx.TextureFilter.Nearest,
    9729: Gfx.TextureFilter.Linear,
    // 9984: NEAREST_MIPMAP_NEAREST
    // 9985: LINEAR_MIPMAP_NEAREST
    // 9986: NEAREST_MIPMAP_LINEAR
    // 9987: LINEAR_MIPMAP_LINEAR
};

const GLTF_SAMPLER_WRAP: { [index: number]: any } = {
    // Currently unsupported
};

/** Spec: https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#accessor-element-size */
const GLTF_COMPONENT_TYPE_ARRAYS: { [index: number]: any } = {
    5120: Int8Array,
    5121: Uint8Array,
    5122: Int16Array,
    5123: Uint16Array,
    5125: Uint32Array,
    5126: Float32Array,
};

/** Spec: https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#accessor-element-size */
const GLTF_ELEMENTS_PER_TYPE: { [index: string]: number } = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT2: 4,
    MAT3: 9,
    MAT4: 16,
};

const kDefaultVertexAttributeSemanticMap: { [semantic: string]: string } = {
    POSITION: 'a_pos',
    NORMAL: 'a_normal',
    TANGENT: 'a_tangent',
    JOINTS_0: 'a_joints',
    WEIGHTS_0: 'a_weights',
    COLOR_0: 'a_color',
    TEXCOORD_0: 'a_uv0',
    TEXCOORD_1: 'a_uv1',
    MORPH0_POSITION: 'a_posMorph0',
};

const GLTF_ATTRIBUTE_DEFINES: { [index: string]: string } = {
    NORMAL: 'HAS_NORMALS 1',
    TANGENT: 'HAS_TANGENT 1',
    JOINTS_0: 'HAS_JOINT_SET0 1',
    WEIGHTS_0: 'HAS_WEIGHT_SET0 1',
    COLOR_0: 'HAS_COLOR0 1',
    TEXCOORD_0: 'HAS_UV_SET0 1',
    TEXCOORD_1: 'HAS_UV_SET1 1',
};

const GLTF_INTERPOLATION: { [index: string]: InterpolationModes | undefined } = {
    CUBICSPLINE: undefined, // We use a custom interpolant (GLTFCubicSplineInterpolation) for CUBICSPLINE tracks. Each
                            // keyframe track will be initialized with a default interpolation type, then modified.
    LINEAR: InterpolateLinear,
    STEP: InterpolateDiscrete
};

const GLTF_ANIMATION_PATH: { [index: string]: string } = {
    translation: 'position',
    rotation: 'quaternion',
    scale: 'scale',
    weights: '_UNSUPPORTED',
}

// --------------------------------------------------------------------------------
// GLTF parsing helpers
// --------------------------------------------------------------------------------
function loadPrimitive(res: GltfResource, asset: GltfAsset, gltfPrimitive: GlTf.MeshPrimitive): GltfPrimitive {
    const prim = gltfPrimitive;
    const gltf = asset.gltf;

    let material;
    if (defined(gltfPrimitive.material)) {
        material = assertDefined(res.transient.materials[gltfPrimitive.material]);
    } else {
        // @TODO: Default material
        throw new Error('Default material not yet supported');
    }

    const shaderDefines: string[] = [];

    let indexBufferView: GltfBufferView | undefined = undefined;
    const vertexBufferViews: GltfBufferView[] = [];

    if (defined(prim.indices)) {
        const acc = assertDefined(gltf.accessors)[prim.indices];
        const viewId = assertDefined(acc.bufferView);
        indexBufferView = loadBufferView(res, asset, viewId, Gfx.BufferType.Index);
    }

    // If the material specifies vertex attribute names, use those. Otherwise use the defaults.
    let attribNameMap: { [semantic: string]: string };
    if (defined(material.techniqueIndex)) {
        attribNameMap = {};
        const technique = assertDefined(res.transient.techniques).techniques[material.techniqueIndex];
        const attribNames = Object.keys(technique.attributes);
        for (const name of attribNames) { 
            const semantic = technique.attributes[name].semantic;
            attribNameMap[semantic] = name;
        }
    } else attribNameMap = kDefaultVertexAttributeSemanticMap;

    // Fill out the VertexLayout based on the primitive's attributes
    const vertexLayout: Gfx.VertexLayout = { buffers: [] };
    const bufferViewMap: { [viewIdx: number]: number } = {};
    for (let semantic in prim.attributes) {
        const accessor = assertDefined(gltf.accessors)[prim.attributes[semantic]];
        const viewIdx = assertDefined(accessor.bufferView, 'Undefined accessor buffers are not yet implemented');
        const bufferIdx = bufferViewMap[viewIdx];
        let bufferDesc;

        if (!defined(bufferIdx)) {
            // This is the first time this buffer view is referenced by an attribute
            bufferViewMap[viewIdx] = vertexBufferViews.length;

            const bufferView = loadBufferView(res, asset, viewIdx, Gfx.BufferType.Vertex);

            const view = assertDefined(gltf.bufferViews)[viewIdx];
            bufferDesc = {
                stride: defaultValue(view.byteStride, 0), // 0 means tightly packed
                layout: {},
            };

            vertexBufferViews.push(bufferView);
            vertexLayout.buffers.push(bufferDesc);
        } else {
            bufferDesc = vertexLayout.buffers[bufferIdx];
        }

        const attribDefine = GLTF_ATTRIBUTE_DEFINES[semantic];
        if (defined(attribDefine)) shaderDefines.push(attribDefine);

        const shaderAttribName = assertDefined(attribNameMap[semantic], `Unknown vertex attribute semantic: ${semantic}`);

        bufferDesc.layout[shaderAttribName] = {
            type: translateAccessorToType(accessor.type, accessor.componentType),
            offset: accessor.byteOffset || 0,
        };
    }

    // Also add any attributes from Morph Targets
    if (prim.targets) {
        shaderDefines.push('HAS_MORPH0 1');
        assert(prim.targets.length === 1, 'Only 1 morph target is currently supported');
        const target = prim.targets[0];
        for (let semantic in target) {
            if (semantic === 'POSITION') {
                const accessor = assertDefined(gltf.accessors)[target[semantic]];
                const viewIdx = assertDefined(accessor.bufferView, 'Undefined accessor buffers are not yet implemented');
                const view = assertDefined(gltf.bufferViews)[viewIdx];
                let bufferDesc = vertexLayout.buffers[viewIdx];

                const bufferView = loadBufferView(res, asset, viewIdx, Gfx.BufferType.Vertex);

                if (!defined(bufferDesc)) {
                    vertexBufferViews[viewIdx] = bufferView;
                    bufferDesc = vertexLayout.buffers[viewIdx] = {
                        stride: defaultValue(view.byteStride, 0), // 0 means tightly packed
                        layout: {},
                    };
                }

                const shaderAttribName = attribNameMap[`MORPH0_${semantic}`];

                bufferDesc.layout[shaderAttribName] = {
                    type: translateAccessorToType(accessor.type, accessor.componentType),
                    offset: accessor.byteOffset || 0,
                };
            }
        }
    }

    // @TODO: For now, only non-sparse indexed primitives are supported
    const indices = gltf.accessors![assertDefined(prim.indices, 'Only indexed primitives are currently supported')];
    const indicesBufferView = assertDefined(indexBufferView, 'Only indexed primitives are currently supported');

    return {
        mesh: {
            elementCount: indices.count,
            vertexBuffers: vertexBufferViews,
            primitiveType: translateModeToPrimitiveType(defaultValue(prim.mode, 4)),
            indexType: translateAccessorToType(indices.type, indices.componentType),
            indexBuffer: indicesBufferView,
            vertexLayout,
        },
        materialIndex: gltfPrimitive.material,
    };
}

function loadMeshes(res: GltfResource, asset: GltfAsset) {
    const meshes = defaultValue(asset.gltf.meshes, []);
    res.meshes = [];

    for (let id = 0; id < meshes.length; id++) {
        const gltfMesh = assertDefined(meshes[id]);

        // A Mesh has a transform (from its parent node) that is shared between its primitives
        // A Primitive defines its material as well as draw call parameters
        const primitives = [];
        for (let prim of gltfMesh.primitives) {
            primitives.push(loadPrimitive(res, asset, prim));
        }

        const mesh: GltfMesh = {
            name: gltfMesh.name,
            id,
            primitives,
        }

        res.meshes[id] = mesh;
    }
}

function loadSkins(res: GltfResource, asset: GltfAsset) {
    const skins = defaultValue(asset.gltf.skins, []);
    res.skins = [];

    for (let id = 0; id < skins.length; id++) {
        const skin = skins[id];
        let ibms = undefined;

        // Inverse bind matrices are in the same order as the skin.joints array
        // This has been re-arranged, so remap them here
        if (defined(skin.inverseBindMatrices)) {
            const ibmData = new Float32Array(asset.accessorData(skin.inverseBindMatrices) as Float32Array);
            assert(!res.transferList.includes(ibmData.buffer));
            res.transferList.push(ibmData.buffer);

            ibms = [];
            for (let i = 0; i < skin.joints.length; i++) {
                ibms[i] = ibmData.subarray(i * 16, i * 16 + 16);
            }
        }

        res.skins[id] = {
            name: skin.name,
            skeleton: skin.skeleton,
            joints: skin.joints,
            inverseBindMatrices: ibms,
        }
    }
}

function loadScenes(res: GltfResource, asset: GltfAsset) {
    const defaultSceneId = defaultValue(asset.gltf.scene, 0);
    if (defined(defaultSceneId)) {
        const scenes = assertDefined(asset.gltf.scenes);
        const defaultScene = assertDefined(scenes[defaultSceneId]);
        res.rootNodeIds = defaultValue(defaultScene.nodes, []);
    }
}

function loadBufferView(res: GltfResource, asset: GltfAsset, id: number, bufType: Gfx.BufferType): GltfBufferView {
    if (defined(res.bufferViews[id])) return res.bufferViews[id];

    const gltfBufferView = assertDefined(asset.gltf.bufferViews)[id];
    const name = gltfBufferView.name || `buffer${id}`;

    const bufId = -1; // The GPU buffer will be created during loadSync on the main thread

    res.bufferData[id] = new Uint8Array(asset.bufferViewData(id)).buffer;
    assert(!res.transferList.includes(res.bufferData[id]));
    res.transferList.push(res.bufferData[id]);

    const buf = { name, type: bufType, buffer: bufId };
    res.bufferViews[id] = buf;
    return buf;
}


// --------------------------------------------------------------------------------
// Materials
// --------------------------------------------------------------------------------
function loadMaterialsAsync(res: GltfResource, asset: GltfAsset) {
    const materials = defaultValue(asset.gltf.materials, []).map((src, i) => {
        const ext = src.extensions?.KHR_techniques_webgl;
        const techniqueIndex = ext ? ext.technique : undefined;
        const values = ext ? ext.values : undefined;

        const material = {
            name: defaultValue(src.name, `Material${i}`),
            renderFormat: { blendingEnabled: false }, // @TODO: Parse this
            cullMode: src.doubleSided ? Gfx.CullMode.None : Gfx.CullMode.Back,
            techniqueIndex,
            values
        };

        return material;
    });

    return materials;
}

function loadMaterialsSync(data: TransientData['materials'], resource: GltfResource): GltfMaterial[] {
    return data.map(src => ({
        name: src.name,
        renderFormat: src.renderFormat,
        cullMode: src.cullMode,
        values: src.values,
        technique: defined(src.techniqueIndex) ? resource.techniques[src.techniqueIndex] : undefined,
    }));
}

// --------------------------------------------------------------------------------
// Techniques
// --------------------------------------------------------------------------------
function loadTechniquesAsync(res: GltfResource, asset: GltfAsset) {
    if (!asset.gltf.extensionsUsed?.includes('KHR_techniques_webgl')) { return; }
    const ext = assertDefined(asset.gltf.extensions.KHR_techniques_webgl);

    const shaderData = ext.shaders.map((src: any, idx: number) => {
        const bufferViewId = assertDefined(src.bufferView, 'Shader loading from URI not yet supported');
        const data = new Uint8Array(asset.bufferViewData(bufferViewId)).buffer;
        assert(!res.transferList.includes(data));
        res.transferList.push(data);
        return data;
    });

    const shaders = ext.programs.map((src: any) => ({
        name: src.name,
        fsIndex: src.fragmentShader,
        vsIndex: src.vertexShader,
    }));

    const techniques = ext.techniques.map((src: any, idx: number) => {
        const uniforms: GltfTechnique['uniforms'] = {};
        for (const uniformName in defaultValue(src.uniforms, {})) {
            const srcUni = src.uniforms[uniformName];
            uniforms[uniformName] = { ...srcUni, type: translateTypeToType(srcUni.type) };
        }
        
        return {
            shaderIndex: src.program,
            attributes: defaultValue(src.attributes, {}),
            uniforms,
        };
    });

    return {
        shaderData,
        shaders,
        techniques
    }
}

function loadTechniquesSync(data: TransientData['techniques'], context: ResourceLoadingContext): GltfTechnique[] {
    if (!defined(data)) return [];

    const shaderIds = data.shaders.map((src: any) => {
        const vertSourceBuf = data.shaderData[src.vsIndex];
        const fragSourceBuf = data.shaderData[src.fsIndex];
        
        const desc: Gfx.ShaderDescriptor = {
            name: src.name,
            vertSource: decodeText(vertSourceBuf),
            fragSource: decodeText(fragSourceBuf),
        }
        
        return context.renderer.createShader(desc);
    });

    const techniques = data.techniques.map((src: any) => ({
        shaderId: shaderIds[src.shaderIndex],
        attributes: src.attributes,
        uniforms: src.uniforms
    }));

    return techniques;
}

// --------------------------------------------------------------------------------
// Nodes
// --------------------------------------------------------------------------------
function loadNodesAsync(res: GltfResource, asset: GltfAsset) {
    const nodes = defaultValue(asset.gltf.nodes, []).map(src => {
        const scale = defaultValue(src.scale, [1, 1, 1]);
        const rotation = defaultValue(src.rotation, [0, 0, 0, 1]);
        const translation = defaultValue(src.translation, [0, 0, 0]);

        const node = {
            name: src.name,
            scale: vec3.fromValues(scale[0], scale[1], scale[2]),
            rotation: quat.fromValues(rotation[0], rotation[1], rotation[2], rotation[3]),
            translation: vec3.fromValues(translation[0], translation[1], translation[2]),
            morphWeight: defaultValue(src.weights, [0])[0],
            transform: mat4.create(),
            meshId: defined(src.mesh) ? src.mesh : undefined,
            skinId: defined(src.skin) ? src.skin : undefined,
            children: [] as number[],
        }

        if (defined(src.matrix)) { 
            (node.transform as Float32Array).set(src.matrix);
            mat4.getRotation(node.rotation, node.transform);
            mat4.getTranslation(node.translation, node.transform);
            mat4.getScaling(node.scale, node.transform);
        }
        else node.transform = mat4.fromRotationTranslationScale(mat4.create(), node.rotation, node.translation, node.scale);

        if (defined(src.children)) {
            for (let childIdx = 0; childIdx < src.children.length; childIdx++) {
                const childId = src.children[childIdx]
                const child = assertDefined(asset.gltf.nodes)[childId];
                node.children.push(childId);
            }
        }

        return node;
    });

    return nodes;
}

function loadNodesSync(data: TransientData['nodes']): GltfNode[] {
    const objects = data.map((node, nodeId) => {
        const obj = new GltfNode();
        obj.name = defaultValue(node.name, `Node${nodeId}`);
        obj.position.set(node.translation[0], node.translation[1], node.translation[2]);
        obj.quaternion.set(node.rotation[0], node.rotation[1], node.rotation[2], node.rotation[3]);
        obj.scale.set(node.scale[0], node.scale[1], node.scale[2]);

        obj.skinId = node.skinId;
        obj.meshId = node.meshId;
        obj.morphWeight = node.morphWeight;
        return obj;
    });

    for (let i = 0; i < objects.length; i++) {
        const src = data[i];
        const node = objects[i];
        for (const childId of src.children) {
            node.add(objects[childId]);
        }
    }
    
    return objects;
}

// --------------------------------------------------------------------------------
// Textures 
// --------------------------------------------------------------------------------
async function loadTexturesAsync(res: GltfResource, asset: GltfAsset) {
    const images = defaultValue(asset.gltf.images, []);
    const srcTextures = defaultValue(asset.gltf.textures, []);
    const samplers = defaultValue(asset.gltf.samplers, []);

    // Shared texture properties
    const defaultTexDesc: Gfx.TextureDescriptor = {
        type: Gfx.TextureType.Texture2D,
        format: Gfx.TexelFormat.U8x4,
        usage: Gfx.Usage.Static,
    };

    // Spec: https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#sampler
    const defaultSampler = {
        wrapS: 10497,
        wrapT: 10497
    }

    const imageDataPromises = images.map(image => {
        const bufferView = assertDefined(image.bufferView, 'Image loading from a URI is not yet supported');
        const bufferData = asset.bufferViewData(bufferView);

        // All browser except Safari support JPG/PNG image decoding on a worker via createImageBitmap
        // Otherwise we'll just send the ArrayBuffer and decode before uploading to the GPU on the main thread
        let imageDataPromise: Promise<ArrayBuffer | ImageBitmap | HTMLImageElement>;
        if (defined(self.createImageBitmap)) {
            const blob = new Blob([bufferData], { type: assertDefined(image.mimeType) });
            imageDataPromise = createImageBitmap(blob);
        } else {
            imageDataPromise = Promise.resolve(new Uint8Array(bufferData).buffer);
        }

        // Wait for the imageData to be ready before pushing to main thread
        // @NOTE: Make sure we make large data transferrable to avoid costly copies between threads
        return imageDataPromise.then(imageData => {
            assert(!res.transferList.includes(imageData as ArrayBuffer | ImageBitmap));
            res.transferList.push(imageData as ArrayBuffer | ImageBitmap);
            return imageData;
        });
    })

    const textures = srcTextures.map(src => {
        const sampler = defaultValue(samplers[src.sampler!], defaultSampler);
        const desc = { ...defaultTexDesc };

        if (defined(sampler.magFilter)) {
            desc.defaultMagFilter = GLTF_SAMPLER_MAG_FILTER[sampler.magFilter];
            if (!defined(desc.defaultMagFilter)) console.warn(`Unsupported texture mag filter: ${sampler.magFilter}`);
        }

        if (defined(sampler.minFilter)) {
            desc.defaultMagFilter = GLTF_SAMPLER_MIN_FILTER[sampler.minFilter];
            if (!defined(desc.defaultMagFilter)) console.warn(`Unsupported texture min filter: ${sampler.magFilter}`);
        }

        if (defined(sampler.wrapS) || defined(sampler.wrapT)) {
            if (!defined(desc.defaultMagFilter)) console.warn(`Texture wrapping not yet supported: ${sampler.magFilter}`);
        }

        return {
            name: src.name,
            desc,
            imageIndex: assertDefined(src.source),
        }
    });

    // Wait for all image data to finish resolving
    const imageData = await Promise.all(imageDataPromises);

    return {
        imageData,
        textures
    };
}

function loadTexturesSync(data: TransientData['textures'], context: ResourceLoadingContext): GltfTexture[] {
    const textures: GltfTexture[] = [];

    // Upload textures to the GPU
    // @TODO: Currently creating multiple copies of textures to support different sampler parameter sets
    if (defined(self.createImageBitmap)) {
        for (const texture of data.textures) {
            const imageData = data.imageData[texture.imageIndex] as ImageBitmap;
            assert(imageData instanceof ImageBitmap);
            textures.push({
                desc: texture.desc,
                name: texture.name,
                id: context.renderer.createTexture(texture.name, texture.desc, imageData),
            });
        }

        for (const imageData of data.imageData) { (imageData as ImageBitmap).close(); }
    }

    return textures;
}

function safariTextureLoadHack(resource: GltfResource, context: ResourceLoadingContext) {
    let firstPass = false;

    // This browser (Safari) doesn't support createImageBitmap(), which means we have to do JPEG/PNG decompression
    // here on the main thread. Use an HtmlImageElement to do this before submitting to WebGL.
    // This will keep the status at LoadingSync (so that loadSync() will be repeatedly called) until the images are ready
    const transient = resource.transient.textures;
    let texLoadedCount = 0;
    for (let i = 0; i < transient.textures.length; i++) {
        const texture = transient.textures[i];
        const imageData = transient.imageData[texture.imageIndex];

        if (defined(resource.textures[i])) {
            texLoadedCount += 1;
            continue;
        }

        if (imageData instanceof ArrayBuffer) {
            firstPass = true;

            // @TODO: Support other file type (PNG) by using the mimetype from the response
            var blob = new Blob([imageData], { type: "image/jpeg" });
            let imageUrl = window.URL.createObjectURL(blob);

            // Create an image element to do async JPEG/PNG decoding
            transient.imageData[texture.imageIndex] = new Image();
            (transient.imageData[texture.imageIndex] as HTMLImageElement).src = imageUrl;

            // Continue calling loadSync until the image is loaded and decoded
            resource.status = ResourceStatus.LoadingSync;
        }

        if ((imageData as HTMLImageElement).complete) {
            assert(defined(resource.textures), 'This should have been defined as an empty array by loadTexturesSync()');
            resource.textures[i] = {
                desc: texture.desc,
                name: texture.name,
                id: context.renderer.createTexture(texture.name, texture.desc, imageData as HTMLImageElement),
            };
        }
    }

    // Continue calling LoadSync each frame until the textures are ready
    if (texLoadedCount === transient.textures.length) {
        resource.status = ResourceStatus.Loaded;
    } else {
        resource.status = ResourceStatus.LoadingSync;
    }

    // If this is our first pass through loadSync(), allow the rest of the loading to run. Otherwise exit early.
    return !firstPass 
}

// --------------------------------------------------------------------------------
// Animation 
// --------------------------------------------------------------------------------
function loadAnimationsAsync(res: GltfResource, asset: GltfAsset) {
    let clips = [];
    for (const src of defaultValue(asset.gltf.animations, [])) {

        // Parse sampler data 
        const samplerDatas = src.samplers.map(sampler => {
            // @TODO: Support non-float times and data
            assert(asset.gltf.accessors![sampler.input].componentType === 5126, 'Non-float animation time type unsupported');
            assert(asset.gltf.accessors![sampler.output].componentType === 5126, 'Non-float animation values type unsupported');
            const times = new Float32Array(asset.accessorData(sampler.input) as Float32Array);
            const values = new Float32Array(asset.accessorData(sampler.output) as Float32Array);
            res.transferList.push(times.buffer, values.buffer);
            return { times, values };
        });

        const tracks = [];
        for (const channel of src.channels) {
            const targetNodeId = channel.target.node;
            if (!defined(targetNodeId)) continue;

            const targetProperty = GLTF_ANIMATION_PATH[channel.target.path];
            const samplerData = samplerDatas[channel.sampler];
            const interpolation = defaultValue(src.samplers[channel.sampler].interpolation, 'LINEAR');

            tracks.push({
                targetNodeId,
                targetProperty,
                times: samplerData.times,
                values: samplerData.values,
                interpolation,
            });
        }

        clips.push({
            name: src.name, 
            maxTime: src.maxTime, 
            tracks
        });
    }

    return clips;
}

function loadAnimationsSync(data: TransientData['animation'], resource: GltfResource): AnimationClip[] {  
    const clips = []  
    for (const clipData of data) {
        const tracks = clipData.tracks.map(trackData => {
            let TypedKeyframeTrack;
            switch(trackData.targetProperty) {
                case 'quaternion':
                    TypedKeyframeTrack = QuaternionKeyframeTrack;
                    break;

                case 'position':
                case 'scale':
                    TypedKeyframeTrack = VectorKeyframeTrack;
                    break;
                default: throw new Error('Unsupported animation target property');
            }

            const targetName = resource.nodes[trackData.targetNodeId].name;

            const track = new TypedKeyframeTrack(
                `${targetName}.${trackData.targetProperty}`, 
                trackData.times as any, // ThreeJS has mistyped these. They should be ArrayLike<number>
                trackData.values as any, 
                GLTF_INTERPOLATION[trackData.interpolation]
            );

            if (trackData.interpolation === 'CUBICSPLINE') {
                (track as any).createInterpolant = function InterpolantFactoryMethodGLTFCubicSpline( result: any ) {
                    // A CUBICSPLINE keyframe in glTF has three output values for each input value,
                    // representing inTangent, splineVertex, and outTangent. As a result, track.getValueSize()
                    // must be divided by three to get the interpolant's sampleSize argument.
                    return new GLTFCubicSplineInterpolant( this.times, this.values, this.getValueSize() / 3, result );
                };
        
                // Mark as CUBICSPLINE. `track.getInterpolation()` doesn't support custom interpolants.
                (track as any).createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline = true;
            }

            return track;
        });

        clips.push(new AnimationClip(clipData.name, clipData.maxTime, tracks));
    }

    return clips;
}

// Spline Interpolation
// Specification: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#appendix-c-spline-interpolation
class GLTFCubicSplineInterpolant extends Interpolant {
    copySampleValue_(index: number) {
        // Copies a sample value to the result buffer. See description of glTF
        // CUBICSPLINE values layout in interpolate_() function below.
        var result = this.resultBuffer,
            values = this.sampleValues,
            valueSize = this.valueSize,
            offset = index * valueSize * 3 + valueSize;

        for (var i = 0; i !== valueSize; i++) {
            result[i] = values[offset + i];
        }

        return result;
    }

    beforeStart_(index: number) {
        this.copySampleValue_(index);
    }

    afterEnd_(index: number) {
        this.copySampleValue_(index);
    }

    interpolate_(i1: number, t0: number, t: number, t1: number) {
        const result = this.resultBuffer;
        const values = this.sampleValues;
        const stride = this.valueSize;

        const stride2 = stride * 2;
        const stride3 = stride * 3;

        const td = t1 - t0;

        const p = (t - t0) / td;
        const pp = p * p;
        const ppp = pp * p;

        const offset1 = i1 * stride3;
        const offset0 = offset1 - stride3;

        const s2 = - 2 * ppp + 3 * pp;
        const s3 = ppp - pp;
        const s0 = 1 - s2;
        const s1 = s3 - pp + p;

        // Layout of keyframe output values for CUBICSPLINE animations:
        //   [ inTangent_1, splineVertex_1, outTangent_1, inTangent_2, splineVertex_2, ... ]
        for (let i = 0; i !== stride; i++) {
            const p0 = values[offset0 + i + stride]; // splineVertex_k
            const m0 = values[offset0 + i + stride2] * td; // outTangent_k * (t_k+1 - t_k)
            const p1 = values[offset1 + i + stride]; // splineVertex_k+1
            const m1 = values[offset1 + i] * td; // inTangent_k+1 * (t_k+1 - t_k)

            result[i] = s0 * p0 + s1 * m0 + s2 * p1 + s3 * m1;
        }

        return result;
    }
}

// --------------------------------------------------------------------------------
// Resource interface
// --------------------------------------------------------------------------------
interface TransientData {
    animation: ReturnType<typeof loadAnimationsAsync>,
    materials: ThenArg<ReturnType<typeof loadMaterialsAsync>>,
    nodes: ThenArg<ReturnType<typeof loadNodesAsync>>,
    techniques: ThenArg<ReturnType<typeof loadTechniquesAsync>>,
    textures: ThenArg<ReturnType<typeof loadTexturesAsync>>,
}

export interface GltfResource extends Resource {
    nodes: GltfNode[];
    skins: GltfSkin[];
    meshes: GltfMesh[];
    materials: GltfMaterial[];
    textures: GltfTexture[];
    bufferViews: GltfBufferView[];
    animations: AnimationClip[];
    techniques: GltfTechnique[];
    rootNodeIds: number[];

    // Transient Data
    bufferData: ArrayBuffer[];

    transient: TransientData;
}

export class GltfLoader implements ResourceLoader {
    async loadAsync(resource: GltfResource): Promise<void> {
        const response = await fetch(resource.source.uri);
        if (response.status != 200) throw new Error(`Failed to download GLTF`);

        const buffer = await response.arrayBuffer();
        const data = new GLTFBinaryData(buffer);
        const gltf = JSON.parse(data.json) as GlTf.GlTf;
        const asset = new GltfAsset(gltf, [data.binaryChunk]);

        resource.nodes = [];
        resource.meshes = [];
        resource.materials = [];
        resource.textures = [];
        resource.bufferViews = [];
        resource.animations = [];
        resource.rootNodeIds = [];

        resource.bufferData = [];

        resource.transient = {
            techniques: loadTechniquesAsync(resource, asset),
            materials: loadMaterialsAsync(resource, asset),
            nodes: loadNodesAsync(resource, asset),
            animation: loadAnimationsAsync(resource, asset),
            textures: await loadTexturesAsync(resource, asset),
        }

        loadMeshes(resource, asset);
        loadSkins(resource, asset);
        loadScenes(resource, asset);

        // Someone leaked the entire GLB buffer!
        assert(!resource.transferList.includes(buffer));

        resource.status = ResourceStatus.LoadingSync
    }

    loadSync(context: ResourceLoadingContext, resource: GltfResource): void {
        // @HACK: We're forced to support async texture decompression on the main thread because of Safari
        if (!defined(self.createImageBitmap)) { if (safariTextureLoadHack(resource, context)) return; }
        else { resource.status = ResourceStatus.Loaded; }

        resource.techniques = loadTechniquesSync(resource.transient.techniques, context);
        resource.materials = loadMaterialsSync(resource.transient.materials, resource);
        resource.nodes = loadNodesSync(resource.transient.nodes);
        resource.animations = loadAnimationsSync(resource.transient.animation, resource);
        resource.textures = loadTexturesSync(resource.transient.textures, context);

        // Upload Vertex and Index buffers to the GPU
        for (let idx in resource.bufferData) {
            const bufferView = resource.bufferViews[idx];
            const bufferData = resource.bufferData[idx];
            bufferView.buffer = context.renderer.createBuffer(bufferView.name, bufferView.type, Gfx.Usage.Static, bufferData);
        }

        if (resource.status === ResourceStatus.Loaded) {
            delete resource.transient;
        }
    }

    unloadSync(context: ResourceLoadingContext, resource: GltfResource) {
    }
}