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
                ? "Ubicación sugerida al generar"
                : "Suggested generation location";
        context.generationDestinationHint =
            game.i18n.lang.startsWith("es")
                ? "Esta opción solo aparecerá preseleccionada al generar una RollTable nueva. Podrás elegir otra ubicación antes de crearla y las tablas existentes no se moverán si cambias este valor."
                : "This option is only preselected when generating a new RollTable. You can choose another location before creating it, and existing tables are not moved when this value changes.";

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
