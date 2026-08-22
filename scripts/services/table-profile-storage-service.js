import {
    MODULE_ID,
    TABLE_PROFILES_SETTING
} from "../settings.js";

const TABLE_PROFILE_BUNDLE_TYPE =
    "compendium-curator-table-profile-bundle";
const TABLE_PROFILE_BUNDLE_VERSION = 1;
const TABLE_PROFILE_BUNDLE_LIMIT = 500;

function getPortableUuidAvailability(uuid) {
    const value = String(uuid ?? "").trim();

    if (!value)
        return { available: false };

    const parts = value.split(".");

    if (
        parts[0] === "Compendium" &&
        parts.length >= 4
    ) {
        const collection =
            `${parts[1]}.${parts[2]}`;
        const pack = game.packs.get(collection);
        const documentId = parts.at(-1);

        return {
            available:
                Boolean(
                    pack?.index?.has(documentId)
                ),
            missingPack:
                pack ? null : collection
        };
    }

    let document = null;

    try {
        document = fromUuidSync(value);
    }
    catch {
        document = null;
    }

    return {
        available: Boolean(document),
        missingPack: null
    };
}

function getImportedObjectAvailability(
    storage,
    profileIds
) {
    const referenced = new Set();

    for (const profileId of profileIds) {
        const profile = storage.profiles?.[profileId];

        if (profile?.type !== "content")
            continue;

        for (const uuid of profile.manualIncludes ?? []) {
            if (uuid)
                referenced.add(uuid);
        }

        for (
            const filterGroupId
            of profile.filterGroupIds ?? []
        ) {
            const filterGroup =
                storage.filterGroups?.[filterGroupId];

            for (const uuid of filterGroup?.matches ?? []) {
                if (uuid)
                    referenced.add(uuid);
            }
        }
    }

    const unavailableUuids = [];
    const missingPacks = new Map();
    let missingDocumentCount = 0;

    for (const uuid of referenced) {
        const availability =
            getPortableUuidAvailability(uuid);

        if (availability.available)
            continue;

        unavailableUuids.push(uuid);

        if (availability.missingPack) {
            missingPacks.set(
                availability.missingPack,
                (
                    missingPacks.get(
                        availability.missingPack
                    ) ?? 0
                ) + 1
            );
        }
        else {
            missingDocumentCount++;
        }
    }

    return {
        referencedCount: referenced.size,
        availableCount:
            referenced.size - unavailableUuids.length,
        unavailableCount: unavailableUuids.length,
        unavailableUuids,
        missingDocumentCount,
        missingPacks: [...missingPacks.entries()]
            .map(([collection, count]) => ({
                collection,
                count
            }))
            .sort((a, b) =>
                a.collection.localeCompare(b.collection)
            )
    };
}

const DISTRIBUTION_MODES = new Set([
    "uniform",
    "individual",
    "grouped"
]);

const GROUPING_CRITERIA = {
    rarity: {
        type: "field",
        criterion: "rarity",
        field: "system.rarity"
    },
    type: {
        type: "field",
        criterion: "type",
        field: "type"
    },
    source: {
        type: "field",
        criterion: "source",
        field: "system.source"
    },
    creatureType: {
        type: "field",
        criterion: "creatureType",
        field: "system.details.type.value"
    },
    size: {
        type: "field",
        criterion: "size",
        field: "system.traits.size"
    },
    spellSchool: {
        type: "field",
        criterion: "spellSchool",
        field: "system.school"
    },
    manual: {
        type: "manual",
        criterion: "manual"
    },
    cr: {
        type: "range",
        criterion: "cr",
        field: "system.details.cr",
        ranges: [
            {
                key: "0-1",
                min: 0,
                max: 1
            },
            {
                key: "2-4",
                min: 2,
                max: 4
            },
            {
                key: "5-8",
                min: 5,
                max: 8
            },
            {
                key: "9-12",
                min: 9,
                max: 12
            },
            {
                key: "13-16",
                min: 13,
                max: 16
            },
            {
                key: "17-plus",
                min: 17,
                max: null
            }
        ]
    },
    spellLevel: {
        type: "range",
        criterion: "spellLevel",
        field: "system.level",
        ranges: Array.from(
            { length: 10 },
            (_, level) => ({
                key: String(level),
                min: level,
                max: level
            })
        )
    }
};

const DEFAULT_GROUPING =
    GROUPING_CRITERIA.rarity;

export class TableProfileStorageService {

