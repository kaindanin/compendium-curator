import {
    MODULE_ID,
    TABLE_PROFILES_SETTING
} from "../settings.js";
import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";
import {
    TableProfileService
} from "./table-profile-service.js";
import {
    StorageService
} from "./storage-service.js";
import {
    setTableChildWeight
} from "./table-profile-relations-service.js";
import {
    activateDnd5eDocumentEntries,
    getDnd5eDistributionIndexEntry,
    prepareDnd5eIndexedEntries
} from "../ui/dnd5e-document-list.js";

const DIRECT_MODE = "direct";
const LOCAL_MODE_FLAT = "flat";
const LOCAL_MODE_GROUPED = "grouped";
const PREVIEW_LIMIT = 150;
const CRITERIA = [
    "none",
    "rarity",
    "type",
    "source",
    "price",
    "cr",
    "spellLevel",
    "creatureType",
    "size",
    "spellSchool",
    "manual"
];
const RANGE_CRITERIA = new Set([
    "price",
    "cr",
    "spellLevel"
]);
const RARITY_ORDER = [
    "mundane",
    "common",
    "uncommon",
    "rare",
    "veryRare",
    "legendary",
    "artifact"
];
const RARITY_LABELS = {
    mundane: "RarityMundane",
    common: "RarityCommon",
    uncommon: "RarityUncommon",
    rare: "RarityRare",
    veryRare: "RarityVeryRare",
    legendary: "RarityLegendary",
    artifact: "RarityArtifact"
};

function text(es, en) {
    return game.i18n.lang.startsWith("es")
        ? es
        : en;
}

function esc(value) {
    return foundry.utils.escapeHTML(
        String(value ?? "")
    );
}

function localizeMaybe(value) {
    const key = String(value ?? "").trim();

    if (!key)
        return "";

    return game.i18n.has(key)
        ? game.i18n.localize(key)
        : key;
}

function positiveNumber(value, fallback = 1) {
    const parsed = Number(value);

    return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : fallback;
}

function percentage(value) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed <= 0)
        return "0%";

    const percent = parsed * 100;

    if (percent < 0.01)
        return "<0,01%";

    return `${new Intl.NumberFormat(
        game.i18n.lang,
        {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }
    ).format(percent)}%`;
}

function sortEntries(entries) {
    return [...entries].sort((a, b) =>
        String(a?.name ?? "").localeCompare(
            String(b?.name ?? ""),
            game.i18n.lang,
            { sensitivity: "base" }
        )
    );
}

function dedupe(entries) {
    const map = new Map();

    for (const entry of entries ?? []) {
        const uuid = String(
            entry?.uuid ?? ""
        ).trim();

        if (!uuid)
            continue;

        const origins = new Set(
            entry.origins ?? []
        );
        const current = map.get(uuid);

        if (current) {
            for (const origin of origins) {
                if (origin)
                    current.origins.add(origin);
            }
            continue;
        }

        map.set(uuid, {
            ...entry,
            uuid,
            origins
        });
    }

    return sortEntries(
        [...map.values()].map(entry => ({
            ...entry,
            origins: [...entry.origins],
            originLabel:
                [...entry.origins]
                    .filter(Boolean)
                    .join(" · ")
        }))
    );
}

function criterionLabel(criterion) {
    const keys = {
        none: "GroupByNone",
        rarity: "GroupByRarity",
        type: "GroupByType",
        source: "GroupBySource",
        price: "GroupByPrice",
        cr: "GroupByChallengeRating",
        spellLevel: "GroupBySpellLevel",
        creatureType: "GroupByCreatureType",
        size: "GroupBySize",
        spellSchool: "GroupBySpellSchool",
        manual: "GroupByManual"
    };

    return game.i18n.localize(
        `COMPENDIUM_CURATOR.${keys[criterion] ?? "GroupByRarity"}`
    );
}

function profileCriterion(profile) {
    const value = String(
        profile?.distribution
            ?.grouped
            ?.grouping
            ?.criterion ??
        "rarity"
    ).trim();

    return CRITERIA.includes(value)
        ? value
        : "rarity";
}

function profileRanges(profile, criterion) {
    const grouped =
        profile?.distribution?.grouped;
    const current = profileCriterion(profile);
    const source = current === criterion
        ? grouped?.grouping?.ranges
        : grouped?.configurations?.[
            criterion
        ]?.ranges;

    return Array.isArray(source)
        ? foundry.utils.deepClone(source)
        : [];
}

function sourceRecord(profile, sourceKey) {
    const source =
        profile?.contentLayout
            ?.sources
            ?.[sourceKey];

    return source &&
        typeof source === "object" &&
        !Array.isArray(source)
        ? source
        : {};
}

function sourceCriterion(
    profile,
    sourceKey,
    fallbackProfile = profile
) {
    const stored = String(
        sourceRecord(profile, sourceKey)
            ?.criterion ??
        ""
    ).trim();

    return CRITERIA.includes(stored)
        ? stored
        : profileCriterion(fallbackProfile);
}

function sourceConfiguration(
    profile,
    sourceKey,
    criterion
) {
    const configuration =
        sourceRecord(profile, sourceKey)
            ?.configurations
            ?.[criterion];

    return configuration &&
        typeof configuration === "object" &&
        !Array.isArray(configuration)
        ? configuration
        : {};
}

function sourceRanges(
    profile,
    sourceKey,
    criterion
) {
    const configured =
        sourceConfiguration(
            profile,
            sourceKey,
            criterion
        )?.ranges;

    return Array.isArray(configured) &&
        configured.length
        ? foundry.utils.deepClone(configured)
        : profileRanges(profile, criterion);
}

function nativeGroupConfiguration(
    profile,
    criterion,
    groupKey
) {
    const grouped =
        profile?.distribution?.grouped;
    const current = profileCriterion(profile);
    const groups = current === criterion
        ? grouped?.groups
        : grouped?.configurations?.[
            criterion
        ]?.groups;

    const group = groups?.[groupKey];

    return group &&
        typeof group === "object" &&
        !Array.isArray(group)
        ? group
        : {};
}

function normalizeNumber(value) {
    const parsed = Number(
        String(value ?? "")
            .trim()
            .replace(",", ".")
    );

    return Number.isFinite(parsed)
        ? parsed
        : null;
}

function normalizeChallengeRating(value) {
    if (
        typeof value === "number" &&
        Number.isFinite(value)
    ) {
        return value >= 0
            ? value
            : null;
    }

    const raw = String(value ?? "").trim();

    if (!raw)
        return null;

    const fraction = raw.match(
        /^(\d+)\s*\/\s*(\d+)$/
    );

    if (fraction) {
        const numerator = Number(fraction[1]);
        const denominator = Number(fraction[2]);

        if (
            Number.isFinite(numerator) &&
            denominator > 0
        ) {
            return numerator / denominator;
        }
    }

    const parsed = normalizeNumber(raw);

    return parsed !== null && parsed >= 0
        ? parsed
        : null;
}

function rangeKey(value, ranges) {
    if (value === null)
        return "unclassified";

    return ranges.find(range => {
        const min = Number(range?.min);
        const rawMax = range?.max;
        const max =
            rawMax === null ||
            rawMax === undefined ||
            rawMax === ""
                ? null
                : Number(rawMax);

        if (!Number.isFinite(min))
            return false;

        return value >= min &&
            (
                max === null ||
                (
                    Number.isFinite(max) &&
                    value <= max
                )
            );
    })?.key ?? "unclassified";
}

function basePrice(document) {
    const price = document?.system?.price;
    const value = Number(price?.value);
    const denomination = String(
        price?.denomination ?? ""
    ).trim();
    const conversion = Number(
        CONFIG.DND5E?.currencies
            ?.[denomination]
            ?.conversion
    );

    if (
        !Number.isFinite(value) ||
        value < 0 ||
        !Number.isFinite(conversion) ||
        conversion <= 0
    ) {
        return null;
    }

    return value / conversion;
}

function sourceValue(document, entry) {
    const source = document?.system?.source;

    if (typeof source === "string") {
        return source.trim() ||
            entry?.source ||
            "unclassified";
    }

    return String(
        source?.value ??
        source?.book ??
        source?.label ??
        entry?.source ??
        ""
    ).trim() || "unclassified";
}

function manualGroupKey(uuid, profile) {
    return (
        profile?.distribution
            ?.grouped
            ?.manualGroups ?? []
    ).find(group =>
        Array.isArray(group?.members) &&
        group.members.includes(uuid)
    )?.key ?? "unclassified";
}

function groupKey(
    entry,
    profile,
    criterion,
    configuredRanges
) {
    if (criterion === "none")
        return "all";

    const document =
        getDnd5eDistributionIndexEntry(
            entry.uuid
        );

    if (criterion === "type") {
        return String(
            document?.type ?? ""
        ).trim() || "unclassified";
    }

    if (criterion === "source") {
        return sourceValue(
            document,
            entry
        );
    }

    if (criterion === "price") {
        return rangeKey(
            basePrice(document),
            configuredRanges
        );
    }

    if (criterion === "cr") {
        return rangeKey(
            normalizeChallengeRating(
                document?.system?.details?.cr
            ),
            configuredRanges
        );
    }

    if (criterion === "spellLevel") {
        const level = normalizeNumber(
            document?.system?.level
        );

        return rangeKey(
            level !== null && level >= 0
                ? level
                : null,
            configuredRanges
        );
    }

    if (criterion === "creatureType") {
        const type =
            document?.system?.details?.type;
        const value = String(
            typeof type === "string"
                ? type
                : type?.value ?? ""
        ).trim();

        if (!value)
            return "unclassified";

        if (value !== "custom")
            return value;

        const custom = String(
            type?.custom ?? ""
        ).trim();

        return custom
            ? `custom:${custom}`
            : "unclassified";
    }

    if (criterion === "size") {
        return String(
            document?.system
                ?.traits
                ?.size ??
            ""
        ).trim() || "unclassified";
    }

    if (criterion === "spellSchool") {
        return String(
            document?.system?.school ?? ""
        ).trim() || "unclassified";
    }

    if (criterion === "manual") {
        return manualGroupKey(
            entry.uuid,
            profile
        );
    }

    return String(
        document?.system?.rarity ?? ""
    ).trim() || "mundane";
}

