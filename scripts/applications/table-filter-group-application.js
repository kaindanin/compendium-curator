import {
    TableProfileService
} from "../services/table-profile-service.js";

import {
    TableProfileStorageService
} from "../services/table-profile-storage-service.js";

import {
    TableProfileFilterGroupLinkService
} from "../services/table-profile-filter-group-link-service.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

const LIVE_PREVIEW_LIMIT = 300;

function prepareLivePreviewEntries(uuids) {

    const entries =
        Array.from(
            new Set(
                uuids ?? []
            )
        )
            .map(uuid => {

                const value =
                    String(uuid ?? "");

                let name = "";

                const parts =
                    value.split(".");

                if (
                    parts[0] ===
                        "Compendium" &&
                    parts.length >= 4
                ) {

                    const collection =
                        `${parts[1]}.${parts[2]}`;

                    const documentId =
                        parts.at(-1);

                    const indexEntry =
                        game.packs
                            ?.get(collection)
                            ?.index
                            ?.get(documentId);

                    name =
                        String(
                            indexEntry?.name ??
                            ""
                        );

                }

                if (
                    !name &&
                    typeof fromUuidSync ===
                        "function"
                ) {

                    name =
                        String(
                            fromUuidSync(value)
                                ?.name ??
                            ""
                        );

                }

                return {
                    uuid: value,
                    name: name || value
                };

            })
            .filter(entry =>
                Boolean(entry.uuid)
            )
            .sort((a, b) =>
                a.name.localeCompare(
                    b.name,
                    game.i18n.lang,
                    {
                        sensitivity: "base"
                    }
                )
            );

    return {
        entries:
            entries.slice(
                0,
                LIVE_PREVIEW_LIMIT
            ),
        total:
            entries.length
    };

}

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

        this._previewSnapshot = null;
        this._previewGeneration = 0;
        this._previewRunning = false;
        this._previewPending = false;
        this._previewLoading = createMode;
        this._previewError = false;

        this._ccRefreshTimer = null;
        this._didInitialFocus = false;

        this._browserRenderHook = null;
        this._closeApplicationHook = null;
        this._browserFilterInputHandler = null;

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

            this._browserFilterInputHandler =
                event => {

                    const target =
                        event.target;

                    if (
                        !(target instanceof Element)
                    ) {
                        return;
                    }

                    const insideFilters =
                        Boolean(
                            target.closest(
                                '[data-application-part="types"], ' +
                                '[data-application-part="filters"]'
                            )
                        );

                    const searchField =
                        target.matches(
                            'search > input[name="name"]'
                        );

                    if (
                        !insideFilters &&
                        !searchField
                    ) {
                        return;
                    }

                    this.scheduleRefresh();

                };

            this.browserApp
                ?.element
                ?.addEventListener(
                    "input",
                    this._browserFilterInputHandler,
                    true
                );

            this.browserApp
                ?.element
                ?.addEventListener(
                    "change",
                    this._browserFilterInputHandler,
                    true
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


    scheduleRefresh({
        immediate = false
    } = {}) {

        if (!this.isCreateMode)
            return;

        this._previewGeneration++;
        this._previewPending = true;
        this._previewError = false;

        this._setPreviewLoading(true);

        /*
         * Un render del Browser puede destruir el
         * enlace sobre el que D&D5e estaba preparando
         * un tooltip. Limpiamos cualquier tooltip
         * pendiente antes de que cambie el DOM.
         */
        game.tooltip?.clearPending?.();
        game.tooltip?.deactivate?.();

        clearTimeout(
            this._ccRefreshTimer
        );

        this._ccRefreshTimer =
            setTimeout(() => {

                this._ccRefreshTimer = null;

                if (!this.rendered)
                    return;

                void this._refreshLivePreview();

            }, immediate ? 0 : 180);

    }


    _setPreviewLoading(loading) {

        this._previewLoading =
            loading === true;

        if (!this.rendered)
            return;

        const indicator =
            this.element.querySelector(
                "[data-cc-preview-loading]"
            );

        if (indicator) {
            indicator.hidden =
                !this._previewLoading;
        }

        const preview =
            this.element.querySelector(
                "[data-cc-live-preview]"
            );

        preview?.classList.toggle(
            "is-loading",
            this._previewLoading
        );

        if (preview) {
            preview.setAttribute(
                "aria-busy",
                this._previewLoading
                    ? "true"
                    : "false"
            );

            const results =
                preview.querySelector(
                    ".cc-table-filter-group-live-results"
                );

            if (results) {
                results.style.opacity =
                    this._previewLoading
                        ? "0.45"
                        : "";
            }
        }

        const createButton =
            this.element.querySelector(
                '[data-action="create"]'
            );

        if (createButton) {

            createButton.disabled =
                this._previewLoading ||
                !this._previewSnapshot
                    ?.hasMatches;

        }

    }


    async _refreshLivePreview() {

        if (
            !this.isCreateMode ||
            !this.rendered
        ) {
            return;
        }

        /*
         * Nunca ejecutamos dos consultas del
         * Browser a la vez. Si llega otro cambio
         * mientras una está trabajando, dejamos
         * marcada una nueva pasada y descartamos
         * el resultado antiguo.
         */
        if (this._previewRunning) {

            this._previewPending = true;

            return;

        }

        this._previewRunning = true;

        try {

            while (
                this.rendered &&
                this._previewPending
            ) {

                this._previewPending =
                    false;

                const generation =
                    this._previewGeneration;

                let draft;

                try {

                    draft =
                        await TableProfileService
                            .createContentDraft(
                                this.browserApp
                            );

                }
                catch (error) {

                    if (
                        generation !==
                        this._previewGeneration
                    ) {
                        this._previewPending =
                            true;

                        continue;
                    }

                    console.error(
                        "Compendium Curator | Error actualizando la vista previa del grupo de filtros.",
                        error
                    );

                    this._draft = null;
                    this._previewSnapshot = null;
                    this._previewError = true;

                    break;

                }

                if (
                    !this.rendered
                ) {
                    return;
                }

                if (
                    generation !==
                    this._previewGeneration
                ) {

                    this._previewPending =
                        true;

                    continue;

                }

                const filterGroups =
                    TableProfileService
                        .getFilterDisplayGroups(
                            this.browserApp,
                            draft?.browser
                                ?.filters ?? {}
                        );

                /*
                 * La lista viva usa únicamente los índices
                 * ya cargados por el Compendium Browser.
                 * No hacemos fromUuid() ni traducciones
                 * completas para cientos de documentos.
                 */
                const preview =
                    prepareLivePreviewEntries(
                        draft?.matches ?? []
                    );

                if (
                    generation !==
                    this._previewGeneration
                ) {

                    this._previewPending =
                        true;

                    continue;

                }

                const matchCount =
                    Number(
                        draft?.includedCount ??
                        preview.total
                    );

                this._draft =
                    draft ?? null;

                this._previewSnapshot = {
                    filterGroups,
                    hasFilters:
                        filterGroups.length > 0,
                    matches:
                        preview.entries,
                    previewCount:
                        preview.entries.length,
                    previewTruncated:
                        matchCount >
                        preview.entries.length,
                    matchCount,
                    hasMatches:
                        matchCount > 0
                };

            }

        }
        finally {

            this._previewRunning =
                false;

            if (!this.rendered)
                return;

            if (this._previewPending) {

                void this
                    ._refreshLivePreview();

                return;

            }

            this._setPreviewLoading(false);

            this.render({
                force: true
            });

        }

    }


    async _prepareContext(options) {

        const context =
            await super._prepareContext(options);

        context.isCreateMode =
            this.isCreateMode;

        if (this.isCreateMode) {

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

            const snapshot =
                this._previewSnapshot ?? {
                    filterGroups: [],
                    hasFilters: false,
                    matches: [],
                    previewCount: 0,
                    previewTruncated: false,
                    matchCount: 0,
                    hasMatches: false
                };

            context.filterGroups =
                snapshot.filterGroups;

            context.hasFilters =
                snapshot.hasFilters;

            context.matches =
                snapshot.matches;

            context.previewCount =
                snapshot.previewCount;

            context.previewTruncated =
                snapshot.previewTruncated;

            context.matchCount =
                snapshot.matchCount;

            context.hasMatches =
                snapshot.hasMatches;

            context.isPreviewLoading =
                this._previewLoading ||
                !this._previewSnapshot;

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

            this._setPreviewLoading(
                context.isPreviewLoading
            );

            if (
                !this._previewSnapshot &&
                !this._previewError &&
                !this._previewRunning &&
                this._ccRefreshTimer === null
            ) {
                this.scheduleRefresh({
                    immediate: true
                });
            }

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
         * Mientras haya una consulta pendiente
         * no permitimos guardar una instantánea
         * que ya no corresponde a los filtros
         * visibles.
         */
        if (
            this._previewLoading ||
            this._previewRunning ||
            this._previewPending ||
            !this._draft
        ) {
            return;
        }

        const draft =
            this._draft;

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

        this._previewGeneration++;
        this._previewPending = false;

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
            this._browserFilterInputHandler
        ) {

            this.browserApp
                ?.element
                ?.removeEventListener(
                    "input",
                    this._browserFilterInputHandler,
                    true
                );

            this.browserApp
                ?.element
                ?.removeEventListener(
                    "change",
                    this._browserFilterInputHandler,
                    true
                );

            this._browserFilterInputHandler =
                null;

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
