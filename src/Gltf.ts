
import * as Gfx from './gfx/GfxTypes';
import { assert, defaultValue, defined, assertDefined } from './util';
import { GlobalUniforms } from './GlobalUniforms';
import { GlTf, GlTfId, MeshPrimitive, Image } from './Gltf.d';
import { RenderPrimitive } from './RenderPrimitive';
import { UniformBuffer } from './UniformBuffer';

import shaderVs from './shaders/gltf.vert';
import shaderFs from './shaders/gltf.frag';

// --------------------------------------------------------------------------------
// GLB (Binary GLTF decoding)
// --------------------------------------------------------------------------------
const BINARY_HEADER_MAGIC = 'glTF';
const BINARY_HEADER_LENGTH = 12;
const BINARY_CHUNK_TYPES = { JSON: 0x4E4F534A, BIN: 0x004E4942 };

// @TODO: This should be shared with the whole engine
let textDecoder = new TextDecoder();
function decodeText(array: ArrayBufferView): string {
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
            const chunkLength = chunkView.getUint32(chunkIndex, true); chunkIndex += 4;
            const chunkType = chunkView.getUint32(chunkIndex, true); chunkIndex += 4;

            switch (chunkType) {
                case BINARY_CHUNK_TYPES.JSON: {
                    const contentArray = new Uint8Array(data, BINARY_HEADER_LENGTH + chunkIndex, chunkLength);
                    this.json = decodeText(contentArray);
                } break;

                case BINARY_CHUNK_TYPES.BIN: {
                    const byteOffset = BINARY_HEADER_LENGTH + chunkIndex;
                    this.binaryChunk = new Uint8Array(data, byteOffset, chunkLength);
                } break;

                default: {
                    console.warn('Skipping unexpected glTF-Binary chunk type:', chunkType);
                } break;
            }

            chunkIndex += chunkLength;
        }

        assert(!!this.json, 'glTF-Binary: JSON content not found.');
    }
}

// --------------------------------------------------------------------------------
// GLTF Shader
// --------------------------------------------------------------------------------
class GltfShader implements Gfx.ShaderDescriptor {
    private static vert = shaderVs;
    private static frag = shaderFs;

    public static uniformLayout: Gfx.BufferLayout = {
        u_modelMtx: { offset: 0, type: Gfx.Type.Float4x4 },
        u_color: { offset: 64, type: Gfx.Type.Float4 },
    };

    public static resourceLayout: Gfx.ShaderResourceLayout = [
        { index: 0, type: Gfx.BindingType.UniformBuffer, layout: GlobalUniforms.bufferLayout },
        { index: 1, type: Gfx.BindingType.UniformBuffer, layout: GltfShader.uniformLayout },
        { index: 0, type: Gfx.BindingType.Texture, name: 'u_tex0' },
    ];

    name = 'GLTF';
    vertSource = GltfShader.vert.sourceCode;
    fragSource = GltfShader.frag.sourceCode;
    resourceLayout = GltfShader.resourceLayout;
}

// --------------------------------------------------------------------------------
// GLTF Asset
// --------------------------------------------------------------------------------
export class GltfAsset {
    public gltf: GlTf;

    private bufferData: Uint8Array[];

    constructor(gltf: GlTf, bufferData: Uint8Array[]) {
        this.gltf = gltf;
        this.bufferData = bufferData;
    }