function configLabel(collection, key) {
    const config = collection?.[key];
    const raw = typeof config === "string"
        ? config
        : config?.label;

    return raw
        ? localizeMaybe(raw)
        : key;
}

function rangeLabel(
    key,
    configuredRanges,
    criterion
) {
    const range = configuredRanges.find(
        candidate =>
            candidate?.key === key
    );

    if (!range)
        return key;

    const format = value =>
        new Intl.NumberFormat(
            game.i18n.lang,
            { maximumFractionDigits: 3 }
        ).format(value);
    const min = Number(range.min);
    const rawMax = range.max;
    const max =
        rawMax === null ||
        rawMax === undefined ||
        rawMax === ""
            ? null
            : Number(rawMax);
    const label = criterionLabel(criterion);

    if (!Number.isFinite(min))
        return label;

    if (max === null)
        return `${label} ${format(min)}+`;

    if (!Number.isFinite(max))
        return label;

    return min === max
        ? `${label} ${format(min)}`
        : `${label} ${format(min)}–${format(max)}`;
}

function groupLabel(
    key,
    profile,
    criterion,
    configuredRanges
) {
    if (criterion === "none") {
        return game.i18n.localize(
            "COMPENDIUM_CURATOR.GroupAllObjects"
        );
    }

    if (criterion === "rarity") {
        const localizationKey =
            RARITY_LABELS[key];

        return localizationKey
            ? game.i18n.localize(
                `COMPENDIUM_CURATOR.${localizationKey}`
            )
            : key;
    }

    if (criterion === "type") {
        if (key === "unclassified") {
            return game.i18n.localize(
                "COMPENDIUM_CURATOR.GroupUnclassified"
            );
        }

        const systemType =
            CONFIG.DND5E?.itemTypes?.[key];
        const raw = [
            CONFIG.Item?.typeLabels?.[key],
            CONFIG.Actor?.typeLabels?.[key],
            typeof systemType === "string"
                ? systemType
                : systemType?.label
        ].find(value =>
            typeof value === "string" &&
            value.trim()
        );

        return raw
            ? localizeMaybe(raw)
            : key;
    }

    if (criterion === "source") {
        return key === "unclassified"
            ? game.i18n.localize(
                "COMPENDIUM_CURATOR.GroupNoSource"
            )
            : key;
    }

    if (RANGE_CRITERIA.has(criterion)) {
        if (key === "unclassified") {
            const localizationKey =
                criterion === "price"
                    ? "GroupNoPrice"
                    : criterion === "cr"
                        ? "GroupNoChallengeRating"
                        : "GroupNoSpellLevel";

            return game.i18n.localize(
                `COMPENDIUM_CURATOR.${localizationKey}`
            );
        }

        return rangeLabel(
            key,
            configuredRanges,
            criterion
        );
    }

    if (criterion === "creatureType") {
        if (key === "unclassified") {
            return game.i18n.localize(
                "COMPENDIUM_CURATOR.GroupNoCreatureType"
            );
        }

        if (key.startsWith("custom:"))
            return key.slice("custom:".length);

        return configLabel(
            CONFIG.DND5E?.creatureTypes,
            key
        );
    }

    if (criterion === "size") {
        return key === "unclassified"
            ? game.i18n.localize(
                "COMPENDIUM_CURATOR.GroupNoSize"
            )
            : configLabel(
                CONFIG.DND5E?.actorSizes,
                key
            );
    }

    if (criterion === "spellSchool") {
        return key === "unclassified"
            ? game.i18n.localize(
                "COMPENDIUM_CURATOR.GroupNoSpellSchool"
            )
            : configLabel(
                CONFIG.DND5E?.spellSchools,
                key
            );
    }

    if (criterion === "manual") {
        if (key === "unclassified") {
            return game.i18n.localize(
                "COMPENDIUM_CURATOR.GroupNoManualGroup"
            );
        }

        return (
            profile?.distribution
                ?.grouped
                ?.manualGroups ?? []
        ).find(group =>
            group?.key === key
        )?.name ?? key;
    }

    return key;
}

function orderedKeys(
    keys,
    profile,
    criterion,
    configuredRanges
) {
    const set = new Set(keys);

    if (criterion === "rarity") {
        return [
            ...RARITY_ORDER.filter(key =>
                set.has(key)
            ),
            ...keys.filter(key =>
                !RARITY_ORDER.includes(key)
            ).sort()
        ];
    }

    if (RANGE_CRITERIA.has(criterion)) {
        const configured =
            configuredRanges.map(
                range => range.key
            );
        const ordered =
            configured.filter(key =>
                set.has(key)
            );

        if (set.has("unclassified"))
            ordered.push("unclassified");

        ordered.push(
            ...keys.filter(key =>
                !ordered.includes(key)
            ).sort()
        );

        return ordered;
    }

    if (criterion === "manual") {
        const configured = (
            profile?.distribution
                ?.grouped
                ?.manualGroups ?? []
        ).map(group => group.key);
        const ordered =
            configured.filter(key =>
                set.has(key)
            );

        if (set.has("unclassified"))
            ordered.push("unclassified");

        ordered.push(
            ...keys.filter(key =>
                !ordered.includes(key)
            ).sort()
        );

        return ordered;
    }

    return [...keys].sort((a, b) =>
        groupLabel(
            a,
            profile,
            criterion,
            configuredRanges
        ).localeCompare(
            groupLabel(
                b,
                profile,
                criterion,
                configuredRanges
            ),
            game.i18n.lang,
            { sensitivity: "base" }
        )
    );
}

function defaultGroupState(
    profile,
    criterion,
    key
) {
    const native =
        nativeGroupConfiguration(
            profile,
            criterion,
            key
        );

    return {
        enabled: native?.enabled !== false,
        weight: positiveNumber(
            native?.weight,
            1
        )
    };
}

function editableGroupState(
    profile,
    sourceKey,
    criterion,
    key
) {
    const fallback =
        defaultGroupState(
            profile,
            criterion,
            key
        );
    const stored =
        sourceConfiguration(
            profile,
            sourceKey,
            criterion
        )?.groups?.[key];
    const nativeDefaultWeight = positiveNumber(
        nativeGroupConfiguration(
            profile,
            criterion,
            key
        )?.distribution?.defaultWeight,
        1
    );

    return {
        enabled:
            stored?.enabled === undefined
                ? fallback.enabled
                : stored.enabled !== false,
        weight: positiveNumber(
            stored?.weight,
            fallback.weight
        ),
        defaultWeight: positiveNumber(
            stored?.defaultWeight,
            nativeDefaultWeight
        ),
        hasDefaultWeight:
            stored?.defaultWeight !== undefined,
        itemWeights:
            stored?.itemWeights &&
            typeof stored.itemWeights === "object" &&
            !Array.isArray(stored.itemWeights)
                ? stored.itemWeights
                : {}
    };
}

function nativeItemWeight(
    profile,
    criterion,
    groupKeyValue,
    uuid
) {
    const group =
        nativeGroupConfiguration(
            profile,
            criterion,
            groupKeyValue
        );
    const distribution =
        group?.distribution ?? {};
    const weights =
        distribution?.weights ??
        distribution?.overrides ??
        distribution?.itemWeights ??
        {};

    return positiveNumber(
        weights?.[uuid],
        positiveNumber(
            distribution?.defaultWeight,
            1
        )
    );
}

function eligibleEntries(profile, uuids) {
    const hidden = new Set(
        StorageService.getHiddenUuids()
    );
    const excluded = new Set(
        profile?.manualExcludes ?? []
    );
    const excludeZeroPrice =
        profile?.itemRules?.excludeZeroPrice === true;

    return prepareDnd5eIndexedEntries(
        uuids
    ).filter(entry =>
        entry.available !== false &&
        !hidden.has(entry.uuid) &&
        !excluded.has(entry.uuid) &&
        (
            !excludeZeroPrice ||
            entry.documentName !== "Item" ||
            entry.hasPositivePrice
        )
    );
}

function buildEditableGroups(
    entries,
    profile,
    sourceKey,
    criterion
) {
    const configuredRanges =
        sourceRanges(
            profile,
            sourceKey,
            criterion
        );
    const byKey = new Map();

    for (const entry of entries) {
        const key = groupKey(
            entry,
            profile,
            criterion,
            configuredRanges
        );
        const current = byKey.get(key) ?? [];

        current.push(entry);
        byKey.set(key, current);
    }

    return orderedKeys(
        [...byKey.keys()],
        profile,
        criterion,
        configuredRanges
    ).map(key => {
        const state = editableGroupState(
            profile,
            sourceKey,
            criterion,
            key
        );
        const groupEntries =
            sortEntries(
                byKey.get(key) ?? []
            ).map(entry => {
                const storedWeight =
                    state.itemWeights?.[
                        entry.uuid
                    ];
                const weight = positiveNumber(
                    storedWeight,
                    state.hasDefaultWeight
                        ? state.defaultWeight
                        : nativeItemWeight(
                            profile,
                            criterion,
                            key,
                            entry.uuid
                        )
                );

                return {
                    ...entry,
                    weight,
                    hasOverride:
                        storedWeight !== undefined,
                    effectiveShare: 0
                };
            });

        return {
            key,
            label: groupLabel(
                key,
                profile,
                criterion,
                configuredRanges
            ),
            entries: groupEntries,
            count: groupEntries.length,
            enabled: state.enabled,
            weight: state.weight,
            defaultWeight: state.defaultWeight,
            effectiveShare: 0
        };
    });
}

