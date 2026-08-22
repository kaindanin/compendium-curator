import { MODULE_ID } from "../settings.js";
import {
    TableProfileStorageService
} from "../services/table-profile-storage-service.js";

const ITEM_PILES_READY_HOOK =
    "item-piles-ready";
const ITEM_PILES_PRE_REFRESH_HOOK =
    "item-piles-preRefreshInventory";
const WRAPPED_API = Symbol.for(
    "compendium-curator.item-piles-api"
);
const WRAPPED_ADD_API = Symbol.for(
    "compendium-curator.item-piles-add-api"
);
const APPLIED_COMMIT = Symbol.for(
    "compendium-curator.item-piles-commit"
);
const APPLIED_ENTRY = Symbol.for(
    "compendium-curator.item-piles-entry"
);

let integrationRegistered = false;

function normalizePositiveInteger(
    value,
    fallback = 1
) {
    const parsed = Number.parseInt(value, 10);

    return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : fallback;
}

function getProfileQuantityRange(profile) {
    const minimum = normalizePositiveInteger(
        profile?.draw?.quantityMin,
        1
    );
    const maximum = Math.max(
        minimum,
        normalizePositiveInteger(
            profile?.draw?.quantityMax,
            minimum
        )
    );

    return {
        minimum,
        maximum
    };
}

function getResultQuantityRange(entry) {
    const flags = entry?.flags?.[MODULE_ID];

    if (!flags)
        return null;

    const minimum = normalizePositiveInteger(
        flags.quantityMin,
        1
    );
    const maximum = Math.max(
        minimum,
        normalizePositiveInteger(
            flags.quantityMax,
            minimum
        )
    );

    return {
        minimum,
        maximum
    };
}

function rangesEqual(left, right) {
    return (
        left?.minimum === right?.minimum &&
        left?.maximum === right?.maximum
    );
}

function normalizeSignaturePart(value) {
    return String(value ?? "")
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase();
}

function getItemSignature(item) {
    const name = normalizeSignaturePart(
        item?.name
    );
    const type = normalizeSignaturePart(
        item?.type
    );
    const identifier = normalizeSignaturePart(
        item?.system?.identifier
    );

    if (!name)
        return "";

    return `${type}|${identifier}|${name}`;
}

function setMatcherValue(map, key, range) {
    if (!key)
        return;

    if (!map.has(key)) {
        map.set(key, range);
        return;
    }

    const existing = map.get(key);

    if (!rangesEqual(existing, range)) {
        map.set(key, null);
    }
}

function resolveTable(tableReference) {
    if (
        tableReference?.documentName ===
            "RollTable"
    ) {
        return tableReference;
    }

    const value = String(
        tableReference?.uuid ??
        tableReference ??
        ""
    ).trim();

    if (!value)
        return null;

    try {
        const document = fromUuidSync(value);

        if (document?.documentName === "RollTable")
            return document;
    }
    catch {
        // Continúa con los identificadores de mundo.
    }

    return (
        game.tables.get(value) ??
        game.tables.getName(value) ??
        null
    );
}

function collectTableMatchers(
    table,
    profiles,
    matchers,
    activeTableUuids = new Set()
) {
    if (
        table?.documentName !== "RollTable" ||
        activeTableUuids.has(table.uuid)
    ) {
        return;
    }

    const tableFlags =
        table.flags?.[MODULE_ID];

    if (tableFlags?.managed !== true)
        return;

    const profile = profiles?.[
        tableFlags.profileId
    ];
    const range =
        getProfileQuantityRange(profile);
    const nextActive = new Set(
        activeTableUuids
    );
    nextActive.add(table.uuid);

    for (const result of table.results ?? []) {
        const uuid = String(
            result?.documentUuid ?? ""
        ).trim();

        if (!uuid)
            continue;

        let document = null;

        try {
            document = fromUuidSync(uuid);
        }
        catch {
            document = null;
        }

        if (
            document?.documentName ===
                "RollTable"
        ) {
            collectTableMatchers(
                document,
                profiles,
                matchers,
                nextActive
            );
            continue;
        }

        if (document?.documentName !== "Item")
            continue;

        setMatcherValue(
            matchers.byUuid,
            uuid,
            range
        );
        setMatcherValue(
            matchers.byId,
            uuid.split(".").at(-1),
            range
        );
        setMatcherValue(
            matchers.bySignature,
            getItemSignature(document),
            range
        );
    }
}

