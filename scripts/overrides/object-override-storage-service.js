import {
    MODULE_ID,
    OBJECT_OVERRIDES_SETTING
} from "../settings.js";


const STORAGE_VERSION = 1;
const OPERATION_TYPES = new Set([
    "set",
    "remove",
    "replace"
]);
const RESERVED_KEYS = new Set([
    "__proto__",
    "prototype",
    "constructor"
]);


function clone(value) {
    return value === undefined
        ? undefined
        : structuredClone(value);
}


function isPlainObject(value) {
    if (!value || typeof value !== "object")
        return false;

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}


function normalizeBaseline(value) {
    if (
        !isPlainObject(value) ||
        typeof value.exists !== "boolean"
    ) {
        return undefined;
    }

    const baseline = { exists: value.exists };

    if (value.exists && Object.hasOwn(value, "value"))
        baseline.value = clone(value.value);

    return baseline;
}


function normalizeOperation(value) {
    if (
        !isPlainObject(value) ||
        !OPERATION_TYPES.has(value.op) ||
        typeof value.path !== "string" ||
        !value.path.startsWith("/")
    ) {
        return null;
    }

    const operation = {
        op: value.op,
        path: value.path
    };

    if (value.op !== "remove") {
        if (!Object.hasOwn(value, "value"))
            return null;

        operation.value = clone(value.value);
    }

    const baseline = normalizeBaseline(value.baseline);

    if (baseline)
        operation.baseline = baseline;

    return operation;
}


function normalizePatch(value) {
    if (!Array.isArray(value))
        return [];

    return value
        .map(normalizeOperation)
        .filter(Boolean);
}


export class ObjectOverrideStorageService {
    static normalizeStorage(value) {
        const storage = {
            version: STORAGE_VERSION,
            overrides: {}
        };

        if (!isPlainObject(value?.overrides))
            return storage;

        for (
            const [sourceUuid, sourceRecord]
            of Object.entries(value.overrides)
        ) {
            if (
                !sourceUuid.startsWith("Compendium.") ||
                RESERVED_KEYS.has(sourceUuid) ||
                !isPlainObject(sourceRecord)
            ) {
                continue;
            }

            const patch = normalizePatch(sourceRecord.patch);

            if (!patch.length)
                continue;

            storage.overrides[sourceUuid] = {
                version: 1,
                documentName: String(
                    sourceRecord.documentName ?? "Item"
                ).trim() || "Item",
                documentType: String(
                    sourceRecord.documentType ?? ""
                ).trim() || null,
                patch,
                updatedAt: Math.max(
                    0,
                    Number(sourceRecord.updatedAt) || 0
                )
            };
        }

        return storage;
    }


    static getStorage() {
        return this.normalizeStorage(
            game.settings.get(
                MODULE_ID,
                OBJECT_OVERRIDES_SETTING
            )
        );
    }


    static get(sourceUuid) {
        const record = this.getStorage()
            .overrides?.[sourceUuid];

        return record ? clone(record) : null;
    }


    static getPatch(sourceUuid) {
        return this.get(sourceUuid)?.patch ?? [];
    }


    static async initialize() {
        const current = game.settings.get(
            MODULE_ID,
            OBJECT_OVERRIDES_SETTING
        );
        const normalized = this.normalizeStorage(current);

        if (
            JSON.stringify(current) ===
            JSON.stringify(normalized)
        ) {
            return false;
        }

        await game.settings.set(
            MODULE_ID,
            OBJECT_OVERRIDES_SETTING,
            normalized
        );
        return true;
    }


    static async save(
        sourceUuid,
        patch,
        {
            documentName = "Item",
            documentType = null
        } = {}
    ) {
        const uuid = String(sourceUuid ?? "").trim();
        const normalizedPatch = normalizePatch(patch);

        if (!uuid.startsWith("Compendium."))
            throw new Error("INVALID_OBJECT_OVERRIDE_UUID");

        if (!normalizedPatch.length) {
            await this.remove(uuid);
            return null;
        }

        const storage = this.getStorage();

        storage.overrides[uuid] = {
            version: 1,
            documentName: String(documentName).trim() || "Item",
            documentType:
                String(documentType ?? "").trim() || null,
            patch: normalizedPatch,
            updatedAt: Date.now()
        };

        await game.settings.set(
            MODULE_ID,
            OBJECT_OVERRIDES_SETTING,
            storage
        );

        return clone(storage.overrides[uuid]);
    }


    static async remove(sourceUuid) {
        const uuid = String(sourceUuid ?? "").trim();
        const storage = this.getStorage();

        if (!Object.hasOwn(storage.overrides, uuid))
            return false;

        delete storage.overrides[uuid];

        await game.settings.set(
            MODULE_ID,
            OBJECT_OVERRIDES_SETTING,
            storage
        );
        return true;
    }
}


export {
    normalizeOperation,
    normalizePatch
};
