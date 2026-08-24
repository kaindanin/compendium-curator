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

export class TableProfileExclusionsApplication
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
            "compendium-curator-table-profile-exclusions",

        classes: [
            "dnd5e2",
            "cc-table-profile-exclusions-app"
        ],

        window: {
            title:
                "COMPENDIUM_CURATOR.ManualExclusions"
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
                "modules/compendium-curator/templates/table-profile-exclusions.hbs"
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

        const preview =
            await TableProfileService
                .getProfilePreview(
                    this.browserApp,
                    profile,
                    {
                        applyManualIncludes:
                            true,

                        applyManualExcludes:
                            false
                    }
                );

        const excluded =
            new Set(
                profile.manualExcludes ??
                []
            );

        this._candidateUuids =
            new Set(
                preview.candidates.map(
                    candidate =>
                        candidate.uuid
                )
            );

        context.profileName =
            profile.name;

        const preparedCandidates =
            await prepareDnd5eDocumentEntries(
                preview.candidates
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

                    excluded:
                        excluded.has(
                            candidate.uuid
                        )
                })
            );

        context.excludedCount =
            context.candidates.filter(
                candidate =>
                    candidate.excluded
            ).length;

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
         * Conservamos exclusiones antiguas
         * que actualmente no aparecen por
         * los filtros del perfil.
         */
        const exclusions =
            new Set(
                (
                    profile.manualExcludes ??
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
                '.cc-table-profile-exclusion-checkbox'
            )
        ) {

            if (checkbox.checked) {

                exclusions.add(
                    checkbox.dataset.uuid
                );

            }

        }

        await TableProfileStorageService
            .setManualExcludes(
                this.profileId,
                exclusions
            );

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.ManualExclusionsSaved"
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
