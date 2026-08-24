import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";

const SUPPORTED_DOCUMENT_NAMES = new Set([
    "Item",
    "Actor"
]);

function normalizePositiveWeight(value, fallback = 1) {
    const parsed = Number(value);

    return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : fallback;
}

function getResultWeight(result) {
    const range = Array.from(result?.range ?? []);
    const start = Number(range[0]);
    const end = Number(range[1]);

    if (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end >= start
    ) {
        return Math.max(1, end - start + 1);
    }

    return normalizePositiveWeight(
        result?.weight,
        1
    );
}

function getTableTotalWeight(table) {
    return Array.from(table?.results ?? [])
        .reduce(
            (sum, result) =>
                sum + getResultWeight(result),
            0
        );
}

function getTextUuid(result) {
    const text = String(
        result?.description ??
        result?.text ??
        result?.name ??
        ""
    );
    const match = text.match(/@UUID\[([^\]]+)\]/i);

    return String(match?.[1] ?? "").trim();
}

function getLegacyResultUuid(result) {
    const collection = String(
        result?.documentCollection ??
        ""
    ).trim();
    const documentId = String(
        result?.documentId ??
        ""
    ).trim();

    if (!collection || !documentId)
        return "";

    if ([
        "Item",
        "Actor",
        "RollTable"
    ].includes(collection)) {
        return `${collection}.${documentId}`;
    }

    const pack = game.packs.get(collection);

    return pack?.documentName
        ? `Compendium.${collection}.${pack.documentName}.${documentId}`
        : "";
}

function getResultUuid(result) {
    return String(
        result?.documentUuid ||
        getLegacyResultUuid(result) ||
        getTextUuid(result) ||
        ""
    ).trim();
}

async function resolveResultDocument(result) {
    const uuid = getResultUuid(result);

    if (!uuid)
        return null;

    try {
        return await fromUuid(uuid);
    }
    catch (error) {
        console.warn(
            "Compendium Curator | No se pudo resolver un resultado de la RollTable importada.",
            { uuid, error }
        );
        return null;
    }
}

function buildDrawPreferences() {
    return {
        count: 1,
        priceAdjustment: 100,
        quantityMin: 1,
        quantityMax: 1
    };
}

function getUniqueProfileName(name) {
    const base = String(name ?? "").trim() ||
        game.i18n.localize(
            "COMPENDIUM_CURATOR.ImportedRollTable"
        );
    let candidate = base;
    let suffix = 2;

    while (
        TableProfileStorageService
            .isNameTaken(candidate)
    ) {
        candidate = `${base} (${suffix})`;
        suffix++;
    }

    return candidate;
}

function getDirectResultsProfileName(table) {
    const suffix = game.i18n.lang.startsWith("es")
        ? "Resultados directos"
        : "Direct results";

    return getUniqueProfileName(
        `${table.name} — ${suffix}`
    );
}

function buildContentProfile(name, entries) {
    const weights = Object.fromEntries(
        entries.map(entry => [
            entry.uuid,
            normalizePositiveWeight(
                entry.weight,
                1
            )
        ])
    );

    return {
        version: 2,
        type: "content",
        name,
        revision: 1,
        filterGroupIds: [],
        manualExcludes: [],
        draw: buildDrawPreferences(),
        itemRules: {
            excludeZeroPrice: false
        },
        distribution: {
            version: 2,
            mode: "individual",
            individual: {
                defaultWeight: 1,
                weights
            },
            grouped: {
                grouping: {
                    type: "field",
                    criterion: "rarity",
                    field: "system.rarity"
                },
                groups: {},
                configurations: {},
                manualGroups: []
            }
        },
        generation: {
            rootUuid: null,
            nodes: {},
            generatedRevision: 0
        }
    };
}

function buildImportedFilterGroup(
    profileName,
    entries
) {
    const suffix = game.i18n.lang.startsWith("es")
        ? "Objetos importados"
        : "Imported objects";

    return {
        name: `${profileName} — ${suffix}`,
        browser: {},
        matches: [],
        manualIncludes:
            entries.map(entry => entry.uuid)
    };
}

async function createImportedContentProfile(
    name,
    entries
) {
    return TableProfileStorageService.create(
        buildContentProfile(name, entries),
        buildImportedFilterGroup(name, entries)
    );
}

