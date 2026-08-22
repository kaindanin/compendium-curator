import { TableProfileEditorApplication } from "./table-profile-editor-application.js";
import { TableDefaultsApplication } from "./table-defaults-application.js";
import { TableProfileStorageService } from "../services/table-profile-storage-service.js";
import { TableFilterGroupApplication } from "./table-filter-group-application.js";
import { TableProfilePreviewApplication } from "./table-profile-preview-application.js";
import { TableProfileExclusionsApplication } from "./table-profile-exclusions-application.js";
import { TableProfileInclusionsApplication } from "./table-profile-inclusions-application.js";
import { TableGroupingRangeApplication } from "./table-grouping-range-application.js";
import { TableManualGroupingApplication } from "./table-manual-grouping-application.js";
import { TableProfileService } from "../services/table-profile-service.js";
import { StorageService } from "../services/storage-service.js";
import { TableFilterGroupDetailsApplication } from "./table-filter-group-details-application.js";
import { TableProfileGenerationService } from "../services/table-profile-generation-service.js";
import { TableProfileDrawService } from "../services/table-profile-draw-service.js";
import {
    activateDnd5eDocumentEntries,
    getDnd5eDistributionIndexEntry,
    prepareDnd5eDocumentEntries,
    prepareDnd5eIndexedEntries
} from "../ui/dnd5e-document-list.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

const TABLE_DIALOG_CLASSES = [
    "cc-table-dialog"
];

const CONTENT_INSPECTOR_ENTRY_LIMIT = 150;

const CONTENT_INSPECTOR_RARITY_ORDER = [
    "mundane",
    "common",
    "uncommon",
    "rare",
    "veryRare",
    "legendary",
    "artifact"
];

const CONTENT_INSPECTOR_RARITY_LABELS = {
    mundane: "RarityMundane",
    common: "RarityCommon",
    uncommon: "RarityUncommon",
    rare: "RarityRare",
    veryRare: "RarityVeryRare",
    legendary: "RarityLegendary",
    artifact: "RarityArtifact"
};

const CONTENT_INSPECTOR_CR_LABELS = {
    "0-1": "CR 0–1",
    "2-4": "CR 2–4",
    "5-8": "CR 5–8",
    "9-12": "CR 9–12",
    "13-16": "CR 13–16",
    "17-plus": "CR 17+"
};

const DISTRIBUTION_MODES = new Set([
    "uniform",
    "individual",
    "grouped"
]);

const GROUPING_CRITERIA = new Set([
    "rarity",
    "type",
    "source",
    "cr",
    "spellLevel",
    "creatureType",
    "size",
    "spellSchool",
    "manual"
]);

function getRefreshSectionTitle(key, count) {
    const text = game.i18n.format(
        `COMPENDIUM_CURATOR.${key}`,
        { count }
    );

    return text
        .replace(/\s*\(\s*\d+\s*\)\s*$/, "")
        .trim();
}

function renderRefreshDocumentList(
    title,
    count,
    entries
) {
    const escape = foundry.utils.escapeHTML;

    const resultsLabel = escape(
        game.i18n.localize(
            "DND5E.CompendiumBrowser.Column.Results"
        )
    );

    const sourceLabel = escape(
        game.i18n.localize(
            "DND5E.CompendiumBrowser.Column.Source"
        )
    );

    const rows = entries
        .map(entry => {
            const uuid = escape(
                String(entry.uuid ?? "")
            );
            const name = escape(
                String(
                    entry.name ??
                    entry.uuid ??
                    ""
                )
            );
            const img = entry.img
                ? escape(String(entry.img))
                : "";
            const subtitle = entry.subtitle
                ? escape(
                    game.i18n.localize(
                        entry.subtitle
                    )
                )
                : "";
            const source = entry.source
                ? escape(String(entry.source))
                : "";

            return `
                <li
                    class="item cc-dnd5e-document-entry"
                    data-uuid="${uuid}"
                >
                    <div class="item-row">
                        <div
                            class="item-name rollable"
                            role="button"
                            data-cc-open-document
                        >
                            ${img
                                ? `
                                    <img
                                        class="item-image gold-icon"
                                        loading="lazy"
                                        src="${img}"
                                        alt="${name}"
                                        draggable="false"
                                    >
                                `
                                : ""
                            }

                            <div class="name name-stacked">
                                <span class="title">
                                    ${name}
                                </span>

                                ${subtitle
                                    ? `
                                        <span class="subtitle">
                                            ${subtitle}
                                        </span>
                                    `
                                    : ""
                                }
                            </div>
                        </div>

                        <div
                            class="item-detail item-source ${source ? "" : "empty"}"
                        >
                            ${source
                                ? `
                                    <span class="condensed">
                                        ${source}
                                    </span>
                                `
                                : ""
                            }
                        </div>

                        <div
                            class="item-detail item-controls"
                        ></div>
                    </div>
                </li>
            `;
        })
        .join("");

    return `
        <section class="cc-table-filter-refresh-section">
            <div class="cc-table-filter-group-matches-title">
                <h3>${escape(title)}</h3>
                <strong>${count}</strong>
            </div>

            <section class="inventory-element cc-dnd5e-document-list">
                <section class="items-list browser-results">
                    <div class="items-section card">
                        <div class="items-header header">
                            <h3 class="item-name">
                                ${resultsLabel}
                            </h3>

                            <div class="item-header item-source">
                                ${sourceLabel}
                            </div>

                            <div class="item-header item-controls"></div>
                        </div>

                        <ol class="item-list unlist">
                            ${rows}
                        </ol>
                    </div>
                </section>
            </section>
        </section>
    `;
}

function normalizeManagerSearchText(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase();
}

