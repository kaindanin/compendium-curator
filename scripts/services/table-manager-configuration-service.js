import {
    MODULE_ID,
    TABLE_PROFILES_SETTING
} from "../settings.js";
import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";
import {
    TableDefaultsService
} from "./table-defaults-service.js";
import {
    TableProfileBundlePreflightService
} from "./table-profile-bundle-preflight-service.js";

const TABLE_MANAGER_CONFIGURATION_TYPE =
    "compendium-curator-table-manager-configuration";
const TABLE_MANAGER_CONFIGURATION_VERSION = 1;
const TABLE_PROFILE_BUNDLE_TYPE =
    "compendium-curator-table-profile-bundle";

function isPlainObject(value) {
    return Boolean(
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}

function normalizeComparableName(value) {
    return String(value ?? "")
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase();
}

function validateVisualStructure(tableProfiles) {
    const validateFolders = (folders, entries) => {
        const siblingNames = new Set();

        for (
            const [folderId, folder]
            of Object.entries(folders)
        ) {
            const name = String(
                folder?.name ?? ""
            ).trim();
            const parentId = String(
                folder?.parentId ?? ""
            ).trim() || null;

            if (
                !folderId ||
                !isPlainObject(folder) ||
                !name ||
                parentId === folderId ||
                (parentId && !folders[parentId])
            ) {
                throw new Error(
                    "INVALID_TABLE_MANAGER_VISUAL_STRUCTURE"
                );
            }

            const siblingKey = `${parentId ?? ""}\u0000${
                normalizeComparableName(name)
            }`;

            if (siblingNames.has(siblingKey)) {
                throw new Error(
                    "INVALID_TABLE_MANAGER_VISUAL_STRUCTURE"
                );
            }

            siblingNames.add(siblingKey);

            const visited = new Set([folderId]);
            let ancestorId = parentId;

            while (ancestorId) {
                if (visited.has(ancestorId)) {
                    throw new Error(
                        "INVALID_TABLE_MANAGER_VISUAL_STRUCTURE"
                    );
                }

                visited.add(ancestorId);
                ancestorId = String(
                    folders[ancestorId]
                        ?.parentId ?? ""
                ).trim() || null;
            }
        }

        for (const entry of Object.values(entries)) {
            const folderId = String(
                entry?.folderId ?? ""
            ).trim();

            if (folderId && !folders[folderId]) {
                throw new Error(
                    "INVALID_TABLE_MANAGER_VISUAL_STRUCTURE"
                );
            }
        }
    };

    validateFolders(
        tableProfiles.folders ?? {},
        tableProfiles.profiles ?? {}
    );
    validateFolders(
        tableProfiles.filterGroupFolders ?? {},
        tableProfiles.filterGroups ?? {}
    );
}

function childProfileId(child) {
    return String(
        typeof child === "string"
            ? child
            : child?.profileId ?? child?.id ?? ""
    ).trim();
}

function validatePortableUuidList(value) {
    if (!Array.isArray(value))
        return false;

    const normalized = value.map(uuid =>
        String(uuid ?? "").trim()
    );

    return normalized.every(Boolean) &&
        new Set(normalized).size ===
            normalized.length;
}

function validateProfileStructure(tableProfiles) {
    const profiles = tableProfiles.profiles ?? {};
    const filterGroups =
        tableProfiles.filterGroups ?? {};

    for (
        const [filterGroupId, filterGroup]
        of Object.entries(filterGroups)
    ) {
        if (
            !filterGroupId ||
            !isPlainObject(filterGroup) ||
            !String(filterGroup.name ?? "").trim() ||
            !validatePortableUuidList(
                filterGroup.matches ?? []
            ) ||
            !validatePortableUuidList(
                filterGroup.manualIncludes ?? []
            ) ||
            (
                filterGroup.id !== undefined &&
                String(filterGroup.id) !== filterGroupId
            )
        ) {
            throw new Error(
                "INVALID_TABLE_MANAGER_PROFILE_STRUCTURE"
            );
        }
    }

    for (
        const [profileId, profile]
        of Object.entries(profiles)
    ) {
        if (
            !profileId ||
            !isPlainObject(profile) ||
            Number(profile.version) !== 2 ||
            !["content", "nested"].includes(
                profile.type
            ) ||
            !String(profile.name ?? "").trim() ||
            !Array.isArray(profile.filterGroupIds ?? []) ||
            !Array.isArray(profile.children ?? []) ||
            (
                profile.id !== undefined &&
                String(profile.id) !== profileId
            ) ||
            !validatePortableUuidList(
                profile.manualExcludes ?? []
            )
        ) {
            throw new Error(
                "INVALID_TABLE_MANAGER_PROFILE_STRUCTURE"
            );
        }

        const filterGroupIds = (
            profile.filterGroupIds ?? []
        ).map(id => String(id ?? "").trim());

        if (
            filterGroupIds.some(id =>
                !id || !filterGroups[id]
            ) ||
            new Set(filterGroupIds).size !==
                filterGroupIds.length
        ) {
            throw new Error(
                "INVALID_TABLE_MANAGER_PROFILE_STRUCTURE"
            );
        }

        const seenChildren = new Set();

        for (const child of profile.children ?? []) {
            const childId = childProfileId(child);
            const weight =
                typeof child === "string"
                    ? 1
                    : Number(child?.weight ?? 1);

            if (
                !childId ||
                childId === profileId ||
                seenChildren.has(childId) ||
                profiles[childId]?.version !== 2 ||
                !Number.isFinite(weight) ||
                weight <= 0 ||
                (
                    typeof child !== "string" &&
                    child?.enabled !== undefined &&
                    typeof child.enabled !== "boolean"
                )
            ) {
                throw new Error(
                    "INVALID_TABLE_MANAGER_PROFILE_STRUCTURE"
                );
            }

            seenChildren.add(childId);
        }
    }

    const visiting = new Set();
    const visited = new Set();

    const visit = profileId => {
        if (visited.has(profileId))
            return;

        if (visiting.has(profileId)) {
            throw new Error(
                "INVALID_TABLE_MANAGER_PROFILE_STRUCTURE"
            );
        }

        visiting.add(profileId);

        for (
            const child
            of profiles[profileId]?.children ?? []
        ) {
            visit(childProfileId(child));
        }

        visiting.delete(profileId);
        visited.add(profileId);
    };

    for (const profileId of Object.keys(profiles))
        visit(profileId);
}

function normalizedRelation(profile) {
    return (profile?.children ?? [])
        .map(child => ({
            profileId: childProfileId(child),
            enabled:
                typeof child === "string" ||
                child?.enabled !== false,
            weight:
                typeof child === "string"
                    ? 1
                    : Number(child?.weight ?? 1)
        }))
        .sort((a, b) =>
            a.profileId.localeCompare(b.profileId)
        );
}

function sameJsonValue(left, right) {
    return JSON.stringify(left) ===
        JSON.stringify(right);
}

function text(es, en) {
    return game.i18n.lang.startsWith("es")
        ? es
        : en;
}

function sanitizeTableProfiles(source) {
    if (!isPlainObject(source)) {
        throw new Error(
            "INVALID_TABLE_MANAGER_CONFIGURATION"
        );
    }

    const tableProfiles =
        foundry.utils.deepClone(source);

    if (!isPlainObject(tableProfiles.profiles)) {
        tableProfiles.profiles = {};
    }

    if (!isPlainObject(tableProfiles.filterGroups)) {
        tableProfiles.filterGroups = {};
    }

    if (!isPlainObject(tableProfiles.folders)) {
        tableProfiles.folders = {};
    }

    if (!isPlainObject(tableProfiles.filterGroupFolders)) {
        tableProfiles.filterGroupFolders = {};
    }

    for (
        const [profileId, profile]
        of Object.entries(tableProfiles.profiles)
    ) {
        /*
         * Los perfiles v1 pertenecen a formatos antiguos que
         * el Gestor actual ya no muestra ni utiliza. No deben
         * viajar en copias nuevas ni volver a restaurarse.
         */
        if (
            !isPlainObject(profile) ||
            Number(profile.version) !== 2
        ) {
            delete tableProfiles.profiles[profileId];
            continue;
        }

        /*
         * Las RollTables generadas pertenecen al mundo de
         * origen. La configuración portable conserva el
         * perfil, pero nunca sus UUID de generación.
         */
        profile.generation = {};
    }

    return tableProfiles;
}

async function pruneLegacyTableProfiles() {
    if (!game.user?.can("SETTINGS_MODIFY"))
        return false;

    const current = game.settings.get(
        MODULE_ID,
        TABLE_PROFILES_SETTING
    );

    if (!isPlainObject(current?.profiles))
        return false;

    const storage =
        foundry.utils.deepClone(current);
    let removed = 0;

    for (
        const [profileId, profile]
        of Object.entries(storage.profiles)
    ) {
        if (
            isPlainObject(profile) &&
            Number(profile.version) === 2
        ) {
            continue;
        }

        delete storage.profiles[profileId];
        removed++;
    }

    if (!removed)
        return false;

    await game.settings.set(
        MODULE_ID,
        TABLE_PROFILES_SETTING,
        storage
    );

    await TableProfileStorageService.migrateStorage();

    console.info(
        `Compendium Curator | Eliminados ${removed} perfiles legacy del Gestor.`
    );

    return true;
}

function synchronizeVisibleProfileNames(
    application,
    storage
) {
    const root = application?.element;

    if (!root)
        return;

    for (
        const [profileId, profile]
        of Object.entries(
            storage?.profiles ?? {}
        )
    ) {
        const row = root.querySelector(
            `[data-profile-id="${CSS.escape(profileId)}"]`
        );
        const title = row?.querySelector(
            ".cc-table-manager-profile-info > strong"
        );

        if (!title)
            continue;

        const expectedName = String(
            profile?.name ?? ""
        );

        if (title.textContent === expectedName)
            continue;

        console.warn(
            "Compendium Curator | Corrigiendo un nombre de perfil desfasado en el Gestor.",
            {
                profileId,
                renderedName: title.textContent,
                storedName: expectedName
            }
        );

        title.textContent = expectedName;
    }
}

export class TableManagerConfigurationService {

    static createExportBundle() {
        const tableProfiles =
            sanitizeTableProfiles(
                TableProfileStorageService.getStorage()
            );

        const tableDefaults =
            foundry.utils.deepClone(
                TableDefaultsService.get()
            );

        return {
            type: TABLE_MANAGER_CONFIGURATION_TYPE,
            version:
                TABLE_MANAGER_CONFIGURATION_VERSION,
            moduleVersion:
                game.modules.get(MODULE_ID)?.version ??
                null,
            systemId: game.system?.id ?? null,
            systemVersion:
                game.system?.version ?? null,
            exportedAt: new Date().toISOString(),
            data: {
                tableDefaults,
                tableProfiles
            }
        };
    }

    static validateImportBundle(bundle) {
        if (
            !isPlainObject(bundle) ||
            bundle.type !==
                TABLE_MANAGER_CONFIGURATION_TYPE ||
            bundle.version !==
                TABLE_MANAGER_CONFIGURATION_VERSION ||
            !isPlainObject(bundle.data) ||
            !isPlainObject(
                bundle.data.tableDefaults
            ) ||
            !isPlainObject(
                bundle.data.tableProfiles
            )
        ) {
            throw new Error(
                "INVALID_TABLE_MANAGER_CONFIGURATION"
            );
        }

        if (
            bundle.systemId &&
            game.system?.id &&
            bundle.systemId !== game.system.id
        ) {
            throw new Error(
                "TABLE_MANAGER_CONFIGURATION_SYSTEM_MISMATCH"
            );
        }

        const tableProfiles =
            sanitizeTableProfiles(
                bundle.data.tableProfiles
            );
        validateVisualStructure(tableProfiles);
        validateProfileStructure(tableProfiles);
        const tableDefaults =
            foundry.utils.deepClone(
                bundle.data.tableDefaults
            );

        return {
            tableDefaults,
            tableProfiles,
            profileCount:
                Object.keys(
                    tableProfiles.profiles ?? {}
                ).length,
            filterGroupCount:
                Object.keys(
                    tableProfiles.filterGroups ?? {}
                ).length,
            folderCount:
                Object.keys(
                    tableProfiles.folders ?? {}
                ).length,
            filterGroupFolderCount:
                Object.keys(
                    tableProfiles.filterGroupFolders ?? {}
                ).length
        };
    }

    static async importBundle(bundle) {
        const imported =
            this.validateImportBundle(bundle);

        const previousDefaults =
            foundry.utils.deepClone(
                TableDefaultsService.get()
            );
        const previousProfiles =
            foundry.utils.deepClone(
                TableProfileStorageService.getStorage()
            );

        try {
            await TableDefaultsService.set(
                imported.tableDefaults
            );

            await game.settings.set(
                MODULE_ID,
                TABLE_PROFILES_SETTING,
                imported.tableProfiles
            );

            await TableProfileStorageService
                .migrateStorage();

            const storedProfiles =
                TableProfileStorageService.getStorage();

            if (
                Object.keys(
                    storedProfiles.profiles ?? {}
                ).length !==
                    Object.keys(
                        imported.tableProfiles.profiles ?? {}
                    ).length ||
                Object.keys(
                    storedProfiles.filterGroups ?? {}
                ).length !==
                    Object.keys(
                        imported.tableProfiles.filterGroups ?? {}
                    ).length
            ) {
                throw new Error(
                    "TABLE_MANAGER_CONFIGURATION_NOT_APPLIED"
                );
            }

            if (
                Object.keys(
                    storedProfiles.folders ?? {}
                ).length !==
                Object.keys(
                    imported.tableProfiles.folders ?? {}
                ).length
            ) {
                throw new Error(
                    "TABLE_MANAGER_CONFIGURATION_NOT_APPLIED"
                );
            }

            if (
                Object.keys(
                    storedProfiles.filterGroupFolders ?? {}
                ).length !==
                Object.keys(
                    imported.tableProfiles.filterGroupFolders ?? {}
                ).length
            ) {
                throw new Error(
                    "TABLE_MANAGER_CONFIGURATION_NOT_APPLIED"
                );
            }

            for (
                const [folderId, importedFolder]
                of Object.entries(
                    imported.tableProfiles.folders ?? {}
                )
            ) {
                const storedFolder =
                    storedProfiles.folders?.[folderId];

                if (
                    !storedFolder ||
                    storedFolder.name !== String(
                        importedFolder?.name ?? ""
                    ).trim() ||
                    (storedFolder.parentId ?? null) !==
                        (
                            String(
                                importedFolder?.parentId ?? ""
                            ).trim() || null
                        )
                ) {
                    throw new Error(
                        "TABLE_MANAGER_CONFIGURATION_NOT_APPLIED"
                    );
                }
            }

            for (
                const [profileId, importedProfile]
                of Object.entries(
                    imported.tableProfiles.profiles ?? {}
                )
            ) {
                const storedProfile =
                    storedProfiles.profiles?.[
                        profileId
                    ];

                if (
                    !storedProfile ||
                    String(
                        storedProfile.name ?? ""
                    ) !== String(
                        importedProfile?.name ?? ""
                    ) ||
                    (storedProfile.folderId ?? null) !==
                        (
                            String(
                                importedProfile?.folderId ?? ""
                            ).trim() || null
                        ) ||
                    !sameJsonValue(
                        [...(
                            storedProfile.filterGroupIds ?? []
                        )].sort(),
                        [...(
                            importedProfile.filterGroupIds ?? []
                        )]
                            .map(id => String(id))
                            .sort()
                    ) ||
                    !sameJsonValue(
                        normalizedRelation(
                            storedProfile
                        ),
                        normalizedRelation(
                            importedProfile
                        )
                    )
                ) {
                    throw new Error(
                        "TABLE_MANAGER_CONFIGURATION_NOT_APPLIED"
                    );
                }
            }

            for (
                const [folderId, importedFolder]
                of Object.entries(
                    imported.tableProfiles.filterGroupFolders ?? {}
                )
            ) {
                const storedFolder =
                    storedProfiles.filterGroupFolders?.[folderId];

                if (
                    !storedFolder ||
                    storedFolder.name !== String(
                        importedFolder?.name ?? ""
                    ).trim() ||
                    (storedFolder.parentId ?? null) !==
                        (String(importedFolder?.parentId ?? "").trim() || null)
                ) {
                    throw new Error(
                        "TABLE_MANAGER_CONFIGURATION_NOT_APPLIED"
                    );
                }
            }

            for (
                const [filterGroupId, importedGroup]
                of Object.entries(
                    imported.tableProfiles.filterGroups ?? {}
                )
            ) {
                const storedGroup =
                    storedProfiles.filterGroups?.[
                        filterGroupId
                    ];

                if (
                    !storedGroup ||
                    String(storedGroup.name ?? "") !==
                        String(importedGroup.name ?? "") ||
                    (storedGroup.folderId ?? null) !==
                        (String(importedGroup.folderId ?? "").trim() || null) ||
                    !sameJsonValue(
                        storedGroup.matches ?? [],
                        importedGroup.matches ?? []
                    ) ||
                    !sameJsonValue(
                        storedGroup.manualIncludes ?? [],
                        importedGroup.manualIncludes ?? []
                    )
                ) {
                    throw new Error(
                        "TABLE_MANAGER_CONFIGURATION_NOT_APPLIED"
                    );
                }
            }

            return {
                ...imported,
                tableDefaults:
                    TableDefaultsService.get(),
                tableProfiles: storedProfiles
            };
        }
        catch (error) {
            try {
                await TableDefaultsService.set(
                    previousDefaults
                );

                await game.settings.set(
                    MODULE_ID,
                    TABLE_PROFILES_SETTING,
                    previousProfiles
                );

                await TableProfileStorageService
                    .migrateStorage();
            }
            catch (rollbackError) {
                console.error(
                    "Compendium Curator | Error restaurando la configuración del Gestor.",
                    rollbackError
                );
            }

            throw error;
        }
    }

    static exportToFile() {
        const bundle = this.createExportBundle();
        const date =
            new Date().toISOString().slice(0, 10);

        foundry.utils.saveDataToFile(
            JSON.stringify(bundle, null, 2),
            "application/json",
            `compendium-curator-manager-${date}.json`
        );

        return bundle;
    }

}

async function restoreConfigurationBundle(
    application,
    bundle
) {
    const preview =
        TableManagerConfigurationService
            .validateImportBundle(bundle);
    const escape = foundry.utils.escapeHTML;

    const confirmed =
        await foundry.applications.api
            .DialogV2.confirm({
                window: {
                    title: text(
                        "Restaurar configuración del Gestor",
                        "Restore Manager configuration"
                    )
                },
                content: `
                    <p>${text(
                        "La configuración actual del Gestor será sustituida por la copia del archivo.",
                        "The current Manager configuration will be replaced by the file backup."
                    )}</p>
                    <p>
                        <strong>${escape(text(
                            "Perfiles",
                            "Profiles"
                        ))}:</strong>
                        ${preview.profileCount}<br>
                        <strong>${escape(text(
                            "Categorías",
                            "Categories"
                        ))}:</strong>
                        ${preview.filterGroupCount}<br>
                        <strong>${escape(text(
                            "Carpetas de tablas",
                            "Table folders"
                        ))}:</strong>
                        ${preview.folderCount}<br>
                        <strong>${escape(text(
                            "Carpetas de categorías",
                            "Category folders"
                        ))}:</strong>
                        ${preview.filterGroupFolderCount}
                    </p>
                    <p>${text(
                        "Las referencias a RollTables generadas no se restaurarán.",
                        "References to generated RollTables will not be restored."
                    )}</p>
                `
            });

    if (!confirmed)
        return;

    const imported =
        await TableManagerConfigurationService
            .importBundle(bundle);

    await application.render(true);

    synchronizeVisibleProfileNames(
        application,
        imported.tableProfiles
    );

    ui.notifications.info(
        text(
            "Configuración del Gestor restaurada.",
            "Manager configuration restored."
        )
    );
}

async function importProfileBundle(
    application,
    bundle
) {
    const preflight =
        TableProfileBundlePreflightService
            .analyze(bundle);
    const confirmed =
        await TableProfileBundlePreflightService
            .confirm(preflight);

    if (!confirmed)
        return;

    const imported =
        await TableProfileStorageService
            .importProfileBundle(bundle);
    const root = imported.rootProfile;

    application._activeTab =
        root?.type === "nested"
            ? "nested"
            : "content";
    application._searchQuery = "";

    await application.render(true);

    ui.notifications.info(
        game.i18n.format(
            "COMPENDIUM_CURATOR.TableProfileBundleImported",
            {
                name: root?.name ?? "",
                profiles:
                    imported.importedProfileIds.length,
                groups:
                    imported.importedFilterGroupIds.length
            }
        )
    );

    if (
        imported.availability
            ?.unavailableCount > 0
    ) {
        const unavailableSources =
            imported.availability
                .missingPacks
                .map(pack =>
                    `${pack.collection} (${pack.count})`
                );

        if (
            imported.availability
                .missingDocumentCount > 0
        ) {
            unavailableSources.push(
                `${game.i18n.localize(
                    "COMPENDIUM_CURATOR.MissingDocuments"
                )} (${imported.availability.missingDocumentCount})`
            );
        }

        ui.notifications.warn(
            game.i18n.format(
                "COMPENDIUM_CURATOR.ImportedUnavailableObjects",
                {
                    count:
                        imported.availability
                            .unavailableCount,
                    packs:
                        unavailableSources.join(", ")
                }
            ),
            { permanent: true }
        );
    }
}

async function importJsonFromFile(
    application,
    file
) {
    try {
        const bundle = JSON.parse(
            await file.text()
        );

        if (
            bundle?.type ===
                TABLE_MANAGER_CONFIGURATION_TYPE
        ) {
            await restoreConfigurationBundle(
                application,
                bundle
            );
            return;
        }

        if (
            bundle?.type ===
                TABLE_PROFILE_BUNDLE_TYPE
        ) {
            await importProfileBundle(
                application,
                bundle
            );
            return;
        }

        throw new Error("UNSUPPORTED_JSON_BUNDLE");
    }
    catch (error) {
        console.error(
            "Compendium Curator | Error importando JSON del Gestor.",
            error
        );

        const message =
            error?.message ===
                "TABLE_MANAGER_CONFIGURATION_SYSTEM_MISMATCH"
                ? text(
                    "El archivo pertenece a otro sistema de juego.",
                    "The file belongs to a different game system."
                )
                : text(
                    "El archivo no es una copia del Gestor ni un perfil exportado válido de Compendium Curator.",
                    "The file is neither a valid Manager backup nor an exported Compendium Curator profile."
                );

        ui.notifications.error(message);
    }
}

function createMenuButton(
    iconClass,
    label,
    onClick
) {
    const button = document.createElement("button");
    button.type = "button";

    const icon = document.createElement("i");
    icon.className = iconClass;

    button.append(
        icon,
        document.createTextNode(label)
    );
    button.addEventListener(
        "click",
        onClick
    );

    return button;
}

function installConfigurationMenu(
    application,
    element
) {
    const actions = element.querySelector(
        ".cc-table-manager-header .cc-table-manager-actions"
    );

    if (!actions)
        return;

    if (
        actions.querySelector(
            "[data-cc-manager-configuration-menu]"
        )
    ) {
        return;
    }

    const legacyImportButton =
        actions.querySelector(
            '[data-action="importProfileBundle"]'
        );
    legacyImportButton?.remove();

    for (
        const stale
        of actions.querySelectorAll(
            "[data-cc-manager-configuration]"
        )
    ) {
        stale.remove();
    }

    const wrapper = document.createElement("div");
    wrapper.className = "cc-profile-menu-wrapper";
    wrapper.dataset.ccManagerConfigurationMenu = "true";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.title = text(
        "Configuración del Gestor",
        "Manager configuration"
    );
    toggle.setAttribute(
        "aria-label",
        toggle.title
    );

    const toggleIcon = document.createElement("i");
    toggleIcon.className = "fas fa-gear";
    toggle.append(
        toggleIcon,
        document.createTextNode(
            ` ${text("Configuración", "Configuration")}`
        )
    );

    const menu = document.createElement("div");
    menu.className = "cc-profile-menu";
    menu.hidden = true;
    menu.style.left = "auto";
    menu.style.right = "0";

    const closeMenu = () => {
        menu.hidden = true;
    };

    const exportButton = createMenuButton(
        "fas fa-file-export",
        text(
            "Exportar configuración",
            "Export configuration"
        ),
        event => {
            event.preventDefault();
            closeMenu();

            TableManagerConfigurationService
                .exportToFile();

            ui.notifications.info(
                text(
                    "Configuración del Gestor exportada.",
                    "Manager configuration exported."
                )
            );
        }
    );

    const importButton = createMenuButton(
        "fas fa-file-import",
        text(
            "Importar JSON…",
            "Import JSON…"
        ),
        event => {
            event.preventDefault();
            closeMenu();

            const input = document.createElement(
                "input"
            );
            input.type = "file";
            input.accept =
                ".json,application/json";

            input.addEventListener(
                "change",
                async () => {
                    const file = input.files?.[0];

                    if (!file)
                        return;

                    await importJsonFromFile(
                        application,
                        file
                    );
                },
                { once: true }
            );

            input.click();
        }
    );

    menu.append(
        exportButton,
        importButton
    );

    toggle.addEventListener(
        "click",
        event => {
            event.preventDefault();
            event.stopPropagation();
            menu.hidden = !menu.hidden;
        }
    );

    menu.addEventListener(
        "click",
        event => event.stopPropagation()
    );

    document.addEventListener(
        "click",
        event => {
            if (
                menu.hidden ||
                wrapper.contains(event.target)
            ) {
                return;
            }

            closeMenu();
        }
    );

    wrapper.append(toggle, menu);
    actions.append(wrapper);
}

export function registerTableManagerConfigurationControls() {
    Hooks.once(
        "ready",
        () => {
            void pruneLegacyTableProfiles();
        }
    );

    Hooks.on(
        "renderTableManagerApplication",
        (application, element) => {
            if (!game.user.can("SETTINGS_MODIFY"))
                return;

            installConfigurationMenu(
                application,
                element
            );
        }
    );
}
