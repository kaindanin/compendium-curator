import {
    ObjectOverrideResolver
} from "./object-override-resolver.js";
import {
    ObjectOverrideStorageService
} from "./object-override-storage-service.js";


function indexSource(entry) {
    return entry?.toObject?.() ?? structuredClone(entry ?? {});
}


function entryId(entry) {
    return String(entry?._id ?? entry?.id ?? "").trim();
}


function documentUuid(pack, entry) {
    const id = entryId(entry);
    const collection = String(pack?.collection ?? "").trim();
    const documentName = String(pack?.documentName ?? "").trim();

    if (!id || !collection || !documentName)
        return null;

    return `Compendium.${collection}.${documentName}.${id}`;
}


function storageSnapshot(storage = ObjectOverrideStorageService) {
    const records = storage.getStorage?.().overrides ?? {};

    return {
        get(uuid) {
            return records[uuid] ?? null;
        }
    };
}


/**
 * Resolve a pack index entry without loading its document. This is deliberately
 * a display projection: it never mutates the pack index or the original source.
 */
export function resolveCompendiumIndexEntry(
    pack,
    entry,
    { storage = ObjectOverrideStorageService } = {}
) {
    const uuid = documentUuid(pack, entry);

    if (!uuid)
        return null;

    const document = {
        uuid,
        documentName: pack.documentName,
        type: entry?.type ?? null,
        toObject() {
            return indexSource(entry);
        }
    };

    return ObjectOverrideResolver.resolveDocument(
        document,
        { storage }
    );
}


export function findCompendiumIndexEntry(uuid) {
    const value = String(uuid ?? "").trim();

    if (!value.startsWith("Compendium."))
        return null;

    for (const pack of game.packs) {
        const prefix = `Compendium.${pack.collection}.`;

        if (!value.startsWith(prefix))
            continue;

        const suffix = value.slice(prefix.length);
        const documentPrefix = `${pack.documentName}.`;

        if (!suffix.startsWith(documentPrefix))
            continue;

        const entry = pack.index.get(
            suffix.slice(documentPrefix.length)
        );

        return entry ? { pack, entry } : null;
    }

    return null;
}


export function projectCompendiumEntryElement(element, resolved) {
    if (!element || !resolved?.patch?.length)
        return false;

    const { source } = resolved;
    const name = String(source?.name ?? "").trim();
    const image = String(source?.img ?? "").trim();

    if (name) {
        const label = element.querySelector(
            ".entry-name, .name .title, h3, h4, .name"
        );

        if (label)
            label.textContent = name;

        element.querySelector("img")?.setAttribute("alt", name);
    }

    if (image)
        element.querySelector("img")?.setAttribute("src", image);

    element.dataset.ccOverride = "true";
    return true;
}


async function projectCompendiumBrowserTooltip(
    element,
    pack,
    entry,
    storage
) {
    if (pack?.documentName !== "Item")
        return;

    try {
        const original = await pack.getDocument(entryId(entry));

        if (!original || !element.isConnected)
            return;

        const resolved = ObjectOverrideResolver.resolveDocument(
            original,
            { storage }
        );

        if (!resolved.patch.length)
            return;

        const ItemClass = CONFIG.Item.documentClass;
        const synthetic = new ItemClass(
            resolved.source,
            { pack: pack.collection }
        );
        const tooltip = await (
            synthetic.richTooltip?.() ??
            synthetic.system?.richTooltip?.()
        );

        if (!tooltip?.content || !element.isConnected)
            return;

        element.dataset.tooltip = tooltip.content;
        element.dataset.tooltipClass = tooltip.classes?.join(" ") ??
            "dnd5e2 dnd5e-tooltip item-tooltip themed theme-light";
    }
    catch (error) {
        console.warn(
            "Compendium Curator | Override tooltip projection failed",
            error
        );
    }
}


export function projectCompendiumDirectory(root, pack) {
    const storage = storageSnapshot();

    for (const element of root?.querySelectorAll?.(
        ".directory-item.entry[data-entry-id]"
    ) ?? []) {
        const entry = pack?.index?.get(element.dataset.entryId);

        if (!entry)
            continue;

        projectCompendiumEntryElement(
            element,
            resolveCompendiumIndexEntry(pack, entry, { storage })
        );
    }
}


export function projectCompendiumBrowserResults(root) {
    const storage = storageSnapshot();

    for (const element of root?.querySelectorAll?.(
        ".item[data-uuid]"
    ) ?? []) {
        const found = findCompendiumIndexEntry(element.dataset.uuid);

        if (!found)
            continue;

        const resolved = resolveCompendiumIndexEntry(
            found.pack,
            found.entry,
            { storage }
        );

        projectCompendiumEntryElement(
            element,
            resolved
        );

        if (resolved?.patch?.length) {
            void projectCompendiumBrowserTooltip(
                element,
                found.pack,
                found.entry,
                storage
            );
        }
    }
}


export {
    documentUuid,
    indexSource,
    projectCompendiumBrowserTooltip,
    storageSnapshot
};