function normalizeInspectorWeight(
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

function getIndexedDocument(uuid) {
    return getDnd5eDistributionIndexEntry(
        uuid
    );
}

function getInspectorRarity(uuid) {
    const document =
        getIndexedDocument(uuid);

    const rarity =
        String(
            document?.system?.rarity ?? ""
        ).trim();

    return rarity || "mundane";
}

function getInspectorRarityLabel(key) {
    const localizationKey =
        CONTENT_INSPECTOR_RARITY_LABELS[key];

    return localizationKey
        ? game.i18n.localize(
            `COMPENDIUM_CURATOR.${localizationKey}`
        )
        : key;
}

function getInspectorDocumentType(uuid) {
    const document =
        getIndexedDocument(uuid);

    const type =
        String(document?.type ?? "").trim();

    return type || "unclassified";
}

function getInspectorDocumentTypeLabel(key) {
    if (key === "unclassified") {
        return game.i18n.localize(
            "COMPENDIUM_CURATOR.GroupUnclassified"
        );
    }

    const systemType =
        CONFIG.DND5E?.itemTypes?.[key];

    const localizationKey = [
        CONFIG.Item?.typeLabels?.[key],
        CONFIG.Actor?.typeLabels?.[key],
        typeof systemType === "string"
            ? systemType
            : systemType?.label
    ].find(value =>
        typeof value === "string" &&
        value.trim()
    );

    return localizationKey
        ? game.i18n.localize(localizationKey)
        : key;
}

function getInspectorDocumentSource(uuid) {
    const document =
        getIndexedDocument(uuid);
    const source =
        document?.system?.source;

    if (!source)
        return "unclassified";

    if (typeof source === "string") {
        return source.trim() ||
            "unclassified";
    }

    const value =
        String(
            source.value ??
            source.book ??
            source.label ??
            ""
        ).trim();

    return value || "unclassified";
}

function getInspectorDocumentSourceLabel(key) {
    return key === "unclassified"
        ? game.i18n.localize(
            "COMPENDIUM_CURATOR.GroupNoSource"
        )
        : key;
}

function normalizeInspectorChallengeRating(value) {
    if (
        typeof value === "number" &&
        Number.isFinite(value)
    ) {
        return value >= 0
            ? value
            : null;
    }

    const text =
        String(value ?? "").trim();

    if (!text)
        return null;

    const fraction =
        text.match(
            /^(\d+)\s*\/\s*(\d+)$/
        );

    if (fraction) {
        const numerator =
            Number(fraction[1]);
        const denominator =
            Number(fraction[2]);

        if (
            denominator > 0 &&
            Number.isFinite(numerator)
        ) {
            return numerator / denominator;
        }
    }

    const parsed =
        Number(text.replace(",", "."));

    return (
        Number.isFinite(parsed) &&
        parsed >= 0
    )
        ? parsed
        : null;
}

function normalizeInspectorSpellLevel(value) {
    if (
        value === null ||
        value === undefined ||
        String(value).trim() === ""
    ) {
        return null;
    }

    const parsed = Number(value);

    return (
        Number.isInteger(parsed) &&
        parsed >= 0
    )
        ? parsed
        : null;
}

function getInspectorDistributionMode(profile) {
    const mode = String(
        profile?.distribution?.mode ?? ""
    );

    return DISTRIBUTION_MODES.has(mode)
        ? mode
        : "grouped";
}

function getInspectorGroupingCriterion(profile) {
    const criterion =
        String(
            profile?.distribution
                ?.grouped
                ?.grouping
                ?.criterion ?? ""
        ).trim();

    return GROUPING_CRITERIA.has(criterion)
        ? criterion
        : "rarity";
}

function getInspectorGroupingRanges(
    profile,
    criterion
) {
    const grouped =
        profile?.distribution?.grouped;
    const activeCriterion =
        getInspectorGroupingCriterion(profile);

    const ranges =
        activeCriterion === criterion
            ? grouped?.grouping?.ranges
            : grouped?.configurations?.[
                criterion
            ]?.ranges;

    return Array.isArray(ranges)
        ? ranges
        : [];
}

function formatInspectorRangeValue(value) {
    const number = Number(value);

    if (!Number.isFinite(number))
        return "";

    return new Intl.NumberFormat(
        game.i18n.lang,
        {
            maximumFractionDigits: 3
        }
    ).format(number);
}

function getInspectorRangeLabel(
    criterion,
    range
) {
    const criterionLabel =
        getInspectorGroupingLabel(
            criterion
        );
    const min = Number(range?.min);

    if (!Number.isFinite(min))
        return criterionLabel;

    const rawMax = range?.max;

    if (
        rawMax === null ||
        rawMax === undefined ||
        rawMax === ""
    ) {
        return `${criterionLabel} ${formatInspectorRangeValue(min)}+`;
    }

    const max = Number(rawMax);

    if (!Number.isFinite(max))
        return criterionLabel;

    if (min === max) {
        return `${criterionLabel} ${formatInspectorRangeValue(min)}`;
    }

    return `${criterionLabel} ${formatInspectorRangeValue(min)}–${formatInspectorRangeValue(max)}`;
}

function getInspectorChallengeRatingKey(
    uuid,
    profile
) {
    const document =
        getIndexedDocument(uuid);
    const cr =
        normalizeInspectorChallengeRating(
            document?.system?.details?.cr
        );

    if (cr === null)
        return "unclassified";

    const range =
        getInspectorGroupingRanges(
            profile,
            "cr"
        ).find(candidate => {
            const min = Number(candidate?.min);
            const rawMax = candidate?.max;
            const max =
                rawMax === null ||
                rawMax === undefined ||
                rawMax === ""
                    ? null
                    : Number(rawMax);

            if (!Number.isFinite(min))
                return false;

            return (
                cr >= min &&
                (
                    max === null ||
                    (
                        Number.isFinite(max) &&
                        cr <= max
                    )
                )
            );
        });

    return range?.key ?? "unclassified";
}

function getInspectorChallengeRatingLabel(
    key,
    profile
) {
    if (key === "unclassified") {
        return game.i18n.localize(
            "COMPENDIUM_CURATOR.GroupNoChallengeRating"
        );
    }

    const range =
        getInspectorGroupingRanges(
            profile,
            "cr"
        ).find(candidate =>
            candidate?.key === key
        );

    if (range) {
        return getInspectorRangeLabel(
            "cr",
            range
        );
    }

    return CONTENT_INSPECTOR_CR_LABELS[key] ?? key;
}

function getNestedChildConfiguration(
    profile,
    childProfileId
) {
    const child = (
        Array.isArray(profile?.children)
            ? profile.children
            : []
    ).find(candidate =>
        candidate?.profileId === childProfileId
    );

    return {
        enabled: child?.enabled === true,
        weight:
            normalizeInspectorWeight(
                child?.weight,
                1
            )
    };
}

function getInspectorSpellLevelKey(
    uuid,
    profile
) {
    const document =
        getIndexedDocument(uuid);
    const level =
        normalizeInspectorSpellLevel(
            document?.system?.level
        );

    if (level === null)
        return "unclassified";

    const range =
        getInspectorGroupingRanges(
            profile,
            "spellLevel"
        ).find(candidate => {
            const min = Number(candidate?.min);
            const rawMax = candidate?.max;
            const max =
                rawMax === null ||
                rawMax === undefined ||
                rawMax === ""
                    ? null
                    : Number(rawMax);

            if (!Number.isFinite(min))
                return false;

            return (
                level >= min &&
                (
                    max === null ||
                    (
                        Number.isFinite(max) &&
                        level <= max
                    )
                )
            );
        });

    return range?.key ?? "unclassified";
}

function getInspectorSpellLevelLabel(
    key,
    profile
) {
    if (key === "unclassified") {
        return game.i18n.localize(
            "COMPENDIUM_CURATOR.GroupNoSpellLevel"
        );
    }

    const range =
        getInspectorGroupingRanges(
            profile,
            "spellLevel"
        ).find(candidate =>
            candidate?.key === key
        );

    return range
        ? getInspectorRangeLabel(
            "spellLevel",
            range
        )
        : key;
}

function getInspectorConfigLabel(
    collection,
    key
) {
    const config = collection?.[key];
    const label =
        typeof config === "string"
            ? config
            : config?.label;

    return label
        ? game.i18n.localize(label)
        : key;
}

function getInspectorCreatureType(uuid) {
    const document =
        getIndexedDocument(uuid);
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

function getInspectorCreatureTypeLabel(key) {
    if (key === "unclassified") {
        return game.i18n.localize(
            "COMPENDIUM_CURATOR.GroupNoCreatureType"
        );
    }

    if (key.startsWith("custom:")) {
        return key.slice("custom:".length);
    }

    return getInspectorConfigLabel(
        CONFIG.DND5E?.creatureTypes,
        key
    );
}

function getInspectorActorSize(uuid) {
    const document =
        getIndexedDocument(uuid);
    const size = String(
        document?.system?.traits?.size ?? ""
    ).trim();

    return size || "unclassified";
}

function getInspectorActorSizeLabel(key) {
    if (key === "unclassified") {
        return game.i18n.localize(
            "COMPENDIUM_CURATOR.GroupNoSize"
        );
    }

    return getInspectorConfigLabel(
        CONFIG.DND5E?.actorSizes,
        key
    );
}

function getInspectorSpellSchool(uuid) {
    const document =
        getIndexedDocument(uuid);
    const school = String(
        document?.system?.school ?? ""
    ).trim();

    return school || "unclassified";
}

function getInspectorSpellSchoolLabel(key) {
    if (key === "unclassified") {
        return game.i18n.localize(
            "COMPENDIUM_CURATOR.GroupNoSpellSchool"
        );
    }

    return getInspectorConfigLabel(
        CONFIG.DND5E?.spellSchools,
        key
    );
}

function getInspectorGroupingLabel(criterion) {
    let key = "GroupByRarity";

    if (criterion === "type")
        key = "GroupByType";
    else if (criterion === "source")
        key = "GroupBySource";
    else if (criterion === "cr")
        key = "GroupByChallengeRating";
    else if (criterion === "spellLevel")
        key = "GroupBySpellLevel";
    else if (criterion === "creatureType")
        key = "GroupByCreatureType";
    else if (criterion === "size")
        key = "GroupBySize";
    else if (criterion === "spellSchool")
        key = "GroupBySpellSchool";
    else if (criterion === "manual")
        key = "GroupByManual";

    return game.i18n.localize(
        `COMPENDIUM_CURATOR.${key}`
    );
}

function getInspectorGroupingKey(
    uuid,
    criterion,
    profile
) {
    if (criterion === "type")
        return getInspectorDocumentType(uuid);

    if (criterion === "source")
        return getInspectorDocumentSource(uuid);

    if (criterion === "cr") {
        return getInspectorChallengeRatingKey(
            uuid,
            profile
        );
    }

    if (criterion === "spellLevel") {
        return getInspectorSpellLevelKey(
            uuid,
            profile
        );
    }

    if (criterion === "creatureType")
        return getInspectorCreatureType(uuid);

    if (criterion === "size")
        return getInspectorActorSize(uuid);

    if (criterion === "spellSchool")
        return getInspectorSpellSchool(uuid);

    if (criterion === "manual") {
        return getInspectorManualGroupKey(
            uuid,
            profile
        );
    }

    return getInspectorRarity(uuid);
}

function getInspectorGroupingGroupLabel(
    criterion,
    key,
    profile
) {
    if (criterion === "type") {
        return getInspectorDocumentTypeLabel(
            key
        );
    }

    if (criterion === "source") {
        return getInspectorDocumentSourceLabel(
            key
        );
    }

    if (criterion === "cr") {
        return getInspectorChallengeRatingLabel(
            key,
            profile
        );
    }

    if (criterion === "spellLevel") {
        return getInspectorSpellLevelLabel(
            key,
            profile
        );
    }

    if (criterion === "creatureType") {
        return getInspectorCreatureTypeLabel(
            key
        );
    }

    if (criterion === "size") {
        return getInspectorActorSizeLabel(key);
    }

    if (criterion === "spellSchool") {
        return getInspectorSpellSchoolLabel(key);
    }

    if (criterion === "manual") {
        return getInspectorManualGroupLabel(
            key,
            profile
        );
    }

    return getInspectorRarityLabel(key);
}

function getInspectorOrderedGroupKeys(
    groups,
    criterion,
    profile
) {
    if (criterion === "manual") {
        const ordered = getInspectorManualGroups(
            profile
        )
            .map(group => group.key)
            .filter(key => groups.has(key));

        if (groups.has("unclassified")) {
            ordered.push("unclassified");
        }

        ordered.push(
            ...[...groups.keys()]
                .filter(key =>
                    !ordered.includes(key)
                )
                .sort()
        );

        return ordered;
    }

    if (criterion === "rarity") {
        return [
            ...CONTENT_INSPECTOR_RARITY_ORDER
                .filter(key => groups.has(key)),
            ...[...groups.keys()]
                .filter(key =>
                    !CONTENT_INSPECTOR_RARITY_ORDER
                        .includes(key)
                )
                .sort((a, b) =>
                    String(a).localeCompare(
                        String(b),
                        game.i18n.lang,
                        { sensitivity: "base" }
                    )
                )
        ];
    }

    if (
        criterion === "cr" ||
        criterion === "spellLevel"
    ) {
        const configuredKeys =
            getInspectorGroupingRanges(
                profile,
                criterion
            ).map(range => range.key);

        const ordered =
            configuredKeys.filter(key =>
                groups.has(key)
            );

        if (groups.has("unclassified")) {
            ordered.push("unclassified");
        }

        ordered.push(
            ...[...groups.keys()]
                .filter(key =>
                    !ordered.includes(key)
                )
                .sort()
        );

        return ordered;
    }

    const configuredOrder =
        criterion === "creatureType"
            ? Object.keys(
                CONFIG.DND5E?.creatureTypes ?? {}
            )
            : criterion === "size"
                ? Object.keys(
                    CONFIG.DND5E?.actorSizes ?? {}
                )
                : criterion === "spellSchool"
                    ? Object.keys(
                        CONFIG.DND5E?.spellSchools ?? {}
                    )
                    : [];

    if (configuredOrder.length) {
        const ordered = configuredOrder
            .filter(key => groups.has(key));

        ordered.push(
            ...[...groups.keys()]
                .filter(key =>
                    key !== "unclassified" &&
                    !ordered.includes(key)
                )
                .sort((a, b) =>
                    getInspectorGroupingGroupLabel(
                        criterion,
                        a,
                        profile
                    ).localeCompare(
                        getInspectorGroupingGroupLabel(
                            criterion,
                            b,
                            profile
                        ),
                        game.i18n.lang,
                        { sensitivity: "base" }
                    )
                )
        );

        if (groups.has("unclassified"))
            ordered.push("unclassified");

        return ordered;
    }

    return [...groups.keys()]
        .sort((a, b) =>
            getInspectorGroupingGroupLabel(
                criterion,
                a,
                profile
            ).localeCompare(
                getInspectorGroupingGroupLabel(
                    criterion,
                    b,
                    profile
                ),
                game.i18n.lang,
                { sensitivity: "base" }
            )
        );
}

function getInspectorGroupWeight(
    profile,
    key
) {
    const modern =
        normalizeInspectorWeight(
            profile?.distribution
                ?.grouped
                ?.groups?.[key]
                ?.weight
        );

    if (modern !== null)
        return modern;

    if (
        getInspectorGroupingCriterion(profile) ===
        "rarity"
    ) {
        return normalizeInspectorWeight(
            profile?.weights?.rarity?.[key],
            1
        );
    }

    return 1;
}

function getInspectorGroupEnabled(
    profile,
    key
) {
    return profile?.distribution
        ?.grouped
        ?.groups?.[key]
        ?.enabled !== false;
}

function getInspectorIndividualWeight(
    profile,
    uuid
) {
    const defaultWeight =
        normalizeInspectorWeight(
            profile?.distribution
                ?.individual
                ?.defaultWeight,
            normalizeInspectorWeight(
                profile?.weights?.default,
                1
            )
        );

    const overrideWeight =
        normalizeInspectorWeight(
            profile?.distribution
                ?.individual
                ?.weights?.[uuid],
            normalizeInspectorWeight(
                profile?.weights
                    ?.overrides?.[uuid]
            )
        );

    const hasOverride =
        overrideWeight !== null;

    return {
        defaultWeight,
        hasOverride,
        weight:
            hasOverride
                ? overrideWeight
                : defaultWeight
    };
}

function getInspectorManualGroups(profile) {
    const groups = profile?.distribution
        ?.grouped?.manualGroups;

    return Array.isArray(groups)
        ? groups
        : [];
}

function getInspectorManualGroupKey(
    uuid,
    profile
) {
    const group = getInspectorManualGroups(
        profile
    ).find(candidate =>
        Array.isArray(candidate?.members) &&
        candidate.members.includes(uuid)
    );

    return group?.key ?? "unclassified";
}

function getInspectorManualGroupLabel(
    key,
    profile
) {
    if (key === "unclassified") {
        return game.i18n.localize(
            "COMPENDIUM_CURATOR.GroupNoManualGroup"
        );
    }

    return getInspectorManualGroups(profile)
        .find(group => group?.key === key)
        ?.name ?? key;
}

function getInspectorGroupItemWeight(
    profile,
    groupKey,
    uuid
) {
    const distribution =
        profile?.distribution
            ?.grouped
            ?.groups?.[groupKey]
            ?.distribution;
    const defaultWeight =
        normalizeInspectorWeight(
            distribution?.defaultWeight,
            1
        );
    const overrideWeight =
        normalizeInspectorWeight(
            distribution?.weights?.[uuid]
        );
    const hasOverride =
        distribution?.mode === "individual" &&
        overrideWeight !== null;

    return {
        defaultWeight,
        hasOverride,
        weight:
            hasOverride
                ? overrideWeight
                : defaultWeight
    };
}

function formatInspectorProbability(
    weight,
    totalWeight
) {
    const value = Number(weight);
    const total = Number(totalWeight);

    if (
        !Number.isFinite(value) ||
        !Number.isFinite(total) ||
        value <= 0 ||
        total <= 0
    ) {
        return "0%";
    }

    const ratio = value / total;

    const formatter =
        new Intl.NumberFormat(
            game.i18n.lang,
            {
                style: "percent",
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            }
        );

    if (
        ratio > 0 &&
        ratio < 0.0001
    ) {
        return `<${formatter.format(0.0001)}`;
    }

    return formatter.format(ratio);
}

function refreshRenderedIndividualWeightControls(
    profileElement,
    profile,
    onlyUuid = null
) {
    if (!profileElement || !profile)
        return;

    for (
        const input
        of profileElement.querySelectorAll(
            "[data-cc-individual-weight]"
        )
    ) {
        const uuid =
            String(
                input.dataset?.uuid ?? ""
            ).trim();

        if (
            !uuid ||
            (
                onlyUuid &&
                uuid !== onlyUuid
            )
        ) {
            continue;
        }

        const info =
            getInspectorIndividualWeight(
                profile,
                uuid
            );

        input.value = String(info.weight);
        input.dataset.hasOverride =
            info.hasOverride
                ? "true"
                : "false";

        const resetButton =
            input.parentElement
                ?.querySelector(
                    "[data-cc-reset-individual-weight]"
                );

        if (resetButton) {
            resetButton.disabled =
                !info.hasOverride;
        }
    }
}

function refreshRenderedGroupItemWeightControls(
    profileElement,
    profile,
    onlyGroupKey = null,
    onlyUuid = null
) {
    if (!profileElement || !profile)
        return;

    for (
        const input
        of profileElement.querySelectorAll(
            "[data-cc-group-item-weight]"
        )
    ) {
        const groupKey = String(
            input.dataset?.groupKey ?? ""
        ).trim();
        const uuid = String(
            input.dataset?.uuid ?? ""
        ).trim();

        if (
            !groupKey ||
            !uuid ||
            (onlyGroupKey && groupKey !== onlyGroupKey) ||
            (onlyUuid && uuid !== onlyUuid)
        ) {
            continue;
        }

        const info =
            getInspectorGroupItemWeight(
                profile,
                groupKey,
                uuid
            );

        input.value = String(info.weight);
        input.dataset.hasOverride =
            info.hasOverride
                ? "true"
                : "false";

        const resetButton =
            input.parentElement?.querySelector(
                "[data-cc-reset-group-item-weight]"
            );

        if (resetButton) {
            resetButton.disabled =
                !info.hasOverride;
        }
    }
}

function refreshRenderedProbabilityControls(
    profileElement,
    profile
) {
    if (!profileElement || !profile)
        return;

    const inspector =
        buildContentInspector(profile);

    const groups =
        new Map(
            inspector.groups.map(
                group => [group.key, group]
            )
        );

    for (
        const element
        of profileElement.querySelectorAll(
            "[data-cc-group-probability]"
        )
    ) {
        const groupKey =
            String(
                element.dataset?.groupKey ?? ""
            ).trim();

        element.textContent =
            groups.get(groupKey)
                ?.probability ?? "0%";
    }

    const entries = new Map();

    for (const group of inspector.groups) {
        for (const entry of group.entries) {
            entries.set(entry.uuid, entry);
        }
    }

    for (
        const element
        of profileElement.querySelectorAll(
            "[data-cc-object-probability]"
        )
    ) {
        const uuid =
            String(
                element.dataset?.uuid ?? ""
            ).trim();

        element.textContent =
            entries.get(uuid)
                ?.probability ?? "0%";
    }
}

function updateRenderedProfileStatus(
    profileElement,
    profile
) {
    const statusElement =
        profileElement?.querySelector(
            ".cc-table-manager-profile-status"
        );

    if (!statusElement || !profile)
        return;

    const revision =
        Number(profile.revision ?? 1);

    const generatedRevision =
        Number(
            profile.generation
                ?.generatedRevision ?? 0
        );

    let statusKey =
        "TableProfileNeverGenerated";

    if (
        generatedRevision > 0 &&
        generatedRevision < revision
    ) {
        statusKey =
            "TableProfilePendingChanges";
    }
    else if (
        generatedRevision > 0 &&
        generatedRevision === revision
    ) {
        statusKey =
            "TableProfileUpToDate";
    }

    statusElement.textContent =
        game.i18n.localize(
            `COMPENDIUM_CURATOR.${statusKey}`
        );
}

function buildContentInspector(profile) {
    const hiddenUuids =
        new Set(
            StorageService.getHiddenUuids()
        );

    const finalUuids = new Set();

    for (
        const group
        of profile?.filterGroups ?? []
    ) {
        for (
            const uuid
            of group?.matches ?? []
        ) {
            if (
                uuid &&
                !hiddenUuids.has(uuid)
            ) {
                finalUuids.add(uuid);
            }
        }
    }

    for (
        const uuid
        of profile?.manualIncludes ?? []
    ) {
        if (
            uuid &&
            !hiddenUuids.has(uuid)
        ) {
            finalUuids.add(uuid);
        }
    }

    for (
        const uuid
        of profile?.manualExcludes ?? []
    ) {
        finalUuids.delete(uuid);
    }

    for (const uuid of hiddenUuids) {
        finalUuids.delete(uuid);
    }

    const groupingCriterion =
        getInspectorGroupingCriterion(profile);
    const byGroup = new Map();

    for (const uuid of finalUuids) {
        const key =
            getInspectorGroupingKey(
                uuid,
                groupingCriterion,
                profile
            );
        const uuids =
            byGroup.get(key) ?? [];

        uuids.push(uuid);
        byGroup.set(key, uuids);
    }

    const orderedKeys =
        getInspectorOrderedGroupKeys(
            byGroup,
            groupingCriterion,
            profile
        );

    const mode =
        getInspectorDistributionMode(profile);

    const isUniform = mode === "uniform";
    const isIndividual = mode === "individual";
    const isGrouped = mode === "grouped";
    const excludeZeroPrice =
        profile?.itemRules
            ?.excludeZeroPrice === true;
    let sourceAvailableCount = 0;
    let priceExcludedCount = 0;
    let hasItemDocuments = false;

    const preparedGroups =
        orderedKeys.map(key => {
            const uuids =
                byGroup.get(key) ?? [];

            const availableEntries =
                prepareDnd5eIndexedEntries(uuids)
                    .filter(entry =>
                        entry.available !== false
                    );

            sourceAvailableCount +=
                availableEntries.length;
            hasItemDocuments ||=
                availableEntries.some(entry =>
                    entry.documentName === "Item"
                );

            const eligibleEntries =
                excludeZeroPrice
                    ? availableEntries.filter(entry =>
                        entry.documentName !== "Item" ||
                        entry.hasPositivePrice
                    )
                    : availableEntries;

            priceExcludedCount +=
                availableEntries.length -
                eligibleEntries.length;

            const allEntries =
                eligibleEntries
                    .map(entry => {
                        const individual =
                            getInspectorIndividualWeight(
                                profile,
                                entry.uuid
                            );
                        const groupItem =
                            getInspectorGroupItemWeight(
                                profile,
                                key,
                                entry.uuid
                            );

                        return {
                            ...entry,
                            weight:
                                isIndividual
                                    ? individual.weight
                                    : isGrouped
                                        ? groupItem.weight
                                        : 1,
                            hasOverride:
                                isIndividual
                                    ? individual.hasOverride
                                    : isGrouped &&
                                        groupItem.hasOverride,
                            isIndividual,
                            isGroupIndividual:
                                isGrouped
                        };
                    });

            const groupWeight =
                getInspectorGroupWeight(
                    profile,
                    key
                );
            const enabled =
                getInspectorGroupEnabled(
                    profile,
                    key
                );
            const internalTotalWeight =
                allEntries.reduce(
                    (sum, entry) =>
                        sum + entry.weight,
                    0
                );

            let probabilityWeight;

            if (isUniform) {
                probabilityWeight =
                    allEntries.length;
            }
            else if (isIndividual) {
                probabilityWeight =
                    allEntries.reduce(
                        (sum, entry) =>
                            sum +
                            getInspectorIndividualWeight(
                                profile,
                                entry.uuid
                            ).weight,
                        0
                    );
            }
            else {
                probabilityWeight =
                    enabled
                        ? groupWeight
                        : 0;
            }

            return {
                key,
                label:
                    getInspectorGroupingGroupLabel(
                        groupingCriterion,
                        key,
                        profile
                    ),
                count: allEntries.length,
                enabled,
                weight: groupWeight,
                probabilityWeight,
                internalTotalWeight,
                allEntries,
                isGrouped,
                isIndividual
            };
        });

    const totalWeight =
        preparedGroups.reduce(
            (sum, group) =>
                sum + group.probabilityWeight,
            0
        );

    const groups =
        preparedGroups.map(group => {
            const itemProbabilityWeight =
                isGrouped &&
                group.enabled &&
                group.internalTotalWeight > 0
                    ? group.weight /
                        group.internalTotalWeight
                    : 0;

            const entries =
                group.allEntries
                    .slice(
                        0,
                        CONTENT_INSPECTOR_ENTRY_LIMIT
                    )
                    .map(entry => {
                        let probabilityWeight;

                        if (isIndividual) {
                            probabilityWeight =
                                entry.weight;
                        }
                        else if (isGrouped) {
                            probabilityWeight =
                                itemProbabilityWeight *
                                entry.weight;
                        }
                        else {
                            probabilityWeight = 1;
                        }

                        return {
                            ...entry,
                            probability:
                                formatInspectorProbability(
                                    probabilityWeight,
                                    totalWeight
                                )
                        };
                    });

            return {
                key: group.key,
                label: group.label,
                count: group.count,
                enabled: group.enabled,
                weight: group.weight,
                probability:
                    formatInspectorProbability(
                        group.probabilityWeight,
                        totalWeight
                    ),
                isGrouped,
                isIndividual,
                allEntries: group.allEntries,
                entries,
                previewCount: entries.length,
                truncated:
                    group.count > entries.length
            };
        });

    const availableCount =
        preparedGroups.reduce(
            (sum, group) =>
                sum + group.count,
            0
        );
    const activeCount =
        isGrouped
            ? preparedGroups.reduce(
                (sum, group) =>
                    sum +
                    (
                        group.enabled
                            ? group.count
                            : 0
                    ),
                0
            )
            : availableCount;

    const groupingLabel =
        getInspectorGroupingLabel(
            groupingCriterion
        );

    return {
        mode,
        isUniform,
        isIndividual,
        isGrouped,
        groupingCriterion,
        isGroupingRarity:
            groupingCriterion === "rarity",
        isGroupingType:
            groupingCriterion === "type",
        isGroupingSource:
            groupingCriterion === "source",
        isGroupingCr:
            groupingCriterion === "cr",
        isGroupingSpellLevel:
            groupingCriterion === "spellLevel",
        isGroupingCreatureType:
            groupingCriterion === "creatureType",
        isGroupingSize:
            groupingCriterion === "size",
        isGroupingSpellSchool:
            groupingCriterion === "spellSchool",
        isGroupingManual:
            groupingCriterion === "manual",
        isRangeGrouping:
            profile?.distribution
                ?.grouped
                ?.grouping
                ?.type === "range",
        groupSectionLabel:
            game.i18n.format(
                "COMPENDIUM_CURATOR.ObjectsByGrouping",
                {
                    criterion:
                        groupingLabel
                            .toLocaleLowerCase()
                }
            ),
        finalCount: activeCount,
        sourceCount: finalUuids.size,
        totalWeight,
        unavailableCount:
            finalUuids.size -
                sourceAvailableCount,
        hasUnavailableObjects:
            finalUuids.size >
                sourceAvailableCount,
        excludeZeroPrice,
        priceExcludedCount,
        hasPriceExcluded:
            priceExcludedCount > 0,
        hasItemDocuments,
        hasObjects: availableCount > 0,
        groups
    };
}

async function generateProfileTables(profile) {
    if (profile.type === "content") {
        const inspector =
            buildContentInspector(profile);

        if (!inspector.hasObjects) {
            throw new Error(
                "TABLE_PROFILE_NO_OBJECTS"
            );
        }

        return TableProfileGenerationService
            .generate(profile, inspector);
    }

    const profiles =
        TableProfileStorageService.getProfiles();
    const children = [];

    for (
        const childConfiguration
        of profile.children ?? []
    ) {
        if (!childConfiguration.enabled)
            continue;

        const childProfile = profiles?.[
            childConfiguration.profileId
        ];

        if (
            !childProfile ||
            childProfile.type !== "content"
        ) {
            continue;
        }

        const childInspector =
            buildContentInspector(childProfile);

        if (!childInspector.hasObjects)
            continue;

        const childGenerated =
            await TableProfileGenerationService
                .generate(
                    childProfile,
                    childInspector
                );

        children.push({
            profile: childProfile,
            table: childGenerated.root,
            weight: childConfiguration.weight
        });
    }

    return TableProfileGenerationService
        .generateNested(profile, children);
}

async function profileNeedsRegeneration(profile) {
    const revision = Number(profile?.revision ?? 1);
    const generatedRevision = Number(
        profile?.generation?.generatedRevision ?? 0
    );
    const root =
        await TableProfileGenerationService
            .getRootTable(profile);

    if (
        !root ||
        generatedRevision !== revision
    ) {
        return true;
    }

    if (profile.type !== "nested")
        return false;

    const profiles =
        TableProfileStorageService.getProfiles();

    for (const child of profile.children ?? []) {
        if (!child.enabled)
            continue;

        const childProfile =
            profiles?.[child.profileId];

        if (
            !childProfile ||
            await profileNeedsRegeneration(
                childProfile
            )
        ) {
            return true;
        }
    }

    return false;
}

async function prepareProfileTableForUse(
    application,
    profileId
) {
    let profile = profileId
        ? TableProfileStorageService
            .getProfiles()?.[profileId]
        : null;

    if (!profile)
        return null;

    let table =
        await TableProfileGenerationService
            .getRootTable(profile);

    if (await profileNeedsRegeneration(profile)) {
        try {
            const generated =
                await generateProfileTables(profile);

            profile = generated.profile;
            table = generated.root;

            ui.notifications.info(
                game.i18n.format(
                    "COMPENDIUM_CURATOR.RollTableAutoUpdated",
                    { name: table.name }
                )
            );
            application.render({ force: true });
        }
        catch (error) {
            console.error(
                "Compendium Curator | Error actualizando la tabla antes de usarla.",
                error
            );
            ui.notifications.error(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.RollTableGenerationFailed"
                )
            );
            return null;
        }
    }

    return table
        ? { profile, table }
        : null;
}

async function drawProfileTable(
    table,
    {
        count,
        unique,
        priceAdjustment,
        quantityMin,
        quantityMax
    }
) {
    const draw =
        await TableProfileDrawService
            .drawItems(table, count, {
                unique,
                displayChat: true,
                priceMultiplier:
                    priceAdjustment / 100,
                quantityMin,
                quantityMax
            });

    if (!draw.availableCount) {
        ui.notifications.warn(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.DrawNoObjects"
            )
        );
        return null;
    }

    if (unique && draw.truncated) {
        ui.notifications.warn(
            game.i18n.format(
                "COMPENDIUM_CURATOR.UniqueDrawLimited",
                {
                    requested:
                        draw.requestedCount,
                    available:
                        draw.availableCount
                }
            )
        );
    }

    return draw;
}

