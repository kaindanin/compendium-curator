import {
    MODULE_ID,
    TABLE_PROFILES_SETTING
} from "../settings.js";
import {
    TableDefaultsService
} from "./table-defaults-service.js";
import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";

const AUTO_PACK_VALUE = "auto";
const WORLD_VALUE = "world";
const INHERIT_VALUE = "inherit";
const PACK_PREFIX = "pack:";
const DEFAULT_PACK_NAME =
    "compendium-curator-tables";
const DEFAULT_PACK_LABEL =
    "Compendium Curator Tables";

function normalizeMode(value, allowInherit = false) {
    const mode = String(value ?? "").trim();

    if (
        allowInherit &&
        (!mode || mode === "inherit")
    ) {
        return "inherit";
    }

    return mode === "world"
        ? "world"
        : "compendium";
}

function normalizePackId(value) {
    const packId = String(value ?? "").trim();
    return packId || null;
}

function normalizeTarget(
    target,
    { allowInherit = false } = {}
) {
    const mode = normalizeMode(
        target?.mode,
        allowInherit
    );

    if (mode === "inherit") {
        return {
            mode: "inherit",
            packId: null
        };
    }

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

export class TableGenerationTargetService {

    static normalizeTarget(
        target,
        options = {}
    ) {
        return normalizeTarget(
            target,
            options
        );
    }

    static getCompatiblePacks() {
        return Array.from(game.packs)
            .filter(pack =>
                pack?.documentName ===
                    "RollTable"
            )
            .sort((a, b) =>
                String(a.title ?? "")
                    .localeCompare(
                        String(b.title ?? ""),
                        game.i18n.lang,
                        { sensitivity: "base" }
                    )
            );
    }

    static getConfiguredProfileTarget(profile) {
        return normalizeTarget(
            profile?.output?.target,
            { allowInherit: true }
        );
    }

    static getDefaultTarget() {
        return normalizeTarget(
            TableDefaultsService.get()
                .generationTarget
        );
    }

    static getEffectiveConfiguredTarget(profile) {
        const profileTarget =
            this.getConfiguredProfileTarget(
                profile
            );

        return profileTarget.mode === "inherit"
            ? this.getDefaultTarget()
            : normalizeTarget(profileTarget);
    }

    static choiceValue(
        target,
        { allowInherit = false } = {}
    ) {
        const normalized = normalizeTarget(
            target,
            { allowInherit }
        );

        if (normalized.mode === "inherit")
            return INHERIT_VALUE;

        if (normalized.mode === "world")
            return WORLD_VALUE;

        return normalized.packId
            ? `${PACK_PREFIX}${normalized.packId}`
            : AUTO_PACK_VALUE;
    }

    static parseChoice(
        value,
        { allowInherit = false } = {}
    ) {
        const normalized =
            String(value ?? "").trim();

        if (
            allowInherit &&
            normalized === INHERIT_VALUE
        ) {
            return {
                mode: "inherit",
                packId: null
            };
        }

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

    static getTargetChoices({
        allowInherit = false
    } = {}) {
        const choices = [];

        if (allowInherit) {
            choices.push({
                value: INHERIT_VALUE,
                label:
                    game.i18n.lang.startsWith("es")
                        ? "Usar el destino predeterminado"
                        : "Use default destination"
            });
        }

        choices.push({
            value: AUTO_PACK_VALUE,
            label:
                game.i18n.lang.startsWith("es")
                    ? "Compendio de Curator (automático)"
                    : "Curator compendium (automatic)"
        });

        for (const pack of this.getCompatiblePacks()) {
            const packageType = String(
                pack.metadata?.packageType ??
                ""
            );
            const suffix = packageType
                ? ` · ${packageType}`
                : "";

            choices.push({
                value:
                    `${PACK_PREFIX}${pack.collection}`,
                label:
                    `${pack.title}${suffix}`
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

        if (
            canonical?.documentName ===
            "RollTable"
        ) {
            return canonical;
        }

        const existing =
            this.getCompatiblePacks()
                .find(pack =>
                    pack.metadata?.packageType ===
                        "world" &&
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

    static async resolveTarget(profile) {
        const configured =
            this.getEffectiveConfiguredTarget(
                profile
            );

        if (configured.mode === "world") {
            return {
                mode: "world",
                packId: null,
                pack: null,
                key: "world"
            };
        }

        const pack = configured.packId
            ? game.packs.get(
                configured.packId
            )
            : await this.ensureDefaultPack();

        if (
            !pack ||
            pack.documentName !== "RollTable"
        ) {
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

        const index =
            await target.pack.getIndex({
                fields: [
                    `flags.${MODULE_ID}`
                ]
            });
        const entry = Array.from(index)
            .find(candidate => {
                const flags =
                    candidate?.flags?.[MODULE_ID];

                return (
                    flags?.managed === true &&
                    flags?.profileId ===
                        profileId &&
                    flags?.nodeId === nodeId
                );
            });

        return entry
            ? target.pack.getDocument(entry._id)
            : null;
    }

    static getStoredGeneratedUuids(profile) {
        return getStoredGeneratedUuids(profile);
    }

    static async removePreviousGeneratedTables(
        profile,
        keepUuids = new Set()
    ) {
        const storedUuids =
            getStoredGeneratedUuids(profile);
        const worldTables = [];
        const packTables = new Map();

        for (const uuid of storedUuids) {
            if (keepUuids.has(uuid))
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

            if (!table.pack) {
                worldTables.push(table);
                continue;
            }

            const pack = game.packs.get(
                table.pack
            );

            if (!pack)
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
        return this.removePreviousGeneratedTables(
            profile,
            new Set()
        );
    }

    static async setProfileTarget(
        profileId,
        target
    ) {
        const storage =
            foundry.utils.deepClone(
                TableProfileStorageService
                    .getStorage()
            );
        const profile =
            storage.profiles?.[profileId];

        if (!profile) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        const normalized = normalizeTarget(
            target,
            { allowInherit: true }
        );
        const previous =
            this.getConfiguredProfileTarget(
                profile
            );

        if (
            foundry.utils.equals(
                previous,
                normalized
            )
        ) {
            return foundry.utils.deepClone(
                profile
            );
        }

        profile.output = {
            ...foundry.utils.deepClone(
                profile.output ?? {}
            ),
            target: normalized
        };
        profile.revision =
            Number(profile.revision ?? 1) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return foundry.utils.deepClone(profile);
    }

    static async markInheritedProfilesPending() {
        const storage =
            foundry.utils.deepClone(
                TableProfileStorageService
                    .getStorage()
            );
        let changed = false;

        for (
            const profile
            of Object.values(
                storage.profiles ?? {}
            )
        ) {
            const target =
                this.getConfiguredProfileTarget(
                    profile
                );

            if (target.mode !== "inherit")
                continue;

            profile.revision =
                Number(profile.revision ?? 1) + 1;
            changed = true;
        }

        if (changed) {
            await game.settings.set(
                MODULE_ID,
                TABLE_PROFILES_SETTING,
                storage
            );
        }

        return changed;
    }

}