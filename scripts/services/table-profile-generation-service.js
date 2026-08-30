import { MODULE_ID } from "../settings.js";
import { TableProfileStorageService } from "./table-profile-storage-service.js";
import { TableGenerationTargetService } from "./table-generation-target-service.js";
import {
    TableGenerationFolderService
} from "./table-generation-folder-service.js";

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

function cloneData(value) {
    return globalThis.foundry?.utils?.deepClone
        ? globalThis.foundry.utils.deepClone(value)
        : structuredClone(value);
}

async function restoreTableSnapshot(
    table,
    snapshot
) {
    const update = {};

    for (const field of [
        "name",
        "img",
        "description",
        "formula",
        "replacement",
        "displayRoll",
        "folder",
        "flags"
    ]) {
        if (
            Object.prototype.hasOwnProperty.call(
                snapshot,
                field
            )
        ) {
            update[field] = cloneData(
                snapshot[field]
            );
        }
    }

    await table.update(update);

    const results = Array.from(
        snapshot.results ?? []
    ).map(result => {
        const restored = cloneData(result);
        delete restored._id;
        return restored;
    });

    await replaceTableResults(
        table,
        results
    );
}

export class TableGenerationTransaction {

    constructor(target) {
        this.target = target;
        this.snapshots = new Map();
        this.created = new Map();
    }

    remember(table) {
        const key = String(
            table?.uuid ?? table?.id ?? ""
        ).trim();

        if (
            !key ||
            this.created.has(key) ||
            this.snapshots.has(key)
        ) {
            return;
        }

        this.snapshots.set(key, {
            table,
            data: cloneData(table.toObject())
        });
    }

    registerCreated(table) {
        const key = String(
            table?.uuid ?? table?.id ?? ""
        ).trim();

        if (key)
            this.created.set(key, table);
    }

    async rollback() {
        const failures = [];

        for (
            const table
            of [...this.created.values()].reverse()
        ) {
            try {
                await table.delete();
            }
            catch (error) {
                failures.push(error);
            }
        }

        for (
            const { table, data }
            of [...this.snapshots.values()].reverse()
        ) {
            try {
                await restoreTableSnapshot(
                    table,
                    data
                );
            }
            catch (error) {
                failures.push(error);
            }
        }

        try {
            await TableGenerationFolderService
                .cleanupTarget(this.target);
        }
        catch (error) {
            failures.push(error);
        }

        if (failures.length) {
            throw new AggregateError(
                failures,
                "TABLE_GENERATION_ROLLBACK_FAILED"
            );
        }
    }
}

async function runGenerationTransaction(
    target,
    callback
) {
    const transaction =
        new TableGenerationTransaction(target);

    try {
        return await callback(transaction);
    }
    catch (error) {
        try {
            await transaction.rollback();
        }
        catch (rollbackError) {
            console.error(
                "Compendium Curator | Error restaurando una generación de tablas fallida.",
                rollbackError
            );
        }

        throw error;
    }
}

