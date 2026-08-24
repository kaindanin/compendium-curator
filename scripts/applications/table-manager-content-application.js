import {
    TableProfileStorageService
} from "../services/table-profile-storage-service.js";
import {
    TableProfileFilterGroupLinkService
} from "../services/table-profile-filter-group-link-service.js";
import {
    canUseTableChild,
    getTableChildren,
    setTableChildEnabled
} from "../services/table-profile-relations-service.js";
import {
    TableFilterGroupApplication
} from "./table-filter-group-application.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

function text(es, en) {
    return game.i18n.lang.startsWith("es")
        ? es
        : en;
}

function sortByName(entries) {
    return [...entries].sort((a, b) =>
        String(a?.name ?? "").localeCompare(
            String(b?.name ?? ""),
            game.i18n.lang,
            { sensitivity: "base" }
        )
    );
}

export class TableManagerContentApplication
    extends HandlebarsApplicationMixin(
        ApplicationV2
    ) {

    constructor(
        managerApp,
        profileId,
        options = {}
    ) {
        super({
            ...options,
            window: {
                ...(options.window ?? {}),
                title: text(
                    "Gestionar contenido",
                    "Manage content"
                )
            }
        });

        this.managerApp = managerApp;
        this.browserApp =
            managerApp?.browserApp ?? null;
        this.profileId = profileId;
        this._filterGroupCreator = null;
        this._managerCloseHook =
            Hooks.on(
                "closeApplicationV2",
                app => {
                    if (
                        app === this.managerApp &&
                        this.rendered
                    ) {
                        void this.close();
                    }
                }
            );
    }

    static DEFAULT_OPTIONS = {
        id:
            "compendium-curator-table-manager-content",
        classes: [
            "dnd5e2",
            "compendium-curator",
            "cc-table-filter-group-app"
        ],
        position: {
            width: 600,
            height: 560
        },
        actions: {
            createCurrentFilters:
                this.#onCreateCurrentFilters,
            save: this.#onSave,
            cancel: this.#onCancel
        }
    };

    static PARTS = {
        body: {
            template:
                "modules/compendium-curator/templates/table-manager-content.hbs"
        }
    };

    async _prepareContext(options) {
        const context =
            await super._prepareContext(options);
        const profiles =
            TableProfileStorageService
                .getProfiles();
        const profile =
            profiles?.[this.profileId];

        if (!profile) {
            context.exists = false;
            return context;
        }

        context.exists = true;
        context.profileName = profile.name;
        context.titleLabel = text(
            "Gestionar contenido",
            "Manage content"
        );
        context.intro = text(
            "Selecciona los grupos de filtros y las otras tablas que forman parte de esta tabla.",
            "Select the filter groups and other tables that belong to this table."
        );
        context.filterGroupsLabel = text(
            "Grupos de filtros",
            "Filter groups"
        );
        context.otherTablesLabel = text(
            "Otras tablas",
            "Other tables"
        );
        context.addCurrentFiltersLabel = text(
            "Crear grupo con los filtros actuales",
            "Create group from current filters"
        );
        context.noOtherTablesLabel = text(
            "No hay otras tablas disponibles.",
            "There are no other tables available."
        );
        context.supportsFilterGroups =
            profile.type === "content";

        const selectedGroupIds =
            new Set(
                profile.filterGroupIds ?? []
            );
        const allProfiles =
            Object.values(profiles);

        context.groups = context.supportsFilterGroups
            ? sortByName(
                Object.values(
                    TableProfileStorageService
                        .getFilterGroups()
                ).map(group => ({
                    id: group.id,
                    name: group.name,
                    checked:
                        selectedGroupIds.has(
                            group.id
                        ),
                    matchCount:
                        Array.isArray(
                            group.matches
                        )
                            ? group.matches.length
                            : 0,
                    useCount:
                        allProfiles.filter(
                            candidate =>
                                Array.from(
                                    candidate
                                        .filterGroupIds ??
                                    []
                                ).includes(
                                    group.id
                                )
                        ).length
                }))
            )
            : [];

        context.hasGroups =
            context.groups.length > 0;

        const configured = new Map(
            getTableChildren(
                profile,
                profiles
            ).map(child => [
                child.profileId,
                child
            ])
        );

        context.tables = sortByName(
            allProfiles
                .filter(candidate =>
                    candidate?.version === 2 &&
                    candidate.id !== profile.id &&
                    (
                        configured.has(candidate.id) ||
                        canUseTableChild(
                            profile.id,
                            candidate.id,
                            profiles
                        )
                    )
                )
                .map(candidate => {
                    const relation =
                        configured.get(
                            candidate.id
                        );

                    return {
                        id: candidate.id,
                        name: candidate.name,
                        checked:
                            relation?.enabled === true
                    };
                })
        );

        context.hasTables =
            context.tables.length > 0;
        context.selectedGroupCount =
            context.groups.filter(
                group => group.checked
            ).length;
        context.selectedTableCount =
            context.tables.filter(
                table => table.checked
            ).length;
        context.selectedSummary =
            context.supportsFilterGroups
                ? text(
                    `${context.selectedGroupCount} grupos · ${context.selectedTableCount} tablas`,
                    `${context.selectedGroupCount} groups · ${context.selectedTableCount} tables`
                )
                : text(
                    `${context.selectedTableCount} tablas`,
                    `${context.selectedTableCount} tables`
                );

        return context;
    }

    async _onRender(context, options) {
        await super._onRender(
            context,
            options
        );

        const summary =
            this.element.querySelector(
                "[data-cc-content-selected-summary]"
            );

        const refreshSummary = () => {
            if (!summary)
                return;

            const groupCount =
                this.element.querySelectorAll(
                    '[name="filterGroupIds"]:checked'
                ).length;
            const tableCount =
                this.element.querySelectorAll(
                    '[name="tableProfileIds"]:checked'
                ).length;

            summary.textContent =
                context.supportsFilterGroups
                    ? text(
                        `${groupCount} grupos · ${tableCount} tablas`,
                        `${groupCount} groups · ${tableCount} tables`
                    )
                    : text(
                        `${tableCount} tablas`,
                        `${tableCount} tables`
                    );
        };

        for (
            const checkbox
            of this.element.querySelectorAll(
                '[name="filterGroupIds"], ' +
                '[name="tableProfileIds"]'
            )
        ) {
            checkbox.addEventListener(
                "change",
                refreshSummary
            );
        }

    }

    async _openFilterGroupCreator() {
        if (
            this._filterGroupCreator?.rendered
        ) {
            this._filterGroupCreator
                .bringToFront();
            return;
        }

        this._filterGroupCreator =
            new TableFilterGroupApplication(
                this.browserApp,
                this,
                this.profileId,
                {
                    createMode: true
                }
            );

        this._filterGroupCreator.render({
            force: true
        });
    }

    static async #onCreateCurrentFilters(
        event
    ) {
        event.preventDefault();
        await this._openFilterGroupCreator();
    }

    static async #onSave(event, target) {
        event.preventDefault();

        const profiles =
            TableProfileStorageService
                .getProfiles();
        const profile =
            profiles?.[this.profileId];

        if (!profile)
            return;

        const relationRows =
            Array.from(
                this.element.querySelectorAll(
                    "[data-cc-table-content-row]"
                )
            );

        const requestedRelations = [];

        for (const row of relationRows) {
            const checkbox = row.querySelector(
                '[name="tableProfileIds"]'
            );
            const childProfileId = String(
                checkbox?.value ?? ""
            ).trim();

            if (!childProfileId)
                continue;

            requestedRelations.push({
                profileId: childProfileId,
                enabled:
                    checkbox?.checked === true
            });
        }

        target.disabled = true;

        try {
            if (profile.type === "content") {
                const selectedGroupIds =
                    Array.from(
                        this.element.querySelectorAll(
                            '[name="filterGroupIds"]:checked'
                        )
                    ).map(input =>
                        input.value
                    );

                await TableProfileFilterGroupLinkService
                    .setProfileFilterGroups(
                        this.profileId,
                        selectedGroupIds
                    );
            }

            const currentProfile =
                TableProfileStorageService
                    .getProfiles()?.[
                        this.profileId
                    ];
            const currentProfiles =
                TableProfileStorageService
                    .getProfiles();
            const currentRelations =
                new Map(
                    getTableChildren(
                        currentProfile,
                        currentProfiles
                    ).map(child => [
                        child.profileId,
                        child
                    ])
                );

            for (
                const requested
                of requestedRelations
            ) {
                const current =
                    currentRelations.get(
                        requested.profileId
                    );

                if (
                    current?.enabled !==
                        requested.enabled &&
                    !(
                        !current &&
                        !requested.enabled
                    )
                ) {
                    await setTableChildEnabled(
                        this.profileId,
                        requested.profileId,
                        requested.enabled
                    );
                }
            }

            if (this.managerApp?.rendered) {
                await this.managerApp.render({
                    force: true
                });
            }

            await this.close();
        }
        catch (error) {
            console.error(
                "Compendium Curator | Error guardando el contenido de una tabla.",
                error
            );

            ui.notifications.error(text(
                "No se pudo guardar el contenido de la tabla.",
                "The table content could not be saved."
            ));
        }
        finally {
            if (target.isConnected)
                target.disabled = false;
        }
    }

    static async #onCancel() {
        await this.close();
    }

    async _preClose(options) {
        if (
            this._filterGroupCreator?.rendered
        ) {
            await this._filterGroupCreator.close();
        }

        this._filterGroupCreator = null;

        if (this._managerCloseHook !== null) {
            Hooks.off(
                "closeApplicationV2",
                this._managerCloseHook
            );
            this._managerCloseHook = null;
        }

        if (
            this.managerApp
                ?._ccContentManager === this
        ) {
            this.managerApp
                ._ccContentManager = null;
        }

        await super._preClose(options);
    }
}
