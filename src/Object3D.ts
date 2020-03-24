import { vec3, quat, mat4 } from "gl-matrix";
import { assert, assertDefined, defined } from "./util";

export interface IObject3D {
    name: string;

    position: vec3;
    rotation: quat;
    scale: vec3;

    matrix: mat4; // local space to parent space
    matrixWorld: mat4; // local space to world space (concatenation of all parents above this object)

    parent: Nullable<this>;
    children: this[];

    matrixWorldDirty: boolean;
    matrixDirty: boolean;
}

export class Object3D implements IObject3D {
    name: string;

    position: vec3;
    rotation: quat;
    scale: vec3;

    matrix: mat4; // local space to parent space
    matrixWorld: mat4; // local space to world space (concatenation of all parents above this object)

    parent: Nullable<this>;
    children: this[];

    matrixWorldDirty: boolean = true;
    matrixDirty: boolean = true;

    constructor() {
        this.name = '';

        this.position = vec3.create();
        this.rotation = quat.create();
        this.scale = vec3.fromValues(1, 1, 1);

        this.matrix = mat4.create();
        this.matrixWorld = mat4.create();

        this.parent = null;
        this.children = [];
    }

    updateMatrix() {
        mat4.fromRotationTranslationScale(this.matrix, this.rotation, this.position, this.scale);
        this.matrixWorldDirty = true;
    }

    updateMatrixWorld(updateParents: boolean, updateChildren: boolean) {
        const parent = this.parent;
        if (updateParents === true && defined(parent)) {
            parent.updateMatrixWorld(true, false);
        }

        if (!defined(this.parent)) {
            mat4.copy(this.matrixWorld, this.matrix);
        } else {
            mat4.multiply(this.matrixWorld, this.parent.matrixWorld, this.matrix);
        }

        if (updateChildren === true) {
            const children = this.children;
            for (let i = 0, l = children.length; i < l; i++) {
                children[i].updateMatrixWorld(false, true);
            }
        }
    }

    /**
	 * Adds object as child of this object.
	 */
    add(object: this, ...others: this[]): this {
        assertDefined(object);
        assert(object !== this, `Object can't be added as a child of itself`);

        if (object.parent !== null) {
            object.parent.remove(object);
        }

        object.parent = this;
        this.children.push(object);

        for (let i = 0; i < others.length; i++) {
            this.add(others[i]);
        }

        return this;
    }

	/**
	 * Removes object as child of this object.
	 */
    remove(object: this, ...others: this[]): this {
        const index = this.children.indexOf(object);

        if (index !== - 1) {
            object.parent = null;
            this.children.splice(index, 1);
        }

        return this;
    }

    clone(recursive?: boolean): this {
        return new (<any>this.constructor)().copy(this, recursive);
    }

    copy(source: this, recursive: boolean = true): this {
        this.name = source.name;
        

        vec3.copy(this.position, source.position);
        quat.copy(this.rotation, source.rotation);
        vec3.copy(this.scale, source.scale);

        this.matrix = mat4.copy(this.matrix, source.matrix);
        this.matrixWorld = mat4.copy(this.matrixWorld, source.matrixWorld);

        if (recursive === true) {
            for (var i = 0; i < source.children.length; i++) {
                const child = source.children[i];
                this.add(child.clone());
            }
        }

        return this;
    }
}