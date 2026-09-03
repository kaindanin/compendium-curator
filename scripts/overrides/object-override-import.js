import {
    ObjectOverrideResolver
} from "./object-override-resolver.js";
import {
    ObjectOverrideStorageService
} from "./object-override-storage-service.js";
import { MODULE_ID } from "../settings.js";


function clone(value) {
    return structuredClone(value);
}


export function compendiumSourceUuid(source) {
    // Foundry 14 imports use _stats; retain legacy flags for older sources.
    for (const value of [
        source?._stats?.compendiumSource,
        source?.flags?.core?.sourceId,
        source?.flags?.core?.sourceUuid
    ]) {
        const uuid = String(value ?? "").trim();

        if (uuid.startsWith("Compendium."))
            return uuid;
    }

    return null;
}


/**
 * Materialize an override only for the newly-created embedded Item. The source
 * document remains untouched and the resulting Actor Item has no dependency on
 * Curator at runtime.
 */
export function materializeItemOverride(
    source,
    { storage = ObjectOverrideStorageService } = {}
) {
    // An inventory copy is a snapshot, even when no override existed at import.
    // Passing it to another Actor must preserve subsequent inventory edits.
    if (source?.flags?.[MODULE_ID]?.objectOverrideDetached)
        return null;

    const duplicateSource = String(source?._stats?.duplicateSource ?? "");

    if (duplicateSource && !duplicateSource.startsWith("Compendium."))
        return null;

    const sourceUuid = compendiumSourceUuid(source);

    if (!sourceUuid)
        return null;

    const resolved = ObjectOverrideResolver.resolveDocument(
        {
            uuid: sourceUuid,
            documentName: "Item",
            type: source?.type ?? null,
            toObject() {
                return clone(source);
            }
        },
        { storage }
    );

    const snapshot = resolved.source;
    snapshot.flags ??= {};
    snapshot.flags[MODULE_ID] ??= {};
    snapshot.flags[MODULE_ID].objectOverrideDetached = true;
    return snapshot;
}


export function registerObjectOverrideActorImport() {
    Hooks.on("preCreateItem", document => {
        if (document?.parent?.documentName !== "Actor")
            return;

        const resolved = materializeItemOverride(
            document.toObject()
        );

        if (resolved)
            document.updateSource(resolved, { recursive: false });
    });
}