function ownSources(
    profile,
    filterGroups
) {
    const sources = [];

    for (
        const filterGroupId
        of [...new Set(
            profile.filterGroupIds ?? []
        )]
    ) {
        const filterGroup =
            filterGroups?.[filterGroupId];

        if (!filterGroup)
            continue;

        const entries = dedupe(
            eligibleEntries(
                profile,
                filterGroup.matches ?? []
            )
                .map(entry => ({
                    ...entry,
                    origins: [filterGroup.name]
                }))
        );

        const key = `filter:${filterGroupId}`;
        const criterion =
            sourceCriterion(profile, key);
        const groups = buildEditableGroups(
            entries,
            profile,
            key,
            criterion
        );

        sources.push({
            key,
            sourceId: filterGroupId,
            type: "category",
            editable: true,
            icon: "fas fa-filter",
            kind: text("Categoría", "Category"),
            name: filterGroup.name,
            entries,
            groups,
            criterion,
            ranges: sourceRanges(
                profile,
                key,
                criterion
            ),
            weight: positiveNumber(
                sourceRecord(profile, key)
                    ?.weight,
                1
            ),
            effectiveShare: 0
        });
    }

    if ((profile?.directUuids ?? []).length) {
        const entries = dedupe(
            eligibleEntries(
                profile,
                profile.directUuids ?? []
            ).map(entry => ({
                ...entry,
                origins: [
                    game.i18n.localize(
                        "COMPENDIUM_CURATOR.ManualInclusions"
                    )
                ]
            }))
        );
        const key = "direct";
        const criterion = sourceCriterion(
            profile,
            key
        );

        sources.push({
            key,
            sourceId: "direct",
            type: "manual",
            editable: true,
            icon: "fas fa-thumbtack",
            kind: game.i18n.localize(
                "COMPENDIUM_CURATOR.ManualInclusions"
            ),
            name: game.i18n.localize(
                "COMPENDIUM_CURATOR.ManualInclusions"
            ),
            entries,
            groups: buildEditableGroups(
                entries,
                profile,
                key,
                criterion
            ),
            criterion,
            ranges: sourceRanges(
                profile,
                key,
                criterion
            ),
            weight: positiveNumber(
                sourceRecord(profile, key)?.weight,
                1
            ),
            effectiveShare: 0
        });
    }

    return sources;
}

function localContentMode(profile) {
    return profile?.contentLayout?.localMode ===
        LOCAL_MODE_FLAT
        ? LOCAL_MODE_FLAT
        : LOCAL_MODE_GROUPED;
}

function localSources(profile, filterGroups) {
    const groupedSources = ownSources(
        profile,
        filterGroups
    );

    if (
        localContentMode(profile) !==
            LOCAL_MODE_FLAT
    ) {
        return groupedSources;
    }

    const entries = dedupe(
        groupedSources.flatMap(source =>
            source.entries ?? []
        )
    );
    const key = "all";
    const criterion = "none";

    return [{
        key,
        sourceId: key,
        type: "all",
        editable: true,
        lockedFlat: true,
        numbered: false,
        icon: "fas fa-layer-group",
        kind: "",
        name: game.i18n.localize(
            "COMPENDIUM_CURATOR.ContentSourceAll"
        ),
        entries,
        groups: buildEditableGroups(
            entries,
            profile,
            key,
            criterion
        ),
        criterion,
        ranges: [],
        weight: positiveNumber(
            sourceRecord(profile, key)?.weight,
            1
        ),
        effectiveShare: 0
    }];
}

function tableSources(
    profile,
    profiles,
    preview
) {
    return (
        preview?.tableGroups ?? []
    ).filter(group =>
        !group.own
    ).map(group => {
        const childId = String(
            group.key ?? ""
        ).replace(/^table:/, "");
        const child = profiles?.[childId];
        const entries = dedupe(
            group.entries ?? []
        );

        return {
            key: `table:${childId}`,
            sourceId: childId,
            type: "table",
            editable: false,
            icon: "fas fa-table-list",
            kind: text("Tabla", "Table"),
            name:
                child?.name ??
                group.label,
            entries,
            child,
            weight: positiveNumber(
                group.weight,
                1
            ),
            effectiveShare: 0
        };
    });
}

function sourceIsActive(source) {
    if (source.type === "table")
        return source.entries.length > 0;

    return source.groups.some(group =>
        group.enabled &&
        group.entries.length
    );
}

function applyEditablePercentages(source) {
    const activeGroups =
        source.groups.filter(group =>
            group.enabled &&
            group.entries.length
        );
    const groupWeightTotal =
        activeGroups.reduce(
            (sum, group) =>
                sum + group.weight,
            0
        );

    for (const group of source.groups) {
        const groupLocalShare =
            group.enabled &&
            group.entries.length &&
            groupWeightTotal > 0
                ? group.weight /
                    groupWeightTotal
                : 0;

        group.effectiveShare =
            source.effectiveShare *
            groupLocalShare;

        const itemWeightTotal =
            group.enabled
                ? group.entries.reduce(
                    (sum, entry) =>
                        sum + entry.weight,
                    0
                )
                : 0;

        for (const entry of group.entries) {
            entry.effectiveShare =
                itemWeightTotal > 0
                    ? group.effectiveShare *
                        entry.weight /
                        itemWeightTotal
                    : 0;
        }
    }
}

function decorateSourcePercentages(sources) {
    const active = sources.filter(
        source => sourceIsActive(source)
    );
    const total = active.reduce(
        (sum, source) =>
            sum + source.weight,
        0
    );

    for (const source of sources) {
        source.effectiveShare =
            sourceIsActive(source) &&
            total > 0
                ? source.weight / total
                : 0;

        if (source.editable)
            applyEditablePercentages(source);
    }
}

export async function buildDirectContentGenerationSources(
    profile,
    browserApp,
    filterGroups =
        TableProfileStorageService.getFilterGroups()
) {
    const resolved = await TableProfileService
        .resolveLocalContentSources(
            browserApp,
            profile
        );
    const resolvedFilterGroups = {};
    const resolvedProfile = {
        ...profile,
        filterGroupIds: [],
        directUuids: [],
        restrictions: null,
        globalFilters: null,
        manualExcludes: []
    };

    for (const source of resolved.sources) {
        const uuids = source.candidates
            .map(candidate => candidate.uuid)
            .filter(Boolean);

        if (source.kind === "category") {
            resolvedProfile.filterGroupIds.push(source.id);
            resolvedFilterGroups[source.id] = {
                id: source.id,
                name: source.name,
                matches: uuids
            };
        }
        else if (
            source.kind === "direct" ||
            source.kind === "manual"
        ) {
            resolvedProfile.directUuids = uuids;
        }
    }

    const sources = localSources(
        resolvedProfile,
        Object.keys(resolvedFilterGroups).length
            ? resolvedFilterGroups
            : filterGroups
    );

    decorateSourcePercentages(sources);
    return sources;
}

function tableModeLabel(profile) {
    if (
        profile?.contentLayout?.mode ===
            DIRECT_MODE
    ) {
        return game.i18n.localize(
            localContentMode(profile) ===
                LOCAL_MODE_FLAT
                ? "COMPENDIUM_CURATOR.ContentDistributionFlat"
                : "COMPENDIUM_CURATOR.ContentDistributionGrouped"
        );
    }

    if (
        profile?.distribution?.mode ===
            "individual"
    ) {
        return game.i18n.localize(
            "COMPENDIUM_CURATOR.DistributionIndividual"
        );
    }

    return game.i18n.localize(
        "COMPENDIUM_CURATOR.DistributionGrouped"
    );
}

function buildReadOnlyDirectBranches(
    child,
    filterGroups,
    childPreview
) {
    const branches = [];

    if (
        localContentMode(child) ===
            LOCAL_MODE_FLAT
    ) {
        const localEntries = dedupe(
            eligibleEntries(
                child,
                [
                    ...(child?.filterGroupIds ?? [])
                        .flatMap(filterGroupId =>
                            filterGroups?.[filterGroupId]
                                ?.matches ?? []
                        ),
                    ...(child?.directUuids ?? [])
                ]
            )
        );

        branches.push({
            key: "all",
            name: game.i18n.localize(
                "COMPENDIUM_CURATOR.ContentSourceAll"
            ),
            kind: "",
            count: localEntries.length,
            weight: positiveNumber(
                sourceRecord(child, "all")?.weight,
                1
            ),
            active: localEntries.length > 0,
            share: 0
        });
    }

    for (
        const filterGroupId
        of [...new Set(
            child?.filterGroupIds ?? []
        )]
    ) {
        if (
            localContentMode(child) ===
                LOCAL_MODE_FLAT
        ) {
            break;
        }

        const filterGroup =
            filterGroups?.[filterGroupId];

        if (!filterGroup)
            continue;

        const entries = dedupe(
            eligibleEntries(
                child,
                [
                    ...(filterGroup.matches ?? []),
                    ...(filterGroup.manualIncludes ?? [])
                ]
            )
        );

        const key = `filter:${filterGroupId}`;

        branches.push({
            key,
            name: filterGroup.name,
            kind: text("Grupo", "Group"),
            count: entries.length,
            weight: positiveNumber(
                sourceRecord(child, key)
                    ?.weight,
                1
            ),
            active: entries.length > 0,
            share: 0
        });
    }

    if (
        localContentMode(child) ===
            LOCAL_MODE_GROUPED &&
        (child?.directUuids ?? []).length
    ) {
        const manualCount = eligibleEntries(
            child,
            child.directUuids
        ).length;

        branches.push({
            key: "direct",
            name: game.i18n.localize(
                "COMPENDIUM_CURATOR.ManualInclusions"
            ),
            kind: "",
            count: manualCount,
            weight: positiveNumber(
                sourceRecord(child, "direct")?.weight,
                1
            ),
            active: manualCount > 0,
            share: 0
        });
    }

    for (
        const group
        of childPreview?.tableGroups ?? []
    ) {
        if (group.own)
            continue;

        const childId = String(
            group.key ?? ""
        ).replace(/^table:/, "");

        branches.push({
            key: `table:${childId}`,
            name: group.label,
            kind: text("Tabla", "Table"),
            count:
                group.entries?.length ?? 0,
            weight: positiveNumber(
                group.weight,
                1
            ),
            active:
                (group.entries?.length ?? 0) > 0,
            share: 0
        });
    }

    const total = branches
        .filter(branch => branch.active)
        .reduce(
            (sum, branch) =>
                sum + branch.weight,
            0
        );

    for (const branch of branches) {
        branch.share =
            branch.active && total > 0
                ? branch.weight / total
                : 0;
    }

    return branches;
}

