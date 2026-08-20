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
            version: 1,

            grouping:
                stored.grouping === "rarity"
                    ? "rarity"
                    : "rarity",

            rarityWeights
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
            version: 1,
            grouping: "rarity",
            rarityWeights
        };

        await game.settings.set(
            MODULE_ID,
            TABLE_DEFAULTS_SETTING,
            normalized
        );

        return normalized;

    }

}