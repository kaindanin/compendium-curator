import {
    MODULE_ID,
    TABLE_PROFILES_SETTING
} from "../settings.js";

const DISTRIBUTION_MODES = new Set([
    "uniform",
    "individual",
    "grouped"
]);

const DEFAULT_GROUPING = {
    type: "field",
    criterion: "rarity",
    field: "system.rarity"
};

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

    static #automaticGroupId(
        criterion,
        key
    ) {
        return `auto:${criterion}:${encodeURIComponent(key)}`;
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

        const grouping = {
            type:
                String(
                    sourceGrouping.type ??
                    DEFAULT_GROUPING.type
                ),
            criterion:
                String(
                    sourceGrouping.criterion ??
                    DEFAULT_GROUPING.criterion
                ),
            field:
                String(
                    sourceGrouping.field ??
                    DEFAULT_GROUPING.field
                )
        };

        const sourceGroups =
            sourceGrouped.groups &&
            typeof sourceGrouped.groups === "object" &&
            !Array.isArray(sourceGrouped.groups)
                ? sourceGrouped.groups
                : {};

        const legacyGroupWeights =
            profile.weights?.rarity ?? {};

        const groupKeys = new Set([
            ...Object.keys(sourceGroups),
            ...Object.keys(legacyGroupWeights)
        ]);

        const groups = {};

        for (const rawKey of groupKeys) {
            const key =
                String(rawKey ?? "").trim();

            if (!key)
                continue;

            const sourceGroup =
                sourceGroups[key] &&
                typeof sourceGroups[key] === "object" &&
                !Array.isArray(sourceGroups[key])
                    ? sourceGroups[key]
                    : {};

            const weight =
                this.#normalizePositiveNumber(
                    sourceGroup.weight,
                    this.#normalizePositiveNumber(
                        legacyGroupWeights[key],
                        1
                    )
                );

            const internalDistribution =
                sourceGroup.distribution &&
                typeof sourceGroup.distribution === "object" &&
                !Array.isArray(sourceGroup.distribution)
                    ? foundry.utils.deepClone(
                        sourceGroup.distribution
                    )
                    : { mode: "uniform" };

            if (
                !DISTRIBUTION_MODES.has(
                    internalDistribution.mode
                )
            ) {
                internalDistribution.mode =
                    "uniform";
            }

            groups[key] = {
                id:
                    String(
                        sourceGroup.id ??
                        this.#automaticGroupId(
                            grouping.criterion,
                            key
                        )
                    ),
                key,
                weight,
                distribution:
                    internalDistribution
            };
        }

        profile.distribution = {
            version: 1,
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
                groups
            }
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
                        grouped.grouping?.criterion ??
                        "group",
                        key
                    )
                ),
            key,
            weight: normalizedWeight,
            distribution:
                foundry.utils.deepClone(
                    previousGroup?.distribution ??
                    { mode: "uniform" }
                )
        };

        profile.weights ??= {
            default: 1,
            rarity: {},
            overrides: {}
        };
        profile.weights.rarity ??= {};
        profile.weights.rarity[key] =
            normalizedWeight;

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

    static async create(profile) {
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