    /**
     * Fetch the data for a buffer view. Pass in the `bufferView` property of an
     * `Accessor`.
     * NOTE: To avoid any unnessary copies, the data is returned as a `Uint8Array` instead of an `ArrayBuffer`.
     */
    bufferViewData(index: GlTfId): Uint8Array {
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
    accessorData(index: GlTfId): Uint8Array {
        if (!this.gltf.accessors) {
            /* istanbul ignore next */
            throw new Error('No accessors views found.');
        }
        const acc = this.gltf.accessors[index];
        const elementsPerType = GLTF_ELEMENTS_PER_TYPE[acc.type];
        let data;
        if (acc.bufferView !== undefined) {
            data = this.bufferViewData(acc.bufferView);
        } else {
            const byteSize = GLTF_COMPONENT_TYPE_ARRAYS[acc.componentType].BYTES_PER_ELEMENT *
                elementsPerType *
                acc.count;
            data = new Uint8Array(byteSize);
        }

        if (acc.sparse) {
            // parse sparse data
            const { count, indices, values } = acc.sparse;
            let typedArray = GLTF_COMPONENT_TYPE_ARRAYS[indices.componentType];
            let bufferViewData = this.bufferViewData(indices.bufferView);
            const indexData = new typedArray(bufferViewData.buffer,
                bufferViewData.byteOffset + (indices.byteOffset || 0), count);

            typedArray = GLTF_COMPONENT_TYPE_ARRAYS[acc.componentType];
            bufferViewData = this.bufferViewData(values.bufferView);
            const valueData = new typedArray(this.bufferViewData(values.bufferView).buffer,
                bufferViewData.byteOffset + (values.byteOffset || 0), count * elementsPerType);

            // copy base data and change it
            if (acc.bufferView) { // no copy necessary if no bufferView since data was created above
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

interface Model {
    primitives: RenderPrimitive[];
    uniformBuffer: UniformBuffer;
}

// --------------------------------------------------------------------------------
// GLTF Loader
// --------------------------------------------------------------------------------
export class GltfLoader {
    globalUniforms: GlobalUniforms;
    shader: Gfx.Id;

    initialize(renderer: Gfx.Renderer, globalUniforms: GlobalUniforms) {
        this.globalUniforms = globalUniforms;
        this.shader = renderer.createShader(new GltfShader());
    }

    loadModelFromGlb(name: string, buffer: ArrayBuffer, renderer: Gfx.Renderer) {
        const data = new GLTFBinaryData(buffer);
        const gltf = JSON.parse(data.json) as GlTf;

        const asset = new GltfAsset(gltf, [data.binaryChunk]);
        console.log(asset);
        return this.createModel(name, asset, renderer);
    }

    createModel(name: string, asset: GltfAsset, renderer: Gfx.Renderer) {
        const gltf = asset.gltf;

        let gpuBuffers: Gfx.Id[] = [];
        let gpuImages: Gfx.Id[] = [];
        let gpuMaterials: {
            baseColorTexture?: Gfx.Id;
        }[] = []
        let vertexLayoutBuffers = [];

        // Missing property fixup
        gltf.bufferViews = defaultValue(gltf.bufferViews, []);
        gltf.accessors = defaultValue(gltf.accessors, []);
        gltf.meshes = defaultValue(gltf.meshes, []);
        gltf.images = defaultValue(gltf.images, []);
        gltf.materials = defaultValue(gltf.materials, []);

        // Determine the targets of each bufferView
        for (let mesh of gltf.meshes)
            for (let prim of mesh.primitives) {
                if (defined(prim.indices)) {
                    const acc = gltf.accessors[prim.indices];
                    const view = gltf.bufferViews[assertDefined(acc.bufferView)];
                    view.target = 34963;
                }
            }

        // Upload all buffer views to the GPU
        // @NOTE: We can't just upload the whole buffer, because WebGL requires indices to be in their own buffer, for validation.
        gpuBuffers = gltf.bufferViews.map((view, i) => {
            const type = view.target === 34963 ? Gfx.BufferType.Index : Gfx.BufferType.Vertex;
            return renderer.createBuffer(view.name || `${name}_buffer${i}`, type, Gfx.Usage.Static, asset.bufferViewData(i))
        });

        // Images (async for now)
        gpuImages = gltf.images.map((image, i) => {
            if (image.bufferView) {
                const desc: Gfx.TextureDescriptor = {
                    type: Gfx.TextureType.Texture2D,
                    format: Gfx.TexelFormat.U8x3,
                    usage: Gfx.Usage.Static,
                }
                const texId = renderer.createTexture(image.name || `${name}_tex${i}`, desc, new Uint8Array([0, 255, 255]));

                const promise = loadImage(asset.bufferViewData(image.bufferView), assertDefined(image.mimeType));
                promise.then(imageData => {
                    if (imageData instanceof HTMLImageElement) {
                        document.body.appendChild(imageData);
                    }
                    renderer.writeTextureData(texId, imageData)
                });

                return texId;
            } else {
                throw new Error(`Image loading via URI not yet supported`);
            }
        });

        // Materials
        const defaultPbr = {
            baseColorFactor: [1, 1, 1, 1],
            metallicFactor: 1,
            roughnessFactor: 1
        };
        gpuMaterials = gltf.materials.map((material, i) => {
            const gpuMaterial: {
                baseColorTexture?: Gfx.Id;
            } = {};

            const pbr = defaultValue(material.pbrMetallicRoughness, defaultPbr);
            // @TODO: Double sided
            // @TODO: Alpha mode
            // @TODO: Alpha cutoff

            if (pbr.baseColorTexture) {
                const uvIdx = defaultValue(pbr.baseColorTexture.texCoord, 0);
                assert(uvIdx === 0, 'Non-zero UV indices not yet supported');
                gpuMaterial.baseColorTexture = gpuImages[pbr.baseColorTexture.index];
            }

            return gpuMaterial;
        });

        // Create templates for the "buffers" component of a VertexLayout based on the GLTF BufferViews
        // @NOTE: Interleaving vertex data is optimal, and will result in less BufferViews
        for (let i = 0; i < gltf.bufferViews.length; i++) {
            vertexLayoutBuffers[i] = {
                stride: gltf.bufferViews[i].byteStride || 0,
                layout: {}
            }
        }

        // @HACK
        const meshes: Model[] = [];
        if (gltf.meshes) {
            for (let mesh of gltf.meshes) {
                let primitives = [];
                const uniformBuffer = new UniformBuffer('GltfPrimUniformBuf', renderer, GltfShader.uniformLayout);

                for (let prim of mesh.primitives) {
                    // @TODO: Material
                    // @TODO: Mode
                    // @TODO: Targets

                    let vertexCount;
                    const vertexLayout: Gfx.VertexLayout = {
                        buffers: vertexLayoutBuffers,
                    };

                    // Fill out the VertexLayout based on the primitive's attributes
                    for (let gltfAttribName in prim.attributes) {
                        const accessor = gltf.accessors[prim.attributes[gltfAttribName]];
                        assert(accessor.bufferView !== undefined, 'Undefined accessor buffers are not yet implemented');
                        vertexCount = accessor.count;
                        
                        const attribName = GLTF_VERTEX_ATTRIBUTES[gltfAttribName];
                        vertexLayout.buffers[accessor.bufferView!].layout[attribName] = {
                            type: translateAccessorToType(accessor.type, accessor.componentType),
                            offset: accessor.byteOffset || 0,
                        }
                    }

                    // @TODO: Parse this from the primitive/mesh/material
                    const renderFormat: Gfx.RenderFormat = { blendingEnabled: false };

                    // @TODO: Cache and reuse these 
                    const pipeline = renderer.createRenderPipeline(this.shader, renderFormat, vertexLayout, GltfShader.resourceLayout);

                    const resourceTable = renderer.createResourceTable(pipeline);

                    // Set all buffer views which provide vertex attributes
                    for (let i = 0; i < gpuBuffers.length; i++) {
                        if (Object.keys(vertexLayout.buffers[i].layout).length > 0)
                            renderer.setBuffer(resourceTable, gpuBuffers[i], i);
                    }

                    // Set uniform buffers
                    renderer.setBuffer(resourceTable, this.globalUniforms.buffer, 0);
                    renderer.setBuffer(resourceTable, uniformBuffer.getBuffer(), 1);

                    // Set material parameters
                    if (defined(prim.material)) {
                        const material = gpuMaterials[prim.material];
                        const tex = assertDefined(material.baseColorTexture);
                        renderer.setTexture(resourceTable, tex, 0);
                    }

                    // renderer.setTexture(resourceTable )

                    // @TODO: For now, only indexed primitives are supported
                    assertDefined(prim.indices);
                    const indices = prim.indices as number;

                    const gfxPrim: RenderPrimitive = {
                        elementCount: defined(prim.indices) ? gltf.accessors[indices].count : vertexCount as number,
                        renderPipeline: pipeline,
                        resourceTable,
                        type: translateModeToPrimitiveType(defaultValue(prim.mode, 4)),
                        indexType: translateAccessorToType(gltf.accessors[indices].type, gltf.accessors[indices].componentType),
                        indexBuffer: !defined(indices) ? undefined : {
                            bufferId: gpuBuffers[gltf.accessors[indices].bufferView!],
                            byteLength: gltf.bufferViews[gltf.accessors[indices].bufferView!].byteLength
                        }
                    }

                    primitives.push(gfxPrim);
                }

                meshes.push({
                    primitives,
                    uniformBuffer
                });
            }
        }

        console.log(meshes);
        return meshes;
    }
}

async function loadImage(data: ArrayBufferView, mimeType: string): Promise<HTMLImageElement | ImageBitmap> {
    const blob = new Blob([data], { type: mimeType });
    
    // ImageBitmap can decode PNG/JPEG on workers, but Safari doesn't support it
    if (defined(self.createImageBitmap)) {
        return createImageBitmap(blob);
    } else {
        return new Promise(resolve => {
            const dataUrl = window.URL.createObjectURL(blob);
            const img = document.createElement('img');
            img.onload = () => resolve(img);
            img.src = dataUrl;
        })
    }
}

function translateAccessorToType(type: string, componentType: number): Gfx.Type {
    let gfxType: Gfx.Type;

    switch (componentType) {
        case 5120: gfxType = Gfx.Type.Char; break;
        case 5121: gfxType = Gfx.Type.Uchar; break;
        case 5122: gfxType = Gfx.Type.Short; break;
        case 5123: gfxType = Gfx.Type.Ushort; break;
        case 5125: gfxType = Gfx.Type.Uint; break;
        case 5126: gfxType = Gfx.Type.Float; break;
        default: throw new Error('Invalid GLTF component type');
    }

    switch (type) {
        case 'SCALAR': gfxType += 0; break;
        case 'VEC2': gfxType += 1; break;
        case 'VEC3': gfxType += 2; break;
        case 'VEC4': gfxType += 3; break;
        case 'MAT2': throw new Error('2x2 Matrice not yet supported');
        case 'MAT3': gfxType = Gfx.Type.Float3x3; break;
        case 'MAT4': gfxType = Gfx.Type.Float4x4; break;
    }

    return gfxType;
}

function translateModeToPrimitiveType(mode: number): Gfx.PrimitiveType {
    switch (mode) {
        case 0: return Gfx.PrimitiveType.Points;
        case 1: return Gfx.PrimitiveType.Lines;
        case 2: return Gfx.PrimitiveType.LineLoop;
        case 3: return Gfx.PrimitiveType.LineStrip;
        case 4: return Gfx.PrimitiveType.Triangles;
        case 5: return Gfx.PrimitiveType.TriangleStrip;
        case 6: return Gfx.PrimitiveType.TriangleFan;
        default: throw new Error('Invalid GLTF primitive mode');
    }
}

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

// Remap GLTF vertex attribute names to our own
const GLTF_VERTEX_ATTRIBUTES: { [index: string]: string } = {
    POSITION: 'a_pos',
    NORMAL: 'a_normal',
    TANGENT: 'a_tangent',
    JOINTS_0: 'a_joints',
    WEIGHTS_0: 'a_weights',
    COLOR_0: 'a_color',
    TEXCOORD_0: 'a_uv0',
    TEXCOORD_1: 'a_uv1',
};