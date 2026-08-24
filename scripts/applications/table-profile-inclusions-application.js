import {
    TableProfileService
} from "../services/table-profile-service.js";

import {
    TableProfileStorageService
} from "../services/table-profile-storage-service.js";

import {
    activateDnd5eDocumentEntries,
    prepareDnd5eDocumentEntries
} from "../ui/dnd5e-document-list.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

export class TableProfileInclusionsApplication
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

        this.browserApp =
            browserApp;

        this.managerApp =
            managerApp;

        this.profileId =
            profileId;

        this._candidateUuids =
            new Set();

    }


    static DEFAULT_OPTIONS = {

        id:
            "compendium-curator-table-profile-inclusions",

        classes: [
            "dnd5e2",
            "cc-table-profile-inclusions-app"
        ],

        window: {
            title:
                "COMPENDIUM_CURATOR.ManualInclusions"
        },

        position: {
            width: 620,
            height: 650
        },

        actions: {
            save: this.#onSave,
            cancel: this.#onCancel
        }

    };


    static PARTS = {

        body: {
            template:
                "modules/compendium-curator/templates/table-profile-inclusions.hbs"
        }

    };


    async _prepareContext(options) {

        const context =
            await super._prepareContext(
                options
            );

        const profile =
            TableProfileStorageService
                .getProfiles()
                ?.[this.profileId];

        if (!profile) {

            context.profileName = "";
            context.candidates = [];
            context.hasCandidates = false;

            return context;

        }

        const included =
            new Set(
                profile.manualIncludes ??
                []
            );

        const candidatesByUuid =
            new Map();

        /*
         * Los filtros actuales del Browser
         * determinan qué objetos podemos
         * añadir cómodamente desde esta
         * ventana.
         */
        const browserCandidates =
            await TableProfileService
                .getBrowserCandidates(
                    this.browserApp
                );

        for (
            const candidate
            of browserCandidates
        ) {

            candidatesByUuid.set(
                candidate.uuid,
                candidate
            );

        }

        /*
         * Mostramos también inclusiones
         * existentes aunque ya no coincidan
         * con los filtros actuales, para que
         * puedan eliminarse.
         */
        for (const uuid of included) {

            if (
                candidatesByUuid.has(
                    uuid
                )
            ) {
                continue;
            }

            const document =
                await fromUuid(uuid);

            if (!document)
                continue;

            candidatesByUuid.set(
                uuid,
                document
            );

        }

        const candidates =
            [
                ...candidatesByUuid.values()
            ];

        candidates.sort(
            (a, b) =>
                String(a.name ?? "")
                    .localeCompare(
                        String(b.name ?? ""),
                        game.i18n.lang,
                        {
                            sensitivity: "base"
                        }
                    )
        );

        this._candidateUuids =
            new Set(
                candidates.map(
                    candidate =>
                        candidate.uuid
                )
            );

        context.profileName =
            profile.name;

        const preparedCandidates =
            await prepareDnd5eDocumentEntries(
                candidates
                    .map(
                        candidate =>
                            candidate.uuid
                    )
                    .filter(Boolean)
            );

        context.candidates =
            preparedCandidates.map(
                candidate => ({
                    ...candidate,

                    included:
                        included.has(
                            candidate.uuid
                        )
                })
            );

        context.hasCandidates =
            context.candidates.length > 0;

        return context;

    }

    async _onRender(
        context,
        options
    ) {

        await super._onRender(
            context,
            options
        );

        activateDnd5eDocumentEntries(
            this.element
        );

    }

    static async #onSave() {

        const profile =
            TableProfileStorageService
                .getProfiles()
                ?.[this.profileId];

        if (!profile)
            return;

        /*
         * Conservamos inclusiones antiguas
         * que no están disponibles en la
         * lista actual.
         */
        const inclusions =
            new Set(
                (
                    profile.manualIncludes ??
                    []
                ).filter(
                    uuid =>
                        !this
                            ._candidateUuids
                            .has(uuid)
                )
            );

        for (
            const checkbox
            of this.element.querySelectorAll(
                ".cc-table-profile-inclusion-checkbox"
            )
        ) {

            if (
                checkbox.checked === true ||
                checkbox.hasAttribute("checked")
            ) {

                inclusions.add(
                    checkbox.dataset.uuid
                );

            }

        }

        await TableProfileStorageService
            .setManualIncludes(
                this.profileId,
                inclusions
            );

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.ManualInclusionsSaved"
            )
        );

        if (this.managerApp?.rendered) {

            this.managerApp.render({
                force: true
            });

        }

        const preview =
            this.managerApp
                ?._profilePreview;

        if (
            preview?.rendered &&
            preview.profileId ===
                this.profileId
        ) {

            preview.render({
                force: true
            });

        }

        await this.close();

    }


    static async #onCancel() {

        await this.close();

    }

}
