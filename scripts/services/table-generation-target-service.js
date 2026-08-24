import { MODULE_ID } from "../settings.js";
import {
    TableDefaultsService
} from "./table-defaults-service.js";

const AUTO_PACK_VALUE = "auto";
const WORLD_VALUE = "world";
const PACK_PREFIX = "pack:";
const ROOT_NODE_ID = "root";
const DEFAULT_PACK_NAME =
    "compendium-curator-tables";
const DEFAULT_PACK_LABEL =
    "Compendium Curator Tables";

function normalizePackId(value) {
    const packId = String(value ?? "").trim();
    return packId || null;
}

function normalizeTarget(target) {
    const mode =
        String(target?.mode ?? "").trim() ===
        "world"
            ? "world"
            : "compendium";

    if (mode === "world") {
        return {
            mode: "world",
            packId: null
        };
    }

    return {
        mode: "compendium",
        packId: normalizePackId(
            target?.packId
        )
    };
}

function isUserRollTablePack(pack) {
    return Boolean(
        pack?.documentName === "RollTable" &&
        pack?.metadata?.packageType === "world"
    );
}

function isManagedTable(
    table,
    profileId,
    nodeId = null
) {
    const flags = table?.flags?.[MODULE_ID];

    return Boolean(
        table?.documentName === "RollTable" &&
        flags?.managed === true &&
        flags?.profileId === profileId &&
        (
            nodeId === null ||
            flags?.nodeId === nodeId
        )
    );
}

function getStoredGeneratedUuids(profile) {
    const uuids = new Set();

    const rootUuid = String(
        profile?.generation?.rootUuid ?? ""
    ).trim();

    if (rootUuid)
        uuids.add(rootUuid);

    for (
        const stored
        of Object.values(
            profile?.generation?.nodes ?? {}
        )
    ) {
        const uuid = String(
            typeof stored === "string"
                ? stored
                : stored?.uuid ?? ""
        ).trim();

        if (uuid)
            uuids.add(uuid);
    }

    return uuids;
}

async function resolveUuid(uuid) {
    if (!uuid)
        return null;

    try {
        return await fromUuid(uuid);
    }
    catch {
        return null;
    }
}

async function withWritablePack(pack, callback) {
    if (!pack)
        return callback();

    const wasLocked = pack.locked === true;

    if (wasLocked) {
        await pack.configure({
            locked: false
        });
    }

    try {
        return await callback();
    }
    finally {
        if (wasLocked) {
            await pack.configure({
                locked: true
            });
        }
    }
}

async function findManagedEntryInPack(
    pack,
    profileId,
    nodeId = null
) {
    if (!isUserRollTablePack(pack))
        return null;

    const index = await pack.getIndex({
        fields: [
            `flags.${MODULE_ID}`
        ]
    });

    return Array.from(index).find(candidate => {
        const flags =
            candidate?.flags?.[MODULE_ID];

        return Boolean(
            flags?.managed === true &&
            flags?.profileId === profileId &&
            (
                nodeId === null ||
                flags?.nodeId === nodeId
            )
        );
    }) ?? null;
}

async function findManagedTableAnywhere(
    profileId,
    nodeId = null
) {
    const worldTable = game.tables.find(table =>
        isManagedTable(
            table,
            profileId,
            nodeId
        )
    );

    if (worldTable)
        return worldTable;

    for (
        const pack
        of TableGenerationTargetService
            .getCompatiblePacks()
    ) {
        const entry =
            await findManagedEntryInPack(
                pack,
                profileId,
                nodeId
            );

        if (entry)
            return pack.getDocument(entry._id);
    }

    return null;
}

async function findManagedTablesAnywhere(profileId) {
    const tables = game.tables.filter(table =>
        isManagedTable(table, profileId)
    );

    for (
        const pack
        of TableGenerationTargetService
            .getCompatiblePacks()
    ) {
        const index = await pack.getIndex({
            fields: [
                `flags.${MODULE_ID}`
            ]
        });

        for (const entry of Array.from(index)) {
            const flags =
                entry?.flags?.[MODULE_ID];

            if (
                flags?.managed !== true ||
                flags?.profileId !== profileId
            ) {
                continue;
            }

            const table =
                await pack.getDocument(entry._id);

            if (table)
                tables.push(table);
        }
    }

    return tables;
}

export class TableGenerationTargetService {

    static normalizeTarget(target) {
        return normalizeTarget(target);
    }

    static getCompatiblePacks() {
        return Array.from(game.packs)
            .filter(isUserRollTablePack)
            .sort((a, b) =>
                String(a.title ?? "")
                    .localeCompare(
                        String(b.title ?? ""),
                        game.i18n.lang,
                        { sensitivity: "base" }
                    )
            );
    }

