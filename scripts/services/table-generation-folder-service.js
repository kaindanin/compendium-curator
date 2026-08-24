import { MODULE_ID } from "../settings.js";
import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";
import {
    TableGenerationTargetService
} from "./table-generation-target-service.js";

const FOLDER_FLAG = "generatedTableFolder";
const LOCATION_FLAG = "generationLocation";

function normalizeId(value) {
    const id = String(value ?? "").trim();
    return id || null;
}

function getFolderId(document) {
    return normalizeId(
        document?.folder?.id ??
        document?._source?.folder
    );
}

function getFolders(target) {
    const collection =
        target?.mode === "compendium"
            ? target.pack?.folders
            : game.folders;

    return Array.from(collection ?? [])
        .filter(folder => folder?.type === "RollTable");
}

function getManagerFolderId(folder) {
    const flags = folder?.flags?.[MODULE_ID];

    return flags?.[FOLDER_FLAG] === true
        ? normalizeId(flags.managerFolderId)
        : null;
}

function getLocation(table) {
    const location =
        table?.flags?.[MODULE_ID]
            ?.[LOCATION_FLAG];

    if (!location || typeof location !== "object")
        return null;

    return {
        automatic: location.automatic === true,
        targetKey:
            normalizeId(location.targetKey),
        managerFolderId:
            normalizeId(location.managerFolderId),
        generatedFolderId:
            normalizeId(location.generatedFolderId)
    };
}

async function createFolder(
    target,
    managerFolder,
    parentId
) {
    return Folder.create(
        {
            name: managerFolder.name,
            type: "RollTable",
            folder: parentId,
            flags: {
                [MODULE_ID]: {
                    [FOLDER_FLAG]: true,
                    managerFolderId:
                        managerFolder.id
                }
            }
        },
        target?.mode === "compendium"
            ? { pack: target.pack.collection }
            : {}
    );
}

async function ensureFolderPath(profile, target) {
    const path = TableProfileStorageService
        .getProfileFolderPath(profile.id);
    let parentId = null;

    for (const managerFolder of path) {
        let folder = getFolders(target).find(
            candidate =>
                getManagerFolderId(candidate) ===
                    managerFolder.id
        );

        if (!folder) {
            folder = await createFolder(
                target,
                managerFolder,
                parentId
            );
        }
        else {
            const update = {};

            if (folder.name !== managerFolder.name) {
                update.name = managerFolder.name;
            }

            if (getFolderId(folder) !== parentId) {
                update.folder = parentId;
            }

            if (Object.keys(update).length)
                await folder.update(update);
        }

        parentId = folder.id;
    }

    return {
        managerFolderId:
            path.at(-1)?.id ?? null,
        generatedFolderId: parentId
    };
}

function isAutomaticLocation(
    table,
    location,
    target
) {
    const actualFolderId = getFolderId(table);

    if (!location) {
        /*
         * Las versiones anteriores siempre creaban en la raíz.
         * Una tabla antigua que siga allí puede incorporarse con
         * seguridad a la organización automática; si ya está en
         * una carpeta, consideramos que el usuario la movió.
         */
        return actualFolderId === null;
    }

    return (
        location.automatic === true &&
        (
            !location.targetKey ||
            location.targetKey === target?.key
        ) &&
        actualFolderId === location.generatedFolderId
    );
}

function locationData({
    automatic,
    targetKey,
    managerFolderId,
    generatedFolderId
}) {
    return {
        automatic,
        targetKey: normalizeId(targetKey),
        managerFolderId:
            normalizeId(managerFolderId),
        generatedFolderId:
            normalizeId(generatedFolderId)
    };
}

function locationEquals(left, right) {
    return (
        left?.automatic === right?.automatic &&
        left?.targetKey === right?.targetKey &&
        left?.managerFolderId ===
            right?.managerFolderId &&
        left?.generatedFolderId ===
            right?.generatedFolderId
    );
}

