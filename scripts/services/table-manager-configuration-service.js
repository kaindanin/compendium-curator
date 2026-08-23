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

const TABLE_MANAGER_CONFIGURATION_TYPE =
    "compendium-curator-table-manager-configuration";
const TABLE_MANAGER_CONFIGURATION_VERSION = 1;

function isPlainObject(value) {
    return Boolean(
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
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

    for (
        const profile
        of Object.values(tableProfiles.profiles)
    ) {
        if (!isPlainObject(profile))
            continue;

        /*
         * Las RollTables generadas pertenecen al mundo de
         * origen. La configuración portable conserva el
         * perfil, pero nunca sus UUID de generación.
         */
        profile.generation = {};
    }

    return tableProfiles;
}

function setButtonLabel(button, label, iconClass = null) {
    if (!button)
        return;

    button.title = label;
    button.setAttribute("aria-label", label);

    if (!iconClass)
        return;

    const icon = document.createElement("i");
    icon.className = iconClass;

    button.replaceChildren(
        icon,
        document.createTextNode(` ${label}`)
    );
}

function clarifyExistingImportControls(element) {
    setButtonLabel(
        element.querySelector(
            '[data-action="importProfileBundle"]'
        ),
        text(
            "Importar perfil JSON",
            "Import profile JSON"
        ),
        "fas fa-file-import"
    );

    const rollTableButton = element.querySelector(
        '[data-action="importRollTable"]'
    );

    if (rollTableButton) {
        const label = text(
            "Crear perfil desde RollTable",
            "Create profile from RollTable"
        );

        rollTableButton.title = label;
        rollTableButton.setAttribute(
            "aria-label",
            label
        );
    }
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

            /*
             * El resto del Gestor nunca trabaja directamente
             * con el objeto crudo del setting. Pasamos la
             * importación por la misma normalización que usa
             * el almacenamiento habitual antes de volver a
             * pintar la aplicación.
             */
            await TableProfileStorageService
                .migrateStorage();

            const storedProfiles =
                TableProfileStorageService.getStorage();

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

async function importConfigurationFromFile(
    application,
    file
) {
    try {
        const bundle = JSON.parse(
            await file.text()
        );
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
                                "Grupos de filtros",
                                "Filter groups"
                            ))}:</strong>
                            ${preview.filterGroupCount}
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
    catch (error) {
        console.error(
            "Compendium Curator | Error restaurando la configuración del Gestor.",
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
                    "El archivo no contiene una configuración válida del Gestor.",
                    "The file does not contain a valid Manager configuration."
                );

        ui.notifications.error(message);
    }
}

function createControlButton({
    action,
    icon,
    label,
    onClick
}) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.ccManagerConfiguration = action;
    button.title = label;
    button.setAttribute("aria-label", label);

    const iconElement =
        document.createElement("i");
    iconElement.className = icon;

    button.append(iconElement);
    button.append(
        document.createTextNode(` ${label}`)
    );
    button.addEventListener("click", onClick);

    return button;
}

export function registerTableManagerConfigurationControls() {
    Hooks.on(
        "renderTableManagerApplication",
        (application, element) => {
            if (!game.user.can("SETTINGS_MODIFY"))
                return;

            clarifyExistingImportControls(element);

            const actions = element.querySelector(
                ".cc-table-manager-header .cc-table-manager-actions"
            );

            if (!actions)
                return;

            if (
                !actions.querySelector(
                    '[data-cc-manager-configuration="export"]'
                )
            ) {
                actions.prepend(
                    createControlButton({
                        action: "export",
                        icon: "fas fa-file-export",
                        label: text(
                            "Exportar configuración",
                            "Export configuration"
                        ),
                        onClick: event => {
                            event.preventDefault();

                            TableManagerConfigurationService
                                .exportToFile();

                            ui.notifications.info(
                                text(
                                    "Configuración del Gestor exportada.",
                                    "Manager configuration exported."
                                )
                            );
                        }
                    })
                );
            }

            if (
                !actions.querySelector(
                    '[data-cc-manager-configuration="import"]'
                )
            ) {
                const importButton =
                    createControlButton({
                        action: "import",
                        icon: "fas fa-file-import",
                        label: text(
                            "Restaurar configuración",
                            "Restore configuration"
                        ),
                        onClick: event => {
                            event.preventDefault();

                            const input =
                                document.createElement(
                                    "input"
                                );
                            input.type = "file";
                            input.accept =
                                ".json,application/json";

                            input.addEventListener(
                                "change",
                                async () => {
                                    const file =
                                        input.files?.[0];

                                    if (!file)
                                        return;

                                    await importConfigurationFromFile(
                                        application,
                                        file
                                    );
                                },
                                { once: true }
                            );

                            input.click();
                        }
                    });

                const exportButton =
                    actions.querySelector(
                        '[data-cc-manager-configuration="export"]'
                    );

                exportButton?.after(importButton);
            }
        }
    );
}