function nativeIndividualWeight(
    profile,
    uuid
) {
    const individual =
        profile?.distribution?.individual ?? {};

    return positiveNumber(
        individual?.weights?.[uuid],
        positiveNumber(
            individual?.defaultWeight,
            1
        )
    );
}

function buildReadOnlyTableView(
    source,
    child,
    filterGroups,
    childPreview
) {
    if (!child) {
        return {
            mode: text("No disponible", "Unavailable"),
            kind: "missing",
            groups: [],
            entries: [],
            branches: []
        };
    }

    if (
        child?.contentLayout?.mode ===
            DIRECT_MODE
    ) {
        return {
            mode: tableModeLabel(child),
            kind: "direct",
            groups: [],
            entries: [],
            branches:
                buildReadOnlyDirectBranches(
                    child,
                    filterGroups,
                    childPreview
                )
        };
    }

    if (
        child?.distribution?.mode ===
            "individual"
    ) {
        const entries = source.entries.map(
            entry => ({
                ...entry,
                weight:
                    nativeIndividualWeight(
                        child,
                        entry.uuid
                    ),
                effectiveShare: 0
            })
        );
        const total = entries.reduce(
            (sum, entry) =>
                sum + entry.weight,
            0
        );

        for (const entry of entries) {
            entry.effectiveShare =
                total > 0
                    ? source.effectiveShare *
                        entry.weight / total
                    : 0;
        }

        return {
            mode: tableModeLabel(child),
            kind: "individual",
            groups: [],
            entries,
            branches: []
        };
    }

    const criterion = profileCriterion(child);
    const configuredRanges =
        profileRanges(child, criterion);
    const byKey = new Map();

    for (const entry of source.entries) {
        const key = groupKey(
            entry,
            child,
            criterion,
            configuredRanges
        );
        const current = byKey.get(key) ?? [];

        current.push(entry);
        byKey.set(key, current);
    }

    const groups = orderedKeys(
        [...byKey.keys()],
        child,
        criterion,
        configuredRanges
    ).map(key => {
        const state =
            defaultGroupState(
                child,
                criterion,
                key
            );
        const entries = sortEntries(
            byKey.get(key) ?? []
        ).map(entry => ({
            ...entry,
            weight:
                nativeItemWeight(
                    child,
                    criterion,
                    key,
                    entry.uuid
                ),
            effectiveShare: 0
        }));

        return {
            key,
            label: groupLabel(
                key,
                child,
                criterion,
                configuredRanges
            ),
            enabled: state.enabled,
            weight: state.weight,
            count: entries.length,
            entries,
            effectiveShare: 0
        };
    });
    const activeGroups = groups.filter(
        group =>
            group.enabled &&
            group.entries.length
    );
    const groupWeightTotal =
        activeGroups.reduce(
            (sum, group) =>
                sum + group.weight,
            0
        );

    for (const group of groups) {
        const localShare =
            group.enabled &&
            group.entries.length &&
            groupWeightTotal > 0
                ? group.weight /
                    groupWeightTotal
                : 0;

        group.effectiveShare =
            source.effectiveShare *
            localShare;

        const itemWeightTotal =
            group.enabled
                ? group.entries.reduce(
                    (sum, entry) =>
                        sum + entry.weight,
                    0
                )
                : 0;

        for (const entry of group.entries) {
            entry.effectiveShare =
                itemWeightTotal > 0
                    ? group.effectiveShare *
                        entry.weight /
                        itemWeightTotal
                    : 0;
        }
    }

    return {
        mode: tableModeLabel(child),
        kind: "grouped",
        criterion,
        criterionLabel:
            criterionLabel(criterion),
        groups,
        entries: [],
        branches: []
    };
}

async function saveLayout(
    profileId,
    mutate
) {
    const storage = foundry.utils.deepClone(
        TableProfileStorageService.getStorage()
    );
    const profile =
        storage.profiles?.[profileId];

    if (
        !profile ||
        profile.type !== "content"
    ) {
        throw new Error(
            "TABLE_PROFILE_NOT_FOUND"
        );
    }

    const layout =
        profile.contentLayout &&
        typeof profile.contentLayout === "object" &&
        !Array.isArray(profile.contentLayout)
            ? foundry.utils.deepClone(
                profile.contentLayout
            )
            : {
                mode: DIRECT_MODE,
                sources: {}
            };

    layout.sources ??= {};
    const before = foundry.utils.deepClone(
        layout
    );

    mutate(layout, profile);

    if (foundry.utils.equals(before, layout))
        return;

    profile.contentLayout = layout;
    profile.revision =
        Number(profile.revision ?? 1) + 1;

    await game.settings.set(
        MODULE_ID,
        TABLE_PROFILES_SETTING,
        storage
    );
}

async function saveSource(
    profileId,
    sourceKey,
    mutate
) {
    return saveLayout(
        profileId,
        layout => {
            const source =
                layout.sources[sourceKey] &&
                typeof layout.sources[sourceKey] ===
                    "object" &&
                !Array.isArray(
                    layout.sources[sourceKey]
                )
                    ? layout.sources[sourceKey]
                    : {};

            layout.sources[sourceKey] = source;
            mutate(source);
        }
    );
}

async function saveSourceConfiguration(
    profileId,
    sourceKey,
    criterion,
    mutate
) {
    return saveSource(
        profileId,
        sourceKey,
        source => {
            source.configurations ??= {};

            const configuration =
                source.configurations[criterion] &&
                typeof source.configurations[criterion] ===
                    "object" &&
                !Array.isArray(
                    source.configurations[criterion]
                )
                    ? source.configurations[criterion]
                    : {};

            source.configurations[criterion] =
                configuration;
            configuration.groups ??= {};
            mutate(configuration, source);
        }
    );
}

function updateCount(inspector, count) {
    const summary = inspector.querySelector(
        ".cc-table-content-object-count"
    );

    if (summary) {
        summary.textContent = game.i18n.format(
            "COMPENDIUM_CURATOR.GroupObjectCount",
            { count }
        );
    }

    const final = inspector.querySelector(
        ".cc-table-filter-group-matches-title strong"
    );

    if (final)
        final.textContent = String(count);
}

function renderDocumentName(entry) {
    const subtitle = localizeMaybe(
        entry.subtitle
    );
    const origin = String(
        entry.originLabel ?? ""
    ).trim();

    return `
        <div
            class="item-name rollable"
            role="button"
            data-cc-open-document
        >
            ${entry.img
                ? `
                    <img
                        class="item-image gold-icon"
                        loading="lazy"
                        src="${esc(entry.img)}"
                        alt="${esc(entry.name)}"
                        draggable="false"
                    >
                `
                : ""
            }
            <div class="name name-stacked">
                <span class="title">
                    ${esc(entry.name)}
                </span>
                ${subtitle
                    ? `
                        <span class="subtitle">
                            ${esc(subtitle)}
                        </span>
                    `
                    : ""
                }
                ${origin
                    ? `
                        <span class="subtitle">
                            <i class="fas fa-sitemap"></i>
                            ${esc(origin)}
                        </span>
                    `
                    : ""
                }
            </div>
        </div>
    `;
}

function renderEditableEntry(
    entry,
    source,
    group
) {
    const sourceText = String(
        entry.source ?? ""
    ).trim();

    return `
        <li
            class="item cc-dnd5e-document-entry"
            data-uuid="${esc(entry.uuid)}"
        >
            <div class="item-row">
                ${renderDocumentName(entry)}
                <div class="item-detail item-source ${sourceText ? "" : "empty"}">
                    ${sourceText
                        ? `<span class="condensed">${esc(sourceText)}</span>`
                        : ""
                    }
                </div>
                <div
                    class="item-detail item-controls"
                    style="
                        flex:0 0 174px;
                        min-width:174px;
                        display:flex;
                        align-items:center;
                        justify-content:flex-end;
                        gap:0.3rem;
                    "
                >
                    <input
                        type="number"
                        min="0.000001"
                        step="any"
                        value="${esc(entry.weight)}"
                        data-cc-direct-item-weight
                        data-source-key="${esc(source.key)}"
                        data-group-key="${esc(group.key)}"
                        data-uuid="${esc(entry.uuid)}"
                        style="width:58px;height:26px;text-align:right;"
                        ${group.enabled ? "" : "disabled"}
                    >
                    <span
                        class="hint cc-direct-weight-value"
                        style="min-width:64px;text-align:right;"
                        title="${esc(text(
                            "Porcentaje efectivo respecto a la tabla padre",
                            "Effective percentage relative to the parent table"
                        ))}"
                    >
                        ${esc(percentage(entry.effectiveShare))}
                    </span>
                    <button
                        type="button"
                        class="unbutton"
                        data-cc-direct-reset-item-weight
                        data-source-key="${esc(source.key)}"
                        data-group-key="${esc(group.key)}"
                        data-uuid="${esc(entry.uuid)}"
                        ${entry.hasOverride ? "" : "disabled"}
                        title="${esc(game.i18n.localize(
                            "COMPENDIUM_CURATOR.ResetGroupItemWeight"
                        ))}"
                        style="width:24px;height:24px;"
                    >
                        <i class="fas fa-rotate-left"></i>
                    </button>
                </div>
            </div>
        </li>
    `;
}

function renderReadOnlyEntry(entry) {
    const sourceText = String(
        entry.source ?? ""
    ).trim();

    return `
        <li
            class="item cc-dnd5e-document-entry"
            data-uuid="${esc(entry.uuid)}"
        >
            <div class="item-row">
                ${renderDocumentName(entry)}
                <div class="item-detail item-source ${sourceText ? "" : "empty"}">
                    ${sourceText
                        ? `<span class="condensed">${esc(sourceText)}</span>`
                        : ""
                    }
                </div>
                <div
                    class="item-detail item-controls"
                    style="
                        flex:0 0 132px;
                        min-width:132px;
                        display:flex;
                        justify-content:flex-end;
                        gap:0.65rem;
                    "
                >
                    <span class="hint">
                        ${esc(text("Peso", "Weight"))}
                        ${esc(entry.weight)}
                    </span>
                    <strong style="min-width:58px;text-align:right;">
                        ${esc(percentage(entry.effectiveShare))}
                    </strong>
                </div>
            </div>
        </li>
    `;
}

