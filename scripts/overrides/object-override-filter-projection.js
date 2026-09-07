import {
    resolveCompendiumIndexEntry,
    storageSnapshot
} from "./object-override-projection.js";


const FILTER_WRAPPER = Symbol.for(
    "compendium-curator.objectOverrideFilterWrapper"
);
const OPERATOR_NAMES = new Set([
    "AND", "NAND", "OR", "NOR", "XOR", "NOT"
]);


function getProperty(object, path) {
    if (globalThis.foundry?.utils?.getProperty)
        return foundry.utils.getProperty(object, path);

    return String(path ?? "")
        .split(".")
        .filter(Boolean)
        .reduce((value, key) => value?.[key], object);
}


function valueType(value) {
    if (value instanceof Set)
        return "Set";
    if (Array.isArray(value))
        return "Array";
    if (value && typeof value === "object")
        return "Object";
    return typeof value;
}


function contains(data, value) {
    return String(data).includes(String(value));
}


function inCollection(data, value) {
    if (Array.isArray(value))
        return value.includes(data);
    if (value instanceof Set)
        return value.has(data);
    return false;
}


function collectionHas(data, value, language) {
    if (valueType(value) === "Object") {
        if (!Array.isArray(data) && !(data instanceof Set))
            return false;
        return Array.from(data).some(entry =>
            matchesDnd5eFilters(entry, value, language)
        );
    }

    return inCollection(value, data);
}


function compare(data, value, operation, language) {
    switch (operation ?? "_") {
        case "_":
        case "exact": return data === value;
        case "contains": return contains(data, value);
        case "icontains": return contains(
            String(data).toLocaleLowerCase(language),
            String(value).toLocaleLowerCase(language)
        );
        case "startswith": return String(data).startsWith(String(value));
        case "istartswith": return String(data)
            .toLocaleLowerCase(language)
            .startsWith(String(value).toLocaleLowerCase(language));
        case "endswith": return String(data).endsWith(String(value));
        case "has": return collectionHas(data, value, language);
        case "hasany": return Array.from(value ?? [])
            .some(entry => collectionHas(data, entry, language));
        case "hasall": return Array.from(value ?? [])
            .every(entry => collectionHas(data, entry, language));
        case "in": return inCollection(data, value);
        case "gt": return data > value;
        case "gte": return data >= value;
        case "lt": return data < value;
        case "lte": return data <= value;
        default: throw new Error(
            `Unsupported D&D5e filter comparison: ${operation}`
        );
    }
}


function check(data, filter, language) {
    const operation = filter?.o;

    if (OPERATOR_NAMES.has(operation)) {
        const values = operation === "NOT"
            ? [filter.v]
            : Array.from(filter.v ?? []);
        const results = values.map(value => check(data, value, language));

        switch (operation) {
            case "AND": return results.every(Boolean);
            case "NAND": return !results.every(Boolean);
            case "OR": return results.some(Boolean);
            case "NOR": return !results.some(Boolean);
            case "XOR": return results.reduce(
                (result, value) => Boolean(result) !== Boolean(value),
                false
            );
            case "NOT": return !results[0];
        }
    }

    return compare(
        getProperty(data, filter?.k),
        filter?.v,
        operation,
        language
    );
}


export function matchesDnd5eFilters(
    data,
    filters = [],
    language = globalThis.game?.i18n?.lang
) {
    if (Array.isArray(filters))
        return filters.every(filter => check(data, filter, language));

    return check(data, filters, language);
}


export function collectDnd5eFilterKeys(filters = []) {
    const keys = new Set();

    const visit = filter => {
        for (const value of Array.from(filter ?? [])) {
            if (OPERATOR_NAMES.has(value?.o)) {
                visit(value.o === "NOT" ? [value.v] : value.v);
                continue;
            }

            if (value?.k)
                keys.add(value.k);
        }
    };

    visit(filters);
    return keys;
}


