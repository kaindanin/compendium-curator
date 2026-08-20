import {
    TableProfileService
} from "../services/table-profile-service.js";

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
            foundry.utils.deepClone(
                profile
            );

        this.filterGroup =
            foundry.utils.deepClone(
                filterGroup
            );

        this.profileId =
            profile.id;

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

        const profile =
            this.profile;

        const filterGroup =
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

        context.profileName =
            profile.name;

        /*
         * Los bloques proceden directamente
         * de las definiciones del navegador
         * de D&D5e.
         */
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

        /*
         * Coincidencias guardadas.
         */
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