function renderEditableGroup(source, group) {
    const entries = group.entries.slice(
        0,
        PREVIEW_LIMIT
    );

    return `
        <details
            data-cc-direct-group-details
            data-source-key="${esc(source.key)}"
            data-group-key="${esc(group.key)}"
            style="
                background:rgb(0 0 0 / 12%);
                border-radius:5px;
            "
        >
            <summary
                style="
                    display:flex;
                    align-items:center;
                    gap:0.55rem;
                    padding:0.5rem 0.65rem;
                    cursor:pointer;
                    list-style:none;
                "
            >
                <input
                    type="checkbox"
                    data-cc-direct-group-enabled
                    data-source-key="${esc(source.key)}"
                    data-group-key="${esc(group.key)}"
                    ${group.enabled ? "checked" : ""}
                    style="margin:0;"
                >
                <span style="min-width:0;flex:1 1 auto;">
                    <i class="fas fa-chevron-down"></i>
                    ${esc(group.label)}
                </span>
                <span class="hint">
                    ${group.count}
                    ${esc(text("objetos", "objects"))}
                </span>
                <strong
                    style="min-width:64px;text-align:right;"
                    title="${esc(text(
                        "Porcentaje efectivo respecto a la tabla padre",
                        "Effective percentage relative to the parent table"
                    ))}"
                >
                    ${esc(percentage(group.effectiveShare))}
                </strong>
                <label class="hint">
                    ${esc(text("Peso interno", "Internal weight"))}
                </label>
                <input
                    type="number"
                    min="0.000001"
                    step="any"
                    value="${esc(group.weight)}"
                    data-cc-direct-group-weight
                    data-source-key="${esc(source.key)}"
                    data-group-key="${esc(group.key)}"
                    ${group.enabled ? "" : "disabled"}
                    style="width:64px;height:28px;text-align:right;"
                >
            </summary>
            <div style="padding:0 0.55rem 0.55rem;">
                ${entries.length
                    ? `
                        <section class="inventory-element cc-dnd5e-document-list">
                            <section class="items-list browser-results">
                                <div class="items-section card">
                                    <div class="items-header header">
                                        <h3 class="item-name">
                                            ${esc(game.i18n.localize(
                                                "DND5E.CompendiumBrowser.Column.Results"
                                            ))}
                                        </h3>
                                        <div class="item-header item-source">
                                            ${esc(game.i18n.localize(
                                                "DND5E.CompendiumBrowser.Column.Source"
                                            ))}
                                        </div>
                                        <div
                                            class="item-header cc-direct-default-weight-header"
                                            style="flex:0 0 64px;min-width:64px;text-align:center;"
                                        >
                                            <input
                                                type="number"
                                                min="0.000001"
                                                step="any"
                                                value="${esc(group.defaultWeight)}"
                                                data-cc-direct-default-item-weight
                                                data-source-key="${esc(source.key)}"
                                                data-group-key="${esc(group.key)}"
                                                ${group.enabled ? "" : "disabled"}
                                                aria-label="${esc(text(
                                                    "Peso base de la lista",
                                                    "List default weight"
                                                ))}"
                                                title="${esc(text(
                                                    "Peso base para los objetos sin peso individual",
                                                    "Default weight for objects without an individual weight"
                                                ))}"
                                                style="width:58px;height:26px;text-align:center;"
                                            >
                                        </div>
                                        <div
                                            class="item-header item-controls cc-direct-weight-header"
                                            style="flex:0 0 174px;min-width:174px;text-align:center;"
                                        >
                                            ${esc(text("Peso interno / % raíz", "Internal weight / root %"))}
                                        </div>
                                    </div>
                                    <ol
                                        class="item-list unlist"
                                        style="max-height:300px;overflow-y:auto;"
                                    >
                                        ${entries.map(entry =>
                                            renderEditableEntry(
                                                entry,
                                                source,
                                                group
                                            )
                                        ).join("")}
                                    </ol>
                                </div>
                            </section>
                        </section>
                    `
                    : `<p class="hint">${esc(text("No hay objetos.", "No objects."))}</p>`
                }
                ${group.count > entries.length
                    ? `
                        <p class="hint" style="text-align:right;">
                            ${esc(text("Vista previa", "Preview"))}:
                            ${entries.length} / ${group.count}
                        </p>
                    `
                    : ""
                }
            </div>
        </details>
    `;
}

function renderFlatEditableGroup(source, group) {
    const entries = group.entries.slice(0, PREVIEW_LIMIT);

    if (!entries.length) {
        return `<p class="hint">${esc(text("No hay objetos.", "No objects."))}</p>`;
    }

    return `
        <section class="inventory-element cc-dnd5e-document-list">
            <section class="items-list browser-results">
                <div class="items-section card">
                    <div class="items-header header">
                        <h3 class="item-name">${esc(game.i18n.localize("DND5E.CompendiumBrowser.Column.Results"))}</h3>
                        <div class="item-header item-source">${esc(game.i18n.localize("DND5E.CompendiumBrowser.Column.Source"))}</div>
                        <div class="item-header cc-direct-default-weight-header" style="flex:0 0 64px;min-width:64px;text-align:center;">
                            <input type="number" min="0.000001" step="any" value="${esc(group.defaultWeight)}" data-cc-direct-default-item-weight data-source-key="${esc(source.key)}" data-group-key="${esc(group.key)}" aria-label="${esc(text("Peso base de la lista", "List default weight"))}" style="width:58px;height:26px;text-align:center;">
                        </div>
                        <div class="item-header item-controls cc-direct-weight-header" style="flex:0 0 174px;min-width:174px;text-align:center;">${esc(text("Peso / % raíz", "Weight / root %"))}</div>
                    </div>
                    <ol class="item-list unlist" style="max-height:420px;overflow-y:auto;">
                        ${entries.map(entry => renderEditableEntry(entry, source, group)).join("")}
                    </ol>
                </div>
            </section>
            ${group.count > entries.length ? `<p class="hint" style="text-align:right;">${esc(text("Vista previa", "Preview"))}: ${entries.length} / ${group.count}</p>` : ""}
        </section>
    `;
}

function criterionOptions(selected) {
    return CRITERIA.map(value => `
        <option
            value="${esc(value)}"
            ${value === selected ? "selected" : ""}
        >
            ${esc(criterionLabel(value))}
        </option>
    `).join("");
}

function renderRangeEditor(source) {
    if (!RANGE_CRITERIA.has(source.criterion))
        return "";

    return `
        <details
            data-cc-direct-range-editor
            data-source-key="${esc(source.key)}"
            style="
                border:1px solid rgb(255 255 255 / 8%);
                border-radius:5px;
                padding:0.45rem 0.55rem;
            "
        >
            <summary style="cursor:pointer;">
                <i class="fas fa-sliders"></i>
                ${esc(game.i18n.localize(
                    "COMPENDIUM_CURATOR.EditRanges"
                ))}
            </summary>
            <div
                style="
                    display:flex;
                    flex-direction:column;
                    gap:0.45rem;
                    padding-top:0.55rem;
                "
            >
                ${source.ranges.map((range, index) => `
                    <div
                        data-cc-direct-range-row
                        data-range-key="${esc(range.key)}"
                        style="
                            display:grid;
                            grid-template-columns:minmax(120px,1fr) 90px 90px;
                            gap:0.45rem;
                            align-items:center;
                        "
                    >
                        <span class="hint">
                            ${esc(rangeLabel(
                                range.key,
                                source.ranges,
                                source.criterion
                            ))}
                        </span>
                        <input
                            type="number"
                            step="any"
                            value="${esc(range.min)}"
                            data-cc-direct-range-min
                            aria-label="Min"
                        >
                        <input
                            type="number"
                            step="any"
                            value="${range.max === null || range.max === undefined ? "" : esc(range.max)}"
                            data-cc-direct-range-max
                            placeholder="∞"
                            aria-label="Max"
                        >
                    </div>
                `).join("")}
                <button
                    type="button"
                    data-cc-direct-save-ranges
                    data-source-key="${esc(source.key)}"
                    style="align-self:flex-end;width:auto;"
                >
                    <i class="fas fa-floppy-disk"></i>
                    ${esc(text("Guardar rangos", "Save ranges"))}
                </button>
            </div>
        </details>
    `;
}

