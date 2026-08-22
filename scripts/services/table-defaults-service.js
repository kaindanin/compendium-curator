import {
    MODULE_ID,
    TABLE_DEFAULTS_SETTING
} from "../settings.js";

const DEFAULT_RARITY_WEIGHTS = {
    mundane: 1,
    common: 1,
    uncommon: 1,
    rare: 1,
    veryRare: 1,
    legendary: 1,
    artifact: 1
};

function normalizeGenerationTarget(target) {
    const mode = String(
        target?.mode ?? ""
    ).trim();

    if (mode === "world") {
        return {
            mode: "world",
            packId: null
        };
    }

    const packId = String(
        target?.packId ?? ""
    ).trim();

    return {
        mode: "compendium",
        packId: packId || null
    };
}

export class TableDefaultsService {

    static get() {

        const stored =
            game.settings.get(
                MODULE_ID,
                TABLE_DEFAULTS_SETTING
            ) ?? {};

        const rarityWeights = {};

        for (
            const [key, fallback]
            of Object.entries(
                DEFAULT_RARITY_WEIGHTS
            )
        ) {

            const value =
                Number(
                    stored
                        .rarityWeights
                        ?.[key]
                );

            rarityWeights[key] =
                Number.isInteger(value) &&
                value >= 1
                    ? value
                    : fallback;

        }

        return {
            version: 2,

            grouping:
                stored.grouping === "rarity"
                    ? "rarity"
                    : "rarity",

            rarityWeights,

            generationTarget:
                normalizeGenerationTarget(
                    stored.generationTarget
                )
        };

    }

    static async set(data) {

        const rarityWeights = {};

        for (
            const [key, fallback]
            of Object.entries(
                DEFAULT_RARITY_WEIGHTS
            )
        ) {

            const value =
                Number(
                    data
                        ?.rarityWeights
                        ?.[key]
                );

            rarityWeights[key] =
                Number.isInteger(value) &&
                value >= 1
                    ? value
                    : fallback;

        }

        const normalized = {
            version: 2,
            grouping: "rarity",
            rarityWeights,
            generationTarget:
                normalizeGenerationTarget(
                    data?.generationTarget
                )
        };

        await game.settings.set(
            MODULE_ID,
            TABLE_DEFAULTS_SETTING,
            normalized
        );

        return normalized;

    }

}