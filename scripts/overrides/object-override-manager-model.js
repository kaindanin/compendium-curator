import { ObjectOverridePatchEngine } from "./object-override-patch-engine.js";
import { ObjectOverrideResolver } from "./object-override-resolver.js";

const ATOMIC_PATHS = ["effects", "system.activities", "system.advancement"];

export function overridePackId(uuid) {
    return String(uuid).split(".").slice(1, 3).join(".");
}

function nativeFieldLabel(document, path) {
    try {
        const parts = ObjectOverridePatchEngine.segments(path);
        const schema = parts[0] === "system" ? document?.system?.schema : document?.schema;
        return schema?.getField?.((parts[0] === "system" ? parts.slice(1) : parts).join("."))?.label;
    }
    catch (_error) { return undefined; }
}

/** Read-only presentation data. Only documents with persisted patches are loaded. */
export function prepareOverrideRow(uuid, record, document, packLabel = "") {
    const packId = overridePackId(uuid);
    const original = document?.toObject?.();
    const resolved = original && ObjectOverrideResolver.resolveDocument(document, {
        storage: { get: () => record }
    });
    const source = resolved?.source;
    const nameChange = record.patch.find(operation => operation.path === "/name");
    const originalName = original?.name ?? nameChange?.baseline?.value ?? "";
    const changes = resolved
        ? ObjectOverridePatchEngine.diff(original, source, { atomicPaths: ATOMIC_PATHS })
        : record.patch;

    return {
        uuid, record, packId,
        packLabel: packLabel || packId,
        name: String((source?.name ?? nameChange?.value ?? originalName) || uuid),
        originalName: String(originalName),
        renamed: Boolean(originalName && source?.name !== originalName),
        img: source?.img || "icons/svg/item-bag.svg",
        type: source?.type || record.documentType || record.documentName,
        source: source?.system?.source?.custom || source?.system?.source?.book || "",
        available: Boolean(document),
        updatedAt: record.updatedAt,
        changes: changes.map(operation => ({
            path: operation.path,
            nativeLabel: nativeFieldLabel(document, operation.path),
            before: original
                ? ObjectOverridePatchEngine.get(original, operation.path)
                : operation.baseline,
            after: source
                ? ObjectOverridePatchEngine.get(source, operation.path)
                : { exists: operation.op !== "remove", value: operation.value }
        }))
    };
}

export async function loadOverrideRows(records, {
    loadDocument = uuid => fromUuid(uuid),
    packLabel = uuid => game.packs.get(overridePackId(uuid))?.metadata?.label
} = {}) {
    const entries = Object.entries(records).filter(([, record]) => record.patch?.length);
    const rows = new Array(entries.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
        while (next < entries.length) {
            const index = next++;
            const [uuid, record] = entries[index];
            let document;
            try { document = await loadDocument(uuid); }
            catch (_error) { /* Keep unavailable sources manageable without deleting their patches. */ }
            rows[index] = prepareOverrideRow(uuid, record, document, packLabel(uuid));
        }
    }));
    return rows;
}

function searchText(value) {
    return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}

export function filterOverrideRows(rows, { search = "", type = "", packId = "" } = {}) {
    const query = searchText(search.trim());
    return rows.filter(row =>
        (!type || row.type === type) &&
        (!packId || row.packId === packId) &&
        (!query || searchText(`${row.name}\n${row.originalName}`).includes(query))
    ).sort((a, b) => a.name.localeCompare(b.name) || a.uuid.localeCompare(b.uuid));
}
