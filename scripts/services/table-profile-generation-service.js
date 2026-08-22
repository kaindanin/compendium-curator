import { MODULE_ID } from "../settings.js";
import { TableProfileStorageService } from "./table-profile-storage-service.js";
import { TableGenerationTargetService } from "./table-generation-target-service.js";

const MANAGED_FOLDER_NODE = "rolltable-folder";
const INTERNAL_FOLDER_NODE =
    "rolltable-internal-folder";
const ROOT_NODE_ID = "root";
const MAX_TABLE_RANGE = 1_000_000;
const WEIGHT_PRECISION = 1000;

function normalizePositiveWeight(value, fallback = 1) {
    const parsed = Number(value);

    return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : fallback;
}

function greatestCommonDivisor(a, b) {
    let left = Math.abs(Math.trunc(a));
    let right = Math.abs(Math.trunc(b));

    while (right) {
        const remainder = left % right;
        left = right;
        right = remainder;
    }

    return left || 1;
}

function integerizeWeights(entries) {
    if (!entries.length)
        return [];

    let weights = entries.map(entry =>
        Math.max(
            1,
            Math.round(
                normalizePositiveWeight(entry.weight) *
                WEIGHT_PRECISION
            )
        )
    );

    const divisor = weights.reduce(
        (current, weight) =>
            greatestCommonDivisor(current, weight)
    );

    weights = weights.map(weight =>
        Math.max(1, Math.round(weight / divisor))
    );

    const total = weights.reduce(
        (sum, weight) => sum + weight,
        0
    );

    if (total > MAX_TABLE_RANGE) {
        const scale = total / MAX_TABLE_RANGE;
        weights = weights.map(weight =>
            Math.max(1, Math.round(weight / scale))
        );
    }

    return entries.map((entry, index) => ({
        ...entry,
        weight: weights[index]
    }));
}

function buildTableResults(
    entries,
    profileId,
    nodeId,
    drawPreferences
) {
    const weighted = integerizeWeights(entries);
    const quantityMin = Math.max(
        1,
        Number.parseInt(
            drawPreferences?.quantityMin,
            10
        ) || 1
    );
    const quantityMax = Math.max(
        quantityMin,
        Number.parseInt(
            drawPreferences?.quantityMax,
            10
        ) || quantityMin
    );
    let cursor = 1;

    const results = weighted.map(entry => {
        const weight = entry.weight;
        const start = cursor;
        const end = start + weight - 1;
        cursor = end + 1;

        return {
            type: CONST.TABLE_RESULT_TYPES.DOCUMENT,
            name: String(
                entry.name ??
                entry.documentUuid ??
                ""
            ),
            img: String(
                entry.img ??
                "icons/svg/d20-grey.svg"
            ),
            documentUuid: String(
                entry.documentUuid ?? ""
            ),
            weight,
            range: [start, end],
            drawn: false,
            flags: {
                [MODULE_ID]: {
                    managed: true,
                    profileId,
                    nodeId,
                    resultKey: String(
                        entry.resultKey ??
                        entry.documentUuid ??
                        ""
                    ),
                    quantityMin,
                    quantityMax
                }
            }
        };
    });

    return {
        results,
        formula:
            `1d${Math.max(1, cursor - 1)}`
    };
}

async function getManagedFolder() {
    const existing = game.folders.find(folder =>
        folder.type === "RollTable" &&
        folder.flags?.[MODULE_ID]?.managed === true &&
        folder.flags?.[MODULE_ID]?.nodeId ===
            MANAGED_FOLDER_NODE
    );

    if (existing)
        return existing;

    return Folder.create({
        name: "Compendium Curator",
        type: "RollTable",
        flags: {
            [MODULE_ID]: {
                managed: true,
                nodeId: MANAGED_FOLDER_NODE
            }
        }
    });
}