function strictSlug(value) {
    const text = String(value ?? "");

    if (typeof text.slugify === "function")
        return text.slugify({ strict: true });

    return text.normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}


function packageTitle(pack) {
    const metadata = pack?.metadata ?? {};

    if (metadata.packageType === "module")
        return game.modules?.get(metadata.packageName)?.title ?? "";
    if (metadata.packageType === "system")
        return game.system?.title ?? "";
    if (metadata.packageType === "world")
        return game.world?.title ?? "";
    return "";
}


function prepareSource(entry, original, pack) {
    const source = entry?.system?.source;
    const baseline = original?.system?.source;

    if (!source || typeof source !== "object")
        return;

    if (
        source.book === baseline?.book &&
        source.custom === baseline?.custom
    ) {
        return;
    }

    const book = String(source.book ?? "").trim() ||
        String(pack?.metadata?.flags?.dnd5e?.sourceBook ?? "").trim();
    const value = book || packageTitle(pack);

    source.book = book;
    source.value = value;
    source.label = String(source.custom ?? "").trim() || book;
    source.slug = strictSlug(value);
}


function packForEntry(entry) {
    const uuid = String(entry?.uuid ?? "");

    for (const pack of game.packs ?? []) {
        const prefix = `Compendium.${pack.collection}.${pack.documentName}.`;
        if (uuid.startsWith(prefix))
            return pack;
    }

    return null;
}


export function projectEffectiveBrowserEntry(entry, storage) {
    const pack = packForEntry(entry);

    if (!pack)
        return entry;

    const resolved = resolveCompendiumIndexEntry(
        pack,
        entry,
        { storage }
    );

    if (!resolved?.patch?.length)
        return entry;

    const effective = resolved.source;
    effective._id ??= entry._id ?? entry.id;
    effective.id ??= entry.id ?? entry._id;
    effective.uuid ??= entry.uuid;
    prepareSource(effective, resolved.originalSource, pack);
    return effective;
}


function hasRelevantOverrides(storage, documentClass) {
    const documentName = documentClass?.metadata?.name;

    return Object.values(storage?.getStorage?.().overrides ?? {})
        .some(record => !record.documentName || record.documentName === documentName);
}


function sortResults(results, sort) {
    if (!sort)
        return results;

    const criterion = sort === true ? "name" : sort;
    const comparator = typeof criterion === "function"
        ? criterion
        : (left, right) => String(getProperty(left, criterion))
            .localeCompare(
                String(getProperty(right, criterion)),
                game.i18n.lang
            );

    return results.sort(comparator);
}


export function installCompendiumBrowserOverrideFiltering(
    browserClass = game.dnd5e?.applications?.CompendiumBrowser
) {
    if (!browserClass?.fetch || browserClass.fetch[FILTER_WRAPPER])
        return false;

    const nativeFetch = browserClass.fetch;

    async function fetchWithOverrides(documentClass, options = {}) {
        const storage = storageSnapshot();
        const filters = Array.from(options.filters ?? []);

        if (
            options.index === false ||
            !filters.length ||
            !hasRelevantOverrides(storage, documentClass)
        ) {
            return nativeFetch.call(this, documentClass, options);
        }

        const indexFields = new Set(options.indexFields ?? []);
        for (const key of collectDnd5eFilterKeys(filters))
            indexFields.add(
                key === "system.source.slug" ? "system.source" : key
            );

        const originals = await nativeFetch.call(this, documentClass, {
            ...options,
            filters: [],
            index: true,
            indexFields,
            sort: false
        });
        const projected = originals
            .map(entry => projectEffectiveBrowserEntry(entry, storage))
            .filter(entry => matchesDnd5eFilters(entry, filters));

        return sortResults(projected, options.sort ?? true);
    }

    Object.defineProperty(fetchWithOverrides, FILTER_WRAPPER, {
        value: true
    });
    browserClass.fetch = fetchWithOverrides;
    return true;
}