async function deleteStaleEmptyFolders(target) {
    const validIds = new Set(
        Object.keys(
            TableProfileStorageService.getFolders()
        )
    );

    if (target?.mode === "compendium") {
        await target.pack.getIndex({
            fields: ["folder"]
        });
    }

    let changed = true;

    while (changed) {
        changed = false;
        const folders = getFolders(target);

        for (const folder of folders) {
            const managerFolderId =
                getManagerFolderId(folder);

            if (
                !managerFolderId ||
                validIds.has(managerFolderId)
            ) {
                continue;
            }

            const hasChildren = folders.some(
                candidate =>
                    getFolderId(candidate) === folder.id
            );
            const hasDocuments =
                target?.mode === "compendium"
                    ? Array.from(
                        target.pack.index ?? []
                    ).some(entry =>
                        normalizeId(entry?.folder) ===
                            folder.id
                    )
                    : game.tables.some(table =>
                        getFolderId(table) === folder.id
                    );

            if (hasChildren || hasDocuments)
                continue;

            await folder.delete();
            changed = true;
            break;
        }
    }
}

export class TableGenerationFolderService {

    static async resolvePlacement({
        profile,
        table,
        target
    }) {
        const currentLocation = getLocation(table);
        const automatic = !table ||
            isAutomaticLocation(
                table,
                currentLocation,
                target
            );

        if (!automatic) {
            const actualFolderId = getFolderId(table);

            return {
                automatic: false,
                shouldSetFolder: false,
                folderId: actualFolderId,
                location: locationData({
                    automatic: false,
                    targetKey: target?.key,
                    managerFolderId:
                        profile?.folderId,
                    generatedFolderId:
                        actualFolderId
                })
            };
        }

        const desired = await ensureFolderPath(
            profile,
            target
        );

        return {
            automatic: true,
            shouldSetFolder: true,
            folderId: desired.generatedFolderId,
            location: locationData({
                automatic: true,
                targetKey: target?.key,
                ...desired
            })
        };
    }

    static applyPlacementToData(
        tableData,
        placement
    ) {
        tableData.flags ??= {};
        tableData.flags[MODULE_ID] ??= {};
        tableData.flags[MODULE_ID][LOCATION_FLAG] =
            placement.location;

        if (placement.shouldSetFolder) {
            tableData.folder = placement.folderId;
        }

        return tableData;
    }

    static async syncTable(profile, table, target) {
        const placement = await this.resolvePlacement({
            profile,
            table,
            target
        });
        const currentLocation = getLocation(table);
        const actualFolderId = getFolderId(table);
        const update = {};

        if (
            placement.shouldSetFolder &&
            actualFolderId !== placement.folderId
        ) {
            update.folder = placement.folderId;
        }

        if (!locationEquals(
            currentLocation,
            placement.location
        )) {
            update[
                `flags.${MODULE_ID}.${LOCATION_FLAG}`
            ] = placement.location;
        }

        if (Object.keys(update).length)
            await table.update(update);

        return Object.keys(update).length > 0;
    }

    static async syncProfile(profileId) {
        const profile =
            TableProfileStorageService
                .getProfiles()?.[profileId];

        if (!profile)
            return 0;

        const tables =
            await TableGenerationTargetService
                .findManagedTables(profileId);
        const targets = new Map();
        let updated = 0;

        for (const table of tables) {
            const target =
                await TableGenerationTargetService
                    .getTargetFromDocument(table);

            if (!target)
                continue;

            targets.set(target.key, target);

            const changed =
                await TableGenerationTargetService
                    .withWritableTarget(
                        target,
                        () => this.syncTable(
                            profile,
                            table,
                            target
                        )
                    );

            if (changed)
                updated++;
        }

        for (const target of targets.values()) {
            await TableGenerationTargetService
                .withWritableTarget(
                    target,
                    () => deleteStaleEmptyFolders(
                        target
                    )
                );
        }

        return updated;
    }

    static async syncAllProfiles() {
        let updated = 0;

        for (
            const profile
            of Object.values(
                TableProfileStorageService
                    .getProfiles()
            )
        ) {
            const hasGeneratedTables = Boolean(
                normalizeId(
                    profile?.generation?.rootUuid
                ) ||
                Object.keys(
                    profile?.generation?.nodes ?? {}
                ).length
            );

            if (!hasGeneratedTables)
                continue;

            updated += await this.syncProfile(
                profile.id
            );
        }

        return updated;
    }

}