function buildNestedProfile(name, children) {
    return {
        version: 2,
        type: "nested",
        name,
        revision: 1,
        children: children.map(child => ({
            profileId: child.profile.id,
            enabled: true,
            weight: normalizePositiveWeight(
                child.weight,
                1
            )
        })),
        draw: buildDrawPreferences(),
        itemRules: {
            excludeZeroPrice: false
        },
        generation: {
            rootUuid: null,
            nodes: {},
            generatedRevision: 0
        }
    };
}

async function collectLeafEntries(
    table,
    {
        multiplier = 1,
        ancestors = new Set(),
        entries = new Map(),
        statistics = {
            unsupported: 0,
            unavailable: 0
        }
    } = {}
) {
    if (
        table?.documentName !== "RollTable" ||
        ancestors.has(table.uuid)
    ) {
        statistics.unsupported++;
        return { entries, statistics };
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(table.uuid);

    const totalWeight = getTableTotalWeight(table);

    if (!(totalWeight > 0)) {
        statistics.unsupported++;
        return { entries, statistics };
    }

    for (const result of table.results ?? []) {
        const document =
            await resolveResultDocument(result);

        if (!document) {
            statistics.unavailable++;
            continue;
        }

        const weight =
            normalizePositiveWeight(
                multiplier,
                1
            ) *
            getResultWeight(result) /
            totalWeight;

        if (
            SUPPORTED_DOCUMENT_NAMES.has(
                document.documentName
            )
        ) {
            const previous = entries.get(
                document.uuid
            );

            entries.set(
                document.uuid,
                {
                    uuid: document.uuid,
                    name:
                        document.name ??
                        result.name ??
                        document.uuid,
                    img:
                        document.img ??
                        result.img ??
                        null,
                    weight:
                        (previous?.weight ?? 0) +
                        weight
                }
            );
            continue;
        }

        if (document.documentName === "RollTable") {
            await collectLeafEntries(
                document,
                {
                    multiplier: weight,
                    ancestors: nextAncestors,
                    entries,
                    statistics
                }
            );
            continue;
        }

        statistics.unsupported++;
    }

    return { entries, statistics };
}

async function getImmediateTableStructure(table) {
    const children = new Map();
    const directEntries = new Map();
    let unsupported = 0;
    let unavailable = 0;

    for (const result of table.results ?? []) {
        const document =
            await resolveResultDocument(result);

        if (!document) {
            unavailable++;
            continue;
        }

        const resultWeight =
            getResultWeight(result);

        if (document.documentName === "RollTable") {
            const previous = children.get(
                document.uuid
            );

            children.set(
                document.uuid,
                {
                    table: document,
                    weight:
                        (previous?.weight ?? 0) +
                        resultWeight
                }
            );
            continue;
        }

        if (
            SUPPORTED_DOCUMENT_NAMES.has(
                document.documentName
            )
        ) {
            const previous = directEntries.get(
                document.uuid
            );

            directEntries.set(
                document.uuid,
                {
                    uuid: document.uuid,
                    name:
                        document.name ??
                        result.name ??
                        document.uuid,
                    img:
                        document.img ??
                        result.img ??
                        null,
                    weight:
                        (previous?.weight ?? 0) +
                        resultWeight
                }
            );
            continue;
        }

        unsupported++;
    }

    return {
        children: Array.from(children.values()),
        directEntries:
            Array.from(directEntries.values()),
        directWeight:
            Array.from(directEntries.values())
                .reduce(
                    (sum, entry) =>
                        sum + entry.weight,
                    0
                ),
        hasDirectDocuments:
            directEntries.size > 0,
        unsupported,
        unavailable
    };
}

async function rollbackProfiles(profiles) {
    for (const profile of [...profiles].reverse()) {
        try {
            if (
                TableProfileStorageService
                    .getProfiles()?.[profile.id]
            ) {
                await TableProfileStorageService
                    .removeProfile(profile.id);
            }
        }
        catch (error) {
            console.error(
                "Compendium Curator | No se pudo revertir un perfil tras fallar la importación de una RollTable.",
                { profileId: profile.id, error }
            );
        }
    }
}

export class TableProfileRollTableImportService {

    static async getIndependentTables(tables) {
        const candidates = Array.from(
            new Map(
                (Array.isArray(tables) ? tables : [])
                    .filter(table =>
                        table?.documentName ===
                            "RollTable"
                    )
                    .map(table => [
                        table.uuid,
                        table
                    ])
            ).values()
        );
        const candidateUuids = new Set(
            candidates.map(table => table.uuid)
        );
        const referencedUuids = new Set();

        for (const table of candidates) {
            const immediate =
                await getImmediateTableStructure(
                    table
                );

            for (const child of immediate.children) {
                if (
                    candidateUuids.has(
                        child.table.uuid
                    )
                ) {
                    referencedUuids.add(
                        child.table.uuid
                    );
                }
            }
        }

        return candidates.filter(table =>
            !referencedUuids.has(table.uuid)
        );
    }

    static async importTables(tables) {
        const requested = Array.from(
            new Map(
                (Array.isArray(tables) ? tables : [])
                    .filter(table =>
                        table?.documentName ===
                            "RollTable"
                    )
                    .map(table => [
                        table.uuid,
                        table
                    ])
            ).values()
        );
        const roots =
            await this.getIndependentTables(
                requested
            );
        const imported = [];
        const failures = [];

        for (const table of roots) {
            try {
                imported.push(
                    await this.importTable(table)
                );
            }
            catch (error) {
                failures.push({
                    table,
                    error
                });
            }
        }

        return {
            requested,
            roots,
            skippedNested:
                requested.length - roots.length,
            imported,
            failures,
            createdProfiles:
                imported.flatMap(result =>
                    result.createdProfiles
                ),
            importedObjects:
                imported.reduce(
                    (sum, result) =>
                        sum + result.imported,
                    0
                ),
            unsupported:
                imported.reduce(
                    (sum, result) =>
                        sum + result.unsupported,
                    0
                ),
            unavailable:
                imported.reduce(
                    (sum, result) =>
                        sum + result.unavailable,
                    0
                )
        };
    }

    static async importTable(table) {
        if (table?.documentName !== "RollTable") {
            throw new Error(
                "INVALID_ROLL_TABLE"
            );
        }

        const createdProfiles = [];

        try {
            const immediate =
                await getImmediateTableStructure(
                    table
                );

            if (immediate.children.length > 0) {
                const childProfiles = [];
                let unsupported =
                    immediate.unsupported;
                let unavailable =
                    immediate.unavailable;
                let imported = 0;

                if (immediate.directEntries.length) {
                    const directProfile =
                        await createImportedContentProfile(
                            getDirectResultsProfileName(
                                table
                            ),
                            immediate.directEntries
                        );

                    createdProfiles.push(
                        directProfile
                    );
                    childProfiles.push({
                        profile: directProfile,
                        weight:
                            immediate.directWeight
                    });
                    imported +=
                        immediate.directEntries.length;
                }

                for (
                    const child
                    of immediate.children
                ) {
                    const collected =
                        await collectLeafEntries(
                            child.table
                        );
                    const entries = Array.from(
                        collected.entries.values()
                    );

                    unsupported +=
                        collected.statistics
                            .unsupported;
                    unavailable +=
                        collected.statistics
                            .unavailable;

                    if (!entries.length)
                        continue;

                    const name =
                        getUniqueProfileName(
                            child.table.name
                        );
                    const profile =
                        await createImportedContentProfile(
                            name,
                            entries
                        );

                    createdProfiles.push(profile);
                    childProfiles.push({
                        profile,
                        weight: child.weight
                    });
                    imported += entries.length;
                }

                if (!childProfiles.length) {
                    throw new Error(
                        "ROLLTABLE_IMPORT_NO_SUPPORTED_RESULTS"
                    );
                }

                const rootName =
                    getUniqueProfileName(
                        table.name
                    );
                const rootProfile =
                    await TableProfileStorageService
                        .create(
                            buildNestedProfile(
                                rootName,
                                childProfiles
                            )
                        );

                createdProfiles.push(rootProfile);

                return {
                    kind:
                        immediate.hasDirectDocuments
                            ? "mixed"
                            : "nested",
                    rootProfile,
                    createdProfiles,
                    imported,
                    unsupported,
                    unavailable
                };
            }

            const collected =
                await collectLeafEntries(table);
            const entries = Array.from(
                collected.entries.values()
            );

            if (!entries.length) {
                throw new Error(
                    "ROLLTABLE_IMPORT_NO_SUPPORTED_RESULTS"
                );
            }

            const name = getUniqueProfileName(
                table.name
            );
            const rootProfile =
                await createImportedContentProfile(
                    name,
                    entries
                );

            createdProfiles.push(rootProfile);

            return {
                kind: "content",
                rootProfile,
                createdProfiles,
                imported: entries.length,
                unsupported:
                    collected.statistics
                        .unsupported,
                unavailable:
                    collected.statistics
                        .unavailable
            };
        }
        catch (error) {
            await rollbackProfiles(
                createdProfiles
            );
            throw error;
        }
    }

}