    static #normalizeComparableName(value) {
        return String(value ?? "")
            .trim()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLocaleLowerCase();
    }

    static #isProfileNameTakenInStorage(
        storage,
        name,
        excludeId = null
    ) {
        const normalizedName =
            this.#normalizeComparableName(name);

        if (!normalizedName)
            return false;

        return Object.entries(
            storage.profiles ?? {}
        ).some(([profileId, profile]) => {
            if (profile?.version !== 2)
                return false;

            if (
                excludeId &&
                (
                    profileId === excludeId ||
                    profile?.id === excludeId
                )
            ) {
                return false;
            }

            return (
                this.#normalizeComparableName(
                    profile?.name
                ) === normalizedName
            );
        });
    }

    static #isFilterGroupNameTakenInStorage(
        storage,
        name,
        excludeId = null
    ) {
        const normalizedName =
            this.#normalizeComparableName(name);

        if (!normalizedName)
            return false;

        return Object.entries(
            storage.filterGroups ?? {}
        ).some(([filterGroupId, filterGroup]) => {
            if (
                excludeId &&
                (
                    filterGroupId === excludeId ||
                    filterGroup?.id === excludeId
                )
            ) {
                return false;
            }

            return (
                this.#normalizeComparableName(
                    filterGroup?.name
                ) === normalizedName
            );
        });
    }

    static #normalizeMatches(uuids) {
        const matches = [
            ...new Set(
                Array.from(uuids ?? [])
                    .map(uuid =>
                        String(uuid ?? "").trim()
                    )
                    .filter(Boolean)
            )
        ];

        matches.sort();
        return matches;
    }

    static #normalizePositiveInteger(
        value,
        fallback = null
    ) {
        const parsed =
            Number.parseInt(value, 10);

        return (
            Number.isInteger(parsed) &&
            parsed >= 1
        )
            ? parsed
            : fallback;
    }

    static #normalizePositiveNumber(
        value,
        fallback = null
    ) {
        const parsed = Number(value);

        return (
            Number.isFinite(parsed) &&
            parsed > 0
        )
            ? parsed
            : fallback;
    }

    static #normalizeProfileWeights(profile) {
        if (
            profile?.version !== 2 ||
            profile?.type === "nested"
        ) {
            return;
        }

        const current =
            profile.weights &&
            typeof profile.weights === "object" &&
            !Array.isArray(profile.weights)
                ? profile.weights
                : {};

        const legacyRarity =
            profile.grouping?.weights &&
            typeof profile.grouping.weights === "object" &&
            !Array.isArray(profile.grouping.weights)
                ? profile.grouping.weights
                : {};

        const currentRarity =
            current.rarity &&
            typeof current.rarity === "object" &&
            !Array.isArray(current.rarity)
                ? current.rarity
                : {};

        const rarity = {};

        for (
            const [key, rawValue]
            of Object.entries({
                ...legacyRarity,
                ...currentRarity
            })
        ) {
            const value =
                this.#normalizePositiveNumber(
                    rawValue
                );

            if (value !== null) {
                rarity[key] = value;
            }
        }

        const currentOverrides =
            current.overrides &&
            typeof current.overrides === "object" &&
            !Array.isArray(current.overrides)
                ? current.overrides
                : {};

        const overrides = {};

        for (
            const [uuid, rawValue]
            of Object.entries(currentOverrides)
        ) {
            const value =
                this.#normalizePositiveNumber(
                    rawValue
                );

            if (uuid && value !== null) {
                overrides[uuid] = value;
            }
        }

        profile.weights = {
            default:
                this.#normalizePositiveNumber(
                    current.default,
                    1
                ),
            rarity,
            overrides
        };
    }

    static #normalizeGroupingCriterion(value) {
        const criterion =
            String(value ?? "").trim();

        return Object.prototype.hasOwnProperty.call(
            GROUPING_CRITERIA,
            criterion
        )
            ? criterion
            : DEFAULT_GROUPING.criterion;
    }

    static #normalizeGroupingRanges(
        sourceRanges,
        criterion,
        fallbackToDefault = true
    ) {
        const normalizedCriterion =
            this.#normalizeGroupingCriterion(
                criterion
            );
        const definition =
            GROUPING_CRITERIA[
                normalizedCriterion
            ];

        if (definition?.type !== "range")
            return [];

        const defaults =
            foundry.utils.deepClone(
                definition.ranges ?? []
            );

        const source =
            Array.isArray(sourceRanges) &&
            sourceRanges.length
                ? sourceRanges
                : defaults;

        const ranges = [];

        for (
            const [index, sourceRange]
            of source.entries()
        ) {
            if (
                !sourceRange ||
                typeof sourceRange !== "object"
            ) {
                continue;
            }

            const rawMin =
                typeof sourceRange.min === "string"
                    ? sourceRange.min.trim()
                    : sourceRange.min;
            const min =
                rawMin === null ||
                rawMin === undefined ||
                rawMin === ""
                    ? Number.NaN
                    : Number(rawMin);

            let rawMax =
                typeof sourceRange.max === "string"
                    ? sourceRange.max.trim()
                    : sourceRange.max;

            if (
                rawMax === undefined &&
                Object.prototype.hasOwnProperty.call(
                    sourceRange,
                    "maxExclusive"
                )
            ) {
                const rawExclusive =
                    sourceRange.maxExclusive;

                rawMax =
                    rawExclusive === null ||
                    rawExclusive === undefined ||
                    rawExclusive === ""
                        ? null
                        : Number(rawExclusive) - 1;
            }

            const max =
                rawMax === null ||
                rawMax === undefined ||
                rawMax === ""
                    ? null
                    : Number(rawMax);

            if (!Number.isFinite(min))
                continue;

            if (
                max !== null &&
                (
                    !Number.isFinite(max) ||
                    max < min
                )
            ) {
                continue;
            }

            const key =
                String(
                    sourceRange.key ?? ""
                ).trim() ||
                `range:${normalizedCriterion}:${index}:${min}:${max ?? "plus"}`;

            ranges.push({
                key,
                min,
                max
            });
        }

        ranges.sort((a, b) => {
            if (a.min !== b.min)
                return a.min - b.min;

            return (
                (a.max ?? Number.POSITIVE_INFINITY) -
                (b.max ?? Number.POSITIVE_INFINITY)
            );
        });

        if (
            !ranges.length &&
            fallbackToDefault
        ) {
            return this.#normalizeGroupingRanges(
                defaults,
                normalizedCriterion,
                false
            );
        }

        return ranges;
    }

    static #validateGroupingRanges(
        sourceRanges,
        criterion
    ) {
        if (
            !Array.isArray(sourceRanges) ||
            !sourceRanges.length
        ) {
            throw new Error(
                "INVALID_TABLE_GROUPING_RANGES"
            );
        }

        const normalized =
            this.#normalizeGroupingRanges(
                sourceRanges,
                criterion,
                false
            );

        if (
            normalized.length !==
            sourceRanges.length
        ) {
            throw new Error(
                "INVALID_TABLE_GROUPING_RANGES"
            );
        }

        const keys = new Set();

        for (
            const [index, range]
            of normalized.entries()
        ) {
            if (keys.has(range.key)) {
                throw new Error(
                    "INVALID_TABLE_GROUPING_RANGES"
                );
            }

            keys.add(range.key);

            if (index === 0)
                continue;

            const previous =
                normalized[index - 1];

            if (
                previous.max === null ||
                range.min <= previous.max
            ) {
                throw new Error(
                    "INVALID_TABLE_GROUPING_RANGES"
                );
            }
        }

        return normalized;
    }

    static #getGroupingDefinition(
        criterion,
        ranges = null
    ) {
        const normalizedCriterion =
            this.#normalizeGroupingCriterion(
                criterion
            );
        const definition =
            foundry.utils.deepClone(
                GROUPING_CRITERIA[
                    normalizedCriterion
                ]
            );

        if (definition.type === "range") {
            definition.ranges =
                this.#normalizeGroupingRanges(
                    ranges,
                    normalizedCriterion
                );
        }

        return definition;
    }

    static #automaticGroupId(
        criterion,
        key
    ) {
        return `auto:${criterion}:${encodeURIComponent(key)}`;
    }

    static #normalizeGroupInternalDistribution(
        sourceDistribution
    ) {
        const source =
            sourceDistribution &&
            typeof sourceDistribution === "object" &&
            !Array.isArray(sourceDistribution)
                ? sourceDistribution
                : {};
        const mode =
            DISTRIBUTION_MODES.has(source.mode)
                ? source.mode
                : "uniform";
        const defaultWeight =
            this.#normalizePositiveNumber(
                source.defaultWeight,
                1
            );
        const sourceWeights =
            source.weights &&
            typeof source.weights === "object" &&
            !Array.isArray(source.weights)
                ? source.weights
                : {};
        const weights = {};

        for (
            const [uuid, rawWeight]
            of Object.entries(sourceWeights)
        ) {
            const weight =
                this.#normalizePositiveNumber(
                    rawWeight
                );

            if (uuid && weight !== null)
                weights[uuid] = weight;
        }

        return {
            ...foundry.utils.deepClone(source),
            mode,
            defaultWeight,
            weights
        };
    }

    static #normalizeManualGroups(sourceGroups) {
        const groups = [];
        const usedKeys = new Set();
        const usedMembers = new Set();

        for (
            const [index, sourceGroup]
            of (
                Array.isArray(sourceGroups)
                    ? sourceGroups
                    : []
            ).entries()
        ) {
            const name = String(
                sourceGroup?.name ?? ""
            ).trim();
            let key = String(
                sourceGroup?.key ??
                sourceGroup?.id ??
                ""
            ).trim();

            if (!name)
                continue;

            if (
                !key ||
                key === "unclassified" ||
                usedKeys.has(key)
            ) {
                key = `manual:${encodeURIComponent(name)}:${index}`;
            }

            let suffix = 1;

            while (usedKeys.has(key)) {
                key =
                    `manual:${encodeURIComponent(name)}:${index}:${suffix}`;
                suffix++;
            }

            usedKeys.add(key);

            const members = [];

            for (
                const rawUuid
                of Array.isArray(sourceGroup?.members)
                    ? sourceGroup.members
                    : []
            ) {
                const uuid = String(rawUuid ?? "").trim();

                if (!uuid || usedMembers.has(uuid))
                    continue;

                usedMembers.add(uuid);
                members.push(uuid);
            }

            groups.push({
                id: key,
                key,
                name,
                members
            });
        }

        return groups;
    }

    static #normalizeDistributionGroups(
        sourceGroups,
        criterion,
        legacyGroupWeights = {}
    ) {
        const normalizedCriterion =
            this.#normalizeGroupingCriterion(
                criterion
            );

        const source =
            sourceGroups &&
            typeof sourceGroups === "object" &&
            !Array.isArray(sourceGroups)
                ? sourceGroups
                : {};

        const legacy =
            normalizedCriterion === "rarity" &&
            legacyGroupWeights &&
            typeof legacyGroupWeights === "object" &&
            !Array.isArray(legacyGroupWeights)
                ? legacyGroupWeights
                : {};

        const groupKeys = new Set([
            ...Object.keys(source),
            ...Object.keys(legacy)
        ]);

        const groups = {};

        for (const rawKey of groupKeys) {
            const key =
                String(rawKey ?? "").trim();

            if (!key)
                continue;

            const sourceGroup =
                source[key] &&
                typeof source[key] === "object" &&
                !Array.isArray(source[key])
                    ? source[key]
                    : {};

            const weight =
                this.#normalizePositiveNumber(
                    sourceGroup.weight,
                    this.#normalizePositiveNumber(
                        legacy[key],
                        1
                    )
                );

            const internalDistribution =
                this.#normalizeGroupInternalDistribution(
                    sourceGroup.distribution
                );

            groups[key] = {
                id:
                    String(
                        sourceGroup.id ??
                        this.#automaticGroupId(
                            normalizedCriterion,
                            key
                        )
                    ),
                key,
                enabled:
                    sourceGroup.enabled !== false,
                weight,
                distribution:
                    internalDistribution
            };
        }

        return groups;
    }

    static #syncActiveDistributionConfiguration(
        grouped
    ) {
        const criterion =
            this.#normalizeGroupingCriterion(
                grouped?.grouping?.criterion
            );

        grouped.configurations ??= {};

        const configuration = {
            groups:
                foundry.utils.deepClone(
                    grouped.groups ?? {}
                )
        };

        if (grouped?.grouping?.type === "range") {
            configuration.ranges =
                this.#normalizeGroupingRanges(
                    grouped.grouping.ranges,
                    criterion
                );
        }

        grouped.configurations[criterion] =
            configuration;
    }

    static #normalizeProfileDistribution(profile) {
        if (
            profile?.version !== 2 ||
            profile?.type === "nested"
        ) {
            return;
        }

        this.#normalizeProfileWeights(profile);

        const source =
            profile.distribution &&
            typeof profile.distribution === "object" &&
            !Array.isArray(profile.distribution)
                ? profile.distribution
                : {};

        const mode =
            DISTRIBUTION_MODES.has(source.mode)
                ? source.mode
                : "grouped";

        const sourceIndividual =
            source.individual &&
            typeof source.individual === "object" &&
            !Array.isArray(source.individual)
                ? source.individual
                : {};

        const sourceIndividualWeights =
            sourceIndividual.weights &&
            typeof sourceIndividual.weights === "object" &&
            !Array.isArray(sourceIndividual.weights)
                ? sourceIndividual.weights
                : profile.weights?.overrides ?? {};

        const individualWeights = {};

        for (
            const [uuid, rawWeight]
            of Object.entries(sourceIndividualWeights)
        ) {
            const weight =
                this.#normalizePositiveNumber(
                    rawWeight
                );

            if (uuid && weight !== null) {
                individualWeights[uuid] = weight;
            }
        }

        const sourceGrouped =
            source.grouped &&
            typeof source.grouped === "object" &&
            !Array.isArray(source.grouped)
                ? source.grouped
                : {};

        const sourceGrouping =
            sourceGrouped.grouping &&
            typeof sourceGrouped.grouping === "object" &&
            !Array.isArray(sourceGrouped.grouping)
                ? sourceGrouped.grouping
                : {};

        const activeCriterion =
            this.#normalizeGroupingCriterion(
                sourceGrouping.criterion
            );

        const sourceGroups =
            sourceGrouped.groups &&
            typeof sourceGrouped.groups === "object" &&
            !Array.isArray(sourceGrouped.groups)
                ? sourceGrouped.groups
                : {};

        const sourceConfigurations =
            sourceGrouped.configurations &&
            typeof sourceGrouped.configurations === "object" &&
            !Array.isArray(sourceGrouped.configurations)
                ? sourceGrouped.configurations
                : {};

        const legacyGroupWeights =
            profile.weights?.rarity ?? {};

        const configurations = {};

        for (
            const criterion
            of Object.keys(GROUPING_CRITERIA)
        ) {
            const sourceConfiguration =
                sourceConfigurations[criterion] &&
                typeof sourceConfigurations[criterion] === "object" &&
                !Array.isArray(
                    sourceConfigurations[criterion]
                )
                    ? sourceConfigurations[criterion]
                    : {};

            const configurationGroups =
                criterion === activeCriterion
                    ? sourceGroups
                    : sourceConfiguration.groups;

            const configuration = {
                groups:
                    this.#normalizeDistributionGroups(
                        configurationGroups,
                        criterion,
                        legacyGroupWeights
                    )
            };

            if (
                GROUPING_CRITERIA[criterion]
                    ?.type === "range"
            ) {
                const sourceRanges =
                    criterion === activeCriterion &&
                    Array.isArray(
                        sourceGrouping.ranges
                    )
                        ? sourceGrouping.ranges
                        : sourceConfiguration.ranges;

                configuration.ranges =
                    this.#normalizeGroupingRanges(
                        sourceRanges,
                        criterion
                    );
            }

            configurations[criterion] =
                configuration;
        }

        const groups =
            foundry.utils.deepClone(
                configurations[activeCriterion]
                    ?.groups ?? {}
            );

        const grouping =
            this.#getGroupingDefinition(
                activeCriterion,
                configurations[activeCriterion]
                    ?.ranges
            );

        profile.distribution = {
            version: 2,
            mode,
            individual: {
                defaultWeight:
                    this.#normalizePositiveNumber(
                        sourceIndividual.defaultWeight,
                        this.#normalizePositiveNumber(
                            profile.weights?.default,
                            1
                        )
                    ),
                weights:
                    individualWeights
            },
            grouped: {
                grouping,
                groups,
                configurations,
                manualGroups:
                    this.#normalizeManualGroups(
                        sourceGrouped.manualGroups
                    )
            }
        };
    }

    static #normalizeDrawPreferences(profile) {
        const source =
            profile?.draw &&
            typeof profile.draw === "object" &&
            !Array.isArray(profile.draw)
                ? profile.draw
                : {};
        const criterion =
            profile?.distribution?.grouped
                ?.grouping?.criterion;
        const isShopGrouping =
            profile?.type === "content" &&
            ["type", "manual"].includes(
                criterion
            );
        const defaultCount =
            isShopGrouping ? 10 : 1;
        const count = Math.min(
            100,
            this.#normalizePositiveInteger(
                source.count,
                defaultCount
            )
        );
        const priceAdjustment = Math.min(
            1000,
            this.#normalizePositiveNumber(
                source.priceAdjustment,
                100
            )
        );
        const quantityMin = Math.min(
            100,
            this.#normalizePositiveInteger(
                source.quantityMin,
                1
            )
        );
        const quantityMax = Math.min(
            100,
            Math.max(
                quantityMin,
                this.#normalizePositiveInteger(
                    source.quantityMax,
                    quantityMin
                )
            )
        );

        profile.draw = {
            count,
            unique:
                typeof source.unique === "boolean"
                    ? source.unique
                    : isShopGrouping,
            priceAdjustment,
            quantityMin,
            quantityMax
        };
    }

    static #normalizeItemRules(profile) {
        const source =
            profile?.itemRules &&
            typeof profile.itemRules === "object" &&
            !Array.isArray(profile.itemRules)
                ? profile.itemRules
                : {};

        profile.itemRules = {
            excludeZeroPrice:
                source.excludeZeroPrice === true,
            includeHidden:
                source.includeHidden === true
        };
    }

    static #createFilterGroupRecord(
        storage,
        filterGroup
    ) {
        const name =
            String(filterGroup?.name ?? "").trim();

        if (!name) {
            throw new Error(
                "FILTER_GROUP_NAME_REQUIRED"
            );
        }

        if (
            this.#isFilterGroupNameTakenInStorage(
                storage,
                name
            )
        ) {
            throw new Error(
                "FILTER_GROUP_NAME_TAKEN"
            );
        }

        storage.filterGroups ??= {};

        let id;
        do {
            id = foundry.utils.randomID();
        }
        while (storage.filterGroups[id]);

        const storedGroup = {
            id,
            name,
            revision: 1,
            browser:
                foundry.utils.deepClone(
                    filterGroup.browser ?? {}
                ),
            matches:
                this.#normalizeMatches(
                    filterGroup.matches
                ),
            refreshedAt:
                Date.now()
        };

        storage.filterGroups[id] =
            storedGroup;

        return storedGroup;
    }

    static #normalizeNestedChildren(
        profileId,
        sourceChildren,
        profiles
    ) {
        const children = [];
        const used = new Set();

        for (
            const sourceChild
            of Array.isArray(sourceChildren)
                ? sourceChildren
                : []
        ) {
            const childProfileId = String(
                typeof sourceChild === "string"
                    ? sourceChild
                    : sourceChild?.profileId ??
                        sourceChild?.id ??
                        ""
            ).trim();
            const childProfile =
                profiles?.[childProfileId];

            if (
                !childProfileId ||
                childProfileId === profileId ||
                used.has(childProfileId) ||
                childProfile?.type !== "content"
            ) {
                continue;
            }

            used.add(childProfileId);
            children.push({
                profileId: childProfileId,
                enabled:
                    typeof sourceChild === "string" ||
                    sourceChild?.enabled !== false,
                weight:
                    this.#normalizePositiveNumber(
                        typeof sourceChild === "string"
                            ? 1
                            : sourceChild?.weight,
                        1
                    )
            });
        }

        return children;
    }

    static #normalizeStorage(rawStorage) {
        const source =
            foundry.utils.deepClone(
                rawStorage ?? {
                    version: 1,
                    profiles: {}
                }
            );

        const storage = {
            ...source,
            version: 4,
            profiles: {},
            filterGroups:
                foundry.utils.deepClone(
                    source.filterGroups ?? {}
                )
        };

        for (
            const [groupId, sourceGroup]
            of Object.entries(storage.filterGroups)
        ) {
            storage.filterGroups[groupId] = {
                ...sourceGroup,
                id: groupId,
                revision:
                    Number(
                        sourceGroup?.revision ?? 1
                    )
            };
        }

        const usedGroupIds =
            new Set(
                Object.keys(storage.filterGroups)
            );

        for (
            const [profileId, sourceProfile]
            of Object.entries(
                source.profiles ?? {}
            )
        ) {
            if (
                !sourceProfile ||
                typeof sourceProfile !== "object"
            ) {
                continue;
            }

            const profile =
                foundry.utils.deepClone(
                    sourceProfile
                );

            profile.id = profileId;

            let filterGroupIds = [];

            if (
                Array.isArray(
                    profile.filterGroupIds
                )
            ) {
                filterGroupIds =
                    profile.filterGroupIds
                        .map(id =>
                            String(id ?? "").trim()
                        )
                        .filter(id =>
                            Boolean(
                                storage.filterGroups?.[id]
                            )
                        );
            }
            else if (
                Array.isArray(
                    profile.filterGroups
                )
            ) {
                for (
                    const sourceGroup
                    of profile.filterGroups
                ) {
                    if (
                        !sourceGroup ||
                        typeof sourceGroup !== "object"
                    ) {
                        continue;
                    }

                    let groupId =
                        String(
                            sourceGroup.id ?? ""
                        ).trim();

                    if (
                        !groupId ||
                        usedGroupIds.has(groupId)
                    ) {
                        do {
                            groupId =
                                foundry.utils.randomID();
                        }
                        while (
                            usedGroupIds.has(groupId)
                        );
                    }

                    usedGroupIds.add(groupId);

                    storage.filterGroups[groupId] = {
                        ...foundry.utils.deepClone(
                            sourceGroup
                        ),
                        id: groupId,
                        revision:
                            Number(
                                sourceGroup.revision ?? 1
                            )
                    };

                    filterGroupIds.push(groupId);
                }
            }

            profile.filterGroupIds = [
                ...new Set(filterGroupIds)
            ];

            delete profile.filterGroups;

            this.#normalizeProfileDistribution(
                profile
            );
            this.#normalizeDrawPreferences(
                profile
            );
            this.#normalizeItemRules(profile);

            profile.generation ??= {};
            profile.generation.rootUuid ??=
                profile.generation.masterUuid ??
                null;

            if (
                !profile.generation.nodes ||
                typeof profile.generation.nodes !== "object" ||
                Array.isArray(profile.generation.nodes)
            ) {
                profile.generation.nodes = {};
            }

            profile.generation.generatedRevision =
                Number(
                    profile.generation
                        .generatedRevision ?? 0
                );

            storage.profiles[profileId] =
                profile;
        }

        for (
            const [profileId, profile]
            of Object.entries(storage.profiles)
        ) {
            if (profile.type !== "nested")
                continue;

            profile.children =
                this.#normalizeNestedChildren(
                    profileId,
                    profile.children,
                    storage.profiles
                );
        }

        return storage;
    }

    static #hydrateProfile(profile, storage) {
        if (!profile)
            return null;

        const hydrated =
            foundry.utils.deepClone(profile);

        hydrated.filterGroups =
            Array.from(
                profile.filterGroupIds ?? []
            )
                .map(filterGroupId =>
                    storage.filterGroups?.[
                        filterGroupId
                    ]
                )
                .filter(Boolean)
                .map(filterGroup =>
                    foundry.utils.deepClone(
                        filterGroup
                    )
                );

        return hydrated;
    }

    static async migrateStorage() {
        const current =
            game.settings.get(
                MODULE_ID,
                TABLE_PROFILES_SETTING
            ) ?? {
                version: 1,
                profiles: {}
            };

        const migrated =
            this.#normalizeStorage(current);

        if (
            foundry.utils.equals(
                current,
                migrated
            )
        ) {
            return false;
        }

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            migrated
        );

        console.info(
            "Compendium Curator | Perfiles de tabla migrados al formato v4."
        );

        return true;
    }

    static async updateFilterGroupMatches(
        profileId,
        filterGroupId,
        uuids,
        browserFilters = null
    ) {
        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const profile =
            profileId
                ? storage.profiles?.[profileId]
                : null;

        if (
            profileId &&
            (
                !profile ||
                profile.version !== 2 ||
                !Array.from(
                    profile.filterGroupIds ?? []
                ).includes(filterGroupId)
            )
        ) {
            throw new Error(
                "TABLE_FILTER_GROUP_NOT_FOUND"
            );
        }

        const filterGroup =
            storage.filterGroups?.[
                filterGroupId
            ];

        if (!filterGroup) {
            throw new Error(
                "TABLE_FILTER_GROUP_NOT_FOUND"
            );
        }

        const matches =
            this.#normalizeMatches(uuids);

        const previous =
            this.#normalizeMatches(
                filterGroup.matches
            );

        const matchesChanged =
            previous.length !== matches.length ||
            previous.some(
                (uuid, index) =>
                    uuid !== matches[index]
            );

        let filtersChanged = false;

        if (browserFilters !== null) {
            const previousFilters =
                filterGroup.browser?.filters ?? {};

            filtersChanged =
                !foundry.utils.equals(
                    previousFilters,
                    browserFilters
                );

            filterGroup.browser ??= {};
            filterGroup.browser.filters =
                foundry.utils.deepClone(
                    browserFilters
                );
        }

        filterGroup.matches = matches;
        filterGroup.refreshedAt = Date.now();

        const changed =
            matchesChanged || filtersChanged;

        if (changed) {
            filterGroup.revision =
                Number(
                    filterGroup.revision ?? 1
                ) + 1;

            for (
                const usedProfile
                of Object.values(
                    storage.profiles ?? {}
                )
            ) {
                if (
                    !Array.from(
                        usedProfile.filterGroupIds ?? []
                    ).includes(filterGroupId)
                ) {
                    continue;
                }

                usedProfile.revision =
                    Number(
                        usedProfile.revision ?? 1
                    ) + 1;
            }
        }

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return {
            profile:
                profile
                    ? this.#hydrateProfile(
                        storage.profiles[profileId],
                        storage
                    )
                    : null,
            filterGroup:
                foundry.utils.deepClone(
                    filterGroup
                ),
            changed
        };
    }

    static async updateFilterGroupCriteria(
        filterGroupId,
        browserState,
        uuids
    ) {
        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const filterGroup =
            storage.filterGroups?.[
                filterGroupId
            ];

        if (!filterGroup) {
            throw new Error(
                "TABLE_FILTER_GROUP_NOT_FOUND"
            );
        }

        const browser =
            foundry.utils.deepClone(
                browserState ?? {}
            );

        const matches =
            this.#normalizeMatches(uuids);

        const previousMatches =
            this.#normalizeMatches(
                filterGroup.matches
            );

        const changed =
            !foundry.utils.equals(
                filterGroup.browser ?? {},
                browser
            ) ||
            previousMatches.length !==
                matches.length ||
            previousMatches.some(
                (uuid, index) =>
                    uuid !== matches[index]
            );

        filterGroup.browser = browser;
        filterGroup.matches = matches;
        filterGroup.refreshedAt = Date.now();

        if (changed) {
            filterGroup.revision =
                Number(
                    filterGroup.revision ?? 1
                ) + 1;

            for (
                const profile
                of Object.values(
                    storage.profiles ?? {}
                )
            ) {
                if (
                    !Array.from(
                        profile.filterGroupIds ?? []
                    ).includes(filterGroupId)
                ) {
                    continue;
                }

                profile.revision =
                    Number(
                        profile.revision ?? 1
                    ) + 1;
            }
        }

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return {
            filterGroup:
                foundry.utils.deepClone(
                    filterGroup
                ),
            changed
        };
    }

    static isFilterGroupNameTaken(
        profileId,
        name,
        excludeId = null
    ) {
        void profileId;

        return this.#isFilterGroupNameTakenInStorage(
            this.getStorage(),
            name,
            excludeId
        );
    }

    static async setManualExcludes(
        profileId,
        uuids
    ) {
        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        const normalized =
            this.#normalizeMatches(uuids);

        const previous =
            this.#normalizeMatches(
                profile.manualExcludes
            );

        const changed =
            previous.length !== normalized.length ||
            previous.some(
                (uuid, index) =>
                    uuid !== normalized[index]
            );

        if (!changed)
            return profile;

        profile.manualExcludes = normalized;
        profile.revision =
            Number(profile.revision ?? 1) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return profile;
    }

    static async setManualIncludes(
        profileId,
        uuids
    ) {
        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        const normalized =
            this.#normalizeMatches(uuids);

        const previous =
            this.#normalizeMatches(
                profile.manualIncludes
            );

        const changed =
            previous.length !== normalized.length ||
            previous.some(
                (uuid, index) =>
                    uuid !== normalized[index]
            );

        if (!changed)
            return profile;

        profile.manualIncludes = normalized;
        profile.revision =
            Number(profile.revision ?? 1) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return profile;
    }

    static async setDistributionMode(
        profileId,
        mode
    ) {
        const normalizedMode =
            String(mode ?? "").trim();

        if (!DISTRIBUTION_MODES.has(normalizedMode)) {
            throw new Error(
                "INVALID_TABLE_DISTRIBUTION_MODE"
            );
        }

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2 ||
            profile.type === "nested"
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        this.#normalizeProfileDistribution(profile);

        if (profile.distribution.mode === normalizedMode) {
            return this.#hydrateProfile(
                profile,
                storage
            );
        }

        profile.distribution.mode =
            normalizedMode;

        profile.revision =
            Number(profile.revision ?? 1) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return this.#hydrateProfile(
            profile,
            storage
        );
    }

    static async setDistributionGroupingCriterion(
        profileId,
        criterion
    ) {
        const requestedCriterion =
            String(criterion ?? "").trim();

        if (
            !Object.prototype.hasOwnProperty.call(
                GROUPING_CRITERIA,
                requestedCriterion
            )
        ) {
            throw new Error(
                "INVALID_TABLE_GROUPING_CRITERION"
            );
        }

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2 ||
            profile.type === "nested"
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        this.#normalizeProfileDistribution(profile);

        const grouped =
            profile.distribution.grouped;
        const currentCriterion =
            this.#normalizeGroupingCriterion(
                grouped.grouping?.criterion
            );

        if (currentCriterion === requestedCriterion) {
            return this.#hydrateProfile(
                profile,
                storage
            );
        }

        this.#syncActiveDistributionConfiguration(
            grouped
        );

        const nextConfiguration =
            grouped.configurations?.[
                requestedCriterion
            ] ?? { groups: {} };

        grouped.grouping =
            this.#getGroupingDefinition(
                requestedCriterion,
                nextConfiguration.ranges
            );
        grouped.groups =
            foundry.utils.deepClone(
                nextConfiguration.groups ?? {}
            );

        this.#syncActiveDistributionConfiguration(
            grouped
        );

        profile.revision =
            Number(profile.revision ?? 1) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return this.#hydrateProfile(
            profile,
            storage
        );
    }

    static async setDistributionGroupingRanges(
        profileId,
        criterion,
        ranges
    ) {
        const requestedCriterion =
            String(criterion ?? "").trim();
        const definition =
            GROUPING_CRITERIA[
                requestedCriterion
            ];

        if (definition?.type !== "range") {
            throw new Error(
                "INVALID_TABLE_GROUPING_CRITERION"
            );
        }

        const normalizedRanges =
            this.#validateGroupingRanges(
                ranges,
                requestedCriterion
            );

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2 ||
            profile.type === "nested"
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        this.#normalizeProfileDistribution(profile);

        const grouped =
            profile.distribution.grouped;
        const configuration =
            grouped.configurations?.[
                requestedCriterion
            ];

        if (!configuration) {
            throw new Error(
                "INVALID_TABLE_GROUPING_CRITERION"
            );
        }

        if (
            foundry.utils.equals(
                configuration.ranges ?? [],
                normalizedRanges
            )
        ) {
            return this.#hydrateProfile(
                profile,
                storage
            );
        }

        configuration.ranges =
            foundry.utils.deepClone(
                normalizedRanges
            );

        const currentCriterion =
            this.#normalizeGroupingCriterion(
                grouped.grouping?.criterion
            );

        if (currentCriterion === requestedCriterion) {
            grouped.grouping =
                this.#getGroupingDefinition(
                    requestedCriterion,
                    normalizedRanges
                );

            this.#syncActiveDistributionConfiguration(
                grouped
            );
        }

        profile.revision =
            Number(profile.revision ?? 1) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return this.#hydrateProfile(
            profile,
            storage
        );
    }

    static async setDistributionGroupWeight(
        profileId,
        groupKey,
        weight
    ) {
        const key =
            String(groupKey ?? "").trim();

        const normalizedWeight =
            this.#normalizePositiveNumber(weight);

        if (!key || normalizedWeight === null) {
            throw new Error(
                "INVALID_TABLE_WEIGHT"
            );
        }

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2 ||
            profile.type === "nested"
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        this.#normalizeProfileDistribution(profile);

        const grouped =
            profile.distribution.grouped;
        const criterion =
            this.#normalizeGroupingCriterion(
                grouped.grouping?.criterion
            );

        const previousGroup =
            grouped.groups?.[key];

        const previousWeight =
            this.#normalizePositiveNumber(
                previousGroup?.weight,
                1
            );

        if (previousWeight === normalizedWeight) {
            return this.#hydrateProfile(
                profile,
                storage
            );
        }

        grouped.groups ??= {};

        grouped.groups[key] = {
            id:
                String(
                    previousGroup?.id ??
                    this.#automaticGroupId(
                        criterion,
                        key
                    )
                ),
            key,
            enabled:
                previousGroup?.enabled !== false,
            weight: normalizedWeight,
            distribution:
                foundry.utils.deepClone(
                    previousGroup?.distribution ??
                    { mode: "uniform" }
                )
        };

        this.#syncActiveDistributionConfiguration(
            grouped
        );

        if (criterion === "rarity") {
            profile.weights ??= {
                default: 1,
                rarity: {},
                overrides: {}
            };
            profile.weights.rarity ??= {};
            profile.weights.rarity[key] =
                normalizedWeight;
        }

        profile.revision =
            Number(profile.revision ?? 1) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return this.#hydrateProfile(
            profile,
            storage
        );
    }

    static async setDistributionGroupEnabled(
        profileId,
        groupKey,
        enabled
    ) {
        const key =
            String(groupKey ?? "").trim();

        if (!key) {
            throw new Error(
                "TABLE_GROUP_KEY_REQUIRED"
            );
        }

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2 ||
            profile.type === "nested"
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        this.#normalizeProfileDistribution(profile);

        const grouped =
            profile.distribution.grouped;
        const criterion =
            this.#normalizeGroupingCriterion(
                grouped.grouping?.criterion
            );

        grouped.groups ??= {};

        const previousGroup =
            grouped.groups?.[key];
        const previousEnabled =
            previousGroup?.enabled !== false;
        const nextEnabled =
            Boolean(enabled);

        if (previousEnabled === nextEnabled) {
            return this.#hydrateProfile(
                profile,
                storage
            );
        }

        const legacyWeight =
            criterion === "rarity"
                ? profile.weights?.rarity?.[key]
                : null;

        grouped.groups[key] = {
            id:
                String(
                    previousGroup?.id ??
                    this.#automaticGroupId(
                        criterion,
                        key
                    )
                ),
            key,
            enabled: nextEnabled,
            weight:
                this.#normalizePositiveNumber(
                    previousGroup?.weight,
                    this.#normalizePositiveNumber(
                        legacyWeight,
                        1
                    )
                ),
            distribution:
                foundry.utils.deepClone(
                    previousGroup?.distribution ??
                    { mode: "uniform" }
                )
        };

        this.#syncActiveDistributionConfiguration(
            grouped
        );

        profile.revision =
            Number(profile.revision ?? 1) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return this.#hydrateProfile(
            profile,
            storage
        );
    }

    static async setDistributionIndividualWeight(
        profileId,
        uuid,
        weight = null
    ) {
        const normalizedUuid =
            String(uuid ?? "").trim();

        if (!normalizedUuid) {
            throw new Error(
                "TABLE_OBJECT_UUID_REQUIRED"
            );
        }

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2 ||
            profile.type === "nested"
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        this.#normalizeProfileDistribution(profile);

        const weights =
            profile.distribution
                .individual.weights;

        const previous =
            this.#normalizePositiveNumber(
                weights[normalizedUuid]
            );

        const clearOverride =
            weight === null ||
            weight === undefined ||
            weight === "";

        if (clearOverride) {
            if (previous === null) {
                return this.#hydrateProfile(
                    profile,
                    storage
                );
            }

            delete weights[normalizedUuid];

            if (profile.weights?.overrides) {
                delete profile.weights
                    .overrides[normalizedUuid];
            }
        }
        else {
            const normalizedWeight =
                this.#normalizePositiveNumber(
                    weight
                );

            if (normalizedWeight === null) {
                throw new Error(
                    "INVALID_TABLE_WEIGHT"
                );
            }

            if (previous === normalizedWeight) {
                return this.#hydrateProfile(
                    profile,
                    storage
                );
            }

            weights[normalizedUuid] =
                normalizedWeight;

            profile.weights ??= {
                default: 1,
                rarity: {},
                overrides: {}
            };
            profile.weights.overrides ??= {};
            profile.weights
                .overrides[normalizedUuid] =
                normalizedWeight;
        }

        profile.revision =
            Number(profile.revision ?? 1) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return this.#hydrateProfile(
            profile,
            storage
        );
    }

    static async setDistributionGroupItemWeight(
        profileId,
        groupKey,
        uuid,
        weight = null
    ) {
        const key =
            String(groupKey ?? "").trim();
        const normalizedUuid =
            String(uuid ?? "").trim();

        if (!key || !normalizedUuid) {
            throw new Error(
                "TABLE_OBJECT_UUID_REQUIRED"
            );
        }

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );
        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2 ||
            profile.type === "nested"
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        this.#normalizeProfileDistribution(profile);

        const grouped =
            profile.distribution.grouped;
        const criterion =
            this.#normalizeGroupingCriterion(
                grouped.grouping?.criterion
            );
        const previousGroup =
            grouped.groups?.[key] ?? {};
        const distribution =
            this.#normalizeGroupInternalDistribution(
                previousGroup.distribution
            );
        const previous =
            this.#normalizePositiveNumber(
                distribution.weights?.[
                    normalizedUuid
                ]
            );
        const clearOverride =
            weight === null ||
            weight === undefined ||
            weight === "";

        if (clearOverride) {
            if (previous === null) {
                return this.#hydrateProfile(
                    profile,
                    storage
                );
            }

            delete distribution.weights[
                normalizedUuid
            ];
        }
        else {
            const normalizedWeight =
                this.#normalizePositiveNumber(
                    weight
                );

            if (normalizedWeight === null) {
                throw new Error(
                    "INVALID_TABLE_WEIGHT"
                );
            }

            if (previous === normalizedWeight) {
                return this.#hydrateProfile(
                    profile,
                    storage
                );
            }

            distribution.weights[
                normalizedUuid
            ] = normalizedWeight;
        }

        distribution.mode = "individual";
        grouped.groups ??= {};
        grouped.groups[key] = {
            id: String(
                previousGroup.id ??
                this.#automaticGroupId(
                    criterion,
                    key
                )
            ),
            key,
            enabled:
                previousGroup.enabled !== false,
            weight:
                this.#normalizePositiveNumber(
                    previousGroup.weight,
                    1
                ),
            distribution
        };

        this.#syncActiveDistributionConfiguration(
            grouped
        );

        profile.revision =
            Number(profile.revision ?? 1) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return this.#hydrateProfile(
            profile,
            storage
        );
    }

    static async setGenerationState(
        profileId,
        generation
    ) {
        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );
        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        const nodes =
            generation?.nodes &&
            typeof generation.nodes === "object" &&
            !Array.isArray(generation.nodes)
                ? foundry.utils.deepClone(
                    generation.nodes
                )
                : {};
        const rootUuid = String(
            generation?.rootUuid ?? ""
        ).trim() || null;

        profile.generation = {
            ...foundry.utils.deepClone(
                profile.generation ?? {}
            ),
            rootUuid,
            nodes,
            generatedRevision:
                Number(
                    generation?.generatedRevision ??
                    profile.revision ??
                    1
                )
        };

        const normalizedStorage =
            this.#normalizeStorage(storage);

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            normalizedStorage
        );

        return this.#hydrateProfile(
            normalizedStorage
                .profiles?.[profileId],
            normalizedStorage
        );
    }

    static async setDrawPreferences(
        profileId,
        preferences
    ) {
        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );
        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        profile.draw = {
            count:
                preferences?.count,
            unique:
                preferences?.unique === true,
            priceAdjustment:
                preferences?.priceAdjustment,
            quantityMin:
                preferences?.quantityMin,
            quantityMax:
                preferences?.quantityMax
        };

        const normalizedStorage =
            this.#normalizeStorage(storage);

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            normalizedStorage
        );

        return this.#hydrateProfile(
            normalizedStorage
                .profiles?.[profileId],
            normalizedStorage
        );
    }

    static async setExcludeZeroPrice(
        profileId,
        excludeZeroPrice
    ) {
        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );
        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2 ||
            profile.type !== "content"
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        const requested =
            excludeZeroPrice === true;

        if (
            profile.itemRules
                ?.excludeZeroPrice === requested
        ) {
            return this.#hydrateProfile(
                profile,
                storage
            );
        }

        profile.itemRules = {
            ...foundry.utils.deepClone(
                profile.itemRules ?? {}
            ),
            excludeZeroPrice:
                requested
        };
        profile.revision =
            Number(profile.revision ?? 1) + 1;

        const normalizedStorage =
            this.#normalizeStorage(storage);

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            normalizedStorage
        );

        return this.#hydrateProfile(
            normalizedStorage
                .profiles?.[profileId],
            normalizedStorage
        );
    }

    static async setIncludeHidden(
        profileId,
        includeHidden
    ) {
        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );
        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2 ||
            profile.type !== "content"
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        const requested =
            includeHidden === true;

        if (
            profile.itemRules
                ?.includeHidden === requested
        ) {
            return this.#hydrateProfile(
                profile,
                storage
            );
        }

        profile.itemRules = {
            ...foundry.utils.deepClone(
                profile.itemRules ?? {}
            ),
            includeHidden: requested
        };
        profile.revision =
            Number(profile.revision ?? 1) + 1;

        const normalizedStorage =
            this.#normalizeStorage(storage);

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            normalizedStorage
        );

        return this.#hydrateProfile(
            normalizedStorage
                .profiles?.[profileId],
            normalizedStorage
        );
    }

    static async setNestedChildEnabled(
        profileId,
        childProfileId,
        enabled
    ) {
        const childId =
            String(childProfileId ?? "").trim();
        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );
        const profile =
            storage.profiles?.[profileId];
        const childProfile =
            storage.profiles?.[childId];

        if (
            !profile ||
            profile.version !== 2 ||
            profile.type !== "nested" ||
            !childProfile ||
            childProfile.type !== "content" ||
            profileId === childId
        ) {
            throw new Error(
                "INVALID_NESTED_TABLE_CHILD"
            );
        }

        const children =
            this.#normalizeNestedChildren(
                profileId,
                profile.children,
                storage.profiles
            );
        const previous = children.find(child =>
            child.profileId === childId
        );
        const nextEnabled = Boolean(enabled);

        if (
            previous?.enabled === nextEnabled ||
            (!previous && !nextEnabled)
        ) {
            return this.#hydrateProfile(
                profile,
                storage
            );
        }

        if (previous) {
            previous.enabled = nextEnabled;
        }
        else {
            children.push({
                profileId: childId,
                enabled: true,
                weight: 1
            });
        }

        profile.children = children;
        profile.revision =
            Number(profile.revision ?? 1) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return this.#hydrateProfile(
            profile,
            storage
        );
    }

    static async setManualGroupingGroups(
        profileId,
        groups
    ) {
        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );
        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2 ||
            profile.type !== "content"
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        this.#normalizeProfileDistribution(profile);

        const normalized =
            this.#normalizeManualGroups(groups);

        if (!normalized.length) {
            throw new Error(
                "MANUAL_GROUPS_REQUIRED"
            );
        }

        if (
            foundry.utils.equals(
                profile.distribution
                    .grouped.manualGroups ?? [],
                normalized
            )
        ) {
            return this.#hydrateProfile(
                profile,
                storage
            );
        }

        profile.distribution
            .grouped.manualGroups = normalized;
        profile.revision =
            Number(profile.revision ?? 1) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return this.#hydrateProfile(
            profile,
            storage
        );
    }

    static async setNestedChildWeight(
        profileId,
        childProfileId,
        weight
    ) {
        const childId =
            String(childProfileId ?? "").trim();
        const normalizedWeight =
            this.#normalizePositiveNumber(weight);

        if (!childId || normalizedWeight === null) {
            throw new Error(
                "INVALID_TABLE_WEIGHT"
            );
        }

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );
        const profile =
            storage.profiles?.[profileId];
        const childProfile =
            storage.profiles?.[childId];

        if (
            !profile ||
            profile.version !== 2 ||
            profile.type !== "nested" ||
            childProfile?.type !== "content"
        ) {
            throw new Error(
                "INVALID_NESTED_TABLE_CHILD"
            );
        }

        const children =
            this.#normalizeNestedChildren(
                profileId,
                profile.children,
                storage.profiles
            );
        const child = children.find(candidate =>
            candidate.profileId === childId
        );

        if (!child) {
            throw new Error(
                "INVALID_NESTED_TABLE_CHILD"
            );
        }

        if (child.weight === normalizedWeight) {
            return this.#hydrateProfile(
                profile,
                storage
            );
        }

        child.weight = normalizedWeight;
        profile.children = children;
        profile.revision =
            Number(profile.revision ?? 1) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return this.#hydrateProfile(
            profile,
            storage
        );
    }

    static async setRarityWeight(
        profileId,
        rarity,
        weight
    ) {
        return this.setDistributionGroupWeight(
            profileId,
            rarity,
            weight
        );
    }

    static async setObjectWeight(
        profileId,
        uuid,
        weight = null
    ) {
        return this.setDistributionIndividualWeight(
            profileId,
            uuid,
            weight
        );
    }

    static async createFilterGroup(filterGroup) {
        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const storedGroup =
            this.#createFilterGroupRecord(
                storage,
                filterGroup
            );

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return foundry.utils.deepClone(
            storedGroup
        );
    }

    static async addFilterGroup(
        profileId,
        filterGroup
    ) {
        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        const storedGroup =
            this.#createFilterGroupRecord(
                storage,
                filterGroup
            );

        profile.filterGroupIds ??= [];

        if (
            !profile.filterGroupIds.includes(
                storedGroup.id
            )
        ) {
            profile.filterGroupIds.push(
                storedGroup.id
            );
        }

        profile.revision =
            Number(profile.revision ?? 1) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return foundry.utils.deepClone(
            storedGroup
        );
    }

    static getStorage() {
        const storage =
            game.settings.get(
                MODULE_ID,
                TABLE_PROFILES_SETTING
            ) ?? {
                version: 1,
                profiles: {}
            };

        return this.#normalizeStorage(storage);
    }

    static getProfiles() {
        const storage = this.getStorage();

        return Object.fromEntries(
            Object.entries(
                storage.profiles ?? {}
            ).map(([profileId, profile]) => [
                profileId,
                this.#hydrateProfile(
                    profile,
                    storage
                )
            ])
        );
    }

    static exportProfileBundle(profileId) {
        const storage = this.getStorage();
        const rootProfile =
            storage.profiles?.[profileId];

        if (!rootProfile) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        const profileIds = new Set();
        const pending = [profileId];

        while (pending.length) {
            const currentId = pending.shift();
            const profile =
                storage.profiles?.[currentId];

            if (!profile || profileIds.has(currentId))
                continue;

            profileIds.add(currentId);

            if (profile.type === "nested") {
                for (const child of profile.children ?? []) {
                    pending.push(child.profileId);
                }
            }
        }

        const profiles = {};
        const filterGroupIds = new Set();

        for (const currentId of profileIds) {
            const profile = foundry.utils.deepClone(
                storage.profiles[currentId]
            );

            profile.generation = {
                masterUuid: null,
                groupUuids: {},
                rootUuid: null,
                nodes: {},
                generatedRevision: 0
            };
            delete profile.filterGroups;
            profiles[currentId] = profile;

            for (
                const filterGroupId
                of profile.filterGroupIds ?? []
            ) {
                filterGroupIds.add(filterGroupId);
            }
        }

        const filterGroups = {};

        for (const filterGroupId of filterGroupIds) {
            const filterGroup =
                storage.filterGroups?.[filterGroupId];

            if (filterGroup) {
                filterGroups[filterGroupId] =
                    foundry.utils.deepClone(
                        filterGroup
                    );
            }
        }

        return {
            type: TABLE_PROFILE_BUNDLE_TYPE,
            version: TABLE_PROFILE_BUNDLE_VERSION,
            moduleVersion:
                game.modules.get(MODULE_ID)?.version ??
                null,
            exportedAt: Date.now(),
            rootProfileId: profileId,
            profiles,
            filterGroups
        };
    }

    static async importProfileBundle(bundle) {
        const sourceProfiles = bundle?.profiles;
        const sourceFilterGroups =
            bundle?.filterGroups ?? {};
        const rootProfileId = String(
            bundle?.rootProfileId ?? ""
        ).trim();

        if (
            bundle?.type !==
                TABLE_PROFILE_BUNDLE_TYPE ||
            bundle?.version !==
                TABLE_PROFILE_BUNDLE_VERSION ||
            !sourceProfiles ||
            typeof sourceProfiles !== "object" ||
            Array.isArray(sourceProfiles) ||
            !sourceFilterGroups ||
            typeof sourceFilterGroups !== "object" ||
            Array.isArray(sourceFilterGroups) ||
            !sourceProfiles[rootProfileId]
        ) {
            throw new Error(
                "INVALID_TABLE_PROFILE_BUNDLE"
            );
        }

        const profileEntries =
            Object.entries(sourceProfiles);
        const filterGroupEntries =
            Object.entries(sourceFilterGroups);

        if (
            !profileEntries.length ||
            profileEntries.length >
                TABLE_PROFILE_BUNDLE_LIMIT ||
            filterGroupEntries.length >
                TABLE_PROFILE_BUNDLE_LIMIT
        ) {
            throw new Error(
                "INVALID_TABLE_PROFILE_BUNDLE"
            );
        }

        for (
            const [sourceId, profile]
            of profileEntries
        ) {
            if (
                !sourceId ||
                !profile ||
                profile.version !== 2 ||
                !["content", "nested"].includes(
                    profile.type
                ) ||
                !String(profile.name ?? "").trim() ||
                !Array.isArray(
                    profile.filterGroupIds ?? []
                ) ||
                (
                    profile.type === "nested" &&
                    !Array.isArray(
                        profile.children ?? []
                    )
                )
            ) {
                throw new Error(
                    "INVALID_TABLE_PROFILE_BUNDLE"
                );
            }

            for (
                const filterGroupId
                of profile.filterGroupIds ?? []
            ) {
                if (!sourceFilterGroups[filterGroupId]) {
                    throw new Error(
                        "INVALID_TABLE_PROFILE_BUNDLE"
                    );
                }
            }

            if (profile.type === "nested") {
                for (const child of profile.children ?? []) {
                    const childProfile =
                        sourceProfiles[
                            child?.profileId
                        ];

                    if (childProfile?.type !== "content") {
                        throw new Error(
                            "INVALID_TABLE_PROFILE_BUNDLE"
                        );
                    }
                }
            }
        }

        for (
            const [sourceId, filterGroup]
            of filterGroupEntries
        ) {
            if (
                !sourceId ||
                !filterGroup ||
                !String(filterGroup.name ?? "").trim() ||
                !Array.isArray(filterGroup.matches)
            ) {
                throw new Error(
                    "INVALID_TABLE_PROFILE_BUNDLE"
                );
            }
        }

        const storage = foundry.utils.deepClone(
            this.getStorage()
        );
        const profileIdMap = new Map();
        const filterGroupIdMap = new Map();

        storage.profiles ??= {};
        storage.filterGroups ??= {};

        const getUniqueProfileName = rawName => {
            const desired = String(rawName).trim();

            if (!this.#isProfileNameTakenInStorage(
                storage,
                desired
            )) {
                return desired;
            }

            const base = game.i18n.format(
                "COMPENDIUM_CURATOR.ImportedCopyName",
                { name: desired }
            );
            let candidate = base;
            let index = 2;

            while (this.#isProfileNameTakenInStorage(
                storage,
                candidate
            )) {
                candidate = `${base} (${index})`;
                index++;
            }

            return candidate;
        };

        const getUniqueFilterGroupName = rawName => {
            const desired = String(rawName).trim();

            if (!this.#isFilterGroupNameTakenInStorage(
                storage,
                desired
            )) {
                return desired;
            }

            const base = game.i18n.format(
                "COMPENDIUM_CURATOR.ImportedCopyName",
                { name: desired }
            );
            let candidate = base;
            let index = 2;

            while (this.#isFilterGroupNameTakenInStorage(
                storage,
                candidate
            )) {
                candidate = `${base} (${index})`;
                index++;
            }

            return candidate;
        };

        for (
            const [sourceId, filterGroup]
            of filterGroupEntries
        ) {
            const imported =
                this.#createFilterGroupRecord(
                    storage,
                    {
                        ...foundry.utils.deepClone(
                            filterGroup
                        ),
                        name:
                            getUniqueFilterGroupName(
                                filterGroup.name
                            )
                    }
                );

            filterGroupIdMap.set(
                sourceId,
                imported.id
            );
        }

        for (const [sourceId] of profileEntries) {
            let newId;

            do {
                newId = foundry.utils.randomID();
            }
            while (
                storage.profiles[newId] ||
                [...profileIdMap.values()]
                    .includes(newId)
            );

            profileIdMap.set(sourceId, newId);
        }

        for (
            const [sourceId, sourceProfile]
            of profileEntries
        ) {
            const profile = foundry.utils.deepClone(
                sourceProfile
            );
            const newId = profileIdMap.get(sourceId);

            profile.id = newId;
            profile.name = getUniqueProfileName(
                profile.name
            );
            profile.revision = 1;
            profile.filterGroupIds = [
                ...new Set(
                    (profile.filterGroupIds ?? [])
                        .map(id =>
                            filterGroupIdMap.get(id)
                        )
                        .filter(Boolean)
                )
            ];
            profile.generation = {
                masterUuid: null,
                groupUuids: {},
                rootUuid: null,
                nodes: {},
                generatedRevision: 0
            };
            delete profile.filterGroups;

            if (profile.type === "nested") {
                profile.children = (
                    profile.children ?? []
                ).map(child => ({
                    ...child,
                    profileId:
                        profileIdMap.get(
                            child.profileId
                        )
                }));
            }

            storage.profiles[newId] = profile;
        }

        const normalizedStorage =
            this.#normalizeStorage(storage);

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            normalizedStorage
        );

        const importedRootId =
            profileIdMap.get(rootProfileId);

        return {
            rootProfile:
                this.#hydrateProfile(
                    normalizedStorage.profiles[
                        importedRootId
                    ],
                    normalizedStorage
                ),
            importedProfileIds: [
                ...profileIdMap.values()
            ],
            importedFilterGroupIds: [
                ...filterGroupIdMap.values()
            ],
            availability:
                getImportedObjectAvailability(
                    normalizedStorage,
                    profileIdMap.values()
                )
        };
    }

    static getFilterGroups() {
        return this.getStorage()
            .filterGroups ?? {};
    }

    static getFilterGroup(filterGroupId) {
        return this.getFilterGroups()?.[
            filterGroupId
        ] ?? null;
    }

    static getFilterGroupUsage(filterGroupId) {
        const storage = this.getStorage();

        return Object.values(
            storage.profiles ?? {}
        )
            .filter(profile =>
                Array.from(
                    profile.filterGroupIds ?? []
                ).includes(filterGroupId)
            )
            .map(profile => ({
                id: profile.id,
                name: profile.name,
                type: profile.type
            }));
    }

    static async renameFilterGroup(
        filterGroupId,
        name
    ) {
        const normalizedName =
            String(name ?? "").trim();

        if (!normalizedName) {
            throw new Error(
                "FILTER_GROUP_NAME_REQUIRED"
            );
        }

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const filterGroup =
            storage.filterGroups?.[
                filterGroupId
            ];

        if (!filterGroup) {
            throw new Error(
                "TABLE_FILTER_GROUP_NOT_FOUND"
            );
        }

        if (
            this.#isFilterGroupNameTakenInStorage(
                storage,
                normalizedName,
                filterGroupId
            )
        ) {
            throw new Error(
                "FILTER_GROUP_NAME_TAKEN"
            );
        }

        if (filterGroup.name === normalizedName)
            return filterGroup;

        filterGroup.name = normalizedName;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return foundry.utils.deepClone(
            filterGroup
        );
    }

    static async duplicateFilterGroup(
        filterGroupId,
        name
    ) {
        const normalizedName =
            String(name ?? "").trim();

        if (!normalizedName) {
            throw new Error(
                "FILTER_GROUP_NAME_REQUIRED"
            );
        }

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const source =
            storage.filterGroups?.[
                filterGroupId
            ];

        if (!source) {
            throw new Error(
                "TABLE_FILTER_GROUP_NOT_FOUND"
            );
        }

        if (
            this.#isFilterGroupNameTakenInStorage(
                storage,
                normalizedName
            )
        ) {
            throw new Error(
                "FILTER_GROUP_NAME_TAKEN"
            );
        }

        let id;
        do {
            id = foundry.utils.randomID();
        }
        while (storage.filterGroups?.[id]);

        const duplicate =
            foundry.utils.deepClone(source);

        duplicate.id = id;
        duplicate.name = normalizedName;
        duplicate.revision = 1;

        storage.filterGroups ??= {};
        storage.filterGroups[id] = duplicate;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return foundry.utils.deepClone(
            duplicate
        );
    }

    static async deleteGlobalFilterGroup(
        filterGroupId
    ) {
        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const filterGroup =
            storage.filterGroups?.[
                filterGroupId
            ];

        if (!filterGroup) {
            throw new Error(
                "TABLE_FILTER_GROUP_NOT_FOUND"
            );
        }

        const usage =
            Object.values(
                storage.profiles ?? {}
            ).filter(profile =>
                Array.from(
                    profile.filterGroupIds ?? []
                ).includes(filterGroupId)
            );

        if (usage.length > 0) {
            throw new Error(
                "FILTER_GROUP_IN_USE"
            );
        }

        delete storage.filterGroups[
            filterGroupId
        ];

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return foundry.utils.deepClone(
            filterGroup
        );
    }

    static isNameTaken(
        name,
        excludeId = null
    ) {
        return this.#isProfileNameTakenInStorage(
            this.getStorage(),
            name,
            excludeId
        );
    }

    static async create(
        profile,
        initialFilterGroup = null
    ) {
        const name =
            String(profile?.name ?? "").trim();

        if (!name) {
            throw new Error(
                "TABLE_PROFILE_NAME_REQUIRED"
            );
        }

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        if (
            this.#isProfileNameTakenInStorage(
                storage,
                name
            )
        ) {
            throw new Error(
                "TABLE_PROFILE_NAME_TAKEN"
            );
        }

        storage.version = 4;
        storage.profiles ??= {};
        storage.filterGroups ??= {};

        let id;
        do {
            id = foundry.utils.randomID();
        }
        while (storage.profiles[id]);

        storage.profiles[id] = {
            ...foundry.utils.deepClone(profile),
            id,
            name
        };

        const normalizedStorage =
            this.#normalizeStorage(storage);

        if (initialFilterGroup) {
            const storedGroup =
                this.#createFilterGroupRecord(
                    normalizedStorage,
                    initialFilterGroup
                );
            const normalizedProfile =
                normalizedStorage.profiles[id];

            normalizedProfile.filterGroupIds ??= [];
            normalizedProfile.filterGroupIds.push(
                storedGroup.id
            );
            normalizedProfile.revision =
                Number(
                    normalizedProfile.revision ?? 1
                ) + 1;
        }

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            normalizedStorage
        );

        return this.#hydrateProfile(
            normalizedStorage.profiles[id],
            normalizedStorage
        );
    }

    static async renameProfile(
        profileId,
        name
    ) {
        const normalizedName =
            String(name ?? "").trim();

        if (!normalizedName) {
            throw new Error(
                "TABLE_PROFILE_NAME_REQUIRED"
            );
        }

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        if (
            this.#isProfileNameTakenInStorage(
                storage,
                normalizedName,
                profileId
            )
        ) {
            throw new Error(
                "TABLE_PROFILE_NAME_TAKEN"
            );
        }

        if (profile.name === normalizedName)
            return profile;

        profile.name = normalizedName;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            this.#normalizeStorage(storage)
        );

        return foundry.utils.deepClone(
            profile
        );
    }

    static async duplicateProfile(
        profileId,
        name
    ) {
        const normalizedName =
            String(name ?? "").trim();

        if (!normalizedName) {
            throw new Error(
                "TABLE_PROFILE_NAME_REQUIRED"
            );
        }

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const source =
            storage.profiles?.[profileId];

        if (
            !source ||
            source.version !== 2
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        if (
            this.#isProfileNameTakenInStorage(
                storage,
                normalizedName
            )
        ) {
            throw new Error(
                "TABLE_PROFILE_NAME_TAKEN"
            );
        }

        let id;
        do {
            id = foundry.utils.randomID();
        }
        while (storage.profiles?.[id]);

        const duplicate =
            foundry.utils.deepClone(source);

        duplicate.id = id;
        duplicate.name = normalizedName;
        duplicate.revision = 1;
        duplicate.filterGroupIds = [
            ...new Set(
                source.filterGroupIds ?? []
            )
        ];

        delete duplicate.filterGroups;

        duplicate.generation = {
            masterUuid: null,
            groupUuids: {},
            rootUuid: null,
            nodes: {},
            generatedRevision: 0
        };

        storage.profiles[id] = duplicate;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            this.#normalizeStorage(storage)
        );

        return foundry.utils.deepClone(
            duplicate
        );
    }

    static async removeProfile(profileId) {
        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        delete storage.profiles[profileId];

        for (
            const candidate
            of Object.values(storage.profiles)
        ) {
            if (
                candidate?.type !== "nested" ||
                !Array.isArray(candidate.children)
            ) {
                continue;
            }

            const nextChildren =
                candidate.children.filter(child =>
                    child?.profileId !== profileId
                );

            if (
                nextChildren.length ===
                candidate.children.length
            ) {
                continue;
            }

            candidate.children = nextChildren;
            candidate.revision =
                Number(candidate.revision ?? 1) + 1;
        }

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            this.#normalizeStorage(storage)
        );

        return foundry.utils.deepClone(profile);
    }

    static async removeFilterGroup(
        profileId,
        filterGroupId
    ) {
        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const profile =
            storage.profiles?.[profileId];

        if (
            !profile ||
            profile.version !== 2
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        const filterGroupIds =
            Array.from(
                profile.filterGroupIds ?? []
            );

        const nextFilterGroupIds =
            filterGroupIds.filter(
                id => id !== filterGroupId
            );

        if (
            nextFilterGroupIds.length ===
            filterGroupIds.length
        ) {
            return this.#hydrateProfile(
                profile,
                storage
            );
        }

        profile.filterGroupIds =
            nextFilterGroupIds;

        profile.revision =
            Number(profile.revision ?? 1) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return this.#hydrateProfile(
            profile,
            storage
        );
    }

}
