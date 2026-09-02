import {
    ObjectOverridePatchEngine
} from "./object-override-patch-engine.js";


function clone(value) {
    return structuredClone(value);
}


export class CuratorOverrideSession {
    constructor(
        originalSource,
        {
            sourceUuid = null,
            appliedPatch = []
        } = {}
    ) {
        this.sourceUuid = sourceUuid;
        this._originalSource = clone(originalSource);
        this._appliedSource = ObjectOverridePatchEngine.apply(
            this._originalSource,
            appliedPatch
        );
        this._workingSource = clone(this._appliedSource);
        this._editBaseline = null;
        this._editing = false;
        this._disposed = false;
    }


    static fromDocument(document, options = {}) {
        return new this(
            document.toObject(),
            {
                ...options,
                sourceUuid: document.uuid
            }
        );
    }


    get editing() {
        return this._editing;
    }


    get disposed() {
        return this._disposed;
    }


    get originalSource() {
        return clone(this._originalSource);
    }


    get appliedSource() {
        return clone(this._appliedSource);
    }


    get workingSource() {
        return clone(this._workingSource);
    }


    get patch() {
        return this.getPatch();
    }


    get appliedPatch() {
        return this.getPatch({ applied: true });
    }


    _assertOpen() {
        if (this._disposed)
            throw new Error("The Object Override session is closed.");
    }


    beginEditing() {
        this._assertOpen();

        if (this._editing)
            return;

        this._editBaseline = clone(this._appliedSource);
        this._workingSource = clone(this._appliedSource);
        this._editing = true;
    }


    captureWorkingSource(source) {
        this._assertOpen();
        this._workingSource = clone(source);
    }


    setField(path, value) {
        this._assertOpen();
        this._workingSource = ObjectOverridePatchEngine.set(
            this._workingSource,
            path,
            value
        );
    }


    removeField(path) {
        this._assertOpen();
        this._workingSource = ObjectOverridePatchEngine.remove(
            this._workingSource,
            path
        );
    }


    resetField(path) {
        this._assertOpen();

        const original = ObjectOverridePatchEngine.get(
            this._originalSource,
            path
        );

        if (original.exists)
            this.setField(path, original.value);
        else
            this.removeField(path);
    }


    resetAll() {
        this._assertOpen();
        this._workingSource = clone(this._originalSource);
    }


    apply() {
        this._assertOpen();
        this._appliedSource = clone(this._workingSource);
        this._editBaseline = null;
        this._editing = false;
        return this.appliedPatch;
    }


    cancel() {
        this._assertOpen();

        this._workingSource = clone(
            this._editBaseline ?? this._appliedSource
        );
        this._editBaseline = null;
        this._editing = false;
    }


    hasDifference(path, { applied = false } = {}) {
        this._assertOpen();

        const original = ObjectOverridePatchEngine.get(
            this._originalSource,
            path
        );
        const candidate = ObjectOverridePatchEngine.get(
            applied
                ? this._appliedSource
                : this._workingSource,
            path
        );

        return original.exists !== candidate.exists ||
            !ObjectOverridePatchEngine.equals(
                original.value,
                candidate.value
            );
    }


    getPatch({ applied = false } = {}) {
        this._assertOpen();

        return ObjectOverridePatchEngine.diff(
            this._originalSource,
            applied
                ? this._appliedSource
                : this._workingSource
        );
    }


    dispose() {
        this._originalSource = null;
        this._appliedSource = null;
        this._workingSource = null;
        this._editBaseline = null;
        this._editing = false;
        this._disposed = true;
    }
}
