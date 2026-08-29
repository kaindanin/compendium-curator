import {
    TableProfileStorageService
} from "../services/table-profile-storage-service.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

function createEmptyTableProfile(name) {
    return {
        version: 2,
        type: "content",
        name,
        revision: 1,
        filterGroupIds: [],
        directUuids: [],
        restrictions: null,
        manualExcludes: [],
        contentLayout: {
            mode: "direct",
            sources: {}
        },
        draw: {
            count: 1,
            priceAdjustment: 100,
            quantityMin: 1,
            quantityMax: 1
        },
        itemRules: {
            excludeZeroPrice: false
        },
        distribution: {
            version: 2,
            mode: "individual",
            individual: {
                defaultWeight: 1,
                weights: {}
            },
            grouped: {
                groups: {},
                configurations: {},
                manualGroups: []
            }
        },
        weights: {
            default: 1,
            rarity: {},
            overrides: {}
        },
        generation: {
            masterUuid: null,
            groupUuids: {},
            rootUuid: null,
            nodes: {},
            generatedRevision: 0
        }
    };
}

export class TableProfileEditorApplication
    extends HandlebarsApplicationMixin(
        ApplicationV2
    ) {

    constructor(browserApp, options = {}) {
        super(options);
        this.browserApp = browserApp;
        this.profileType = "content";
        this._draftName = "";
    }

    static DEFAULT_OPTIONS = {
        id: "compendium-curator-table-profile-editor",
        classes: [
            "dnd5e2",
            "compendium-curator",
            "cc-table-profile-editor-app"
        ],
        actions: {
            save: this.#onSave,
            cancel: this.#onCancel
        },
        window: {
            title: "COMPENDIUM_CURATOR.NewTableProfile",
            resizable: false
        },
        position: {
            width: 380,
            height: 170
        }
    };

    static PARTS = {
        body: {
            template:
                "modules/compendium-curator/templates/table-profile-editor.hbs"
        }
    };

    scheduleRefresh() {
        /*
         * La creación ya no depende de los filtros actuales del
         * Navegador. Conservamos el método como punto de integración
         * para los avisos existentes, pero no necesita refrescar nada.
         */
    }

    prepareForCreate() {
        this._draftName = "";
    }

    async _prepareContext(options) {
        const context =
            await super._prepareContext(options);

        context.profileName = this._draftName;
        return context;
    }

    async _onRender(context, options) {
        await super._onRender(context, options);

        const nameInput = this.element.querySelector(
            '[name="profileName"]'
        );

        nameInput?.addEventListener("input", event => {
            this._draftName = String(
                event.target.value ?? ""
            );
        });
    }

    static async #onSave(event, target) {
        event.preventDefault();

        const nameInput = this.element.querySelector(
            '[name="profileName"]'
        );
        const name = String(
            nameInput?.value ?? ""
        ).trim();

        if (!name) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.ProfileNameRequired"
                )
            );
            nameInput?.focus();
            return;
        }

        target.disabled = true;

        try {
            await TableProfileStorageService.create(
                createEmptyTableProfile(name)
            );
        }
        catch (error) {
            if (
                error?.message ===
                    "TABLE_PROFILE_NAME_TAKEN"
            ) {
                ui.notifications.warn(
                    game.i18n.localize(
                        "COMPENDIUM_CURATOR.TableProfileNameTaken"
                    )
                );
                nameInput?.focus();
                nameInput?.select();
                return;
            }

            throw error;
        }
        finally {
            if (target.isConnected)
                target.disabled = false;
        }

        const tableManager =
            this.browserApp?._ccTableManager;

        if (tableManager?.rendered) {
            tableManager._activeTab = "content";
            await tableManager.render({ force: true });
        }

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.TableProfileSaved"
            )
        );

        await this.close();
    }

    static async #onCancel() {
        await this.close();
    }
}
