import {
    TableDirectInclusionSelection
} from "../services/table-direct-inclusion-selection-service.js";
import {
    TableProfileService
} from "../services/table-profile-service.js";
import {
    TableProfileStorageService
} from "../services/table-profile-storage-service.js";
import {
    activateDnd5eDocumentEntries,
    prepareDnd5eIndexedEntries
} from "../ui/dnd5e-document-list.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

function checkboxIsChecked(checkbox) {
    return typeof checkbox?.checked === "boolean"
        ? checkbox.checked
        : checkbox?.hasAttribute("checked") === true;
}

export class TableProfileDirectObjectsApplication
    extends HandlebarsApplicationMixin(
        ApplicationV2
    ) {

    constructor(
        browserApp,
        managerApp,
        profileId,
        options = {}
    ) {
        super(options);

        this.browserApp = browserApp;
        this.managerApp = managerApp;
        this.profileId = profileId;

        this._selection = null;
        this._browserCandidates = [];
        this._browserSnapshotReady = false;
        this._browserLoading = true;
        this._browserError = false;
        this._refreshGeneration = 0;
        this._refreshRunning = false;
        this._refreshPending = false;
        this._refreshTimer = null;

        this._browserRenderHook = Hooks.on(
            "renderApplicationV2",
            app => {
                if (app === this.browserApp)
                    this.scheduleRefresh();
            }
        );

        this._closeApplicationHook = Hooks.on(
            "closeApplicationV2",
            app => {
                if (
                    app !== this.browserApp &&
                    app !== this.managerApp
                ) {
                    return;
                }

                if (this.rendered)
                    void this.close();
            }
        );

        this._browserFilterInputHandler = event => {
            const target = event.target;

            if (
                !(target instanceof Element) ||
                !this.browserApp?.element?.contains(target)
            ) {
                return;
            }

            const insideFilters = Boolean(
                target.closest(
                    '[data-application-part="types"], ' +
                    '[data-application-part="filters"]'
                )
            );
            const insideTabs = Boolean(
                target.closest(
                    '[data-application-part="tabs"] ' +
                    '[data-tab]'
                )
            );
            const searchField = target.matches(
                'search > input[name="name"]'
            );

            if (
                !insideFilters &&
                !insideTabs &&
                !searchField
            ) {
                return;
            }

            if (
                searchField &&
                this.browserApp?.currentFilters
            ) {
                const name = String(
                    target.value ?? ""
                );

                if (name) {
                    this.browserApp.currentFilters.name =
                        name;
                }
                else {
                    delete this.browserApp
                        .currentFilters.name;
                }
            }

            this.scheduleRefresh();
        };

        document.addEventListener(
            "input",
            this._browserFilterInputHandler,
            true
        );
        document.addEventListener(
            "change",
            this._browserFilterInputHandler,
            true
        );
        document.addEventListener(
            "click",
            this._browserFilterInputHandler,
            true
        );
    }

    static DEFAULT_OPTIONS = {
        id:
            "compendium-curator-table-profile-direct-objects",
        classes: [
            "dnd5e2",
            "cc-table-profile-direct-objects-app"
        ],
        window: {
            title:
                "COMPENDIUM_CURATOR.ManualInclusions"
        },
        position: {
            width: 920,
            height: 700
        },
        actions: {
            save: this.#onSave,
            cancel: this.#onCancel,
            selectAll: this.#onSelectAll,
            clearAll: this.#onClearAll
        }
    };

    static PARTS = {
        body: {
            template:
                "modules/compendium-curator/templates/table-profile-direct-objects.hbs"
        }
    };

    scheduleRefresh({ immediate = false } = {}) {
        this._refreshGeneration++;
        this._refreshPending = true;
        this._browserError = false;
        this._setBrowserLoading(true);

        game.tooltip?.clearPending?.();
        game.tooltip?.deactivate?.();

        clearTimeout(this._refreshTimer);

        this._refreshTimer = setTimeout(
            () => {
                this._refreshTimer = null;

                if (this.rendered)
                    void this._refreshLiveResults();
            },
            immediate ? 0 : 180
        );
    }

    _setBrowserLoading(loading) {
        this._browserLoading = loading === true;

        if (!this.rendered)
            return;

        const workspace = this.element.querySelector(
            "[data-cc-direct-inclusion-workspace]"
        );

        workspace?.classList.toggle(
            "is-loading",
            this._browserLoading
        );
        workspace?.setAttribute(
            "aria-busy",
            this._browserLoading
                ? "true"
                : "false"
        );

        const indicator = this.element.querySelector(
            "[data-cc-inclusions-loading]"
        );

        if (indicator)
            indicator.hidden = !this._browserLoading;
    }

    async _refreshLiveResults() {
        if (!this.rendered)
            return;

        if (this._refreshRunning) {
            this._refreshPending = true;
            return;
        }

        this._refreshRunning = true;

        try {
            while (
                this.rendered &&
                this._refreshPending
            ) {
                this._refreshPending = false;

                const generation =
                    this._refreshGeneration;

                try {
                    const draft =
                        await TableProfileService
                            .createContentDraft(
                                this.browserApp
                            );
                    const candidates = (
                        draft?.matches ?? []
                    ).map(uuid => ({ uuid }));

                    if (
                        generation !==
                        this._refreshGeneration
                    ) {
                        this._refreshPending = true;
                        continue;
                    }

                    const unique = new Map();

                    for (const candidate of candidates) {
                        if (candidate?.uuid) {
                            unique.set(
                                candidate.uuid,
                                candidate
                            );
                        }
                    }

                    this._browserCandidates = [
                        ...unique.values()
                    ];
                    this._browserSnapshotReady = true;
                    this._browserError = false;
                }
                catch (error) {
                    if (
                        generation !==
                        this._refreshGeneration
                    ) {
                        this._refreshPending = true;
                        continue;
                    }

                    console.error(
                        "Compendium Curator | Error actualizando las inclusiones desde el Navegador de Compendios.",
                        error
                    );

                    this._browserError = true;
                    this._browserSnapshotReady = true;
                }
            }
        }
        finally {
            this._refreshRunning = false;

            if (!this.rendered)
                return;

            if (this._refreshPending) {
                void this._refreshLiveResults();
                return;
            }

            this._setBrowserLoading(false);
            this.render({ force: true });
        }
    }

    async _prepareContext(options) {
        const context = await super
            ._prepareContext(options);
        const profile = TableProfileStorageService
            .getProfiles()?.[this.profileId];

        if (!profile) {
            context.exists = false;
            return context;
        }

        this._selection ??=
            new TableDirectInclusionSelection(
                profile.directUuids ?? []
            );

        const availableCandidates =
            this._selection.available(
                this._browserCandidates
            );
        const availableUuids = availableCandidates
            .map(candidate => candidate.uuid)
            .filter(Boolean);
        const selectedUuids =
            this._selection.values();

        context.exists = true;
        context.profileName = profile.name;
        context.candidates =
            prepareDnd5eIndexedEntries(
                availableUuids
            );
        context.inclusions =
            prepareDnd5eIndexedEntries(
                selectedUuids
            );
        context.candidateCount =
            context.candidates.length;
        context.selectedCount =
            context.inclusions.length;
        context.browserMatchCount =
            this._browserCandidates.length;
        context.hasCandidates =
            context.candidateCount > 0;
        context.hasInclusions =
            context.selectedCount > 0;
        context.hasBrowserMatches =
            context.browserMatchCount > 0;
        context.allBrowserMatchesIncluded =
            context.hasBrowserMatches &&
            !context.hasCandidates;
        context.isBrowserLoading =
            this._browserLoading ||
            !this._browserSnapshotReady;
        context.browserError = this._browserError;

        return context;
    }

    async _onRender(context, options) {
        await super._onRender(context, options);
        activateDnd5eDocumentEntries(this.element);

        for (
            const checkbox
            of this.element.querySelectorAll(
                ".cc-table-profile-direct-object-checkbox"
            )
        ) {
            checkbox.addEventListener(
                "change",
                () => {
                    const uuid = checkbox.dataset.uuid;

                    if (checkboxIsChecked(checkbox)) {
                        this._selection.select(uuid);
                    }
                    else {
                        this._selection.deselect(uuid);
                    }

                    game.tooltip?.clearPending?.();
                    game.tooltip?.deactivate?.();
                    void this.render({ force: true });
                }
            );
        }

        this._setBrowserLoading(
            context.isBrowserLoading
        );

        if (
            !this._browserSnapshotReady &&
            !this._refreshRunning &&
            this._refreshTimer === null
        ) {
            this.scheduleRefresh({
                immediate: true
            });
        }
    }

    static async #onSave() {
        if (!this._selection)
            return;

        await TableProfileStorageService
            .setDirectUuids(
                this.profileId,
                this._selection.values()
            );

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.ManualInclusionsSaved"
            )
        );

        if (this.managerApp?.rendered) {
            await this.managerApp.render({
                force: true
            });
        }

        if (this.managerApp?.managerApp?.rendered) {
            await this.managerApp.managerApp.render({
                force: true
            });
        }

        await this.close();
    }

    static async #onCancel() {
        await this.close();
    }

    static #onSelectAll() {
        this._selection?.selectAll(
            this._browserCandidates
        );
        void this.render({ force: true });
    }

    static #onClearAll() {
        this._selection?.clear();
        void this.render({ force: true });
    }

    async _preClose(options) {
        clearTimeout(this._refreshTimer);
        this._refreshGeneration++;
        this._refreshPending = false;

        if (this._browserRenderHook !== null) {
            Hooks.off(
                "renderApplicationV2",
                this._browserRenderHook
            );
            this._browserRenderHook = null;
        }

        if (this._closeApplicationHook !== null) {
            Hooks.off(
                "closeApplicationV2",
                this._closeApplicationHook
            );
            this._closeApplicationHook = null;
        }

        if (this._browserFilterInputHandler) {
            document.removeEventListener(
                "input",
                this._browserFilterInputHandler,
                true
            );
            document.removeEventListener(
                "change",
                this._browserFilterInputHandler,
                true
            );
            document.removeEventListener(
                "click",
                this._browserFilterInputHandler,
                true
            );
            this._browserFilterInputHandler = null;
        }

        await super._preClose(options);
    }
}