export class TableManagerApplication
    extends HandlebarsApplicationMixin(
        ApplicationV2
    ) {

    constructor(browserApp, options = {}) {
        super(options);

        this.browserApp = browserApp;
        this._profileEditor = null;
        this._defaultsEditor = null;
        this._filterGroupEditor = null;
        this._filterCriteriaEditor = null;
        this._profilePreview = null;
        this._profileExclusions = null;
        this._profileInclusions = null;
        this._filterGroupDetails = null;
        this._groupingRangeEditor = null;
        this._manualGroupingEditor = null;
        this._profileActionsPopover = null;
        this._profileActionsProfileId = null;
        this._profileActionsOutsideHandler = null;
        this._profileActionsViewportHandler = null;
        this._activeTab = "content";
        this._searchQuery = "";
        this._distributionSaveQueue =
            Promise.resolve();
        this._openContentInspectors =
            new Set();
    }

    async generateStoredProfileTables(profileId) {
        const profile =
            TableProfileStorageService
                .getProfiles()?.[profileId];

        if (!profile) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        return generateProfileTables(profile);
    }

    static DEFAULT_OPTIONS = {
        id: "compendium-curator-table-manager",
        classes: [
            "dnd5e2",
            "compendium-curator",
            "cc-table-manager-app"
        ],
        actions: {
            changeManagerTab: this.#onChangeManagerTab,
            clearManagerSearch: this.#onClearManagerSearch,
            createProfile: this.#onCreateProfile,
            importProfileBundle: this.#onImportProfileBundle,
            configureDefaults: this.#onConfigureDefaults,
            editGroupingRanges: this.#onEditGroupingRanges,
            editManualGroups: this.#onEditManualGroups,
            addCurrentFilters: this.#onAddCurrentFilters,
            previewProfile: this.#onPreviewProfile,
            manualInclusions: this.#onManualInclusions,
            manualExclusions: this.#onManualExclusions,
            generateProfile: this.#onGenerateProfile,
            openGeneratedTable: this.#onOpenGeneratedTable,
            drawGeneratedTable: this.#onDrawGeneratedTable,
            quickDrawGeneratedTable:
                this.#onQuickDrawGeneratedTable,
            renameProfile: this.#onRenameProfile,
            duplicateProfile: this.#onDuplicateProfile,
            exportProfileBundle: this.#onExportProfileBundle,
            deleteProfile: this.#onDeleteProfile,
            renameFilterGroup: this.#onRenameFilterGroup,
            duplicateFilterGroup: this.#onDuplicateFilterGroup,
            deleteGlobalFilterGroup: this.#onDeleteGlobalFilterGroup,
            toggleProfileActions: this.#onToggleProfileActions,
            filterGroupDetails: this.#onFilterGroupDetails,
            refreshFilterGroup: this.#onRefreshFilterGroup,
            editFilterGroup: this.#onEditFilterGroup,
            loadFilterGroup: this.#onLoadFilterGroup,
            unlinkFilterGroup: this.#onUnlinkFilterGroup
        },
        window: {
            title: "COMPENDIUM_CURATOR.TableManagerTitle",
            resizable: true
        },
        position: {
            width: 720,
            height: 520
        }
    };

    static PARTS = {
        body: {
            template: "modules/compendium-curator/templates/table-manager.hbs"
        }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);

        await TableProfileStorageService.migrateStorage();

        const storedProfiles = Object.values(
            TableProfileStorageService.getProfiles()
        )
            .filter(profile => profile?.version === 2);
        const contentChoices = storedProfiles
            .filter(profile =>
                profile.type === "content"
            )
            .sort((a, b) =>
                String(a.name ?? "").localeCompare(
                    String(b.name ?? ""),
                    game.i18n.lang,
                    { sensitivity: "base" }
                )
            );

        const profiles = storedProfiles
            .map(profile => {
                const filterGroupCount = Array.isArray(profile.filterGroups)
                    ? profile.filterGroups.length
                    : 0;

                const filterGroups = Array.isArray(profile.filterGroups)
                    ? profile.filterGroups
                        .map(group => ({
                            id: group.id,
                            name: group.name
                        }))
                        .sort((a, b) =>
                            String(a.name ?? "").localeCompare(
                                String(b.name ?? ""),
                                game.i18n.lang,
                                { sensitivity: "base" }
                            )
                        )
                    : [];

                const type = profile.type === "nested"
                    ? "nested"
                    : "content";
                const isContent = type === "content";
                const isNested = type === "nested";

                const childConfigurations =
                    new Map(
                        (
                            Array.isArray(profile.children)
                                ? profile.children
                                : []
                        ).map(child => [
                            child.profileId,
                            child
                        ])
                    );
                const nestedChildren = isNested
                    ? contentChoices.map(childProfile => {
                        const configuration =
                            childConfigurations.get(
                                childProfile.id
                            );

                        return {
                            id: childProfile.id,
                            name: childProfile.name,
                            enabled:
                                configuration?.enabled === true,
                            weight:
                                normalizeInspectorWeight(
                                    configuration?.weight,
                                    1
                                ),
                            generated:
                                Boolean(
                                    childProfile.generation
                                        ?.rootUuid
                                ),
                            pending:
                                !childProfile.generation
                                    ?.rootUuid ||
                                Number(
                                    childProfile.generation
                                        ?.generatedRevision ?? 0
                                ) !== Number(
                                    childProfile.revision ?? 1
                                )
                        };
                    })
                    : [];
                const childCount = nestedChildren.filter(
                    child => child.enabled
                ).length;

                const typeLabel = game.i18n.localize(
                    isNested
                        ? "COMPENDIUM_CURATOR.TableProfileTypeNested"
                        : "COMPENDIUM_CURATOR.TableProfileTypeContent"
                );

                const typeIcon = isNested
                    ? "fas fa-table-list"
                    : "fas fa-boxes-stacked";

                const summary = isNested
                    ? game.i18n.format(
                        "COMPENDIUM_CURATOR.SubtableCount",
                        { count: childCount }
                    )
                    : game.i18n.format(
                        "COMPENDIUM_CURATOR.FilterGroupCount",
                        { count: filterGroupCount }
                    );

                const revision = Number(profile.revision ?? 1);
                const generatedRevision = Number(
                    profile.generation?.generatedRevision ?? 0
                );
                const hasPendingDependency =
                    isNested &&
                    nestedChildren.some(child =>
                        child.enabled &&
                        child.pending
                    );

                let statusKey = "TableProfileNeverGenerated";

                if (
                    generatedRevision > 0 &&
                    (
                        generatedRevision < revision ||
                        hasPendingDependency
                    )
                ) {
                    statusKey = "TableProfilePendingChanges";
                }
                else if (
                    generatedRevision > 0 &&
                    generatedRevision === revision
                ) {
                    statusKey = "TableProfileUpToDate";
                }

                const status = game.i18n.localize(
                    `COMPENDIUM_CURATOR.${statusKey}`
                );

                const inspector = isContent
                    ? buildContentInspector(profile)
                    : null;
                const nestedInspector = isNested
                    ? {
                        children: nestedChildren,
                        hasChoices:
                            nestedChildren.length > 0,
                        activeCount: childCount
                    }
                    : null;

                return {
                    id: profile.id,
                    name: profile.name,
                    type,
                    isContent,
                    isNested,
                    typeLabel,
                    typeIcon,
                    summary,
                    childCount,
                    filterGroupCount,
                    filterGroups,
                    inspector,
                    nestedInspector,
                    canGenerate:
                        isContent
                            ? inspector?.hasObjects === true
                            : childCount > 0,
                    hasGenerated:
                        Boolean(
                            profile.generation?.rootUuid
                        ),
                    generationActionLabel:
                        profile.generation?.rootUuid
                            ? "COMPENDIUM_CURATOR.UpdateRollTable"
                            : "COMPENDIUM_CURATOR.GenerateRollTable",
                    inspectorOpen:
                        (isContent || isNested) &&
                        this._openContentInspectors.has(profile.id),
                    status,
                    searchText: [
                        profile.name,
                        typeLabel,
                        status,
                        ...filterGroups.map(group => group.name),
                        ...nestedChildren
                            .filter(child => child.enabled)
                            .map(child => child.name)
                    ]
                        .filter(Boolean)
                        .join(" ")
                };
            })
            .sort((a, b) =>
                String(a.name ?? "").localeCompare(
                    String(b.name ?? ""),
                    game.i18n.lang,
                    { sensitivity: "base" }
                )
            );

        const contentProfiles = profiles.filter(
            profile => profile.isContent
        );
        const nestedProfiles = profiles.filter(
            profile => profile.isNested
        );

        const filterGroups = Object.values(
            TableProfileStorageService.getFilterGroups()
        )
            .map(filterGroup => {
                const usedBy = profiles
                    .filter(profile =>
                        profile.filterGroups.some(group =>
                            group.id === filterGroup.id
                        )
                    )
                    .map(profile => ({
                        id: profile.id,
                        name: profile.name
                    }))
                    .sort((a, b) =>
                        String(a.name ?? "").localeCompare(
                            String(b.name ?? ""),
                            game.i18n.lang,
                            { sensitivity: "base" }
                        )
                    );

                const matchCount = Array.isArray(filterGroup.matches)
                    ? filterGroup.matches.length
                    : 0;
                const useCount = usedBy.length;

                return {
                    id: filterGroup.id,
                    name: filterGroup.name,
                    matchCount,
                    useCount,
                    usedBy,
                    matchesLabel: game.i18n.format(
                        "COMPENDIUM_CURATOR.CurrentFilterMatches",
                        { count: matchCount }
                    ),
                    usageLabel: `${useCount} ${game.i18n.localize(
                        "COMPENDIUM_CURATOR.TableProfiles"
                    ).toLocaleLowerCase()}`,
                    searchText: [
                        filterGroup.name,
                        ...usedBy.map(profile => profile.name)
                    ]
                        .filter(Boolean)
                        .join(" ")
                };
            })
            .sort((a, b) =>
                String(a.name ?? "").localeCompare(
                    String(b.name ?? ""),
                    game.i18n.lang,
                    { sensitivity: "base" }
                )
            );

        if (![
            "content",
            "nested",
            "filters"
        ].includes(this._activeTab)) {
            this._activeTab = "content";
        }

        const isContentTab = this._activeTab === "content";
        const isNestedTab = this._activeTab === "nested";
        const isFilterGroupsTab = this._activeTab === "filters";

        context.isContentTab = isContentTab;
        context.isNestedTab = isNestedTab;
        context.isFilterGroupsTab = isFilterGroupsTab;

        context.contentTabClass = isContentTab ? "active" : "";
        context.nestedTabClass = isNestedTab ? "active" : "";
        context.filterGroupsTabClass = isFilterGroupsTab ? "active" : "";

        context.contentProfileCount = contentProfiles.length;
        context.nestedProfileCount = nestedProfiles.length;
        context.filterGroupCount = filterGroups.length;

        context.profiles = isNestedTab
            ? nestedProfiles
            : contentProfiles;

        context.hasProfiles = context.profiles.length > 0;
        context.filterGroups = filterGroups;
        context.hasFilterGroups = filterGroups.length > 0;
        context.searchQuery = this._searchQuery;

        context.searchLabel = this.browserApp
            ?.element
            ?.querySelector('search > input[name="name"]')
            ?.placeholder ?? game.i18n.localize(
                "COMPENDIUM_CURATOR.TableProfiles"
            );

        return context;
    }

    async _onRender(context, options) {
        await super._onRender(context, options);

        const searchInput = this.element.querySelector(
            '[name="managerSearch"]'
        );

        searchInput?.addEventListener(
            "input",
            event => {
                this._searchQuery = String(
                    event.target?.value ?? ""
                );
                this._applyManagerSearch();
            }
        );

        for (
            const details
            of this.element.querySelectorAll(
                "[data-cc-content-inspector]"
            )
        ) {
            const profileId = details.closest(
                "[data-profile-id]"
            )?.dataset?.profileId;

            if (!profileId)
                continue;

            if (details.open)
                this._openContentInspectors.add(profileId);

            details.addEventListener(
                "toggle",
                () => {
                    if (details.open)
                        this._openContentInspectors.add(profileId);
                    else
                        this._openContentInspectors.delete(profileId);
                }
            );
        }

        for (
            const ruleInput
            of this.element.querySelectorAll(
                "[data-cc-exclude-zero-price]"
            )
        ) {
            ruleInput.addEventListener(
                "change",
                event => {
                    const target = event.currentTarget;
                    const profileElement = target.closest(
                        "[data-profile-id]"
                    );
                    const profileId =
                        profileElement?.dataset?.profileId;

                    if (!profileId)
                        return;

                    target.disabled = true;
                    this._openContentInspectors.add(
                        profileId
                    );

                    this._distributionSaveQueue =
                        this._distributionSaveQueue
                            .catch(() => {})
                            .then(() =>
                                TableProfileStorageService
                                    .setExcludeZeroPrice(
                                        profileId,
                                        target.checked
                                    )
                            )
                            .then(() =>
                                this.render({ force: true })
                            )
                            .catch(error => {
                                console.error(
                                    "Compendium Curator | Error cambiando la regla de precio.",
                                    error
                                );

                                const profile =
                                    TableProfileStorageService
                                        .getProfiles()?.[profileId];

                                if (target.isConnected) {
                                    target.checked =
                                        profile?.itemRules
                                            ?.excludeZeroPrice ===
                                        true;
                                }
                            })
                            .finally(() => {
                                if (target.isConnected)
                                    target.disabled = false;
                            });
                }
            );
        }

        for (
            const childToggle
            of this.element.querySelectorAll(
                "[data-cc-nested-child-enabled]"
            )
        ) {
            childToggle.addEventListener(
                "change",
                event => {
                    const target = event.currentTarget;
                    const profileElement = target.closest(
                        "[data-profile-id]"
                    );
                    const profileId =
                        profileElement?.dataset?.profileId;
                    const childProfileId = String(
                        target.dataset?.childProfileId ?? ""
                    ).trim();

                    if (!profileId || !childProfileId)
                        return;

                    target.disabled = true;
                    this._openContentInspectors.add(profileId);

                    this._distributionSaveQueue =
                        this._distributionSaveQueue
                            .catch(() => {})
                            .then(() =>
                                TableProfileStorageService
                                    .setNestedChildEnabled(
                                        profileId,
                                        childProfileId,
                                        target.checked
                                    )
                            )
                            .then(() =>
                                this.render({ force: true })
                            )
                            .catch(error => {
                                console.error(
                                    "Compendium Curator | Error cambiando una subtabla.",
                                    error
                                );

                                const profile =
                                    TableProfileStorageService
                                        .getProfiles()?.[profileId];
                                target.checked =
                                    getNestedChildConfiguration(
                                        profile,
                                        childProfileId
                                    ).enabled;
                            })
                            .finally(() => {
                                if (target.isConnected)
                                    target.disabled = false;
                            });
                }
            );
        }

        for (
            const childWeight
            of this.element.querySelectorAll(
                "[data-cc-nested-child-weight]"
            )
        ) {
            childWeight.addEventListener(
                "change",
                event => {
                    const target = event.currentTarget;
                    const profileElement = target.closest(
                        "[data-profile-id]"
                    );
                    const profileId =
                        profileElement?.dataset?.profileId;
                    const childProfileId = String(
                        target.dataset?.childProfileId ?? ""
                    ).trim();
                    const weight = Number(target.value);

                    if (!profileId || !childProfileId)
                        return;

                    if (!Number.isFinite(weight) || weight <= 0) {
                        const profile =
                            TableProfileStorageService
                                .getProfiles()?.[profileId];
                        target.value = String(
                            getNestedChildConfiguration(
                                profile,
                                childProfileId
                            ).weight
                        );
                        ui.notifications.warn(
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.InvalidTableWeight"
                            )
                        );
                        return;
                    }

                    target.disabled = true;
                    this._openContentInspectors.add(profileId);

                    this._distributionSaveQueue =
                        this._distributionSaveQueue
                            .catch(() => {})
                            .then(() =>
                                TableProfileStorageService
                                    .setNestedChildWeight(
                                        profileId,
                                        childProfileId,
                                        weight
                                    )
                            )
                            .then(updatedProfile => {
                                target.value = String(
                                    getNestedChildConfiguration(
                                        updatedProfile,
                                        childProfileId
                                    ).weight
                                );
                                updateRenderedProfileStatus(
                                    profileElement,
                                    updatedProfile
                                );
                            })
                            .catch(error => {
                                console.error(
                                    "Compendium Curator | Error guardando el peso de una subtabla.",
                                    error
                                );

                                const profile =
                                    TableProfileStorageService
                                        .getProfiles()?.[profileId];
                                target.value = String(
                                    getNestedChildConfiguration(
                                        profile,
                                        childProfileId
                                    ).weight
                                );
                            })
                            .finally(() => {
                                if (target.isConnected)
                                    target.disabled = false;
                            });
                }
            );
        }

        for (
            const modeSelect
            of this.element.querySelectorAll(
                "[data-cc-distribution-mode]"
            )
        ) {
            modeSelect.addEventListener(
                "change",
                event => {
                    const target = event.currentTarget;
                    const profileElement = target.closest(
                        "[data-profile-id]"
                    );
                    const profileId = profileElement?.dataset?.profileId;
                    const mode = String(target.value ?? "").trim();

                    if (!profileId || !DISTRIBUTION_MODES.has(mode))
                        return;

                    target.disabled = true;
                    this._openContentInspectors.add(profileId);

                    this._distributionSaveQueue = this._distributionSaveQueue
                        .catch(() => {})
                        .then(async () => {
                            const updatedProfile =
                                await TableProfileStorageService
                                    .setDistributionMode(
                                        profileId,
                                        mode
                                    );

                            updateRenderedProfileStatus(
                                profileElement,
                                updatedProfile
                            );

                            if (
                                this._profilePreview?.rendered &&
                                this._profilePreview.profileId === profileId
                            ) {
                                this._profilePreview.render({ force: true });
                            }

                            this.render({ force: true });
                        })
                        .catch(error => {
                            console.error(
                                "Compendium Curator | Error cambiando el modo de distribución.",
                                error
                            );

                            const profile =
                                TableProfileStorageService
                                    .getProfiles()?.[profileId];

                            if (target.isConnected && profile) {
                                target.value =
                                    getInspectorDistributionMode(profile);
                            }
                        })
                        .finally(() => {
                            if (target.isConnected)
                                target.disabled = false;
                        });
                }
            );
        }

        for (
            const groupingSelect
            of this.element.querySelectorAll(
                "[data-cc-grouping-criterion]"
            )
        ) {
            groupingSelect.addEventListener(
                "change",
                event => {
                    const target = event.currentTarget;
                    const profileElement = target.closest(
                        "[data-profile-id]"
                    );
                    const profileId = profileElement?.dataset?.profileId;
                    const criterion = String(
                        target.value ?? ""
                    ).trim();

                    if (
                        !profileId ||
                        !GROUPING_CRITERIA.has(criterion)
                    ) {
                        return;
                    }

                    target.disabled = true;
                    this._openContentInspectors.add(profileId);

                    this._distributionSaveQueue = this._distributionSaveQueue
                        .catch(() => {})
                        .then(async () => {
                            const updatedProfile =
                                await TableProfileStorageService
                                    .setDistributionGroupingCriterion(
                                        profileId,
                                        criterion
                                    );

                            updateRenderedProfileStatus(
                                profileElement,
                                updatedProfile
                            );

                            if (
                                this._profilePreview?.rendered &&
                                this._profilePreview.profileId === profileId
                            ) {
                                this._profilePreview.render({ force: true });
                            }

                            this.render({ force: true });
                        })
                        .catch(error => {
                            console.error(
                                "Compendium Curator | Error cambiando el criterio de agrupación.",
                                error
                            );

                            const profile =
                                TableProfileStorageService
                                    .getProfiles()?.[profileId];

                            if (target.isConnected && profile) {
                                target.value =
                                    getInspectorGroupingCriterion(profile);
                            }
                        })
                        .finally(() => {
                            if (target.isConnected)
                                target.disabled = false;
                        });
                }
            );
        }

        for (
            const groupEnabledInput
            of this.element.querySelectorAll(
                "[data-cc-group-enabled]"
            )
        ) {
            groupEnabledInput.addEventListener(
                "change",
                event => {
                    const target = event.currentTarget;
                    const profileElement = target.closest(
                        "[data-profile-id]"
                    );
                    const profileId = profileElement?.dataset?.profileId;
                    const groupKey = String(
                        target.dataset?.groupKey ?? ""
                    ).trim();

                    if (!profileId || !groupKey)
                        return;

                    const enabled = Boolean(target.checked);

                    target.disabled = true;
                    this._openContentInspectors.add(profileId);

                    this._distributionSaveQueue = this._distributionSaveQueue
                        .catch(() => {})
                        .then(async () => {
                            const updatedProfile =
                                await TableProfileStorageService
                                    .setDistributionGroupEnabled(
                                        profileId,
                                        groupKey,
                                        enabled
                                    );

                            updateRenderedProfileStatus(
                                profileElement,
                                updatedProfile
                            );

                            if (
                                this._profilePreview?.rendered &&
                                this._profilePreview.profileId === profileId
                            ) {
                                this._profilePreview.render({ force: true });
                            }

                            this.render({ force: true });
                        })
                        .catch(error => {
                            console.error(
                                "Compendium Curator | Error cambiando el estado del grupo.",
                                error
                            );

                            const profile =
                                TableProfileStorageService
                                    .getProfiles()?.[profileId];

                            if (target.isConnected && profile) {
                                target.checked =
                                    getInspectorGroupEnabled(
                                        profile,
                                        groupKey
                                    );
                            }
                        })
                        .finally(() => {
                            if (target.isConnected)
                                target.disabled = false;
                        });
                }
            );
        }

        for (
            const groupWeightInput
            of this.element.querySelectorAll(
                "[data-cc-group-weight]"
            )
        ) {
            groupWeightInput.addEventListener(
                "change",
                event => {
                    const target = event.currentTarget;
                    const profileElement = target.closest(
                        "[data-profile-id]"
                    );
                    const profileId = profileElement?.dataset?.profileId;
                    const groupKey = String(
                        target.dataset?.groupKey ?? ""
                    ).trim();
                    const weight = Number(target.value);

                    if (!profileId || !groupKey)
                        return;

                    if (!Number.isFinite(weight) || weight <= 0) {
                        const profile =
                            TableProfileStorageService
                                .getProfiles()?.[profileId];

                        target.value = String(
                            getInspectorGroupWeight(
                                profile,
                                groupKey
                            )
                        );

                        ui.notifications.warn(
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.InvalidTableWeight"
                            )
                        );

                        target.focus();
                        return;
                    }

                    target.disabled = true;

                    this._distributionSaveQueue = this._distributionSaveQueue
                        .catch(() => {})
                        .then(async () => {
                            const updatedProfile =
                                await TableProfileStorageService
                                    .setDistributionGroupWeight(
                                        profileId,
                                        groupKey,
                                        weight
                                    );

                            if (target.isConnected) {
                                target.value = String(
                                    getInspectorGroupWeight(
                                        updatedProfile,
                                        groupKey
                                    )
                                );
                            }

                            refreshRenderedProbabilityControls(
                                profileElement,
                                updatedProfile
                            );

                            updateRenderedProfileStatus(
                                profileElement,
                                updatedProfile
                            );

                            if (
                                this._profilePreview?.rendered &&
                                this._profilePreview.profileId === profileId
                            ) {
                                this._profilePreview.render({ force: true });
                            }
                        })
                        .catch(error => {
                            console.error(
                                "Compendium Curator | Error guardando el peso del grupo.",
                                error
                            );

                            const profile =
                                TableProfileStorageService
                                    .getProfiles()?.[profileId];

                            if (target.isConnected && profile) {
                                target.value = String(
                                    getInspectorGroupWeight(
                                        profile,
                                        groupKey
                                    )
                                );
                            }

                            refreshRenderedProbabilityControls(
                                profileElement,
                                profile
                            );
                        })
                        .finally(() => {
                            if (target.isConnected)
                                target.disabled = false;
                        });
                }
            );
        }

        for (
            const groupItemInput
            of this.element.querySelectorAll(
                "[data-cc-group-item-weight]"
            )
        ) {
            groupItemInput.addEventListener(
                "change",
                event => {
                    const target = event.currentTarget;
                    const profileElement = target.closest(
                        "[data-profile-id]"
                    );
                    const profileId =
                        profileElement?.dataset?.profileId;
                    const groupKey = String(
                        target.dataset?.groupKey ?? ""
                    ).trim();
                    const uuid = String(
                        target.dataset?.uuid ?? ""
                    ).trim();
                    const weight = Number(target.value);

                    if (!profileId || !groupKey || !uuid)
                        return;

                    if (!Number.isFinite(weight) || weight <= 0) {
                        const profile =
                            TableProfileStorageService
                                .getProfiles()?.[profileId];

                        refreshRenderedGroupItemWeightControls(
                            profileElement,
                            profile,
                            groupKey,
                            uuid
                        );

                        ui.notifications.warn(
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.InvalidTableWeight"
                            )
                        );

                        target.focus();
                        return;
                    }

                    const resetButton =
                        target.parentElement?.querySelector(
                            "[data-cc-reset-group-item-weight]"
                        );

                    target.disabled = true;
                    if (resetButton)
                        resetButton.disabled = true;

                    this._distributionSaveQueue =
                        this._distributionSaveQueue
                            .catch(() => {})
                            .then(async () => {
                                const updatedProfile =
                                    await TableProfileStorageService
                                        .setDistributionGroupItemWeight(
                                            profileId,
                                            groupKey,
                                            uuid,
                                            weight
                                        );

                                refreshRenderedGroupItemWeightControls(
                                    profileElement,
                                    updatedProfile,
                                    groupKey,
                                    uuid
                                );
                                refreshRenderedProbabilityControls(
                                    profileElement,
                                    updatedProfile
                                );
                                updateRenderedProfileStatus(
                                    profileElement,
                                    updatedProfile
                                );
                            })
                            .catch(error => {
                                console.error(
                                    "Compendium Curator | Error guardando el peso interno del grupo.",
                                    error
                                );

                                const profile =
                                    TableProfileStorageService
                                        .getProfiles()?.[profileId];

                                refreshRenderedGroupItemWeightControls(
                                    profileElement,
                                    profile,
                                    groupKey,
                                    uuid
                                );
                                refreshRenderedProbabilityControls(
                                    profileElement,
                                    profile
                                );
                            })
                            .finally(() => {
                                if (target.isConnected)
                                    target.disabled = false;

                                if (resetButton?.isConnected) {
                                    resetButton.disabled =
                                        target.dataset
                                            .hasOverride !== "true";
                                }
                            });
                }
            );
        }

        for (
            const resetButton
            of this.element.querySelectorAll(
                "[data-cc-reset-group-item-weight]"
            )
        ) {
            resetButton.addEventListener(
                "click",
                event => {
                    event.preventDefault();
                    event.stopPropagation();

                    const target = event.currentTarget;
                    const profileElement = target.closest(
                        "[data-profile-id]"
                    );
                    const profileId =
                        profileElement?.dataset?.profileId;
                    const groupKey = String(
                        target.dataset?.groupKey ?? ""
                    ).trim();
                    const uuid = String(
                        target.dataset?.uuid ?? ""
                    ).trim();
                    const input =
                        target.parentElement?.querySelector(
                            "[data-cc-group-item-weight]"
                        );

                    if (
                        !profileId ||
                        !groupKey ||
                        !uuid ||
                        !input
                    ) {
                        return;
                    }

                    input.disabled = true;
                    target.disabled = true;

                    this._distributionSaveQueue =
                        this._distributionSaveQueue
                            .catch(() => {})
                            .then(async () => {
                                const updatedProfile =
                                    await TableProfileStorageService
                                        .setDistributionGroupItemWeight(
                                            profileId,
                                            groupKey,
                                            uuid,
                                            null
                                        );

                                refreshRenderedGroupItemWeightControls(
                                    profileElement,
                                    updatedProfile,
                                    groupKey,
                                    uuid
                                );
                                refreshRenderedProbabilityControls(
                                    profileElement,
                                    updatedProfile
                                );
                                updateRenderedProfileStatus(
                                    profileElement,
                                    updatedProfile
                                );
                            })
                            .catch(error => {
                                console.error(
                                    "Compendium Curator | Error restaurando el peso interno del grupo.",
                                    error
                                );

                                const profile =
                                    TableProfileStorageService
                                        .getProfiles()?.[profileId];

                                refreshRenderedGroupItemWeightControls(
                                    profileElement,
                                    profile,
                                    groupKey,
                                    uuid
                                );
                                refreshRenderedProbabilityControls(
                                    profileElement,
                                    profile
                                );
                            })
                            .finally(() => {
                                if (input.isConnected)
                                    input.disabled = false;

                                if (target.isConnected) {
                                    target.disabled =
                                        input.dataset
                                            .hasOverride !== "true";
                                }
                            });
                }
            );
        }

        for (
            const individualInput
            of this.element.querySelectorAll(
                "[data-cc-individual-weight]"
            )
        ) {
            individualInput.addEventListener(
                "change",
                event => {
                    const target = event.currentTarget;
                    const profileElement = target.closest(
                        "[data-profile-id]"
                    );
                    const profileId = profileElement?.dataset?.profileId;
                    const uuid = String(
                        target.dataset?.uuid ?? ""
                    ).trim();
                    const weight = Number(target.value);

                    if (!profileId || !uuid)
                        return;

                    if (!Number.isFinite(weight) || weight <= 0) {
                        const profile =
                            TableProfileStorageService
                                .getProfiles()?.[profileId];
                        const info =
                            getInspectorIndividualWeight(profile, uuid);

                        target.value = String(info.weight);

                        ui.notifications.warn(
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.InvalidTableWeight"
                            )
                        );

                        target.focus();
                        return;
                    }

                    const resetButton = target.parentElement?.querySelector(
                        "[data-cc-reset-individual-weight]"
                    );

                    target.disabled = true;
                    if (resetButton)
                        resetButton.disabled = true;

                    this._distributionSaveQueue = this._distributionSaveQueue
                        .catch(() => {})
                        .then(async () => {
                            const updatedProfile =
                                await TableProfileStorageService
                                    .setDistributionIndividualWeight(
                                        profileId,
                                        uuid,
                                        weight
                                    );

                            refreshRenderedIndividualWeightControls(
                                profileElement,
                                updatedProfile,
                                uuid
                            );

                            refreshRenderedProbabilityControls(
                                profileElement,
                                updatedProfile
                            );

                            updateRenderedProfileStatus(
                                profileElement,
                                updatedProfile
                            );

                            if (
                                this._profilePreview?.rendered &&
                                this._profilePreview.profileId === profileId
                            ) {
                                this._profilePreview.render({ force: true });
                            }
                        })
                        .catch(error => {
                            console.error(
                                "Compendium Curator | Error guardando el peso individual.",
                                error
                            );

                            const profile =
                                TableProfileStorageService
                                    .getProfiles()?.[profileId];

                            refreshRenderedIndividualWeightControls(
                                profileElement,
                                profile,
                                uuid
                            );

                            refreshRenderedProbabilityControls(
                                profileElement,
                                profile
                            );
                        })
                        .finally(() => {
                            if (target.isConnected)
                                target.disabled = false;

                            if (resetButton?.isConnected) {
                                resetButton.disabled =
                                    target.dataset.hasOverride !== "true";
                            }
                        });
                }
            );
        }

        for (
            const resetButton
            of this.element.querySelectorAll(
                "[data-cc-reset-individual-weight]"
            )
        ) {
            resetButton.addEventListener(
                "click",
                event => {
                    event.preventDefault();
                    event.stopPropagation();

                    const target = event.currentTarget;
                    const profileElement = target.closest(
                        "[data-profile-id]"
                    );
                    const profileId = profileElement?.dataset?.profileId;
                    const uuid = String(
                        target.dataset?.uuid ?? ""
                    ).trim();
                    const input = target.parentElement?.querySelector(
                        "[data-cc-individual-weight]"
                    );

                    if (!profileId || !uuid || !input)
                        return;

                    input.disabled = true;
                    target.disabled = true;

                    this._distributionSaveQueue = this._distributionSaveQueue
                        .catch(() => {})
                        .then(async () => {
                            const updatedProfile =
                                await TableProfileStorageService
                                    .setDistributionIndividualWeight(
                                        profileId,
                                        uuid,
                                        null
                                    );

                            refreshRenderedIndividualWeightControls(
                                profileElement,
                                updatedProfile,
                                uuid
                            );

                            refreshRenderedProbabilityControls(
                                profileElement,
                                updatedProfile
                            );

                            updateRenderedProfileStatus(
                                profileElement,
                                updatedProfile
                            );

                            if (
                                this._profilePreview?.rendered &&
                                this._profilePreview.profileId === profileId
                            ) {
                                this._profilePreview.render({ force: true });
                            }
                        })
                        .catch(error => {
                            console.error(
                                "Compendium Curator | Error restaurando el peso individual predeterminado.",
                                error
                            );

                            const profile =
                                TableProfileStorageService
                                    .getProfiles()?.[profileId];

                            refreshRenderedIndividualWeightControls(
                                profileElement,
                                profile,
                                uuid
                            );

                            refreshRenderedProbabilityControls(
                                profileElement,
                                profile
                            );
                        })
                        .finally(() => {
                            if (input.isConnected)
                                input.disabled = false;

                            if (target.isConnected) {
                                target.disabled =
                                    input.dataset.hasOverride !== "true";
                            }
                        });
                }
            );
        }

        activateDnd5eDocumentEntries(this.element);
        this._applyManagerSearch();
    }

    _applyManagerSearch() {
        const query = normalizeManagerSearchText(this._searchQuery);

        for (
            const entry
            of this.element.querySelectorAll(
                "[data-cc-search-text]"
            )
        ) {
            const haystack = normalizeManagerSearchText(
                entry.dataset.ccSearchText
            );

            entry.hidden = Boolean(query) && !haystack.includes(query);
        }
    }

    _refreshApplicationsForFilterGroup(filterGroupId) {
        const affectedProfiles = new Set(
            TableProfileStorageService
                .getFilterGroupUsage(filterGroupId)
                .map(profile => profile.id)
        );

        if (
            this._profilePreview?.rendered &&
            affectedProfiles.has(this._profilePreview.profileId)
        ) {
            this._profilePreview.render({ force: true });
        }

        if (
            this._profileExclusions?.rendered &&
            affectedProfiles.has(this._profileExclusions.profileId)
        ) {
            this._profileExclusions.render({ force: true });
        }

        if (
            this._profileInclusions?.rendered &&
            affectedProfiles.has(this._profileInclusions.profileId)
        ) {
            this._profileInclusions.render({ force: true });
        }

        if (
            this._filterGroupDetails?.rendered &&
            this._filterGroupDetails.filterGroupId === filterGroupId
        ) {
            this._filterGroupDetails.render({ force: true });
        }
    }

    async _preClose(options) {
        this._closeProfileActionsPopover();

        const applications = [
            "_profileEditor",
            "_defaultsEditor",
            "_filterGroupEditor",
            "_filterCriteriaEditor",
            "_profilePreview",
            "_profileExclusions",
            "_profileInclusions",
            "_filterGroupDetails",
            "_groupingRangeEditor",
            "_manualGroupingEditor"
        ];

        for (const property of applications) {
            const application = this[property];
            this[property] = null;

            if (application?.rendered)
                await application.close();
        }

        if (this.browserApp) {
            this.browserApp._ccTableManagerLocked = false;

            if (this.browserApp.element?.isConnected)
                this.browserApp._ccRefreshToolbar?.();

            if (this.browserApp._ccTableManager === this)
                this.browserApp._ccTableManager = null;
        }

        await super._preClose(options);
    }

    static #onChangeManagerTab(event, target) {
        event.preventDefault();

        const tab = String(target.dataset?.tab ?? "");

        if (
            !["content", "nested", "filters"].includes(tab) ||
            tab === this._activeTab
        ) {
            return;
        }

        this._activeTab = tab;
        this._closeProfileActionsPopover();
        this.render({ force: true });
    }

    static #onClearManagerSearch(event, target) {
        event.preventDefault();
        this._searchQuery = "";

        const input = target
            .closest("search")
            ?.querySelector('[name="managerSearch"]');

        if (input)
            input.value = "";

        this._applyManagerSearch();
        input?.focus();
    }

    static async #onCreateProfile() {
        if (this._activeTab === "filters") {
            const storedGroup =
                await TableFilterGroupApplication
                    .createFromCurrentFilters(this.browserApp);

            if (storedGroup)
                this.render({ force: true });

            return;
        }

        if (this._profileEditor?.rendered) {
            this._profileEditor.bringToFront();
            return;
        }

        this._profileEditor ??=
            new TableProfileEditorApplication(this.browserApp);

        this._profileEditor.render({ force: true });
    }

    static #onExportProfileBundle(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const profileId = target
            .closest("[data-profile-id]")
            ?.dataset?.profileId;
        let profile = profileId
            ? TableProfileStorageService
                .getProfiles()?.[profileId]
            : null;

        if (!profile)
            return;

        const bundle =
            TableProfileStorageService
                .exportProfileBundle(profileId);
        const safeName = String(profile.name)
            .replace(
                /[<>:"/\\|?*\u0000-\u001F]/g,
                "-"
            )
            .trim() || "table-profile";

        foundry.utils.saveDataToFile(
            JSON.stringify(bundle, null, 2),
            "application/json",
            `compendium-curator-table-${safeName}.json`
        );

        ui.notifications.info(
            game.i18n.format(
                "COMPENDIUM_CURATOR.TableProfileExported",
                { name: profile.name }
            )
        );
        this._closeProfileActionsPopover();
    }

    static #onImportProfileBundle(event) {
        event.preventDefault();

        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";

        input.addEventListener(
            "change",
            async () => {
                const file = input.files?.[0];

                if (!file)
                    return;

                try {
                    const bundle = JSON.parse(
                        await file.text()
                    );
                    const imported =
                        await TableProfileStorageService
                            .importProfileBundle(bundle);
                    const root = imported.rootProfile;

                    this._activeTab =
                        root?.type === "nested"
                            ? "nested"
                            : "content";
                    this._searchQuery = "";
                    this.render({ force: true });

                    ui.notifications.info(
                        game.i18n.format(
                            "COMPENDIUM_CURATOR.TableProfileBundleImported",
                            {
                                name: root?.name ?? "",
                                profiles:
                                    imported
                                        .importedProfileIds
                                        .length,
                                groups:
                                    imported
                                        .importedFilterGroupIds
                                        .length
                            }
                        )
                    );

                    if (
                        imported.availability
                            ?.unavailableCount > 0
                    ) {
                        const unavailableSources =
                            imported.availability
                                .missingPacks
                                .map(pack =>
                                    `${pack.collection} (${pack.count})`
                                );

                        if (
                            imported.availability
                                .missingDocumentCount > 0
                        ) {
                            unavailableSources.push(
                                `${game.i18n.localize(
                                    "COMPENDIUM_CURATOR.MissingDocuments"
                                )} (${imported.availability.missingDocumentCount})`
                            );
                        }

                        ui.notifications.warn(
                            game.i18n.format(
                                "COMPENDIUM_CURATOR.ImportedUnavailableObjects",
                                {
                                    count:
                                        imported.availability
                                            .unavailableCount,
                                    packs:
                                        unavailableSources.join(", ")
                                }
                            ),
                            { permanent: true }
                        );
                    }
                }
                catch (error) {
                    console.error(
                        "Compendium Curator | Error importando un paquete de tablas.",
                        error
                    );
                    ui.notifications.error(
                        game.i18n.localize(
                            "COMPENDIUM_CURATOR.TableProfileBundleInvalid"
                        )
                    );
                }
            },
            { once: true }
        );

        input.click();
    }

    refreshProfileEditor() {
        if (!this._profileEditor?.rendered)
            return;

        this._profileEditor.scheduleRefresh();
    }

    static #onConfigureDefaults() {
        if (this._defaultsEditor?.rendered) {
            this._defaultsEditor.bringToFront();
            return;
        }

        this._defaultsEditor = new TableDefaultsApplication();
        this._defaultsEditor.render({ force: true });
    }

    static async #onEditGroupingRanges(
        event,
        target
    ) {
        event.preventDefault();

        const profileId = target
            .closest("[data-profile-id]")
            ?.dataset?.profileId;

        if (!profileId)
            return;

        const profile =
            TableProfileStorageService
                .getProfiles()?.[profileId];

        if (!profile)
            return;

        const criterion =
            getInspectorGroupingCriterion(
                profile
            );

        if (
            profile.distribution
                ?.grouped
                ?.grouping
                ?.type !== "range"
        ) {
            return;
        }

        if (this._groupingRangeEditor?.rendered) {
            if (
                this._groupingRangeEditor
                    .profileId === profileId &&
                this._groupingRangeEditor
                    .criterion === criterion
            ) {
                this._groupingRangeEditor
                    .bringToFront();
                return;
            }

            await this._groupingRangeEditor.close();
        }

        this._groupingRangeEditor =
            new TableGroupingRangeApplication(
                this,
                profileId,
                criterion
            );

        this._groupingRangeEditor.render({
            force: true
        });
    }

    static async #onEditManualGroups(
        event,
        target
    ) {
        event.preventDefault();

        const profileId = target
            .closest("[data-profile-id]")
            ?.dataset?.profileId;

        if (!profileId)
            return;

        const profile =
            TableProfileStorageService
                .getProfiles()?.[profileId];

        if (
            !profile ||
            getInspectorGroupingCriterion(profile) !==
                "manual"
        ) {
            return;
        }

        if (this._manualGroupingEditor?.rendered) {
            if (
                this._manualGroupingEditor
                    .profileId === profileId
            ) {
                this._manualGroupingEditor
                    .bringToFront();
                return;
            }

            await this._manualGroupingEditor.close();
        }

        this._manualGroupingEditor =
            new TableManualGroupingApplication(
                this,
                profileId
            );

        this._manualGroupingEditor.render({
            force: true
        });
    }

    static async #onAddCurrentFilters(event, target) {
        const profileId = target
            .closest("[data-profile-id]")
            ?.dataset?.profileId;

        if (!profileId)
            return;

        if (this._filterGroupEditor?.rendered) {
            if (this._filterGroupEditor.profileId === profileId) {
                this._filterGroupEditor.bringToFront();
                return;
            }

            await this._filterGroupEditor.close();
        }

        this._filterGroupEditor = new TableFilterGroupApplication(
            this.browserApp,
            this,
            profileId
        );

        this._filterGroupEditor.render({ force: true });
    }

    static async #onPreviewProfile(event, target) {
        const profileId = target
            .closest("[data-profile-id]")
            ?.dataset?.profileId;

        if (!profileId)
            return;

        if (this._profilePreview?.rendered) {
            if (this._profilePreview.profileId === profileId) {
                this._profilePreview.bringToFront();
                return;
            }

            await this._profilePreview.close();
        }

        this._profilePreview = new TableProfilePreviewApplication(
            this.browserApp,
            profileId
        );

        this._profilePreview.render({ force: true });
    }

    static async #onManualInclusions(event, target) {
        const profileId = target
            .closest("[data-profile-id]")
            ?.dataset?.profileId;

        if (!profileId)
            return;

        if (this._profileInclusions?.rendered) {
            if (this._profileInclusions.profileId === profileId) {
                this._profileInclusions.bringToFront();
                return;
            }

            await this._profileInclusions.close();
        }

        this._profileInclusions = new TableProfileInclusionsApplication(
            this.browserApp,
            this,
            profileId
        );

        this._profileInclusions.render({ force: true });
    }

    static async #onManualExclusions(event, target) {
        const profileId = target
            .closest("[data-profile-id]")
            ?.dataset?.profileId;

        if (!profileId)
            return;

        if (this._profileExclusions?.rendered) {
            if (this._profileExclusions.profileId === profileId) {
                this._profileExclusions.bringToFront();
                return;
            }

            await this._profileExclusions.close();
        }

        this._profileExclusions = new TableProfileExclusionsApplication(
            this.browserApp,
            this,
            profileId
        );

        this._profileExclusions.render({ force: true });
    }

    static async #onGenerateProfile(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const profileId = target
            .closest("[data-profile-id]")
            ?.dataset?.profileId;

        if (!profileId)
            return;

        const profile =
            TableProfileStorageService
                .getProfiles()?.[profileId];

        if (!profile)
            return;

        target.disabled = true;
        this._closeProfileActionsPopover();

        try {
            const generated =
                await generateProfileTables(profile);

            ui.notifications.info(
                game.i18n.format(
                    "COMPENDIUM_CURATOR.RollTableGenerated",
                    { name: generated.root.name }
                )
            );

            this.render({ force: true });
        }
        catch (error) {
            console.error(
                "Compendium Curator | Error generando RollTables.",
                error
            );

            let key = "RollTableGenerationFailed";

            if (
                error?.message ===
                    "TABLE_PROFILE_NO_ACTIVE_GROUPS"
            ) {
                key = "TableProfileNoActiveGroups";
            }
            else if (
                error?.message ===
                    "TABLE_PROFILE_NO_ACTIVE_CHILDREN"
            ) {
                key = "TableProfileNoActiveChildren";
            }
            else if (
                error?.message ===
                    "TABLE_PROFILE_NO_OBJECTS"
            ) {
                key = "TableProfileNoObjects";
            }

            ui.notifications.error(
                game.i18n.localize(
                    `COMPENDIUM_CURATOR.${key}`
                )
            );
        }
        finally {
            if (target.isConnected)
                target.disabled = false;
        }
    }

    static async #onOpenGeneratedTable(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const profileId = target
            .closest("[data-profile-id]")
            ?.dataset?.profileId;

        if (!profileId)
            return;

        target.disabled = true;

        try {
            const prepared =
                await prepareProfileTableForUse(
                    this,
                    profileId
                );

            prepared?.table?.sheet?.render(true);
        }
        finally {
            if (target.isConnected)
                target.disabled = false;
        }
    }

    static async #onDrawGeneratedTable(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const profileId = target
            .closest("[data-profile-id]")
            ?.dataset?.profileId;

        if (!profileId)
            return;

        target.disabled = true;

        let prepared;

        try {
            prepared =
                await prepareProfileTableForUse(
                    this,
                    profileId
                );
        }
        finally {
            if (target.isConnected)
                target.disabled = false;
        }

        if (!prepared)
            return;

        const { profile, table } = prepared;

        const field = document.createElement("div");
        field.className = "form-group";

        const label = document.createElement("label");
        label.textContent = game.i18n.localize(
            "COMPENDIUM_CURATOR.DrawCount"
        );

        const input = document.createElement("input");
        input.type = "number";
        input.name = "drawCount";
        input.min = "1";
        input.max = "100";
        input.step = "1";
        input.value = String(
            profile?.draw?.count ?? 1
        );
        input.setAttribute(
            "value",
            input.value
        );

        field.append(label, input);

        const uniqueField =
            document.createElement("div");
        uniqueField.className = "form-group";

        const uniqueLabel =
            document.createElement("label");
        uniqueLabel.textContent =
            game.i18n.localize(
                "COMPENDIUM_CURATOR.DrawUniqueResults"
            );

        const uniqueFields =
            document.createElement("div");
        uniqueFields.className = "form-fields";

        const uniqueInput =
            document.createElement("input");
        uniqueInput.type = "checkbox";
        uniqueInput.name = "uniqueResults";
        uniqueInput.checked =
            profile?.draw?.unique === true;

        if (uniqueInput.checked) {
            uniqueInput.setAttribute(
                "checked",
                ""
            );
        }

        uniqueFields.append(uniqueInput);
        uniqueField.append(
            uniqueLabel,
            uniqueFields
        );

        const uniqueHint =
            document.createElement("p");
        uniqueHint.className = "hint";
        uniqueHint.textContent =
            game.i18n.localize(
                "COMPENDIUM_CURATOR.DrawUniqueResultsHint"
            );
        uniqueField.append(uniqueHint);

        const quantityField =
            document.createElement("div");
        quantityField.className = "form-group";

        const quantityLabel =
            document.createElement("label");
        quantityLabel.textContent =
            game.i18n.localize(
                "COMPENDIUM_CURATOR.StockQuantityPerItem"
            );

        const quantityFields =
            document.createElement("div");
        quantityFields.className = "form-fields";

        const quantityMinInput =
            document.createElement("input");
        quantityMinInput.type = "number";
        quantityMinInput.name = "quantityMin";
        quantityMinInput.min = "1";
        quantityMinInput.max = "100";
        quantityMinInput.step = "1";
        quantityMinInput.value = String(
            profile?.draw?.quantityMin ?? 1
        );
        quantityMinInput.setAttribute(
            "value",
            quantityMinInput.value
        );

        const quantitySeparator =
            document.createElement("span");
        quantitySeparator.className = "units";
        quantitySeparator.textContent = "–";

        const quantityMaxInput =
            document.createElement("input");
        quantityMaxInput.type = "number";
        quantityMaxInput.name = "quantityMax";
        quantityMaxInput.min = "1";
        quantityMaxInput.max = "100";
        quantityMaxInput.step = "1";
        quantityMaxInput.value = String(
            profile?.draw?.quantityMax ?? 1
        );
        quantityMaxInput.setAttribute(
            "value",
            quantityMaxInput.value
        );

        quantityFields.append(
            quantityMinInput,
            quantitySeparator,
            quantityMaxInput
        );
        quantityField.append(
            quantityLabel,
            quantityFields
        );

        const quantityHint =
            document.createElement("p");
        quantityHint.className = "hint";
        quantityHint.textContent =
            game.i18n.localize(
                "COMPENDIUM_CURATOR.StockQuantityPerItemHint"
            );
        quantityField.append(quantityHint);

        const priceField =
            document.createElement("div");
        priceField.className = "form-group";

        const priceLabel =
            document.createElement("label");
        priceLabel.textContent =
            game.i18n.localize(
                "COMPENDIUM_CURATOR.PriceAdjustment"
            );

        const priceFields =
            document.createElement("div");
        priceFields.className = "form-fields";

        const priceInput =
            document.createElement("input");
        priceInput.type = "number";
        priceInput.name = "priceAdjustment";
        priceInput.min = "1";
        priceInput.max = "1000";
        priceInput.step = "1";
        priceInput.value = String(
            profile?.draw?.priceAdjustment ??
                100
        );
        priceInput.setAttribute(
            "value",
            priceInput.value
        );

        const priceUnits =
            document.createElement("span");
        priceUnits.className = "units";
        priceUnits.textContent = "%";

        priceFields.append(
            priceInput,
            priceUnits
        );
        priceField.append(
            priceLabel,
            priceFields
        );

        const priceHint =
            document.createElement("p");
        priceHint.className = "hint";
        priceHint.textContent =
            game.i18n.localize(
                "COMPENDIUM_CURATOR.PriceAdjustmentHint"
            );
        priceField.append(priceHint);

        const rememberField =
            document.createElement("div");
        rememberField.className = "form-group";

        const rememberLabel =
            document.createElement("label");
        rememberLabel.textContent =
            game.i18n.localize(
                "COMPENDIUM_CURATOR.RememberDrawSettings"
            );

        const rememberFields =
            document.createElement("div");
        rememberFields.className = "form-fields";

        const rememberInput =
            document.createElement("input");
        rememberInput.type = "checkbox";
        rememberInput.name =
            "rememberDrawSettings";
        rememberInput.checked = true;
        rememberInput.setAttribute("checked", "");

        rememberFields.append(rememberInput);
        rememberField.append(
            rememberLabel,
            rememberFields
        );

        const form = document.createElement("div");
        form.append(
            field,
            uniqueField,
            quantityField,
            priceField,
            rememberField
        );

        const result =
            await foundry.applications.api.DialogV2
                .input({
                    window: {
                        title: game.i18n.format(
                            "COMPENDIUM_CURATOR.DrawGeneratedTableTitle",
                            { name: profile.name }
                        )
                    },
                    content: form.innerHTML,
                    ok: {
                        label: game.i18n.localize(
                            "COMPENDIUM_CURATOR.DrawResults"
                        )
                    },
                    rejectClose: false,
                    modal: true
                });

        if (!result)
            return;

        const count = Math.min(
            100,
            Math.max(
                1,
                Number.parseInt(
                    result.drawCount,
                    10
                ) || 1
            )
        );
        const uniqueResults =
            result.uniqueResults === true ||
            result.uniqueResults === "true" ||
            result.uniqueResults === "on" ||
            result.uniqueResults === 1 ||
            result.uniqueResults === "1";
        const quantityMin = Math.min(
            100,
            Math.max(
                1,
                Number.parseInt(
                    result.quantityMin,
                    10
                ) || 1
            )
        );
        const quantityMax = Math.min(
            100,
            Math.max(
                quantityMin,
                Number.parseInt(
                    result.quantityMax,
                    10
                ) || quantityMin
            )
        );
        const priceAdjustment = Math.min(
            1000,
            Math.max(
                1,
                Number(
                    result.priceAdjustment
                ) || 100
            )
        );
        const rememberDrawSettings =
            result.rememberDrawSettings === true ||
            result.rememberDrawSettings === "true" ||
            result.rememberDrawSettings === "on" ||
            result.rememberDrawSettings === 1 ||
            result.rememberDrawSettings === "1";

        if (rememberDrawSettings) {
            await TableProfileStorageService
                .setDrawPreferences(
                    profile.id,
                    {
                        count,
                        unique: uniqueResults,
                        priceAdjustment,
                        quantityMin,
                        quantityMax
                    }
                );
        }

        await drawProfileTable(
            table,
            {
                count,
                unique: uniqueResults,
                priceAdjustment,
                quantityMin,
                quantityMax
            }
        );
    }

    static async #onQuickDrawGeneratedTable(
        event,
        target
    ) {
        event.preventDefault();
        event.stopPropagation();

        const profileId = target
            .closest("[data-profile-id]")
            ?.dataset?.profileId;

        if (!profileId)
            return;

        target.disabled = true;

        try {
            const prepared =
                await prepareProfileTableForUse(
                    this,
                    profileId
                );

            if (!prepared)
                return;

            const preferences =
                prepared.profile.draw ?? {};

            await drawProfileTable(
                prepared.table,
                {
                    count:
                        preferences.count ?? 1,
                    unique:
                        preferences.unique === true,
                    priceAdjustment:
                        preferences.priceAdjustment ??
                            100,
                    quantityMin:
                        preferences.quantityMin ?? 1,
                    quantityMax:
                        preferences.quantityMax ?? 1
                }
            );
        }
        catch (error) {
            console.error(
                "Compendium Curator | Error en la reposición rápida.",
                error
            );
            ui.notifications.error(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.DrawFailed"
                )
            );
        }
        finally {
            if (target.isConnected)
                target.disabled = false;
        }
    }

    static async #onRenameProfile(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const profileId = target
            .closest("[data-profile-id]")
            ?.dataset?.profileId;

        if (!profileId)
            return;

        const profile =
            TableProfileStorageService.getProfiles()?.[profileId];

        if (!profile)
            return;

        const field = document.createElement("div");
        field.className = "form-group";

        const label = document.createElement("label");
        label.textContent = game.i18n.localize(
            "COMPENDIUM_CURATOR.ProfileName"
        );

        const input = document.createElement("input");
        input.type = "text";
        input.name = "profileName";
        input.autocomplete = "off";
        input.autofocus = true;
        input.value = profile.name;
        input.setAttribute("value", profile.name);

        field.append(label, input);

        const result = await foundry.applications.api.DialogV2.input({
            window: {
                title: game.i18n.localize(
                    "COMPENDIUM_CURATOR.RenameProfile"
                )
            },
            content: field.outerHTML,
            ok: {
                label: game.i18n.localize(
                    "COMPENDIUM_CURATOR.Rename"
                )
            },
            rejectClose: false,
            modal: true
        });

        if (!result)
            return;

        const name = String(result.profileName ?? "").trim();

        if (!name) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.ProfileNameRequired"
                )
            );
            return;
        }

        if (name === profile.name)
            return;

        try {
            await TableProfileStorageService.renameProfile(
                profileId,
                name
            );
        }
        catch (error) {
            if (error?.message === "TABLE_PROFILE_NAME_TAKEN") {
                ui.notifications.warn(
                    game.i18n.localize(
                        "COMPENDIUM_CURATOR.TableProfileNameTaken"
                    )
                );
                return;
            }
            throw error;
        }

        this.render({ force: true });

        const applications = [
            this._profilePreview,
            this._profileInclusions,
            this._profileExclusions
        ];

        for (const application of applications) {
            if (
                application?.rendered &&
                application.profileId === profileId
            ) {
                application.render({ force: true });
            }
        }
    }

    static async #onDuplicateProfile(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const profileId = target
            .closest("[data-profile-id]")
            ?.dataset?.profileId;

        if (!profileId)
            return;

        const profile =
            TableProfileStorageService.getProfiles()?.[profileId];

        if (!profile)
            return;

        let suggestedName = game.i18n.format(
            "COMPENDIUM_CURATOR.ProfileCopyName",
            { profile: profile.name }
        );

        if (TableProfileStorageService.isNameTaken(suggestedName)) {
            const baseName = suggestedName;
            let index = 2;

            while (
                TableProfileStorageService.isNameTaken(
                    `${baseName} (${index})`
                )
            ) {
                index++;
            }

            suggestedName = `${baseName} (${index})`;
        }

        const field = document.createElement("div");
        field.className = "form-group";

        const label = document.createElement("label");
        label.textContent = game.i18n.localize(
            "COMPENDIUM_CURATOR.ProfileName"
        );

        const input = document.createElement("input");
        input.type = "text";
        input.name = "profileName";
        input.autocomplete = "off";
        input.autofocus = true;
        input.value = suggestedName;
        input.setAttribute("value", suggestedName);

        field.append(label, input);

        const result = await foundry.applications.api.DialogV2.input({
            window: {
                title: game.i18n.localize(
                    "COMPENDIUM_CURATOR.DuplicateProfile"
                )
            },
            content: field.outerHTML,
            ok: {
                label: game.i18n.localize(
                    "COMPENDIUM_CURATOR.Duplicate"
                )
            },
            rejectClose: false,
            modal: true
        });

        if (!result)
            return;

        const name = String(result.profileName ?? "").trim();

        if (!name) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.ProfileNameRequired"
                )
            );
            return;
        }

        if (TableProfileStorageService.isNameTaken(name)) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.TableProfileNameTaken"
                )
            );
            return;
        }

        await TableProfileStorageService.duplicateProfile(
            profileId,
            name
        );

        this.render({ force: true });
    }

    static async #onDeleteProfile(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const profileId = target
            .closest("[data-profile-id]")
            ?.dataset?.profileId;

        if (!profileId)
            return;

        const profile =
            TableProfileStorageService.getProfiles()?.[profileId];

        if (!profile)
            return;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            classes: TABLE_DIALOG_CLASSES,
            window: {
                title: game.i18n.localize(
                    "COMPENDIUM_CURATOR.DeleteProfile"
                )
            },
            content: `<p>${game.i18n.format(
                "COMPENDIUM_CURATOR.ProfileDeleteConfirm",
                {
                    profile: foundry.utils.escapeHTML(profile.name)
                }
            )}</p>`,
            rejectClose: false,
            modal: true
        });

        if (!confirmed)
            return;

        const profileApplications = [
            "_filterGroupEditor",
            "_filterCriteriaEditor",
            "_profilePreview",
            "_profileInclusions",
            "_profileExclusions",
            "_filterGroupDetails",
            "_groupingRangeEditor",
            "_manualGroupingEditor"
        ];

        for (const property of profileApplications) {
            const application = this[property];

            if (application?.profileId !== profileId)
                continue;

            if (application.rendered)
                await application.close();

            this[property] = null;
        }

        this._openContentInspectors.delete(profileId);
        const deletedTables =
            await TableProfileGenerationService
                .deleteGeneratedTables(profile);
        await TableProfileStorageService.removeProfile(profileId);

        if (deletedTables > 0) {
            ui.notifications.info(
                game.i18n.format(
                    deletedTables === 1
                        ? "COMPENDIUM_CURATOR.GeneratedTableRemoved"
                        : "COMPENDIUM_CURATOR.GeneratedTablesRemoved",
                    { count: deletedTables }
                )
            );
        }

        this.render({ force: true });
    }

    static async #onRenameFilterGroup(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const filterGroupId = target
            .closest("[data-filter-group-id]")
            ?.dataset?.filterGroupId;

        if (!filterGroupId)
            return;

        const filterGroup =
            TableProfileStorageService.getFilterGroup(filterGroupId);

        if (!filterGroup)
            return;

        const field = document.createElement("div");
        field.className = "form-group";

        const label = document.createElement("label");
        label.textContent = game.i18n.localize(
            "COMPENDIUM_CURATOR.FilterGroupName"
        );

        const input = document.createElement("input");
        input.type = "text";
        input.name = "filterGroupName";
        input.autocomplete = "off";
        input.autofocus = true;
        input.value = filterGroup.name;
        input.setAttribute(
            "value",
            filterGroup.name
        );

        field.append(label, input);

        const result = await foundry.applications.api.DialogV2.input({
            window: {
                title: game.i18n.localize(
                    "COMPENDIUM_CURATOR.RenameFilterGroup"
                )
            },
            content: field.outerHTML,
            ok: {
                label: game.i18n.localize(
                    "COMPENDIUM_CURATOR.Rename"
                )
            },
            rejectClose: false,
            modal: true
        });

        if (!result)
            return;

        const name = String(result.filterGroupName ?? "").trim();

        if (!name) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNameRequired"
                )
            );
            return;
        }

        if (name === filterGroup.name)
            return;

        if (
            TableProfileStorageService.isFilterGroupNameTaken(
                null,
                name,
                filterGroupId
            )
        ) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNameTaken"
                )
            );
            return;
        }

        await TableProfileStorageService.renameFilterGroup(
            filterGroupId,
            name
        );

        this.render({ force: true });
        this._refreshApplicationsForFilterGroup(filterGroupId);
    }

    static async #onDuplicateFilterGroup(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const filterGroupId = target
            .closest("[data-filter-group-id]")
            ?.dataset?.filterGroupId;

        if (!filterGroupId)
            return;

        const filterGroup =
            TableProfileStorageService.getFilterGroup(filterGroupId);

        if (!filterGroup)
            return;

        let suggestedName = game.i18n.format(
            "COMPENDIUM_CURATOR.FilterGroupCopyName",
            { group: filterGroup.name }
        );

        if (
            TableProfileStorageService.isFilterGroupNameTaken(
                null,
                suggestedName
            )
        ) {
            const baseName = suggestedName;
            let index = 2;

            while (
                TableProfileStorageService.isFilterGroupNameTaken(
                    null,
                    `${baseName} (${index})`
                )
            ) {
                index++;
            }

            suggestedName = `${baseName} (${index})`;
        }

        const field = document.createElement("div");
        field.className = "form-group";

        const label = document.createElement("label");
        label.textContent = game.i18n.localize(
            "COMPENDIUM_CURATOR.FilterGroupName"
        );

        const input = document.createElement("input");
        input.type = "text";
        input.name = "filterGroupName";
        input.autocomplete = "off";
        input.autofocus = true;
        input.value = suggestedName;
        input.setAttribute("value", suggestedName);

        field.append(label, input);

        const result = await foundry.applications.api.DialogV2.input({
            window: {
                title: game.i18n.localize(
                    "COMPENDIUM_CURATOR.DuplicateFilterGroup"
                )
            },
            content: field.outerHTML,
            ok: {
                label: game.i18n.localize(
                    "COMPENDIUM_CURATOR.Duplicate"
                )
            },
            rejectClose: false,
            modal: true
        });

        if (!result)
            return;

        const name = String(result.filterGroupName ?? "").trim();

        if (!name) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNameRequired"
                )
            );
            return;
        }

        if (
            TableProfileStorageService.isFilterGroupNameTaken(
                null,
                name
            )
        ) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNameTaken"
                )
            );
            return;
        }

        await TableProfileStorageService.duplicateFilterGroup(
            filterGroupId,
            name
        );

        this.render({ force: true });
    }

    static async #onDeleteGlobalFilterGroup(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const filterGroupId = target
            .closest("[data-filter-group-id]")
            ?.dataset?.filterGroupId;

        if (!filterGroupId)
            return;

        const filterGroup =
            TableProfileStorageService.getFilterGroup(filterGroupId);

        if (!filterGroup)
            return;

        const usage =
            TableProfileStorageService.getFilterGroupUsage(filterGroupId);

        if (usage.length > 0) {
            ui.notifications.warn(
                game.i18n.format(
                    "COMPENDIUM_CURATOR.FilterGroupDeleteBlocked",
                    {
                        name: filterGroup.name,
                        profiles: usage
                            .map(profile => profile.name)
                            .join(", ")
                    }
                )
            );
            return;
        }

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            classes: TABLE_DIALOG_CLASSES,
            window: {
                title: game.i18n.localize(
                    "COMPENDIUM_CURATOR.DeleteFilterGroup"
                )
            },
            content: `<p>${game.i18n.format(
                "COMPENDIUM_CURATOR.DeleteFilterGroupConfirm",
                {
                    name: foundry.utils.escapeHTML(filterGroup.name)
                }
            )}</p>`,
            rejectClose: false,
            modal: true
        });

        if (!confirmed)
            return;

        await TableProfileStorageService.deleteGlobalFilterGroup(
            filterGroupId
        );

        if (
            this._filterGroupDetails?.rendered &&
            this._filterGroupDetails.filterGroupId === filterGroupId
        ) {
            await this._filterGroupDetails.close();
            this._filterGroupDetails = null;
        }

        if (
            this._filterCriteriaEditor?.rendered &&
            this._filterCriteriaEditor.filterGroupId === filterGroupId
        ) {
            await this._filterCriteriaEditor.close();
            this._filterCriteriaEditor = null;
        }

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupDeleted"
            )
        );

        this.render({ force: true });
    }

    static #onToggleProfileActions(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const profile = target.closest(
            ".cc-table-manager-profile"
        );

        if (!profile)
            return;

        const profileId = profile.dataset.profileId;
        const filterGroupId = profile.dataset.filterGroupId;

        const resourceId = profileId || (
            filterGroupId
                ? `filter:${filterGroupId}`
                : null
        );

        if (!resourceId)
            return;

        if (
            this._profileActionsPopover &&
            this._profileActionsProfileId === resourceId
        ) {
            this._closeProfileActionsPopover();
            return;
        }

        this._openProfileActionsPopover(profile, target);
    }

    _openProfileActionsPopover(profile, anchor) {
        this._closeProfileActionsPopover();

        const sourceMenu = profile.querySelector(
            ".cc-table-manager-profile-menu"
        );

        if (!sourceMenu)
            return;

        const popover = sourceMenu.cloneNode(true);
        popover.hidden = false;
        popover.classList.add(
            "cc-table-manager-profile-menu-popover"
        );

        const profileId = profile.dataset.profileId;
        const filterGroupId = profile.dataset.filterGroupId;

        const resourceId = profileId || (
            filterGroupId
                ? `filter:${filterGroupId}`
                : null
        );

        if (profileId)
            popover.dataset.profileId = profileId;

        if (filterGroupId)
            popover.dataset.filterGroupId = filterGroupId;

        popover.addEventListener(
            "click",
            event => {
                const button = event.target.closest(
                    "button[data-action]"
                );

                if (!button || button.disabled)
                    return;

                event.preventDefault();
                event.stopPropagation();

                const action = button.dataset.action;
                const originalButton = profile.querySelector(
                    `.cc-table-manager-profile-menu button[data-action="${action}"]`
                );

                this._closeProfileActionsPopover();
                originalButton?.click();
            }
        );

        document.body.append(popover);
        this._positionProfileActionsPopover(popover, anchor);

        this._profileActionsPopover = popover;
        this._profileActionsProfileId = resourceId;

        this._profileActionsOutsideHandler = event => {
            if (
                popover.contains(event.target) ||
                anchor.contains(event.target)
            ) {
                return;
            }

            this._closeProfileActionsPopover();
        };

        this._profileActionsViewportHandler = () => {
            this._closeProfileActionsPopover();
        };

        document.addEventListener(
            "pointerdown",
            this._profileActionsOutsideHandler,
            true
        );
        document.addEventListener(
            "scroll",
            this._profileActionsViewportHandler,
            true
        );
        window.addEventListener(
            "resize",
            this._profileActionsViewportHandler
        );
    }

    _positionProfileActionsPopover(popover, anchor) {
        const margin = 8;
        const gap = 6;
        const anchorRect = anchor.getBoundingClientRect();
        const popoverRect = popover.getBoundingClientRect();

        let left = anchorRect.right - popoverRect.width;
        let top = anchorRect.bottom + gap;

        left = Math.min(
            left,
            window.innerWidth - popoverRect.width - margin
        );
        left = Math.max(margin, left);

        if (
            top + popoverRect.height >
            window.innerHeight - margin
        ) {
            top = anchorRect.top - popoverRect.height - gap;
        }

        top = Math.max(margin, top);

        popover.style.left = `${Math.round(left)}px`;
        popover.style.top = `${Math.round(top)}px`;
    }

    _closeProfileActionsPopover() {
        if (this._profileActionsOutsideHandler) {
            document.removeEventListener(
                "pointerdown",
                this._profileActionsOutsideHandler,
                true
            );
        }

        if (this._profileActionsViewportHandler) {
            document.removeEventListener(
                "scroll",
                this._profileActionsViewportHandler,
                true
            );
            window.removeEventListener(
                "resize",
                this._profileActionsViewportHandler
            );
        }

        this._profileActionsPopover?.remove();
        this._profileActionsPopover = null;
        this._profileActionsProfileId = null;
        this._profileActionsOutsideHandler = null;
        this._profileActionsViewportHandler = null;
    }

    static async #onFilterGroupDetails(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const profileId = target
            .closest("[data-profile-id]")
            ?.dataset?.profileId ?? null;

        const filterGroupId = target
            .closest("[data-filter-group-id]")
            ?.dataset?.filterGroupId;

        if (!filterGroupId)
            return;

        const filterGroup =
            TableProfileStorageService.getFilterGroup(filterGroupId);

        const profile = profileId
            ? TableProfileStorageService.getProfiles()?.[profileId]
            : null;

        if (!filterGroup) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNotFound"
                )
            );
            return;
        }

        if (this._filterGroupDetails?.rendered) {
            if (this._filterGroupDetails.filterGroupId === filterGroupId) {
                this._filterGroupDetails.bringToFront();
                return;
            }

            await this._filterGroupDetails.close();
        }

        this._filterGroupDetails = new TableFilterGroupDetailsApplication(
            this.browserApp,
            profile,
            filterGroup
        );

        this._filterGroupDetails.render({ force: true });
    }

    static async #onRefreshFilterGroup(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const profileId = target
            .closest("[data-profile-id]")
            ?.dataset?.profileId ?? null;

        const filterGroupId = target
            .closest("[data-filter-group-id]")
            ?.dataset?.filterGroupId;

        if (!filterGroupId)
            return;

        const filterGroup =
            TableProfileStorageService.getFilterGroup(filterGroupId);

        if (!filterGroup)
            return;

        const filters = TableProfileService.compactBrowserFilters(
            filterGroup.browser?.filters ?? {}
        );

        if (!filters)
            return;

        const currentCandidates =
            await TableProfileService.getBrowserCandidates(
                this.browserApp,
                filters
            );

        const currentByUuid = new Map();

        for (const candidate of currentCandidates)
            currentByUuid.set(candidate.uuid, candidate);

        if (!Array.isArray(filterGroup.matches)) {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                classes: TABLE_DIALOG_CLASSES,
                window: {
                    title: game.i18n.localize(
                        "COMPENDIUM_CURATOR.RefreshFilterGroup"
                    )
                },
                content: `<p>${game.i18n.format(
                    "COMPENDIUM_CURATOR.InitializeFilterGroupMatches",
                    {
                        name: foundry.utils.escapeHTML(filterGroup.name),
                        count: currentByUuid.size
                    }
                )}</p>`,
                rejectClose: false,
                modal: true
            });

            if (!confirmed)
                return;

            await TableProfileStorageService.updateFilterGroupMatches(
                profileId,
                filterGroupId,
                currentByUuid.keys(),
                filters
            );

            ui.notifications.info(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupRefreshed"
                )
            );

            this.render({ force: true });
            this._refreshApplicationsForFilterGroup(filterGroupId);
            return;
        }

        const previous = new Set(filterGroup.matches);
        const added = [...currentByUuid.values()].filter(
            candidate => !previous.has(candidate.uuid)
        );
        const removedUuids = [...previous].filter(
            uuid => !currentByUuid.has(uuid)
        );

        if (added.length === 0 && removedUuids.length === 0) {
            await TableProfileStorageService.updateFilterGroupMatches(
                profileId,
                filterGroupId,
                currentByUuid.keys(),
                filters
            );

            ui.notifications.info(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.NoFilterGroupChanges"
                )
            );
            return;
        }

        const addedEntries = await prepareDnd5eDocumentEntries(
            added.map(candidate => candidate.uuid)
        );
        const removedEntries = await prepareDnd5eDocumentEntries(
            removedUuids
        );

        const addedHtml = added.length
            ? renderRefreshDocumentList(
                getRefreshSectionTitle(
                    "NewMatches",
                    added.length
                ),
                added.length,
                addedEntries
            )
            : "";

        const removedHtml = removedUuids.length
            ? renderRefreshDocumentList(
                getRefreshSectionTitle(
                    "RemovedMatches",
                    removedUuids.length
                ),
                removedUuids.length,
                removedEntries
            )
            : "";

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            classes: TABLE_DIALOG_CLASSES,
            window: {
                title: game.i18n.format(
                    "COMPENDIUM_CURATOR.RefreshFilterGroupTitle",
                    { name: filterGroup.name }
                )
            },
            position: { width: 650 },
            content: `
                <div class="dnd5e2 cc-table-filter-refresh-preview">
                    ${addedHtml}
                    ${removedHtml}
                </div>
            `,
            render: (_event, dialog) => {
                activateDnd5eDocumentEntries(dialog.window.content);
            },
            rejectClose: false,
            modal: true
        });

        if (!confirmed)
            return;

        await TableProfileStorageService.updateFilterGroupMatches(
            profileId,
            filterGroupId,
            currentByUuid.keys(),
            filters
        );

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupRefreshed"
            )
        );

        this.render({ force: true });
        this._refreshApplicationsForFilterGroup(filterGroupId);
    }

    static async #onEditFilterGroup(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const filterGroupId = target
            .closest("[data-filter-group-id]")
            ?.dataset?.filterGroupId;

        if (!filterGroupId)
            return;

        const filterGroup =
            TableProfileStorageService
                .getFilterGroup(filterGroupId);

        if (!filterGroup?.browser) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNotFound"
                )
            );
            return;
        }

        if (this._filterCriteriaEditor?.rendered) {
            if (
                this._filterCriteriaEditor
                    .filterGroupId ===
                filterGroupId
            ) {
                this._filterCriteriaEditor
                    .bringToFront();
                return;
            }

            await this._filterCriteriaEditor.close();
        }

        const loaded =
            await TableProfileService
                .loadBrowserFilters(
                    this.browserApp,
                    filterGroup.browser
                );

        if (loaded === null)
            return;

        if (loaded === false) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupFiltersLoadFailed"
                )
            );
            return;
        }

        this._filterCriteriaEditor =
            new TableFilterGroupApplication(
                this.browserApp,
                this,
                null,
                {
                    editFilterGroupId:
                        filterGroupId
                }
            );

        this.browserApp
            ._ccFilterGroupCriteriaEditor =
                this._filterCriteriaEditor;

        this._filterCriteriaEditor.render({
            force: true
        });
    }

    static async #onLoadFilterGroup(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const filterGroupId = target
            .closest("[data-filter-group-id]")
            ?.dataset?.filterGroupId;

        if (!filterGroupId)
            return;

        const filterGroup =
            TableProfileStorageService.getFilterGroup(filterGroupId);

        if (!filterGroup?.browser) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNotFound"
                )
            );
            return;
        }

        const loaded = await TableProfileService.loadBrowserFilters(
            this.browserApp,
            filterGroup.browser
        );

        if (loaded === null)
            return;

        if (loaded === false) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupFiltersLoadFailed"
                )
            );
            return;
        }

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupFiltersLoaded"
            )
        );
    }

    static async #onUnlinkFilterGroup(event, target) {
        event.preventDefault();
        event.stopPropagation();

        const profileElement = target.closest(
            "[data-profile-id]"
        );
        const filterGroupElement = target.closest(
            "[data-filter-group-id]"
        );

        const profileId = profileElement?.dataset?.profileId;
        const filterGroupId = filterGroupElement?.dataset?.filterGroupId;

        if (!profileId || !filterGroupId)
            return;

        const profile =
            TableProfileStorageService.getProfiles()?.[profileId];
        const filterGroup =
            TableProfileStorageService.getFilterGroup(filterGroupId);

        if (!profile || !filterGroup)
            return;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            classes: TABLE_DIALOG_CLASSES,
            window: {
                title: game.i18n.localize(
                    "COMPENDIUM_CURATOR.UnlinkFilterGroup"
                )
            },
            content: `<p>${game.i18n.format(
                "COMPENDIUM_CURATOR.UnlinkFilterGroupConfirm",
                {
                    name: foundry.utils.escapeHTML(filterGroup.name),
                    profile: foundry.utils.escapeHTML(profile.name)
                }
            )}</p>`,
            rejectClose: false,
            modal: true
        });

        if (!confirmed)
            return;

        await TableProfileStorageService.removeFilterGroup(
            profileId,
            filterGroupId
        );

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupUnlinked"
            )
        );

        this.render({ force: true });

        const applications = [
            this._profilePreview,
            this._profileExclusions
        ];

        for (const application of applications) {
            if (
                application?.rendered &&
                application.profileId === profileId
            ) {
                application.render({ force: true });
            }
        }

        if (
            this._filterGroupDetails?.rendered &&
            this._filterGroupDetails.filterGroupId === filterGroupId
        ) {
            this._filterGroupDetails.render({ force: true });
        }
    }
}