function renderEditableSource(source) {
    return `
        <details
            data-cc-direct-source="${esc(source.key)}"
            style="
                background:rgb(0 0 0 / 12%);
                border-radius:5px;
            "
        >
            <summary
                style="
                    display:flex;
                    align-items:center;
                    gap:0.55rem;
                    padding:0.55rem 0.65rem;
                    cursor:pointer;
                    list-style:none;
                "
            >
                <span style="min-width:0;flex:1 1 auto;">
                    <i class="fas fa-chevron-down"></i>
                    <i class="${esc(source.icon)}"></i>
                    ${source.kind
                        ? `<span class="hint">${esc(source.kind)}:</span>`
                        : ""
                    }
                    ${esc(source.name)}
                </span>
                <span class="hint">
                    ${source.entries.length}
                    ${esc(text("objetos", "objects"))}
                </span>
                <strong
                    style="min-width:64px;text-align:right;"
                    title="${esc(text(
                        "Porcentaje efectivo de esta rama",
                        "Effective percentage of this branch"
                    ))}"
                >
                    ${esc(percentage(source.effectiveShare))}
                </strong>
                <label class="hint">
                    ${esc(text("Peso rama", "Branch weight"))}
                </label>
                <input
                    type="number"
                    min="0.000001"
                    step="any"
                    value="${esc(source.weight)}"
                    data-cc-direct-branch-weight
                    data-source-key="${esc(source.key)}"
                    style="width:68px;height:28px;text-align:right;"
                >
            </summary>
            <div
                style="
                    display:flex;
                    flex-direction:column;
                    gap:0.6rem;
                    padding:0 0.55rem 0.55rem;
                "
            >
                ${source.lockedFlat ? "" : `<div
                    class="cc-direct-configuration-row"
                    style="
                        display:grid;
                        grid-template-columns:minmax(140px,1fr) minmax(180px,1.3fr);
                        gap:0.55rem 0.8rem;
                        align-items:center;
                        padding-top:0.55rem;
                    "
                >
                    <label>
                        ${esc(text("Agrupar por", "Group by"))}
                    </label>
                    <select
                        class="cc-direct-configuration-select"
                        data-cc-direct-source-grouping
                        data-source-key="${esc(source.key)}"
                    >
                        ${criterionOptions(source.criterion)}
                    </select>
                </div>`}
                ${source.lockedFlat ? "" : renderRangeEditor(source)}
                ${source.criterion === "none" ? "" : `<div
                    class="cc-table-filter-detail-choices"
                    style="display:flex;flex-direction:column;gap:0.35rem;"
                >
                    ${source.groups.map(group => `
                        <div
                            class="cc-table-filter-detail-choice"
                            style="align-items:center;"
                        >
                            <input
                                type="checkbox"
                                data-cc-direct-group-enabled
                                data-source-key="${esc(source.key)}"
                                data-group-key="${esc(group.key)}"
                                ${group.enabled ? "checked" : ""}
                                style="margin:0;"
                            >
                            <span style="flex:1 1 auto;min-width:0;">
                                ${esc(group.label)}
                            </span>
                            <span class="hint">
                                ${group.count}
                                ${esc(text("objetos", "objects"))}
                            </span>
                            <strong style="min-width:64px;text-align:right;">
                                ${esc(percentage(group.effectiveShare))}
                            </strong>
                            <label class="hint">
                                ${esc(text("Peso", "Weight"))}
                            </label>
                            <input
                                type="number"
                                min="0.000001"
                                step="any"
                                value="${esc(group.weight)}"
                                data-cc-direct-group-weight
                                data-source-key="${esc(source.key)}"
                                data-group-key="${esc(group.key)}"
                                ${group.enabled ? "" : "disabled"}
                                style="width:64px;height:28px;text-align:right;"
                            >
                        </div>
                    `).join("")}
                </div>`}
                <div style="display:flex;flex-direction:column;gap:0.55rem;">
                    ${source.groups.length
                        ? source.groups.map(group =>
                            source.criterion === "none"
                                ? renderFlatEditableGroup(source, group)
                                : renderEditableGroup(source, group)
                        ).join("")
                        : `<p class="hint">${esc(text(
                            "Este contenido no aporta objetos activos.",
                            "This content has no active objects."
                        ))}</p>`
                    }
                </div>
            </div>
        </details>
    `;
}

function renderReadOnlyGroup(group) {
    const entries = group.entries.slice(
        0,
        PREVIEW_LIMIT
    );

    return `
        <details
            style="
                background:rgb(0 0 0 / 12%);
                border-radius:5px;
            "
        >
            <summary
                style="
                    display:flex;
                    align-items:center;
                    gap:0.6rem;
                    padding:0.5rem 0.65rem;
                    cursor:pointer;
                    list-style:none;
                "
            >
                <span style="flex:1 1 auto;min-width:0;">
                    <i class="fas fa-chevron-down"></i>
                    ${esc(group.label)}
                    ${group.enabled ? "" : `<span class="hint">(${esc(text("excluido", "excluded"))})</span>`}
                </span>
                <span class="hint">
                    ${group.count}
                    ${esc(text("objetos", "objects"))}
                </span>
                <span class="hint">
                    ${esc(text("Peso", "Weight"))}
                    ${esc(group.weight)}
                </span>
                <strong style="min-width:64px;text-align:right;">
                    ${esc(percentage(group.effectiveShare))}
                </strong>
            </summary>
            <div style="padding:0 0.55rem 0.55rem;">
                ${entries.length
                    ? `
                        <section class="inventory-element cc-dnd5e-document-list">
                            <section class="items-list browser-results">
                                <div class="items-section card">
                                    <ol
                                        class="item-list unlist"
                                        style="max-height:280px;overflow-y:auto;"
                                    >
                                        ${entries.map(
                                            renderReadOnlyEntry
                                        ).join("")}
                                    </ol>
                                </div>
                            </section>
                        </section>
                    `
                    : `<p class="hint">${esc(text("No hay objetos.", "No objects."))}</p>`
                }
            </div>
        </details>
    `;
}

function renderTableSource(source, tableView) {
    const childId = source.sourceId;

    return `
        <details
            data-cc-direct-source="${esc(source.key)}"
            style="
                background:rgb(0 0 0 / 12%);
                border-radius:5px;
            "
        >
            <summary
                style="
                    display:flex;
                    align-items:center;
                    gap:0.55rem;
                    padding:0.55rem 0.65rem;
                    cursor:pointer;
                    list-style:none;
                "
            >
                <span style="min-width:0;flex:1 1 auto;">
                    <i class="fas fa-chevron-down"></i>
                    <i class="fas fa-table-list"></i>
                    <span class="hint">${esc(text("Tabla", "Table"))}:</span>
                    ${esc(source.name)}
                    <button
                        type="button"
                        class="unbutton cc-open-original-table-button"
                        data-cc-open-original-table
                        data-child-profile-id="${esc(childId)}"
                        aria-label="${esc(text(
                            "Ir a la tabla original",
                            "Go to original table"
                        ))}"
                        title="${esc(text(
                            "Ir a la tabla original",
                            "Go to original table"
                        ))}"
                    >
                        <i class="fas fa-arrow-up-right-from-square"></i>
                    </button>
                </span>
                <span class="hint">
                    ${source.entries.length}
                    ${esc(text("objetos", "objects"))}
                </span>
                <strong
                    style="min-width:64px;text-align:right;"
                    title="${esc(text(
                        "Porcentaje efectivo de esta tabla dentro de la tabla padre",
                        "Effective percentage of this table inside the parent table"
                    ))}"
                >
                    ${esc(percentage(source.effectiveShare))}
                </strong>
                <label class="hint">
                    ${esc(text("Peso rama", "Branch weight"))}
                </label>
                <input
                    type="number"
                    min="0.000001"
                    step="any"
                    value="${esc(source.weight)}"
                    data-cc-direct-table-weight
                    data-child-profile-id="${esc(childId)}"
                    style="width:68px;height:28px;text-align:right;"
                >
            </summary>
            <div
                style="
                    display:flex;
                    flex-direction:column;
                    gap:0.6rem;
                    padding:0 0.55rem 0.55rem;
                "
            >
                ${tableView.kind === "grouped"
                    ? tableView.groups.map(
                        renderReadOnlyGroup
                    ).join("")
                    : ""
                }
                ${tableView.kind === "individual"
                    ? `
                        <section class="inventory-element cc-dnd5e-document-list">
                            <section class="items-list browser-results">
                                <div class="items-section card">
                                    <ol
                                        class="item-list unlist"
                                        style="max-height:320px;overflow-y:auto;"
                                    >
                                        ${tableView.entries
                                            .slice(0, PREVIEW_LIMIT)
                                            .map(renderReadOnlyEntry)
                                            .join("")}
                                    </ol>
                                </div>
                            </section>
                        </section>
                    `
                    : ""
                }
                ${tableView.kind === "direct"
                    ? `
                        <div style="display:flex;flex-direction:column;gap:0.35rem;">
                            ${tableView.branches.map(branch => `
                                <div
                                    class="cc-table-filter-detail-choice"
                                    style="align-items:center;"
                                >
                                    ${branch.kind
                                        ? `<span class="hint">${esc(branch.kind)}:</span>`
                                        : ""
                                    }
                                    <span style="flex:1 1 auto;min-width:0;">
                                        ${esc(branch.name)}
                                    </span>
                                    <span class="hint">
                                        ${branch.count}
                                        ${esc(text("objetos", "objects"))}
                                    </span>
                                    <span class="hint">
                                        ${esc(text("Peso", "Weight"))}
                                        ${esc(branch.weight)}
                                    </span>
                                    <strong style="min-width:64px;text-align:right;">
                                        ${esc(percentage(
                                            source.effectiveShare *
                                            branch.share
                                        ))}
                                    </strong>
                                </div>
                            `).join("")}
                        </div>
                    `
                    : ""
                }
            </div>
        </details>
    `;
}

function renderEditor(
    profile,
    sources,
    tableViews
) {
    const totalCount = dedupe(
        sources.flatMap(source =>
            source.entries
        )
    ).length;

    return `
        <div
            data-cc-direct-content-editor
            style="
                display:flex;
                flex-direction:column;
                gap:0.55rem;
            "
        >
            <div class="cc-table-content-distribution-mode">
                <span class="cc-table-content-distribution-icon">
                    <i class="fas fa-chart-simple"></i>
                </span>
                <span class="cc-table-content-distribution-copy">
                    <strong>${esc(game.i18n.localize(
                        "COMPENDIUM_CURATOR.DistributionMode"
                    ))}</strong>
                    <span class="hint">${esc(game.i18n.localize(
                        localContentMode(profile) === LOCAL_MODE_FLAT
                            ? "COMPENDIUM_CURATOR.ContentDistributionFlatHint"
                            : "COMPENDIUM_CURATOR.ContentDistributionGroupedHint"
                    ))}</span>
                </span>
                <select data-cc-content-local-mode>
                    <option value="flat" ${localContentMode(profile) === LOCAL_MODE_FLAT ? "selected" : ""}>
                        ${esc(game.i18n.localize(
                            "COMPENDIUM_CURATOR.ContentDistributionFlat"
                        ))}
                    </option>
                    <option value="grouped" ${localContentMode(profile) === LOCAL_MODE_GROUPED ? "selected" : ""}>
                        ${esc(game.i18n.localize(
                            "COMPENDIUM_CURATOR.ContentDistributionGrouped"
                        ))}
                    </option>
                </select>
            </div>

            <details
                class="cc-table-filter-detail-block cc-table-content-section"
                data-cc-content-section
            >
                <summary class="cc-table-section-summary">
                    <span>
                        <i class="fas fa-chevron-down"></i>
                        <i class="fas fa-boxes-stacked"></i>
                        ${esc(game.i18n.localize(
                            "COMPENDIUM_CURATOR.TableManagerTabContent"
                        ))}
                    </span>
                    <strong class="cc-table-content-object-count">
                        ${esc(game.i18n.format(
                            "COMPENDIUM_CURATOR.GroupObjectCount",
                            { count: totalCount }
                        ))}
                    </strong>
                </summary>

                <div class="cc-table-content-list">
                    ${sources.length
                        ? sources.map(source => {
                            if (source.type === "table") {
                                return renderTableSource(
                                    source,
                                    tableViews.get(
                                        source.sourceId
                                    )
                                );
                            }

                            return renderEditableSource(
                                source
                            );
                        }).join("")
                        : `<p class="hint">${esc(text(
                            "Esta tabla todavía no tiene contenido directo.",
                            "This table does not have direct content yet."
                        ))}</p>`
                    }
                </div>
            </details>
        </div>
    `;
}

