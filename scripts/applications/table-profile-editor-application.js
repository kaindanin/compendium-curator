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
         * El Gestor ya separa Contenido y
         * Subtablas. Usamos la pestaña activa
         * como valor inicial, pero el usuario
         * puede cambiarlo en el selector.
         */
        this.initialType =
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
            width: 520,
            height: 330
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

        context.profileTypes = [
            {
                value: "content",
                label:
                    "COMPENDIUM_CURATOR.TableProfileTypeContent",
                selected:
                    this.initialType === "content"
            },
            {
                value: "nested",
                label:
                    "COMPENDIUM_CURATOR.TableProfileTypeNested",
                selected:
                    this.initialType === "nested"
            }
        ];

        return context;

    }


    static async #onSave() {

        const nameInput =
            this.element.querySelector(
                '[name="profileName"]'
            );

        const typeInput =
            this.element.querySelector(
                '[name="profileType"]'
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
            typeInput?.value === "nested"
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
                 * se editarán desde el futuro
                 * inspector de contenido.
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

            /*
             * Si el usuario cambió el tipo en
             * el selector, mostramos la pestaña
             * correspondiente al cerrar.
             */
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