async function getInternalManagedFolder(
    rootFolder
) {
    const existing = game.folders.find(folder =>
        folder.type === "RollTable" &&
        folder.flags?.[MODULE_ID]?.managed === true &&
        folder.flags?.[MODULE_ID]?.nodeId ===
            INTERNAL_FOLDER_NODE
    );

    if (existing) {
        if (
            rootFolder?.id &&
            existing.folder?.id !== rootFolder.id
        ) {
            await existing.update({
                folder: rootFolder.id
            });
        }

        return existing;
    }

    return Folder.create({
        name: game.i18n.localize(
            "COMPENDIUM_CURATOR.InternalTablesFolder"
        ),
        type: "RollTable",
        folder: rootFolder?.id ?? null,
        flags: {
            [MODULE_ID]: {
                managed: true,
                nodeId: INTERNAL_FOLDER_NODE
            }
        }
    });
}

async function getTargetFolders(target) {
    if (target.mode !== "world") {
        return {
            root: null,
            internal: null
        };
    }

    const root = await getManagedFolder();
    const internal =
        await getInternalManagedFolder(root);

    return { root, internal };
}

async function replaceTableResults(
    table,
    entries
) {
    const currentIds = table.results
        .map(result => result.id);

    if (currentIds.length) {
        await table.deleteEmbeddedDocuments(
            "TableResult",
            currentIds
        );
    }

    if (entries.length) {
        await table.createEmbeddedDocuments(
            "TableResult",
            entries
        );
    }
}

async function reconcileTable({
    profile,
    nodeId,
    name,
    img,
    entries,
    storedUuid,
    folder,
    target,
    replacement = true
}) {
    let table =
        await TableGenerationTargetService
            .resolveManagedTable(
                profile.id,
                nodeId,
                storedUuid,
                target
            );

    const prepared = buildTableResults(
        entries,
        profile.id,
        nodeId,
        profile.draw
    );

    const tableData = {
        name,
        img:
            img ||
            "icons/svg/d20-grey.svg",
        description: game.i18n.format(
            "COMPENDIUM_CURATOR.GeneratedTableDescription",
            { profile: profile.name }
        ),
        formula: prepared.formula,
        replacement,
        displayRoll: true,
        flags: {
            [MODULE_ID]: {
                managed: true,
                profileId: profile.id,
                nodeId
            }
        }
    };

    if (target.mode === "world") {
        tableData.folder =
            folder?.id ?? null;
    }

    if (!table) {
        table = await RollTable.create(
            {
                ...tableData,
                results: prepared.results
            },
            TableGenerationTargetService
                .getCreateContext(target)
        );
    }
    else {
        await table.update(tableData);
        await replaceTableResults(
            table,
            prepared.results
        );
    }

    return table;
}

function getStoredNodeUuid(profile, nodeId) {
    const stored =
        profile?.generation?.nodes?.[nodeId];

    if (typeof stored === "string")
        return stored;

    return stored?.uuid ?? null;
}

function getInternalItemWeight(
    profile,
    groupKey,
    uuid
) {
    const distribution =
        profile?.distribution
            ?.grouped?.groups?.[groupKey]
            ?.distribution;

    if (distribution?.mode !== "individual")
        return 1;

    return normalizePositiveWeight(
        distribution?.weights?.[uuid],
        normalizePositiveWeight(
            distribution?.defaultWeight,
            1
        )
    );
}

function buildDirectEntries(
    profile,
    inspector
) {
    void profile;

    return inspector.groups.flatMap(group =>
        (
            group.allEntries ??
            group.entries ??
            []
        ).map(entry => ({
            documentUuid: entry.uuid,
            name: entry.name,
            img: entry.img,
            resultKey: entry.uuid,
            weight:
                inspector.isIndividual
                    ? entry.weight
                    : 1
        }))
    );
}

function buildUniqueGroupedEntries(
    profile,
    inspector
) {
    return inspector.groups
        .filter(group =>
            group.enabled &&
            group.count > 0
        )
        .flatMap(group => {
            const entries =
                group.allEntries ??
                group.entries ??
                [];
            const weighted =
                entries.map(entry => ({
                    entry,
                    weight:
                        getInternalItemWeight(
                            profile,
                            group.key,
                            entry.uuid
                        )
                }));
            const internalTotal =
                weighted.reduce(
                    (sum, candidate) =>
                        sum + candidate.weight,
                    0
                );

            if (internalTotal <= 0)
                return [];

            return weighted.map(candidate => ({
                documentUuid:
                    candidate.entry.uuid,
                name: candidate.entry.name,
                img: candidate.entry.img,
                resultKey:
                    candidate.entry.uuid,
                weight:
                    group.weight *
                    candidate.weight /
                    internalTotal
            }));
        });
}

