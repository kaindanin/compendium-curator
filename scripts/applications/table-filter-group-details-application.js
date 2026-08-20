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


export class TableFilterGroupDetailsApplication
    extends HandlebarsApplicationMixin(
        ApplicationV2
    ) {

    constructor(
        browserApp,
        profile,
        filterGroup,
        options = {}
    ) {

        super(options);

        this.browserApp =
            browserApp;

        this.profile =
            profile
                ? foundry.utils.deepClone(
                    profile
                )
                : null;

        this.filterGroup =
            foundry.utils.deepClone(
                filterGroup
            );

        this.profileId =
            profile?.id ?? null;

        this.filterGroupId =
            filterGroup.id;

    }


    static DEFAULT_OPTIONS = {

        id:
            "compendium-curator-table-filter-group-details",

        classes: [
            "dnd5e2",
            "cc-table-filter-group-details-app"
        ],

        window: {
            title:
                "COMPENDIUM_CURATOR.FilterGroupDetails"
        },

        position: {
            width: 600,
            height: 650
        }

    };


    static PARTS = {

        body: {
            template:
                "modules/compendium-curator/templates/table-filter-group-details.hbs"
        }

    };


    async _prepareContext(options) {

        const context =
            await super._prepareContext(
                options
            );

        const filterGroup =
            TableProfileStorageService
                .getFilterGroup(
                    this.filterGroupId
                ) ??
            this.filterGroup;

        if (!filterGroup) {

            context.exists =
                false;

            return context;

        }

        context.exists =
            true;

        context.groupName =
            filterGroup.name;

        const profiles =
            Object.values(
                TableProfileStorageService
                    .getProfiles()
            );

        context.usedBy =
            profiles
                .filter(profile =>
                    Array.isArray(
                        profile.filterGroups
                    ) &&
                    profile.filterGroups
                        .some(group =>
                            group.id ===
                            filterGroup.id
                        )
                )
                .map(profile => ({
                    id: profile.id,
                    name: profile.name
                }))
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

        context.hasUsage =
            context.usedBy.length > 0;

        context.filterGroups =
            TableProfileService
                .getFilterDisplayGroups(
                    this.browserApp,
                    filterGroup
                        .browser
                        ?.filters ??
                    {}
                );

        context.hasFilters =
            context
                .filterGroups
                .length > 0;

        const matchUuids =
            Array.isArray(
                filterGroup.matches
            )
                ? filterGroup.matches
                : [];

        context.matches =
            await prepareDnd5eDocumentEntries(
                matchUuids
            );

        context.matchCount =
            matchUuids.length;

        context.hasMatches =
            context.matches.length >
                0;

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

}