    static getDefaultTarget() {
        const target = normalizeTarget(
            TableDefaultsService.get()
                .generationTarget
        );

        if (
            target.mode === "compendium" &&
            target.packId
        ) {
            const pack = game.packs.get(
                target.packId
            );

            if (!isUserRollTablePack(pack)) {
                return {
                    mode: "compendium",
                    packId: null
                };
            }
        }

        return target;
    }

    static choiceValue(target) {
        const normalized =
            normalizeTarget(target);

        if (normalized.mode === "world")
            return WORLD_VALUE;

        return normalized.packId
            ? `${PACK_PREFIX}${normalized.packId}`
            : AUTO_PACK_VALUE;
    }

    static parseChoice(value) {
        const normalized =
            String(value ?? "").trim();

        if (normalized === WORLD_VALUE) {
            return {
                mode: "world",
                packId: null
            };
        }

        if (
            normalized.startsWith(
                PACK_PREFIX
            )
        ) {
            return {
                mode: "compendium",
                packId:
                    normalizePackId(
                        normalized.slice(
                            PACK_PREFIX.length
                        )
                    )
            };
        }

        return {
            mode: "compendium",
            packId: null
        };
    }

    static getTargetChoices() {
        const choices = [
            {
                value: AUTO_PACK_VALUE,
                label:
                    game.i18n.lang.startsWith("es")
                        ? "Compendium Curator Tables (automático)"
                        : "Compendium Curator Tables (automatic)"
            }
        ];

        for (const pack of this.getCompatiblePacks()) {
            choices.push({
                value:
                    `${PACK_PREFIX}${pack.collection}`,
                label: String(pack.title ?? "")
            });
        }

        choices.push({
            value: WORLD_VALUE,
            label:
                game.i18n.lang.startsWith("es")
                    ? "Tablas de tiradas del mundo"
                    : "World Roll Tables"
        });

        return choices;
    }

    static async ensureDefaultPack() {
        const canonicalId =
            `world.${DEFAULT_PACK_NAME}`;
        const canonical =
            game.packs.get(canonicalId);

        if (isUserRollTablePack(canonical))
            return canonical;

        const existing =
            this.getCompatiblePacks()
                .find(pack =>
                    pack.title ===
                        DEFAULT_PACK_LABEL
                );

        if (existing)
            return existing;

        const CollectionClass =
            foundry.documents.collections
                .CompendiumCollection;

        let name = DEFAULT_PACK_NAME;
        let suffix = 2;

        while (game.packs.has(`world.${name}`)) {
            name =
                `${DEFAULT_PACK_NAME}-${suffix}`;
            suffix++;
        }

        return CollectionClass.createCompendium({
            name,
            label: DEFAULT_PACK_LABEL,
            type: "RollTable"
        });
    }

    static async resolveSelectedTarget(target) {
        const normalized =
            normalizeTarget(target);

        if (normalized.mode === "world") {
            return {
                mode: "world",
                packId: null,
                pack: null,
                key: "world"
            };
        }

        const pack = normalized.packId
            ? game.packs.get(
                normalized.packId
            )
            : await this.ensureDefaultPack();

        if (!isUserRollTablePack(pack)) {
            throw new Error(
                "INVALID_ROLLTABLE_GENERATION_TARGET"
            );
        }

        return {
            mode: "compendium",
            packId: pack.collection,
            pack,
            key: `pack:${pack.collection}`
        };
    }

    static async getTargetFromDocument(document) {
        if (!document)
            return null;

        if (!document.pack) {
            return {
                mode: "world",
                packId: null,
                pack: null,
                key: "world"
            };
        }

        const pack = game.packs.get(
            document.pack
        );

        if (!isUserRollTablePack(pack))
            return null;

        return {
            mode: "compendium",
            packId: pack.collection,
            pack,
            key: `pack:${pack.collection}`
        };
    }

    static async resolveExistingTarget(profile) {
        const storedRootUuid = String(
            profile?.generation?.rootUuid ??
            ""
        ).trim();
        const storedRoot = await resolveUuid(
            storedRootUuid
        );

        if (
            isManagedTable(
                storedRoot,
                profile.id,
                ROOT_NODE_ID
            )
        ) {
            const target =
                await this.getTargetFromDocument(
                    storedRoot
                );

            if (target)
                return target;
        }

        /*
         * La raíz visible manda sobre las tablas internas. Si el
         * usuario la traslada a otro compendio, su UUID puede
         * cambiar mientras aún quedan nodos antiguos en el destino
         * anterior.
         */
        const discoveredRoot =
            await findManagedTableAnywhere(
                profile.id,
                ROOT_NODE_ID
            );
        const discoveredTarget =
            await this.getTargetFromDocument(
                discoveredRoot
            );

        if (discoveredTarget)
            return discoveredTarget;

        for (
            const uuid
            of getStoredGeneratedUuids(profile)
        ) {
            if (uuid === storedRootUuid)
                continue;

            const table = await resolveUuid(uuid);

            if (
                !isManagedTable(
                    table,
                    profile.id
                )
            ) {
                continue;
            }

            const target =
                await this.getTargetFromDocument(
                    table
                );

            if (target)
                return target;
        }

        return null;
    }