function buildGroupedNodes(
    profile,
    inspector
) {
    return inspector.groups
        .filter(group => group.count > 0)
        .map(group => {
            const configured =
                profile?.distribution
                    ?.grouped?.groups?.[
                        group.key
                    ];
            const groupId = String(
                configured?.id ??
                `auto:${inspector.groupingCriterion}:${encodeURIComponent(group.key)}`
            );
            const nodeId =
                `group:${groupId}`;
            const entries = (
                group.allEntries ??
                group.entries ??
                []
            ).map(entry => ({
                documentUuid: entry.uuid,
                name: entry.name,
                img: entry.img,
                resultKey: entry.uuid,
                weight:
                    getInternalItemWeight(
                        profile,
                        group.key,
                        entry.uuid
                    )
            }));

            return {
                nodeId,
                name:
                    `${profile.name} — ${group.label}`,
                label: group.label,
                enabled: group.enabled,
                img:
                    entries.find(entry =>
                        entry.img
                    )?.img ??
                    "icons/svg/d20-grey.svg",
                weight: group.weight,
                entries
            };
        });
}

async function finalizeGeneration(
    profile,
    root,
    nodes
) {
    const keepUuids = new Set(
        Object.values(nodes)
            .map(node => node?.uuid)
            .filter(Boolean)
    );

    await TableGenerationTargetService
        .removePreviousGeneratedTables(
            profile,
            keepUuids
        );

    const updatedProfile =
        await TableProfileStorageService
            .setGenerationState(
                profile.id,
                {
                    rootUuid: root.uuid,
                    nodes,
                    generatedRevision:
                        Number(
                            profile.revision ?? 1
                        )
                }
            );

    return {
        root,
        nodes,
        profile: updatedProfile
    };
}

export class TableProfileGenerationService {

    static async deleteGeneratedTables(profile) {
        if (!profile?.id)
            return 0;

        return TableGenerationTargetService
            .deleteGeneratedTables(profile);
    }

    static async generate(profile, inspector) {
        if (
            !profile?.id ||
            profile.type !== "content"
        ) {
            throw new Error(
                "INVALID_TABLE_PROFILE"
            );
        }

        if (!inspector?.hasObjects) {
            throw new Error(
                "TABLE_PROFILE_NO_OBJECTS"
            );
        }

        const target =
            await TableGenerationTargetService
                .resolveTarget(profile);

        return TableGenerationTargetService
            .withWritableTarget(
                target,
                async () => {
                    const folders =
                        await getTargetFolders(
                            target
                        );
                    const nodes = {};
                    let rootEntries;

                    const flattenUniqueGroups =
                        inspector.isGrouped &&
                        profile.draw?.unique === true;

                    if (
                        flattenUniqueGroups &&
                        !inspector.groups.some(
                            group =>
                                group.enabled &&
                                group.count > 0
                        )
                    ) {
                        throw new Error(
                            "TABLE_PROFILE_NO_ACTIVE_GROUPS"
                        );
                    }

                    if (
                        inspector.isGrouped &&
                        !flattenUniqueGroups
                    ) {
                        const groupNodes =
                            buildGroupedNodes(
                                profile,
                                inspector
                            );

                        if (
                            !groupNodes.some(
                                node => node.enabled
                            )
                        ) {
                            throw new Error(
                                "TABLE_PROFILE_NO_ACTIVE_GROUPS"
                            );
                        }

                        for (const node of groupNodes) {
                            const table =
                                await reconcileTable({
                                    profile,
                                    nodeId:
                                        node.nodeId,
                                    name: node.name,
                                    img: node.img,
                                    entries:
                                        node.entries,
                                    storedUuid:
                                        getStoredNodeUuid(
                                            profile,
                                            node.nodeId
                                        ),
                                    folder:
                                        folders.internal,
                                    target,
                                    replacement:
                                        profile.draw?.unique !==
                                        true
                                });

                            nodes[node.nodeId] = {
                                uuid: table.uuid
                            };
                            node.table = table;
                        }

                        rootEntries = groupNodes
                            .filter(node =>
                                node.enabled
                            )
                            .map(node => ({
                                documentUuid:
                                    node.table.uuid,
                                name: node.label,
                                img: node.table.img,
                                resultKey:
                                    node.nodeId,
                                weight:
                                    node.weight
                            }));
                    }
                    else if (flattenUniqueGroups) {
                        rootEntries =
                            buildUniqueGroupedEntries(
                                profile,
                                inspector
                            );
                    }
                    else {
                        rootEntries =
                            buildDirectEntries(
                                profile,
                                inspector
                            );
                    }

                    const root =
                        await reconcileTable({
                            profile,
                            nodeId: ROOT_NODE_ID,
                            name: profile.name,
                            img:
                                rootEntries.find(
                                    entry => entry.img
                                )?.img ??
                                "icons/svg/d20-grey.svg",
                            entries: rootEntries,
                            storedUuid:
                                profile.generation
                                    ?.rootUuid ??
                                getStoredNodeUuid(
                                    profile,
                                    ROOT_NODE_ID
                                ),
                            folder: folders.root,
                            target,
                            replacement:
                                profile.draw?.unique !==
                                true
                        });

                    nodes[ROOT_NODE_ID] = {
                        uuid: root.uuid
                    };

                    return finalizeGeneration(
                        profile,
                        root,
                        nodes
                    );
                }
            );
    }