function validateRanges(rows) {
    const parsed = [];

    for (const row of rows) {
        const key = String(
            row.dataset.rangeKey ?? ""
        ).trim();
        const min = normalizeNumber(
            row.querySelector(
                "[data-cc-direct-range-min]"
            )?.value
        );
        const maxInput = String(
            row.querySelector(
                "[data-cc-direct-range-max]"
            )?.value ?? ""
        ).trim();
        const max = maxInput
            ? normalizeNumber(maxInput)
            : null;

        if (
            !key ||
            min === null ||
            (
                max !== null &&
                max < min
            )
        ) {
            return null;
        }

        parsed.push({
            key,
            min,
            max
        });
    }

    parsed.sort((a, b) =>
        a.min - b.min
    );

    for (
        let index = 1;
        index < parsed.length;
        index++
    ) {
        const previous = parsed[index - 1];
        const current = parsed[index];

        if (
            previous.max === null ||
            current.min <= previous.max
        ) {
            return null;
        }
    }

    return parsed;
}

function stopSummaryToggle(control) {
    control.addEventListener(
        "click",
        event => event.stopPropagation()
    );
}

async function rerender(application) {
    await application.render({ force: true });
}

function activateEditor(
    application,
    profile,
    row,
    wrapper
) {
    for (
        const control
        of wrapper.querySelectorAll(
            "summary input, summary select, summary button"
        )
    ) {
        stopSummaryToggle(control);
    }

    const localModeSelect = wrapper.querySelector(
        "[data-cc-content-local-mode]"
    );

    localModeSelect?.addEventListener(
        "change",
        async () => {
            const value = String(
                localModeSelect.value ?? ""
            ).trim();

            if (![LOCAL_MODE_FLAT, LOCAL_MODE_GROUPED]
                .includes(value)) {
                return;
            }

            localModeSelect.disabled = true;

            try {
                await saveLayout(
                    profile.id,
                    layout => {
                        layout.mode = DIRECT_MODE;
                        layout.localMode = value;
                    }
                );
                await rerender(application);
            }
            catch (error) {
                console.error(
                    "Compendium Curator | Error actualizando el modo de distribución del contenido.",
                    error
                );
                ui.notifications.error(text(
                    "No se pudo actualizar el modo de distribución.",
                    "The distribution mode could not be updated."
                ));
                localModeSelect.disabled = false;
            }
        }
    );

    for (
        const input
        of wrapper.querySelectorAll(
            "[data-cc-direct-branch-weight]"
        )
    ) {
        input.addEventListener(
            "change",
            async () => {
                input.disabled = true;

                try {
                    const value = positiveNumber(
                        input.value,
                        null
                    );

                    if (value === null)
                        throw new Error("INVALID_TABLE_WEIGHT");

                    await saveSource(
                        profile.id,
                        input.dataset.sourceKey,
                        source => {
                            source.weight = value;
                        }
                    );
                    await rerender(application);
                }
                catch (error) {
                    console.error(
                        "Compendium Curator | Error actualizando el peso de una rama de contenido.",
                        error
                    );
                    ui.notifications.error(text(
                        "No se pudo actualizar el peso.",
                        "The weight could not be updated."
                    ));
                    input.disabled = false;
                }
            }
        );
    }

    for (
        const input
        of wrapper.querySelectorAll(
            "[data-cc-direct-table-weight]"
        )
    ) {
        input.addEventListener(
            "change",
            async () => {
                input.disabled = true;

                try {
                    await setTableChildWeight(
                        profile.id,
                        input.dataset.childProfileId,
                        input.value
                    );
                    await rerender(application);
                }
                catch (error) {
                    console.error(
                        "Compendium Curator | Error actualizando el peso de una tabla enlazada.",
                        error
                    );
                    ui.notifications.error(text(
                        "No se pudo actualizar el peso de la tabla enlazada.",
                        "The linked table weight could not be updated."
                    ));
                    input.disabled = false;
                }
            }
        );
    }

    for (
        const select
        of wrapper.querySelectorAll(
            "[data-cc-direct-source-grouping]"
        )
    ) {
        select.addEventListener(
            "change",
            async () => {
                select.disabled = true;

                try {
                    await saveSource(
                        profile.id,
                        select.dataset.sourceKey,
                        source => {
                            source.criterion =
                                select.value;
                        }
                    );
                    await rerender(application);
                }
                catch (error) {
                    console.error(
                        "Compendium Curator | Error cambiando la agrupación de una rama.",
                        error
                    );
                    ui.notifications.error(text(
                        "No se pudo cambiar la agrupación.",
                        "The grouping could not be changed."
                    ));
                    select.disabled = false;
                }
            }
        );
    }

    for (
        const checkbox
        of wrapper.querySelectorAll(
            "[data-cc-direct-group-enabled]"
        )
    ) {
        checkbox.addEventListener(
            "click",
            event => event.stopPropagation()
        );
        checkbox.addEventListener(
            "change",
            async () => {
                checkbox.disabled = true;
                const sourceKey =
                    checkbox.dataset.sourceKey;
                const source =
                    sourceRecord(profile, sourceKey);
                const criterion = String(
                    source?.criterion ??
                    sourceCriterion(
                        profile,
                        sourceKey
                    )
                );
                const groupKeyValue =
                    checkbox.dataset.groupKey;

                try {
                    await saveSourceConfiguration(
                        profile.id,
                        sourceKey,
                        criterion,
                        configuration => {
                            configuration.groups[
                                groupKeyValue
                            ] ??= {};
                            configuration.groups[
                                groupKeyValue
                            ].enabled =
                                checkbox.checked;
                        }
                    );
                    await rerender(application);
                }
                catch (error) {
                    console.error(
                        "Compendium Curator | Error activando o desactivando un grupo directo.",
                        error
                    );
                    ui.notifications.error(text(
                        "No se pudo actualizar el grupo.",
                        "The group could not be updated."
                    ));
                    checkbox.disabled = false;
                }
            }
        );
    }

    for (
        const input
        of wrapper.querySelectorAll(
            "[data-cc-direct-group-weight]"
        )
    ) {
        input.addEventListener(
            "click",
            event => event.stopPropagation()
        );
        input.addEventListener(
            "change",
            async () => {
                input.disabled = true;
                const sourceKey =
                    input.dataset.sourceKey;
                const source =
                    sourceRecord(profile, sourceKey);
                const criterion = String(
                    source?.criterion ??
                    sourceCriterion(
                        profile,
                        sourceKey
                    )
                );
                const groupKeyValue =
                    input.dataset.groupKey;
                const value = positiveNumber(
                    input.value,
                    null
                );

                try {
                    if (value === null)
                        throw new Error("INVALID_TABLE_WEIGHT");

                    await saveSourceConfiguration(
                        profile.id,
                        sourceKey,
                        criterion,
                        configuration => {
                            configuration.groups[
                                groupKeyValue
                            ] ??= {};
                            configuration.groups[
                                groupKeyValue
                            ].weight = value;
                        }
                    );
                    await rerender(application);
                }
                catch (error) {
                    console.error(
                        "Compendium Curator | Error actualizando el peso interno de un grupo.",
                        error
                    );
                    ui.notifications.error(text(
                        "No se pudo actualizar el peso del grupo.",
                        "The group weight could not be updated."
                    ));
                    input.disabled = false;
                }
            }
        );
    }

    for (
        const input
        of wrapper.querySelectorAll(
            "[data-cc-direct-default-item-weight]"
        )
    ) {
        input.addEventListener(
            "change",
            async () => {
                input.disabled = true;
                const sourceKey =
                    input.dataset.sourceKey;
                const source =
                    sourceRecord(profile, sourceKey);
                const criterion = String(
                    source?.criterion ??
                    sourceCriterion(
                        profile,
                        sourceKey
                    )
                );
                const groupKeyValue =
                    input.dataset.groupKey;
                const value = positiveNumber(
                    input.value,
                    null
                );

                try {
                    if (value === null)
                        throw new Error("INVALID_DEFAULT_ITEM_WEIGHT");

                    await saveSourceConfiguration(
                        profile.id,
                        sourceKey,
                        criterion,
                        configuration => {
                            const group =
                                configuration.groups[
                                    groupKeyValue
                                ] ??= {};

                            group.defaultWeight = value;
                        }
                    );
                    await rerender(application);
                }
                catch (error) {
                    console.error(
                        "Compendium Curator | Error actualizando el peso base de una lista.",
                        error
                    );
                    ui.notifications.error(text(
                        "No se pudo actualizar el peso base de la lista.",
                        "The list default weight could not be updated."
                    ));
                    input.disabled = false;
                }
            }
        );
    }

    for (
        const input
        of wrapper.querySelectorAll(
            "[data-cc-direct-item-weight]"
        )
    ) {
        input.addEventListener(
            "change",
            async () => {
                input.disabled = true;
                const sourceKey =
                    input.dataset.sourceKey;
                const source =
                    sourceRecord(profile, sourceKey);
                const criterion = String(
                    source?.criterion ??
                    sourceCriterion(
                        profile,
                        sourceKey
                    )
                );
                const groupKeyValue =
                    input.dataset.groupKey;
                const uuid = input.dataset.uuid;
                const value = positiveNumber(
                    input.value,
                    null
                );

                try {
                    if (value === null)
                        throw new Error("INVALID_TABLE_WEIGHT");

                    await saveSourceConfiguration(
                        profile.id,
                        sourceKey,
                        criterion,
                        configuration => {
                            const group =
                                configuration.groups[
                                    groupKeyValue
                                ] ??= {};
                            group.itemWeights ??= {};
                            group.itemWeights[uuid] = value;
                        }
                    );
                    await rerender(application);
                }
                catch (error) {
                    console.error(
                        "Compendium Curator | Error actualizando el peso de un objeto directo.",
                        error
                    );
                    ui.notifications.error(text(
                        "No se pudo actualizar el peso del objeto.",
                        "The object weight could not be updated."
                    ));
                    input.disabled = false;
                }
            }
        );
    }

    for (
        const button
        of wrapper.querySelectorAll(
            "[data-cc-direct-reset-item-weight]"
        )
    ) {
        button.addEventListener(
            "click",
            async event => {
                event.preventDefault();
                event.stopPropagation();
                button.disabled = true;
                const sourceKey =
                    button.dataset.sourceKey;
                const source =
                    sourceRecord(profile, sourceKey);
                const criterion = String(
                    source?.criterion ??
                    sourceCriterion(
                        profile,
                        sourceKey
                    )
                );
                const groupKeyValue =
                    button.dataset.groupKey;
                const uuid = button.dataset.uuid;

                try {
                    await saveSourceConfiguration(
                        profile.id,
                        sourceKey,
                        criterion,
                        configuration => {
                            const weights =
                                configuration.groups
                                    ?.[groupKeyValue]
                                    ?.itemWeights;

                            if (weights)
                                delete weights[uuid];
                        }
                    );
                    await rerender(application);
                }
                catch (error) {
                    console.error(
                        "Compendium Curator | Error restableciendo el peso de un objeto directo.",
                        error
                    );
                    ui.notifications.error(text(
                        "No se pudo restablecer el peso del objeto.",
                        "The object weight could not be reset."
                    ));
                    button.disabled = false;
                }
            }
        );
    }

    for (
        const button
        of wrapper.querySelectorAll(
            "[data-cc-direct-save-ranges]"
        )
    ) {
        button.addEventListener(
            "click",
            async event => {
                event.preventDefault();
                const sourceKey =
                    button.dataset.sourceKey;
                const source =
                    sourceRecord(profile, sourceKey);
                const criterion = String(
                    source?.criterion ??
                    sourceCriterion(
                        profile,
                        sourceKey
                    )
                );
                const editor = button.closest(
                    "[data-cc-direct-range-editor]"
                );
                const rangeValues = validateRanges([
                    ...editor.querySelectorAll(
                        "[data-cc-direct-range-row]"
                    )
                ]);

                if (!rangeValues) {
                    ui.notifications.warn(text(
                        "Los rangos no son válidos: no pueden solaparse y cada máximo debe ser mayor o igual que su mínimo.",
                        "The ranges are invalid: they cannot overlap and each maximum must be greater than or equal to its minimum."
                    ));
                    return;
                }

                button.disabled = true;

                try {
                    await saveSourceConfiguration(
                        profile.id,
                        sourceKey,
                        criterion,
                        configuration => {
                            configuration.ranges =
                                rangeValues;
                        }
                    );
                    await rerender(application);
                }
                catch (error) {
                    console.error(
                        "Compendium Curator | Error actualizando los rangos de una rama directa.",
                        error
                    );
                    ui.notifications.error(text(
                        "No se pudieron actualizar los rangos.",
                        "The ranges could not be updated."
                    ));
                    button.disabled = false;
                }
            }
        );
    }

    for (
        const button
        of wrapper.querySelectorAll(
            "[data-cc-open-original-table]"
        )
    ) {
        button.addEventListener(
            "click",
            event => {
                event.preventDefault();
                event.stopPropagation();

                const childId =
                    button.dataset.childProfileId;
                const targetRow =
                    application.element?.querySelector(
                        `[data-profile-id="${CSS.escape(childId)}"]`
                    );
                const inspector =
                    targetRow?.matches(
                        "details[data-cc-content-inspector]"
                    )
                        ? targetRow
                        : targetRow?.querySelector(
                            "details[data-cc-content-inspector]"
                        );

                if (!targetRow || !inspector) {
                    ui.notifications.info(text(
                        "La tabla original no está visible con el filtro actual.",
                        "The original table is not visible with the current filter."
                    ));
                    return;
                }

                inspector.open = true;
                targetRow.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
            }
        );
    }

    activateDnd5eDocumentEntries(wrapper);
}