    static async resolveTarget(profile) {
        const existing =
            await this.resolveExistingTarget(
                profile
            );

        if (existing)
            return existing;

        return this.resolveSelectedTarget(
            this.getDefaultTarget()
        );
    }

    static async withWritableTarget(
        target,
        callback
    ) {
        return withWritablePack(
            target?.pack,
            callback
        );
    }

    static getCreateContext(target) {
        return target?.mode === "compendium"
            ? { pack: target.pack.collection }
            : {};
    }

    static documentBelongsToTarget(
        document,
        target
    ) {
        if (!document)
            return false;

        if (target?.mode === "world")
            return !document.pack;

        return Boolean(
            target?.pack?.collection &&
            document.pack ===
                target.pack.collection
        );
    }

    static async resolveManagedTable(
        profileId,
        nodeId,
        storedUuid,
        target
    ) {
        const stored =
            await resolveUuid(storedUuid);

        if (
            isManagedTable(
                stored,
                profileId,
                nodeId
            ) &&
            this.documentBelongsToTarget(
                stored,
                target
            )
        ) {
            return stored;
        }

        if (target?.mode === "world") {
            return game.tables.find(table =>
                isManagedTable(
                    table,
                    profileId,
                    nodeId
                )
            ) ?? null;
        }

        const entry =
            await findManagedEntryInPack(
                target.pack,
                profileId,
                nodeId
            );

        return entry
            ? target.pack.getDocument(entry._id)
            : null;
    }

    static async findManagedTable(
        profileId,
        nodeId = null
    ) {
        return findManagedTableAnywhere(
            profileId,
            nodeId
        );
    }

    static async findManagedTables(profileId) {
        return findManagedTablesAnywhere(
            profileId
        );
    }

    static getStoredGeneratedUuids(profile) {
        return getStoredGeneratedUuids(profile);
    }

    static async removePreviousGeneratedTables(
        profile,
        keepUuids = new Set()
    ) {
        const generatedTables =
            await findManagedTablesAnywhere(
                profile.id
            );
        const worldTables = [];
        const packTables = new Map();

        for (const table of generatedTables) {
            if (keepUuids.has(table.uuid))
                continue;

            if (
                !isManagedTable(
                    table,
                    profile.id
                )
            ) {
                continue;
            }

            if (!table.pack) {
                worldTables.push(table);
                continue;
            }

            const pack = game.packs.get(
                table.pack
            );

            if (!isUserRollTablePack(pack))
                continue;

            if (!packTables.has(pack.collection)) {
                packTables.set(
                    pack.collection,
                    { pack, tables: [] }
                );
            }

            packTables.get(pack.collection)
                .tables.push(table);
        }

        for (const table of worldTables)
            await table.delete();

        for (
            const { pack, tables }
            of packTables.values()
        ) {
            await withWritablePack(
                pack,
                async () => {
                    for (const table of tables)
                        await table.delete();
                }
            );
        }

        return (
            worldTables.length +
            Array.from(packTables.values())
                .reduce(
                    (sum, entry) =>
                        sum + entry.tables.length,
                    0
                )
        );
    }

    static async deleteGeneratedTables(profile) {
        const tables =
            await findManagedTablesAnywhere(
                profile.id
            );
        const worldTables = tables.filter(
            table => !table.pack
        );
        const packTables = new Map();

        for (const table of tables) {
            if (!table.pack)
                continue;

            const pack = game.packs.get(
                table.pack
            );

            if (!isUserRollTablePack(pack))
                continue;

            if (!packTables.has(pack.collection)) {
                packTables.set(
                    pack.collection,
                    { pack, tables: [] }
                );
            }

            packTables.get(pack.collection)
                .tables.push(table);
        }

        for (const table of worldTables)
            await table.delete();

        for (
            const { pack, tables: packDocuments }
            of packTables.values()
        ) {
            await withWritablePack(
                pack,
                async () => {
                    for (const table of packDocuments)
                        await table.delete();
                }
            );
        }

        return (
            worldTables.length +
            Array.from(packTables.values())
                .reduce(
                    (sum, entry) =>
                        sum + entry.tables.length,
                    0
                )
        );
    }

}
