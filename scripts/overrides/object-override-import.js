import {
    ObjectOverrideResolver
} from "./object-override-resolver.js";
import {
    ObjectOverrideStorageService
} from "./object-override-storage-service.js";


function clone(value) {
    return structuredClone(value);
}


export function compendiumSourceUuid(source) {
    const uuid = String(
        source?.flags?.core?.sourceId ??
        source?.flags?.core?.sourceUuid ??
        ""
    ).trim();

    return uuid.startsWith("Compendium.")
        ? uuid
        : null;
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

    return resolved.patch.length
        ? resolved.source
        : null;
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