function enhanceDirectEditor(
    application,
    element
) {
    const profiles =
        TableProfileStorageService.getProfiles();
    const filterGroups =
        TableProfileStorageService.getFilterGroups();
    const previews =
        application._ccRecursivePreviewData;
    const renderProfileIds = new Set();

    for (
        const row
        of element.querySelectorAll(
            "details[data-cc-content-inspector][data-profile-id]"
        )
    ) {
        if (row.open) {
            renderProfileIds.add(
                String(row.dataset.profileId ?? "")
            );
        }
    }

    /*
     * La vista de una tabla enlazada se crea clonando la estructura
     * de su tabla original. Conservamos únicamente esas dependencias
     * transitivas, en lugar de montar todos los perfiles del Gestor.
     */
    const pending = [...renderProfileIds];

    while (pending.length) {
        const profileId = pending.pop();
        const profile = profiles[profileId];

        for (const child of profile?.children ?? []) {
            if (child?.enabled === false)
                continue;

            const childId = String(
                typeof child === "string"
                    ? child
                    : child?.profileId ?? child?.id ?? ""
            ).trim();

            if (
                !childId ||
                renderProfileIds.has(childId) ||
                !profiles[childId]
            ) {
                continue;
            }

            renderProfileIds.add(childId);
            pending.push(childId);
        }
    }

    for (
        const profile
        of Object.values(profiles)
    ) {
        if (
            profile?.version !== 2 ||
            profile.type !== "content" ||
            profile?.contentLayout?.mode !==
                DIRECT_MODE ||
            !renderProfileIds.has(profile.id)
        ) {
            continue;
        }

        const row = element.querySelector(
            `[data-profile-id="${CSS.escape(profile.id)}"]`
        );

        if (!row)
            continue;

        const oldWrapper = row.querySelector(
            "[data-cc-direct-content]"
        );
        const legacyDistribution = row.querySelector(
            "[data-cc-distribution-mode]"
        )?.closest(
            ".cc-table-filter-detail-block"
        );

        if (legacyDistribution)
            legacyDistribution.hidden = true;

        const existing = row.querySelector(
            "[data-cc-direct-content-editor]"
        );

        existing?.remove();

        const preview = previews instanceof Map
            ? previews.get(profile.id)
            : null;
        const sources = [
            ...localSources(
                profile,
                filterGroups
            ),
            ...tableSources(
                profile,
                profiles,
                preview
            )
        ];

        decorateSourcePercentages(sources);

        const tableViews = new Map();

        for (
            const source
            of sources.filter(source =>
                source.type === "table"
            )
        ) {
            const childPreview =
                previews instanceof Map
                    ? previews.get(
                        source.sourceId
                    )
                    : null;

            tableViews.set(
                source.sourceId,
                buildReadOnlyTableView(
                    source,
                    source.child,
                    filterGroups,
                    childPreview
                )
            );
        }

        const inspector = row.matches(
            "details[data-cc-content-inspector]"
        )
            ? row
            : row.querySelector(
                "details[data-cc-content-inspector]"
            );

        if (inspector) {
            updateCount(
                inspector,
                dedupe(
                    sources.flatMap(
                        source => source.entries
                    )
                ).length
            );
        }

        const wrapper = document.createElement(
            "div"
        );

        wrapper.innerHTML = renderEditor(
            profile,
            sources,
            tableViews
        ).trim();

        const editor = wrapper.firstElementChild;

        if (!editor)
            continue;

        if (oldWrapper) {
            oldWrapper.replaceWith(editor);
        }
        else if (legacyDistribution) {
            legacyDistribution?.insertAdjacentElement(
                "afterend",
                editor
            );
        }
        else {
            inspector?.append(editor);
        }

        activateEditor(
            application,
            profile,
            row,
            editor
        );
    }

    for (
        const row
        of element.querySelectorAll(
            "details[data-cc-content-inspector][data-profile-id]"
        )
    ) {
        row.addEventListener(
            "toggle",
            () => {
                if (!row.open) {
                    for (
                        const closedRow
                        of element.querySelectorAll(
                            "details[data-cc-content-inspector][data-profile-id]:not([open])"
                        )
                    ) {
                        closedRow.querySelector(
                            ":scope > .cc-table-manager-content-inspector"
                        )?.remove();
                    }
                    return;
                }

                if (
                    row.querySelector(
                        "[data-cc-direct-content-editor]"
                    )
                ) {
                    return;
                }

                queueMicrotask(() => {
                    if (
                        row.isConnected &&
                        row.open &&
                        !row.querySelector(
                            "[data-cc-direct-content-editor]"
                        )
                    ) {
                        void application.render({
                            force: true
                        });
                    }
                });
            }
        );
    }
}

export function registerTableManagerDirectContentEditor() {
    Hooks.on(
        "renderTableManagerApplication",
        (application, element) => {
            if (!game.user.can("SETTINGS_MODIFY"))
                return;

            enhanceDirectEditor(
                application,
                element
            );
        }
    );
}
