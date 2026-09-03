import {
    ObjectOverridePatchEngine
} from "./object-override-patch-engine.js";
import {
    ObjectOverrideStorageService
} from "./object-override-storage-service.js";


function clone(value) {
    return value === undefined
        ? undefined
        : structuredClone(value);
}


function documentMetadataMatches(document, record) {
    if (!document || !record)
        return false;

    if (
        record.documentName &&
        document.documentName &&
        record.documentName !== document.documentName
    ) {
        return false;
    }

    return !record.documentType ||
        !document.type ||
        record.documentType === document.type;
}


function safePatch(patch) {
    return Array.from(patch ?? []).filter(operation => {
        try {
            ObjectOverridePatchEngine.segments(operation?.path);
            return true;
        }
        catch (_error) {
            return false;
        }
    });
}


/**
 * The single, document-agnostic place where a stored Curator patch becomes
 * a resolved source. It deliberately returns plain source data: callers can
 * decide whether that source is used for a synthetic sheet, a directory row,
 * an index projection, or an embedded document import.
 */
export class ObjectOverrideResolver {
    static resolveSource(originalSource, patch = []) {
        return ObjectOverridePatchEngine.apply(
            clone(originalSource),
            patch
        );
    }


    static getRecord(document, {
        storage = ObjectOverrideStorageService
    } = {}) {
        const uuid = String(document?.uuid ?? "").trim();

        if (!uuid.startsWith("Compendium."))
            return null;

        const record = storage.get(uuid);

        if (!documentMetadataMatches(document, record))
            return null;

        const patch = safePatch(record.patch);

        return patch.length
            ? { ...record, patch }
            : null;
    }


    static resolveDocument(document, options = {}) {
        const originalSource = document?.toObject?.();

        if (!originalSource)
            throw new Error("A Foundry document with toObject() is required.");

        const record = this.getRecord(document, options);
        const patch = record?.patch ?? [];

        return {
            originalSource: clone(originalSource),
            source: this.resolveSource(originalSource, patch),
            patch: clone(patch),
            record: clone(record)
        };
    }
}


export {
    documentMetadataMatches,
    safePatch
};
