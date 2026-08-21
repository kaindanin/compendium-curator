import {
    TableDefaultsService
} from "../services/table-defaults-service.js";

import {
    TableProfileStorageService
} from "../services/table-profile-storage-service.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

export class TableProfileEditorApplication
    extends HandlebarsApplicationMixin(
        ApplicationV2
    ) {

    constructor(browserApp, options = {}) {

        super(options);

        this.browserApp = browserApp;

        /*
         * El tipo lo decide la pestaña desde la
         * que se abrió el editor. Ya no existe un
         * selector dentro de la ventana, evitando
         * crear accidentalmente un recurso de otro
         * tipo distinto al que representa la pestaña.
         */
        this.profileType =
            browserApp
                ?._ccTableManager
                ?._activeTab === "nested"
                ? "nested"
                : "content";

    }


    static DEFAULT_OPTIONS = {

        id:
            "compendium-curator-table-profile-editor",

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
            title:
                "COMPENDIUM_CURATOR.NewTableProfile",
            resizable: true
        },

        position: {
            width: 480,
            height: 250
        }

    };


    static PARTS = {

        body: {
            template:
                "modules/compendium-curator/templates/table-profile-editor.hbs"
        }

    };


    /*
     * Se conserva por compatibilidad con el
     * refresco del Compendium Browser. La
     * creación de perfiles ya no depende de
     * sus filtros actuales.
     */
    scheduleRefresh() {}


    async _prepareContext(options) {

        const context =
            await super._prepareContext(
                options
            );

        context.profileTypeLabel =
            this.profileType === "nested"
                ? "COMPENDIUM_CURATOR.TableProfileTypeNested"
                : "COMPENDIUM_CURATOR.TableProfileTypeContent";

        return context;

    }


    static async #onSave() {

        const nameInput =
            this.element.querySelector(
                '[name="profileName"]'
            );

        const name =
            String(
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

        const profileType =
            this.profileType === "nested"
                ? "nested"
                : "content";

        let profile;

        if (profileType === "nested") {

            profile = {
                version: 2,
                type: "nested",
                name,
                revision: 1,
                children: [],
                generation: {
                    masterUuid: null,
                    groupUuids: {},
                    generatedRevision: 0
                }
            };

        }
        else {

            const tableDefaults =
                TableDefaultsService.get();

            profile = {
                version: 2,
                type: "content",
                name,
                revision: 1,

                filterGroupIds: [],
                manualIncludes: [],
                manualExcludes: [],

                /*
                 * Los pesos ya no se configuran
                 * al crear el perfil. Heredamos
                 * los valores predeterminados y
                 * se editarán desde el inspector
                 * de contenido.
                 */
                weights: {
                    default: 1,
                    rarity:
                        foundry.utils.deepClone(
                            tableDefaults
                                ?.rarityWeights ?? {}
                        ),
                    overrides: {}
                },

                generation: {
                    masterUuid: null,
                    groupUuids: {},
                    generatedRevision: 0
                }
            };

        }

        try {

            await TableProfileStorageService
                .create(profile);

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

        const tableManager =
            this.browserApp
                ?._ccTableManager;

        if (tableManager?.rendered) {

            tableManager._activeTab =
                profileType === "nested"
                    ? "nested"
                    : "content";

            tableManager.render({
                force: true
            });

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