function buildTableMatchers(
    tableConfigurations
) {
    const matchers = {
        byUuid: new Map(),
        byId: new Map(),
        bySignature: new Map()
    };
    const profiles =
        TableProfileStorageService.getProfiles();

    for (
        const configuration
        of Array.isArray(tableConfigurations)
            ? tableConfigurations
            : []
    ) {
        const table = resolveTable(
            configuration?.uuid ??
            configuration
        );

        collectTableMatchers(
            table,
            profiles,
            matchers
        );
    }

    return matchers;
}

function getItemSourceUuid(item) {
    return String(
        item?._stats?.compendiumSource ??
        item?.flags?.core?.sourceId ??
        ""
    ).trim();
}

function getMatchingRange(item, matchers) {
    const sourceUuid =
        getItemSourceUuid(item);
    const direct = sourceUuid
        ? matchers.byUuid.get(sourceUuid)
        : null;

    if (direct)
        return direct;

    const itemId = String(
        item?._id ?? item?.id ?? ""
    ).trim();
    const byId = itemId
        ? matchers.byId.get(itemId)
        : null;

    if (byId)
        return byId;

    const signature =
        getItemSignature(item);

    return signature
        ? matchers.bySignature.get(signature) ?? null
        : null;
}

function randomStockQuantity(
    minimum,
    maximum,
    random
) {
    if (maximum <= minimum)
        return minimum;

    return minimum + Math.floor(
        random() *
        (maximum - minimum + 1)
    );
}

function expandOccurrenceQuantity(
    occurrences,
    range,
    random
) {
    let quantity = 0;

    for (
        let index = 0;
        index < occurrences;
        index++
    ) {
        quantity += randomStockQuantity(
            range.minimum,
            range.maximum,
            random
        );
    }

    return quantity;
}

function getQuantityPath() {
    return String(
        game.itempiles?.API
            ?.ITEM_QUANTITY_ATTRIBUTE ??
        "system.quantity"
    );
}

function getItemQuantity(item, path) {
    return Math.max(
        0,
        Number.parseInt(
            foundry.utils.getProperty(
                item,
                path
            ),
            10
        ) || 0
    );
}

function setItemQuantity(item, path, quantity) {
    foundry.utils.setProperty(
        item,
        path,
        quantity
    );
}

export function applyItemPilesRollQuantities(
    entries,
    {
        tableConfigurations = [],
        random = Math.random
    } = {}
) {
    if (!Array.isArray(entries))
        return 0;

    const matchers = buildTableMatchers(
        tableConfigurations
    );
    let adjusted = 0;

    for (const entry of entries) {
        if (entry?.[APPLIED_ENTRY])
            continue;

        const range =
            getResultQuantityRange(entry) ??
            getMatchingRange(
                entry?.item,
                matchers
            );

        if (
            !range ||
            (
                range.minimum === 1 &&
                range.maximum === 1
            )
        ) {
            continue;
        }

        const occurrences = Math.max(
            1,
            normalizePositiveInteger(
                entry.quantity,
                1
            )
        );

        entry.quantity =
            expandOccurrenceQuantity(
                occurrences,
                range,
                random
            );

        try {
            Object.defineProperty(
                entry,
                APPLIED_ENTRY,
                { value: true }
            );
        }
        catch {
            // El resultado puede estar sellado.
        }

        adjusted++;
    }

    return adjusted;
}

