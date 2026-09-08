import { ObjectOverridePatchEngine } from "./object-override-patch-engine.js";
import { ObjectOverrideResolver } from "./object-override-resolver.js";

const ATOMIC_PATHS = ["effects", "system.activities", "system.advancement"];

const SUMMARY_PATHS = [
    "system.source", "name", "img", "system.rarity", "system.quantity", "system.weight", "system.price"
];

const DETAIL_PATHS = [
    "system.type", "system.level", "system.school", "system.proficient", "system.mastery", "system.properties",
    "system.armor", "system.strength", "system.attuned", "system.attunement", "system.magicalBonus",
    "system.ammunition", "system.damage", "system.range", "system.activation", "system.duration", "system.target",
    "system.materials", "system.method", "system.prepared", "system.ability", "system.sourceItem", "system.uses",
    "system.recharge", "system.identifier"
];

const SECTION_ORDER = ["description", "details", "activities", "effects", "advancement"];

const SECTION_PATHS = {
    description: ["system.description.value", "system.unidentified.description", "system.description.unidentified", "system.description.chat"],
    details: DETAIL_PATHS,
    activities: ["system.activities"],
    effects: ["effects"],
    advancement: ["system.advancement"]
};

function normalizedPath(path) {
    return String(path || "").replace(/^\//, "").replaceAll("/", ".");
}

function matchesPath(path, prefix) {
    return path === prefix || path.startsWith(`${prefix}.`);
}

function pathRank(path, paths) {
    const index = paths.findIndex(prefix => matchesPath(path, prefix));
    return index === -1 ? paths.length : index;
}

function sectionForPath(path) {
    if (matchesPath(path, "system.description") || matchesPath(path, "system.unidentified.description")) return "description";
    if (matchesPath(path, "system.activities")) return "activities";
    if (matchesPath(path, "effects")) return "effects";
    if (matchesPath(path, "system.advancement")) return "advancement";
    return "details";
}

function isRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function sameValue(before, after) {
    if (Object.is(before, after)) return true;
    if (before instanceof Set || after instanceof Set) {
        if (!(before instanceof Set) || !(after instanceof Set) || before.size !== after.size) return false;
        return [...before].every(value => [...after].some(candidate => sameValue(value, candidate)));
    }
    if (before instanceof Map || after instanceof Map) {
        if (!(before instanceof Map) || !(after instanceof Map) || before.size !== after.size) return false;
        return [...before].every(([key, value]) => after.has(key) && sameValue(value, after.get(key)));
    }
    if (Array.isArray(before) || Array.isArray(after))
        return Array.isArray(before) && Array.isArray(after) && before.length === after.length
            && before.every((value, index) => sameValue(value, after[index]));
    if (!isRecord(before) || !isRecord(after)) return false;
    const beforeKeys = Object.keys(before);
    return beforeKeys.length === Object.keys(after).length
        && beforeKeys.every(key => Object.hasOwn(after, key) && sameValue(before[key], after[key]));
}

function entityEntries(value) {
    if (Array.isArray(value)) return value.map((entry, index) => [String(entry?._id ?? entry?.id ?? entry?.name ?? index), entry]);
    if (value instanceof Map) return [...value.entries()].map(([key, entry]) => [String(key), entry]);
    if (isRecord(value)) return Object.entries(value).filter(([, entry]) => isRecord(entry));
    return [];
}

function collectChangedLeaves(before, after, path, leaves) {
    if (sameValue(before, after)) return;
    if (Array.isArray(before) || Array.isArray(after)) {
        const beforeArray = Array.isArray(before) ? before : [];
        const afterArray = Array.isArray(after) ? after : [];
        const containsStructure = [...beforeArray, ...afterArray]
            .some(value => isRecord(value) || Array.isArray(value) || value instanceof Map || value instanceof Set);
        if (!containsStructure) {
            leaves.push({ path, before, after });
            return;
        }
        const length = Math.max(beforeArray.length, afterArray.length);
        for (let index = 0; index < length; index++)
            collectChangedLeaves(beforeArray[index], afterArray[index], [...path, String(index)], leaves);
        return;
    }
    if (isRecord(before) || isRecord(after)) {
        const beforeRecord = isRecord(before) ? before : {};
        const afterRecord = isRecord(after) ? after : {};
        for (const key of new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])) {
            if (key === "_id" || key === "id") continue;
            collectChangedLeaves(beforeRecord[key], afterRecord[key], [...path, key], leaves);
        }
        return;
    }
    leaves.push({ path, before, after });
}

/**
 * Produce a compact, data-only view of changes inside an atomic embedded
 * collection. Unlike the persisted patch this is solely presentation data:
 * each entry shows the leaves that changed, added, or disappeared.
 */
export function describeEmbeddedChanges(beforeState, afterState) {
    const beforeEntries = new Map(entityEntries(beforeState?.value));
    const afterEntries = new Map(entityEntries(afterState?.value));
    const keys = [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])];
    return keys.map(key => {
        const before = beforeEntries.get(key);
        const after = afterEntries.get(key);
        const leaves = [];
        collectChangedLeaves(before, after, [], leaves);
        const beforeName = String(before?.name ?? after?.name ?? key);
        const afterName = String(after?.name ?? before?.name ?? key);
        return {
            key,
            beforeName,
            afterName,
            fields: leaves.filter(field => !(field.path.length === 1 && field.path[0] === "name"))
        };
    }).filter(entry => entry.fields.length || entry.beforeName !== entry.afterName);
}

/**
 * Arrange changed fields in the same broad sequence as an ItemSheet5e: header,
 * then its native tabs. The result intentionally contains no localized text so
 * it can be covered by Node tests and localized only while rendering.
 */
export function organizeOverrideChanges(changes = []) {
    const indexed = changes.map((change, index) => ({ ...change, index, normalizedPath: normalizedPath(change.path) }));
    const summary = indexed.filter(change => pathRank(change.normalizedPath, SUMMARY_PATHS) < SUMMARY_PATHS.length)
        .sort((a, b) => pathRank(a.normalizedPath, SUMMARY_PATHS) - pathRank(b.normalizedPath, SUMMARY_PATHS)
            || a.index - b.index);
    const grouped = new Map(SECTION_ORDER.map(section => [section, []]));
    for (const change of indexed) {
        if (summary.includes(change)) continue;
        grouped.get(sectionForPath(change.normalizedPath)).push(change);
    }
    return {
        summary,
        sections: SECTION_ORDER.map(id => ({
            id,
            changes: grouped.get(id).sort((a, b) => {
                const paths = SECTION_PATHS[id];
                return pathRank(a.normalizedPath, paths) - pathRank(b.normalizedPath, paths) || a.index - b.index;
            })
        })).filter(section => section.changes.length)
    };
}

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
        uuid, record, packId, document,
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
