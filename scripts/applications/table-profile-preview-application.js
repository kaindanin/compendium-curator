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

const RARITY_LABELS = {
    mundane:
        "RarityMundane",

    common:
        "RarityCommon",

    uncommon:
        "RarityUncommon",

    rare:
        "RarityRare",

    veryRare:
        "RarityVeryRare",

    legendary:
        "RarityLegendary",

    artifact:
        "RarityArtifact"
};

export class TableProfilePreviewApplication
    extends HandlebarsApplicationMixin(
        ApplicationV2
    ) {

    constructor(
        browserApp,
        profileId,
        options = {}
    ) {

        super(options);

        this.browserApp =
            browserApp;

        this.profileId =
            profileId;

    }


    static DEFAULT_OPTIONS = {

        id:
            "compendium-curator-table-profile-preview",

        classes: [
            "dnd5e2",
            "cc-table-profile-preview-app"
        ],

        window: {
            title:
                "COMPENDIUM_CURATOR.TableProfilePreview"
        },

        position: {
            width: 680,
            height: 650
        }

    };


    static PARTS = {

        body: {
            template:
                "modules/compendium-curator/templates/table-profile-preview.hbs"
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
            context.preview = null;

            return context;

        }

        const preview =
            await TableProfileService
                .getProfilePreview(
                    this.browserApp,
                    profile
                );

        context.profileName =
            profile.name;

        context.groups =
            preview.groups;

        context.totalMatches =
            preview.totalMatches;

        context.uniqueCount =
            preview.uniqueCount;

        context.duplicateEntriesRemoved =
            preview
                .duplicateEntriesRemoved;

        context.overlappingObjects =
            preview
                .overlappingObjects;

        context.manualIncludedCount =
            preview.manualIncludedCount;

        context.manualExcludedCount =
            preview.manualExcludedCount;

        context.rarityGroups =
            preview.rarityGroups.map(
                group => {

                    const localizationKey =
                        RARITY_LABELS[
                            group.key
                        ];

                    return {
                        ...group,

                        label:
                            localizationKey
                                ? game.i18n.localize(
                                    `COMPENDIUM_CURATOR.${localizationKey}`
                                )
                                : group.key
                    };

                }
            );

        context.candidates =
            preview.candidates.map(
                candidate => ({
                    uuid:
                        candidate.uuid,

                    name:
                        candidate.name
                })
            );

        context.hasCandidates =
            preview.uniqueCount > 0;

        const candidateUuids =
            Array.from(
                context.candidates ?? []
            )
                .map(
                    candidate =>
                        candidate.uuid
                )
                .filter(Boolean);

        context.candidates =
            await prepareDnd5eDocumentEntries(
                candidateUuids
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

}