    static async getRootTable(profile) {
        if (!profile?.id)
            return null;

        const storedUuid =
            profile.generation?.rootUuid ??
            getStoredNodeUuid(
                profile,
                ROOT_NODE_ID
            );

        if (storedUuid) {
            try {
                const stored =
                    await fromUuid(storedUuid);
                const flags =
                    stored?.flags?.[MODULE_ID];

                if (
                    stored?.documentName ===
                        "RollTable" &&
                    flags?.managed === true &&
                    flags?.profileId ===
                        profile.id &&
                    flags?.nodeId ===
                        ROOT_NODE_ID
                ) {
                    return stored;
                }
            }
            catch {
                // Continue with target lookup.
            }
        }

        const target =
            await TableGenerationTargetService
                .resolveTarget(profile);

        return TableGenerationTargetService
            .resolveManagedTable(
                profile.id,
                ROOT_NODE_ID,
                null,
                target
            );
    }

    static async generateNested(
        profile,
        children
    ) {
        if (
            !profile?.id ||
            profile.type !== "nested"
        ) {
            throw new Error(
                "INVALID_TABLE_PROFILE"
            );
        }

        const activeChildren = (
            Array.isArray(children)
                ? children
                : []
        ).filter(child =>
            child?.profile?.id &&
            child?.table?.uuid
        );

        if (!activeChildren.length) {
            throw new Error(
                "TABLE_PROFILE_NO_ACTIVE_CHILDREN"
            );
        }

        const target =
            await TableGenerationTargetService
                .resolveTarget(profile);

        return TableGenerationTargetService
            .withWritableTarget(
                target,
                async () => {
                    const folders =
                        await getTargetFolders(
                            target
                        );
                    const entries =
                        activeChildren.map(
                            child => ({
                                documentUuid:
                                    child.table.uuid,
                                name:
                                    child.profile.name,
                                img:
                                    child.table.img ??
                                    "icons/svg/d20-grey.svg",
                                resultKey:
                                    child.profile.id,
                                weight:
                                    normalizePositiveWeight(
                                        child.weight,
                                        1
                                    )
                            })
                        );
                    const root =
                        await reconcileTable({
                            profile,
                            nodeId: ROOT_NODE_ID,
                            name: profile.name,
                            img:
                                entries.find(entry =>
                                    entry.img
                                )?.img ??
                                "icons/svg/d20-grey.svg",
                            entries,
                            storedUuid:
                                profile.generation
                                    ?.rootUuid ??
                                getStoredNodeUuid(
                                    profile,
                                    ROOT_NODE_ID
                                ),
                            folder: folders.root,
                            target,
                            replacement: true
                        });
                    const nodes = {
                        [ROOT_NODE_ID]: {
                            uuid: root.uuid
                        }
                    };

                    return finalizeGeneration(
                        profile,
                        root,
                        nodes
                    );
                }
            );
    }

}