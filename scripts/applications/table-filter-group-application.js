import {
    TableProfileService
} from "../services/table-profile-service.js";

import {
    TableProfileStorageService
} from "../services/table-profile-storage-service.js";

import {
    TableProfileFilterGroupLinkService
} from "../services/table-profile-filter-group-link-service.js";

import {
    activateDnd5eDocumentEntries,
    prepareDnd5eDocumentEntries
} from "../ui/dnd5e-document-list.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

export class TableFilterGroupApplication
    extends HandlebarsApplicationMixin(
        ApplicationV2
    ) {

    constructor(
        browserApp,
        managerApp,
        profileId,
        options = {}
    ) {

        const createMode =
            options.createMode === true;

        const applicationOptions = {
            ...options
        };

        delete applicationOptions.createMode;

        if (createMode) {

            applicationOptions.id =
                "compendium-curator-table-filter-group-creator";

            applicationOptions.window = {
                ...(applicationOptions.window ?? {}),
                title:
                    "COMPENDIUM_CURATOR.AddFilterGroupTitle"
            };

            applicationOptions.position = {
                width: 650,
                height: 680,
                ...(applicationOptions.position ?? {})
            };

        }

        super(applicationOptions);

        this.browserApp = browserApp;
        this.managerApp = managerApp;
        this.profileId = profileId ?? null;
        this.isCreateMode = createMode;

        this._draftName = "";
        this._draft = null;
        this._ccRefreshTimer = null;
        this._didInitialFocus = false;
        this._browserRenderHook = null;
        this._closeApplicationHook = null;

        if (this.isCreateMode) {

            this._browserRenderHook =
                Hooks.on(
                    "renderApplicationV2",
                    app => {

                        if (app !== this.browserApp)
                            return;

                        this.scheduleRefresh();

                    }
                );

            this._closeApplicationHook =
                Hooks.on(
                    "closeApplicationV2",
                    app => {

                        if (
                            app !== this.browserApp &&
                            app !== this.managerApp
                        ) {
                            return;
                        }

                        if (this.rendered) {
                            void this.close();
                        }

                    }
                );

        }

    }


    static DEFAULT_OPTIONS = {
        id:
            "compendium-curator-table-filter-group",
        classes: [
            "dnd5e2",
            "cc-table-filter-group-app"
        ],
        window: {
            title:
                "COMPENDIUM_CURATOR.FilterGroups"
        },
        position: {
            width: 560,
            height: 520
        },
        actions: {
            createCurrentFilters:
                this.#onCreateCurrentFilters,
            create:
                this.#onCreate,
            save:
                this.#onSave,
            cancel:
                this.#onCancel
        }
    };


    static PARTS = {
        body: {
            template:
                "modules/compendium-curator/templates/table-filter-group.hbs"
        }
    };


    static async createFromCurrentFilters(
        browserApp,
        profileId = null
    ) {

        const current =
            browserApp?._ccFilterGroupCreator;

        if (current?.rendered) {

            if (
                current.profileId ===
                    (profileId ?? null)
            ) {
                current.bringToFront();
                return null;
            }

            await current.close();

        }

        const creator =
            new TableFilterGroupApplication(
                browserApp,
                browserApp?._ccTableManager ?? null,
                profileId,
                {
                    createMode: true
                }
            );

        browserApp._ccFilterGroupCreator =
            creator;

        creator.render({
            force: true
        });

        return null;

    }


    scheduleRefresh() {

        if (!this.isCreateMode)
            return;

        clearTimeout(
            this._ccRefreshTimer
        );

        this._ccRefreshTimer =
            setTimeout(() => {

                this._ccRefreshTimer = null;

                if (!this.rendered)
                    return;

                this.render({
                    force: true
                });

            }, 120);

    }


    async _prepareContext(options) {

        const context =
            await super._prepareContext(options);

        context.isCreateMode =
            this.isCreateMode;

        if (this.isCreateMode) {

            const draft =
                await TableProfileService
                    .createContentDraft(
                        this.browserApp
                    );

            this._draft = draft ?? null;

            context.filterGroupName =
                this._draftName;

            const profile =
                this.profileId
                    ? TableProfileStorageService
                        .getProfiles()?.[
                            this.profileId
                        ]
                    : null;

            context.profileName =
                profile?.name ?? "";

            context.linkToProfile =
                Boolean(profile);

            context.filterGroups =
                TableProfileService
                    .getFilterDisplayGroups(
                        this.browserApp,
                        draft?.browser
                            ?.filters ?? {}
                    );

            context.hasFilters =
                context.filterGroups.length > 0;

            const matchUuids =
                Array.from(
                    draft?.matches ?? []
                );

            context.matches =
                await prepareDnd5eDocumentEntries(
                    matchUuids
                );

            context.matchCount =
                Number(
                    draft?.includedCount ??
                    matchUuids.length
                );

            context.hasMatches =
                context.matchCount > 0;

            return context;

        }

        const profile =
            TableProfileStorageService
                .getProfiles()?.[this.profileId];

        if (!profile) {
            context.exists = false;
            return context;
        }

        context.exists = true;
        context.profileName = profile.name;

        const selectedIds =
            new Set(
                profile.filterGroupIds ?? []
            );

        const profiles =
            Object.values(
                TableProfileStorageService
                    .getProfiles()
            );

        context.groups =
            Object.values(
                TableProfileStorageService
                    .getFilterGroups()
            )
                .map(group => {

                    const useCount =
                        profiles.filter(
                            usedProfile =>
                                Array.from(
                                    usedProfile
                                        .filterGroupIds ?? []
                                ).includes(group.id)
                        ).length;

                    return {
                        id: group.id,
                        name: group.name,
                        checked:
                            selectedIds.has(group.id),
                        matchCount:
                            Array.isArray(group.matches)
                                ? group.matches.length
                                : 0,
                        useCount
                    };

                })
                .sort((a, b) =>
                    String(a.name ?? "")
                        .localeCompare(
                            String(b.name ?? ""),
                            game.i18n.lang,
                            {
                                sensitivity: "base"
                            }
                        )
                );

        context.hasGroups =
            context.groups.length > 0;

        context.selectedCount =
            context.groups.filter(
                group => group.checked
            ).length;

        return context;

    }


    async _onRender(context, options) {

        await super._onRender(
            context,
            options
        );

        if (this.isCreateMode) {

            const nameInput =
                this.element.querySelector(
                    '[name="filterGroupName"]'
                );

            nameInput?.addEventListener(
                "input",
                event => {
                    this._draftName =
                        String(
                            event.target?.value ?? ""
                        );
                }
            );

            if (!this._didInitialFocus) {
                this._didInitialFocus = true;
                nameInput?.focus();
            }

            activateDnd5eDocumentEntries(
                this.element
            );

            return;

        }

        const inputs =
            Array.from(
                this.element.querySelectorAll(
                    '[name="filterGroupIds"]'
                )
            );

        const countElement =
            this.element.querySelector(
                "[data-cc-selected-count]"
            );

        const refreshCount = () => {

            if (!countElement)
                return;

            const count =
                inputs.filter(
                    input => input.checked
                ).length;

            countElement.textContent =
                game.i18n.format(
                    "COMPENDIUM_CURATOR.FilterGroupCount",
                    { count }
                );

        };

        for (const input of inputs) {
            input.addEventListener(
                "change",
                refreshCount
            );
        }

    }


    _refreshParentApplications() {

        if (this.managerApp?.rendered) {
            this.managerApp.render({
                force: true
            });
        }

        const groupEditor =
            this.managerApp
                ?._filterGroupEditor;

        if (
            groupEditor?.rendered &&
            groupEditor !== this &&
            groupEditor.profileId ===
                this.profileId
        ) {
            groupEditor.render({
                force: true
            });
        }

        const applications = [
            this.managerApp?._profilePreview,
            this.managerApp?._profileInclusions,
            this.managerApp?._profileExclusions
        ];

        for (
            const application
            of applications
        ) {

            if (
                application?.rendered &&
                application.profileId ===
                    this.profileId
            ) {
                application.render({
                    force: true
                });
            }

        }

    }


    static async #onCreateCurrentFilters() {

        await TableFilterGroupApplication
            .createFromCurrentFilters(
                this.browserApp,
                this.profileId
            );

    }


    static async #onCreate() {

        if (!this.isCreateMode)
            return;

        const nameInput =
            this.element.querySelector(
                '[name="filterGroupName"]'
            );

        const name =
            String(
                nameInput?.value ??
                this._draftName ??
                ""
            ).trim();

        if (!name) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNameRequired"
                )
            );
            nameInput?.focus();
            return;
        }

        if (
            TableProfileStorageService
                .isFilterGroupNameTaken(
                    null,
                    name
                )
        ) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNameTaken"
                )
            );
            nameInput?.focus();
            nameInput?.select();
            return;
        }

        /*
         * Volvemos a capturar el estado justo al
         * guardar para que el grupo corresponda
         * exactamente a los filtros que están
         * visibles en ese momento.
         */
        const draft =
            await TableProfileService
                .createContentDraft(
                    this.browserApp
                );

        if (
            (draft?.includedCount ?? 0) === 0
        ) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNoObjects"
                )
            );
            return;
        }

        const filterGroup = {
            name,
            browser:
                draft.browser,
            matches:
                draft.matches
        };

        try {

            if (this.profileId) {
                await TableProfileStorageService
                    .addFilterGroup(
                        this.profileId,
                        filterGroup
                    );
            }
            else {
                await TableProfileStorageService
                    .createFilterGroup(
                        filterGroup
                    );
            }

        }
        catch (error) {

            if (
                error?.message ===
                    "FILTER_GROUP_NAME_TAKEN"
            ) {
                ui.notifications.warn(
                    game.i18n.localize(
                        "COMPENDIUM_CURATOR.FilterGroupNameTaken"
                    )
                );
                nameInput?.focus();
                nameInput?.select();
                return;
            }

            throw error;

        }

        this._refreshParentApplications();

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupSaved"
            )
        );

        await this.close();

    }


    static async #onSave() {

        if (this.isCreateMode)
            return;

        const selectedIds =
            Array.from(
                this.element.querySelectorAll(
                    '[name="filterGroupIds"]:checked'
                )
            )
                .map(input => input.value);

        await TableProfileFilterGroupLinkService
            .setProfileFilterGroups(
                this.profileId,
                selectedIds
            );

        this._refreshParentApplications();

        await this.close();

    }


    static async #onCancel() {
        await this.close();
    }


    async _preClose(options) {

        clearTimeout(
            this._ccRefreshTimer
        );

        if (
            this._browserRenderHook !== null
        ) {
            Hooks.off(
                "renderApplicationV2",
                this._browserRenderHook
            );
            this._browserRenderHook = null;
        }

        if (
            this._closeApplicationHook !== null
        ) {
            Hooks.off(
                "closeApplicationV2",
                this._closeApplicationHook
            );
            this._closeApplicationHook = null;
        }

        if (
            this.browserApp
                ?._ccFilterGroupCreator ===
            this
        ) {
            this.browserApp
                ._ccFilterGroupCreator = null;
        }

        await super._preClose(options);

    }

}
