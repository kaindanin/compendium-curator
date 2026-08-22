import {
    TableDefaultsService
} from "../services/table-defaults-service.js";
import {
    TableGenerationTargetService
} from "../services/table-generation-target-service.js";

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

        const selectedTarget =
            TableGenerationTargetService
                .choiceValue(
                    defaults.generationTarget
                );

        context.generationTargets =
            TableGenerationTargetService
                .getTargetChoices()
                .map(choice => ({
                    ...choice,
                    selected:
                        choice.value ===
                        selectedTarget
                }));

        context.generationDestinationLabel =
            game.i18n.lang.startsWith("es")
                ? "Destino de generación"
                : "Generation destination";
        context.generationDestinationHint =
            game.i18n.lang.startsWith("es")
                ? "Las nuevas RollTables se guardarán aquí salvo que un perfil tenga un destino propio. El compendio automático se crea en este mundo cuando haga falta."
                : "New RollTables are stored here unless a profile has its own destination. The automatic compendium is created in this world when needed.";

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

        const previous =
            TableDefaultsService.get();
        const generationTarget =
            TableGenerationTargetService
                .parseChoice(
                    this.element
                        .querySelector(
                            '[name="generationTarget"]'
                        )
                        ?.value
                );

        await TableDefaultsService.set({
            grouping: "rarity",
            rarityWeights,
            generationTarget
        });

        if (
            !foundry.utils.equals(
                previous.generationTarget,
                generationTarget
            )
        ) {
            await TableGenerationTargetService
                .markInheritedProfilesPending();
        }

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