async function reconcileTable({
    profile,
    nodeId,
    name,
    img,
    entries,
    storedUuid,
    target,
    internalPath = [],
    fromTargetRoot = false,
    transaction = null
}) {
    let table =
        await TableGenerationTargetService
            .resolveManagedTable(
                profile.id,
                nodeId,
                storedUuid,
                target
            );

    if (table)
        transaction?.remember(table);

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
        replacement: true,
        displayRoll: true,
        flags: {
            [MODULE_ID]: {
                managed: true,
                profileId: profile.id,
                nodeId
            }
        }
    };

    const placement =
        await TableGenerationFolderService
            .resolvePlacement({
                profile,
                table,
                target,
                internalPath,
                fromTargetRoot
            });

    TableGenerationFolderService
        .applyPlacementToData(
            tableData,
            placement
        );

    if (!table) {
        const createData = {
            ...tableData,
            results: prepared.results
        };

        table = await RollTable.create(
            createData,
            TableGenerationTargetService
                .getCreateContext(target)
        );
        transaction?.registerCreated(table);
    }
    else {
        /*
         * Solo incluimos `folder` cuando la tabla continúa en la
         * ubicación automática que registramos. Si el usuario la
         * movió, el servicio de carpetas omite ese campo y conserva
         * su colocación actual.
         */
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

function numberedName(index, name) {
    return `${index + 1}. ${String(name ?? "").trim()}`;
}

function profileInternalPath(profile) {
    const managerPath =
        TableProfileStorageService
            .getProfileFolderPath(profile.id);

    return [
        {
            key: "subtables:root",
            name: game.i18n.localize(
                "COMPENDIUM_CURATOR.GeneratedSubtablesFolder"
            ),
            shared: true
        },
        ...managerPath.map(folder => ({
            key: `manager:${folder.id}`,
            name: folder.name,
            shared: true
        })),
        {
            key: "profile",
            name: profile.name
        }
    ];
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
                inspector.isIndividual ||
                inspector.isGroupingNone
                    ? entry.weight
                    : 1
        }))
    );
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
    nodes,
    target
) {
    const keepUuids = new Set(
        Object.values(nodes)
            .map(node => node?.uuid)
            .filter(Boolean)
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

    try {
        await TableGenerationTargetService
            .removePreviousGeneratedTables(
                profile,
                keepUuids
            );

        await TableGenerationFolderService
            .cleanupTarget(target);
    }
    catch (error) {
        /*
         * La generación ya está guardada y es válida. Una tabla o
         * carpeta obsoleta puede limpiarse de forma segura en la
         * siguiente actualización, sin invalidar el resultado nuevo.
         */
        console.warn(
            "Compendium Curator | La generación terminó, pero quedó contenido obsoleto pendiente de limpieza.",
            error
        );
    }

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

        const tables =
            await TableGenerationTargetService
                .findManagedTables(profile.id);
        const targets = new Map();

        for (const table of tables) {
            const target =
                await TableGenerationTargetService
                    .getTargetFromDocument(table);

            if (target)
                targets.set(target.key, target);
        }

        const deleted =
            await TableGenerationTargetService
                .deleteGeneratedTables(profile);

        for (const target of targets.values()) {
            await TableGenerationTargetService
                .withWritableTarget(
                    target,
                    () => TableGenerationFolderService
                        .cleanupTarget(target)
                );
        }

        return deleted;
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
                () => runGenerationTransaction(
                    target,
                    async transaction => {
                    const nodes = {};
                    let rootEntries;

                    if (
                        inspector.isGrouped &&
                        !inspector.isGroupingNone
                    ) {
                        const groupNodes =
                            buildGroupedNodes(
                                profile,
                                inspector
                            );
                        const activeGroupNodes =
                            groupNodes.filter(
                                node => node.enabled
                            );

                        if (!activeGroupNodes.length) {
                            throw new Error(
                                "TABLE_PROFILE_NO_ACTIVE_GROUPS"
                            );
                        }

                        for (
                            const [index, node]
                            of activeGroupNodes.entries()
                        ) {
                            const numberedLabel =
                                numberedName(
                                    index,
                                    node.label
                                );
                            const table =
                                await reconcileTable({
                                    profile,
                                    nodeId:
                                        node.nodeId,
                                    name: numberedLabel,
                                    img: node.img,
                                    entries:
                                        node.entries,
                                    storedUuid:
                                        getStoredNodeUuid(
                                            profile,
                                            node.nodeId
                                        ),
                                    target,
                                    internalPath:
                                        profileInternalPath(
                                            profile
                                        ),
                                    fromTargetRoot: true,
                                    transaction
                                });

                            nodes[node.nodeId] = {
                                uuid: table.uuid
                            };
                            node.table = table;
                            node.numberedLabel =
                                numberedLabel;
                        }

                        rootEntries = activeGroupNodes
                            .map(node => ({
                                documentUuid:
                                    node.table.uuid,
                                name:
                                    node.numberedLabel,
                                img: node.table.img,
                                resultKey:
                                    node.nodeId,
                                weight:
                                    node.weight
                            }));
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
                            target,
                            transaction
                        });

                    nodes[ROOT_NODE_ID] = {
                        uuid: root.uuid
                    };

                    return finalizeGeneration(
                        profile,
                        root,
                        nodes,
                        target
                    );
                    }
                )
            );
    }

    static async generateDirect(
        profile,
        sources,
        children = []
    ) {
        if (
            !profile?.id ||
            profile.type !== "content"
        ) {
            throw new Error(
                "INVALID_TABLE_PROFILE"
            );
        }

        const activeSources = (
            Array.isArray(sources)
                ? sources
                : []
        ).map(source => ({
            ...source,
            groups: (
                Array.isArray(source?.groups)
                    ? source.groups
                    : []
            ).filter(group =>
                group?.enabled !== false &&
                Array.isArray(group?.entries) &&
                group.entries.length > 0
            )
        })).filter(source =>
            source?.key &&
            source.groups.length > 0
        );
        const activeChildren = (
            Array.isArray(children)
                ? children
                : []
        ).filter(child =>
            child?.profile?.id &&
            child?.table?.uuid
        );

        if (
            !activeSources.length &&
            !activeChildren.length
        ) {
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
                () => runGenerationTransaction(
                    target,
                    async transaction => {
                    const nodes = {};
                    const rootEntries = [];
                    const rootInternalPath =
                        profileInternalPath(profile);

                    for (
                        const [sourceIndex, source]
                        of activeSources.entries()
                    ) {
                        const sourceNodeId =
                            `source:${source.key}`;
                        const sourceName = numberedName(
                            sourceIndex,
                            source.name
                        );
                        const sourceInternalPath = [
                            ...rootInternalPath,
                            {
                                key: sourceNodeId,
                                name: sourceName
                            }
                        ];
                        const sourceEntries = [];

                        if (source.criterion === "none") {
                            sourceEntries.push(
                                ...source.groups.flatMap(group =>
                                    group.entries.map(entry => ({
                                        documentUuid: entry.uuid,
                                        name: entry.name,
                                        img: entry.img,
                                        resultKey: entry.uuid,
                                        weight: normalizePositiveWeight(
                                            entry.weight,
                                            1
                                        )
                                    }))
                                )
                            );
                        }

                        for (
                            const [groupIndex, group]
                            of source.criterion === "none"
                                ? []
                                : source.groups.entries()
                        ) {
                            const groupNodeId =
                                `${sourceNodeId}:group:${encodeURIComponent(group.key)}`;
                            const groupName =
                                numberedName(
                                    groupIndex,
                                    group.label
                                );
                            const groupTable =
                                await reconcileTable({
                                    profile,
                                    nodeId: groupNodeId,
                                    name: groupName,
                                    img:
                                        group.entries.find(
                                            entry => entry.img
                                        )?.img ??
                                        "icons/svg/d20-grey.svg",
                                    entries:
                                        group.entries.map(
                                            entry => ({
                                                documentUuid:
                                                    entry.uuid,
                                                name:
                                                    entry.name,
                                                img:
                                                    entry.img,
                                                resultKey:
                                                    entry.uuid,
                                                weight:
                                                    normalizePositiveWeight(
                                                        entry.weight,
                                                        1
                                                    )
                                            })
                                        ),
                                    storedUuid:
                                        getStoredNodeUuid(
                                            profile,
                                            groupNodeId
                                        ),
                                    target,
                                    internalPath:
                                        sourceInternalPath,
                                    fromTargetRoot: true,
                                    transaction
                                });

                            nodes[groupNodeId] = {
                                uuid: groupTable.uuid
                            };
                            sourceEntries.push({
                                documentUuid:
                                    groupTable.uuid,
                                name: groupName,
                                img: groupTable.img,
                                resultKey: groupNodeId,
                                weight:
                                    normalizePositiveWeight(
                                        group.weight,
                                        1
                                    )
                            });
                        }

                        const sourceTable =
                            await reconcileTable({
                                profile,
                                nodeId: sourceNodeId,
                                name: sourceName,
                                img:
                                    sourceEntries.find(
                                        entry => entry.img
                                    )?.img ??
                                    "icons/svg/d20-grey.svg",
                                entries: sourceEntries,
                                storedUuid:
                                    getStoredNodeUuid(
                                        profile,
                                        sourceNodeId
                                    ),
                                target,
                                internalPath:
                                    rootInternalPath,
                                fromTargetRoot: true,
                                transaction
                            });

                        nodes[sourceNodeId] = {
                            uuid: sourceTable.uuid
                        };
                        rootEntries.push({
                            documentUuid:
                                sourceTable.uuid,
                            name: sourceName,
                            img: sourceTable.img,
                            resultKey: source.key,
                            weight:
                                normalizePositiveWeight(
                                    source.weight,
                                    1
                                )
                        });
                    }

                    for (const child of activeChildren) {
                        rootEntries.push({
                            documentUuid:
                                child.table.uuid,
                            name:
                                child.profile.name,
                            img:
                                child.table.img ??
                                "icons/svg/d20-grey.svg",
                            resultKey:
                                `table:${child.profile.id}`,
                            weight:
                                normalizePositiveWeight(
                                    child.weight,
                                    1
                                )
                        });
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
                            target,
                            transaction
                        });

                    nodes[ROOT_NODE_ID] = {
                        uuid: root.uuid
                    };

                    return finalizeGeneration(
                        profile,
                        root,
                        nodes,
                        target
                    );
                    }
                )
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
                // Continue with managed-table discovery.
            }
        }

        return TableGenerationTargetService
            .findManagedTable(
                profile.id,
                ROOT_NODE_ID
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
                () => runGenerationTransaction(
                    target,
                    async transaction => {
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
                            target,
                            transaction
                        });
                    const nodes = {
                        [ROOT_NODE_ID]: {
                            uuid: root.uuid
                        }
                    };

                    return finalizeGeneration(
                        profile,
                        root,
                        nodes,
                        target
                    );
                    }
                )
            );
    }

}
