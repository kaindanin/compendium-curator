import {
    TableDefaultsService
} from "../services/table-defaults-service.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

const RARITY_LABELS = {
    mundane: "RarityMundane",
    common: "RarityCommon",
    uncommon: "RarityUncommon",
    rare: "RarityRare",
    veryRare: "RarityVeryRare",
    legendary: "RarityLegendary",
    artifact: "RarityArtifact"
};

export class TableDefaultsApplication
    extends HandlebarsApplicationMixin(
        ApplicationV2
    ) {

    static DEFAULT_OPTIONS = {

        id:
            "compendium-curator-table-defaults",

        classes: [
            "dnd5e2",
            "cc-table-defaults-app"
        ],

        window: {
            title:
                "COMPENDIUM_CURATOR.TableDefaultsTitle"
        },

        position: {
            width: 520,
            height: 560
        },

        actions: {
            save: this.#onSave,
            cancel: this.#onCancel
        }

    };

    static PARTS = {

        body: {
            template:
                "modules/compendium-curator/templates/table-defaults.hbs"
        }

    };

    async _prepareContext(options) {

        const context =
            await super._prepareContext(
                options
            );

        const defaults =
            TableDefaultsService.get();

        context.rarityWeights =
            Object.entries(
                defaults.rarityWeights
            ).map(
                ([key, value]) => ({
                    key,
                    value,

                    label:
                        game.i18n.localize(
                            `COMPENDIUM_CURATOR.${RARITY_LABELS[key]}`
                        )
                })
            );

        return context;

    }

    static async #onSave() {

        const rarityWeights = {};

        for (
            const input
            of this.element.querySelectorAll(
                '[name^="rarityWeight."]'
            )
        ) {

            const key =
                input.name.replace(
                    "rarityWeight.",
                    ""
                );

            rarityWeights[key] =
                Number.parseInt(
                    input.value,
                    10
                );

        }

        await TableDefaultsService.set({
            grouping: "rarity",
            rarityWeights
        });

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.TableDefaultsSaved"
            )
        );

        await this.close();

    }

    static async #onCancel() {

        await this.close();

    }

}