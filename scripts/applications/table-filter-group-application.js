import {
    TableProfileService
} from "../services/table-profile-service.js";

import {
    TableProfileStorageService
} from "../services/table-profile-storage-service.js";

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

        super(options);

        this.browserApp =
            browserApp;

        this.managerApp =
            managerApp;

        this.profileId =
            profileId;

        this._draft =
            null;

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
                "COMPENDIUM_CURATOR.AddFilterGroupTitle"
        },

        position: {
            width: 520,
            height: 280
        },

        actions: {
            save: this.#onSave,
            cancel: this.#onCancel
        }

    };


    static PARTS = {

        body: {
            template:
                "modules/compendium-curator/templates/table-filter-group.hbs"
        }

    };


    async _prepareContext(options) {

        const context =
            await super._prepareContext(
                options
            );

        if (!this._draft) {

            this._draft =
                await TableProfileService
                    .createContentDraft(
                        this.browserApp
                    );

        }

        const profile =
            TableProfileStorageService
                .getProfiles()
                ?.[this.profileId];

        context.profileName =
            profile?.name ?? "";

        context.candidateCount =
            this._draft
                ?.includedCount ?? 0;

        context.hasCandidates =
            context.candidateCount > 0;

        return context;

    }


    static async #onSave() {

        if (!this._draft)
            return;

        const nameInput =
            this.element.querySelector(
                '[name="filterGroupName"]'
            );

        const name =
            String(
                nameInput?.value ?? ""
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
                    this.profileId,
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

        if (
            (
                this._draft
                    ?.includedCount ?? 0
            ) === 0
        ) {

            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNoObjects"
                )
            );

            return;

        }

        await TableProfileStorageService
            .addFilterGroup(
                this.profileId,
                {
                    name,

                    browser:
                        this._draft.browser,

                    matches:
                        this._draft.matches
                }
            );

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupSaved"
            )
        );

        if (this.managerApp?.rendered) {

            this.managerApp.render({
                force: true
            });

        }

        await this.close();

    }


    static async #onCancel() {

        await this.close();

    }

}