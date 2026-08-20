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

            context.exists =
                false;

            return context;

        }

        context.exists =
            true;

        context.profileName =
            profile.name;

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
                                ).includes(
                                    group.id
                                )
                        ).length;

                    return {
                        id:
                            group.id,

                        name:
                            group.name,

                        checked:
                            selectedIds.has(
                                group.id
                            ),

                        matchCount:
                            Array.isArray(
                                group.matches
                            )
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
                                sensitivity:
                                    "base"
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


    async _onRender(
        context,
        options
    ) {

        await super._onRender(
            context,
            options
        );

        const inputs =
            Array.from(
                this.element
                    .querySelectorAll(
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
                    {
                        count
                    }
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

        const applications = [
            this.managerApp
                ?._profilePreview,
            this.managerApp
                ?._profileInclusions,
            this.managerApp
                ?._profileExclusions
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

        const draft =
            await TableProfileService
                .createContentDraft(
                    this.browserApp
                );

        if (
            (
                draft
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

        const field =
            document.createElement(
                "div"
            );

        field.className =
            "form-group";

        const label =
            document.createElement(
                "label"
            );

        label.textContent =
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupName"
            );

        const input =
            document.createElement(
                "input"
            );

        input.type = "text";
        input.name = "filterGroupName";
        input.autocomplete = "off";
        input.autofocus = true;

        field.append(
            label,
            input
        );

        const result =
            await foundry
                .applications
                .api
                .DialogV2
                .input({
                    window: {
                        title:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.AddFilterGroupTitle"
                            )
                    },

                    content:
                        field.outerHTML,

                    ok: {
                        label:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.AddFilterGroup"
                            )
                    },

                    rejectClose: false,
                    modal: true
                });

        if (!result)
            return;

        const name =
            String(
                result.filterGroupName ?? ""
            ).trim();

        if (!name) {

            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNameRequired"
                )
            );

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

            return;

        }

        await TableProfileStorageService
            .addFilterGroup(
                this.profileId,
                {
                    name,
                    browser:
                        draft.browser,
                    matches:
                        draft.matches
                }
            );

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupSaved"
            )
        );

        this._refreshParentApplications();

        this.render({
            force: true
        });

    }


    static async #onSave() {

        const selectedIds =
            Array.from(
                this.element
                    .querySelectorAll(
                        '[name="filterGroupIds"]:checked'
                    )
            )
                .map(input =>
                    input.value
                );

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

}