export function applyItemPilesStockQuantities(
    actor,
    commit,
    {
        tableConfigurations = null,
        random = Math.random
    } = {}
) {
    if (!commit || commit[APPLIED_COMMIT])
        return 0;

    const configuredTables =
        tableConfigurations ??
        game.itempiles?.API
            ?.getActorFlagData(actor)
            ?.tablesForPopulate ??
        [];
    const matchers = buildTableMatchers(
        configuredTables
    );
    const quantityPath = getQuantityPath();
    const deltas = new Map(
        (commit.itemDeltas ?? [])
            .map(delta => [
                String(
                    delta?.item?._id ??
                    delta?.item?.id ??
                    ""
                ),
                delta
            ])
            .filter(([id]) => id)
    );
    let adjusted = 0;

    for (const item of commit.itemsToCreate ?? []) {
        const range = getMatchingRange(
            item,
            matchers
        );

        if (
            !range ||
            (
                range.minimum === 1 &&
                range.maximum === 1
            )
        ) {
            continue;
        }

        const occurrences = Math.max(
            1,
            getItemQuantity(item, quantityPath)
        );
        const quantity = expandOccurrenceQuantity(
            occurrences,
            range,
            random
        );

        setItemQuantity(
            item,
            quantityPath,
            quantity
        );
        adjusted++;
    }

    for (const update of commit.itemsToUpdate ?? []) {
        const itemId = String(
            update?._id ?? ""
        );
        const existing =
            actor?.items?.get?.(itemId) ??
            update;
        const range = getMatchingRange(
            existing,
            matchers
        );

        if (
            !range ||
            (
                range.minimum === 1 &&
                range.maximum === 1
            )
        ) {
            continue;
        }

        const currentQuantity = getItemQuantity(
            existing,
            quantityPath
        );
        const delta = deltas.get(itemId);
        const occurrences = Math.max(
            0,
            delta
                ? currentQuantity +
                    Number(delta.quantity ?? 0)
                : getItemQuantity(
                    update,
                    quantityPath
                )
        );

        if (occurrences <= 0)
            continue;

        const quantity = expandOccurrenceQuantity(
            occurrences,
            range,
            random
        );

        setItemQuantity(
            update,
            quantityPath,
            quantity
        );

        if (delta) {
            delta.quantity =
                quantity - currentQuantity;
            setItemQuantity(
                delta.item,
                quantityPath,
                delta.quantity
            );
        }

        adjusted++;
    }

    try {
        Object.defineProperty(
            commit,
            APPLIED_COMMIT,
            { value: true }
        );
    }
    catch {
        // El objeto del hook puede estar sellado.
    }

    return adjusted;
}

function wrapItemPilesRollApi(api) {
    if (
        typeof api.rollItemTable !== "function" ||
        api.rollItemTable[WRAPPED_API]
    ) {
        return;
    }

    const original = api.rollItemTable;
    const wrapped = async function(
        table,
        options = {}
    ) {
        const entries = await original.call(
            this,
            table,
            options
        );

        if (!options?.targetActor) {
            const resolved = resolveTable(table);

            applyItemPilesRollQuantities(
                entries,
                {
                    tableConfigurations:
                        resolved
                            ? [{ uuid: resolved.uuid }]
                            : []
                }
            );
        }

        return entries;
    };

    Object.defineProperty(
        wrapped,
        WRAPPED_API,
        { value: true }
    );
    Object.defineProperty(
        wrapped,
        "original",
        { value: original }
    );
    api.rollItemTable = wrapped;
}

function wrapItemPilesAddItemsApi(api) {
    if (
        typeof api.addItems !== "function" ||
        api.addItems[WRAPPED_ADD_API]
    ) {
        return;
    }

    const original = api.addItems;
    const wrapped = function(
        target,
        items,
        options = {}
    ) {
        applyItemPilesRollQuantities(items);

        return original.call(
            this,
            target,
            items,
            options
        );
    };

    Object.defineProperty(
        wrapped,
        WRAPPED_ADD_API,
        { value: true }
    );
    Object.defineProperty(
        wrapped,
        "original",
        { value: original }
    );
    api.addItems = wrapped;
}

function wrapItemPilesApis() {
    const api = game.itempiles?.API;

    if (
        !game.modules.get("item-piles")?.active ||
        !api
    ) {
        return;
    }

    wrapItemPilesRollApi(api);
    wrapItemPilesAddItemsApi(api);
}

export function registerItemPilesIntegration() {
    if (integrationRegistered)
        return;

    integrationRegistered = true;

    Hooks.on(
        ITEM_PILES_PRE_REFRESH_HOOK,
        (actor, commit) => {
            try {
                applyItemPilesStockQuantities(
                    actor,
                    commit
                );
            }
            catch (error) {
                console.error(
                    "Compendium Curator | No se pudieron aplicar las cantidades de stock a Item Piles.",
                    error
                );
            }
        }
    );

    Hooks.once(
        ITEM_PILES_READY_HOOK,
        wrapItemPilesApis
    );
    Hooks.once(
        "ready",
        wrapItemPilesApis
    );
}
