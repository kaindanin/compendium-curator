import {
    TableManagerApplication
} from "../applications/table-manager-application.js";
import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";
import {
    getActiveTableChildren
} from "./table-profile-relations-service.js";
import {
    activateDnd5eDocumentEntries,
    getDnd5eDistributionIndexEntry
} from "../ui/dnd5e-document-list.js";

const PATCH_FLAG = Symbol.for(
    "compendium-curator.table-manager-recursive-preview"
);
const PREVIEW_LIMIT = 150;

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

function escape(value) {
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

function sortByName(entries) {
    return [...entries].sort((a, b) =>
        String(a?.name ?? "").localeCompare(
            String(b?.name ?? ""),
            game.i18n.lang,
            { sensitivity: "base" }
        )
    );
}

function getOwnActiveEntries(inspector) {
    if (!inspector)
        return [];

    return (inspector.groups ?? [])
        .filter(group =>
            !inspector.isGrouped ||
            group.enabled !== false
        )
        .flatMap(group =>
            group.allEntries ??
            group.entries ??
            []
        );
}

function mergeOrigins(target, source) {
    for (const origin of source ?? []) {
        if (origin)
            target.add(origin);
    }
}

function dedupeEntries(entries) {
    const deduped = new Map();

    for (const entry of entries) {
        const uuid = String(
            entry?.uuid ?? ""
        ).trim();

        if (!uuid)
            continue;

        const origins = new Set(
            entry.origins ?? []
        );
        const existing = deduped.get(uuid);

        if (existing) {
            mergeOrigins(
                existing.origins,
                origins
            );
            continue;
        }

        deduped.set(uuid, {
            ...entry,
            uuid,
            origins
        });
    }

    return sortByName(
        [...deduped.values()].map(entry => ({
            ...entry,
            originLabel:
                [...entry.origins].join(" · ")
        }))
    );
}

function collectProfileLeaves(
    profileId,
    profiles,
    contextById,
    pathNames,
    activePath = new Set()
) {
    const id = String(profileId ?? "").trim();

    if (!id || activePath.has(id))
        return [];

    const profile = profiles?.[id];

    if (!profile)
        return [];

    const nextPath = new Set(activePath);
    nextPath.add(id);

    const profileContext = contextById.get(id);
    const pathLabel = pathNames.join(" → ");
    const ownEntries = getOwnActiveEntries(
        profileContext?.inspector
    ).map(entry => ({
        ...entry,
        origins: [pathLabel]
    }));
    const descendants = [];

    for (
        const relation
        of getActiveTableChildren(
            profile,
            profiles
        )
    ) {
        const child =
            profiles?.[relation.profileId];

        if (!child)
            continue;

        descendants.push(
            ...collectProfileLeaves(
                child.id,
                profiles,
                contextById,
                [
                    ...pathNames,
                    child.name
                ],
                nextPath
            )
        );
    }

    return [
        ...ownEntries,
        ...descendants
    ];
}

function getGroupingCriterion(profile, inspector) {
    return String(
        inspector?.groupingCriterion ??
        profile?.distribution
            ?.grouped
            ?.grouping
            ?.criterion ??
        "rarity"
    );
}

function getGroupingRanges(profile, criterion) {
    const grouped =
        profile?.distribution?.grouped;
    const activeCriterion = String(
        grouped?.grouping?.criterion ??
        "rarity"
    );
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

function getRangeKey(value, profile, criterion) {
    if (value === null)
        return "unclassified";

    const range = getGroupingRanges(
        profile,
        criterion
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
            value >= min &&
            (
                max === null ||
                (
                    Number.isFinite(max) &&
                    value <= max
                )
            )
        );
    });

    return range?.key ?? "unclassified";
}

function getDocumentSource(document, entry) {
    const source = document?.system?.source;

    if (typeof source === "string") {
        return source.trim() ||
            entry?.source ||
            "unclassified";
    }

    const value = String(
        source?.value ??
        source?.book ??
        source?.label ??
        entry?.source ??
        ""
    ).trim();

    return value || "unclassified";
}

function normalizePrice(document) {
    const price = document?.system?.price;
    const value = Number(price?.value);
    const denomination = String(
        price?.denomination ?? ""
    ).trim();
    const conversion = Number(
        CONFIG.DND5E?.currencies?.[
            denomination
        ]?.conversion
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

function getManualGroupKey(uuid, profile) {
    const groups =
        profile?.distribution
            ?.grouped
            ?.manualGroups;

    if (!Array.isArray(groups))
        return "unclassified";

    return groups.find(group =>
        Array.isArray(group?.members) &&
        group.members.includes(uuid)
    )?.key ?? "unclassified";
}

function getGroupingKey(entry, profile, criterion) {
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
        return getDocumentSource(
            document,
            entry
        );
    }

    if (criterion === "price") {
        return getRangeKey(
            normalizePrice(document),
            profile,
            "price"
        );
    }

    if (criterion === "cr") {
        return getRangeKey(
            normalizeChallengeRating(
                document?.system?.details?.cr
            ),
            profile,
            "cr"
        );
    }

    if (criterion === "spellLevel") {
        const level = normalizeNumber(
            document?.system?.level
        );

        return getRangeKey(
            level !== null && level >= 0
                ? level
                : null,
            profile,
            "spellLevel"
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
            document?.system?.traits?.size ?? ""
        ).trim() || "unclassified";
    }

    if (criterion === "spellSchool") {
        return String(
            document?.system?.school ?? ""
        ).trim() || "unclassified";
    }

    if (criterion === "manual") {
        return getManualGroupKey(
            entry.uuid,
            profile
        );
    }

    return String(
        document?.system?.rarity ?? ""
    ).trim() || "mundane";
}

function getConfigLabel(collection, key) {
    const config = collection?.[key];
    const raw =
        typeof config === "string"
            ? config
            : config?.label;

    return raw
        ? localizeMaybe(raw)
        : key;
}

function getCriterionLabel(criterion) {
    const keys = {
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
    const key = keys[criterion] ??
        "GroupByRarity";

    return game.i18n.localize(
        `COMPENDIUM_CURATOR.${key}`
    );
}

function formatRangeValue(value) {
    const number = Number(value);

    if (!Number.isFinite(number))
        return "";

    return new Intl.NumberFormat(
        game.i18n.lang,
        { maximumFractionDigits: 3 }
    ).format(number);
}

function getRangeLabel(key, profile, criterion) {
    const range = getGroupingRanges(
        profile,
        criterion
    ).find(candidate =>
        candidate?.key === key
    );

    if (!range)
        return key;

    const criterionLabel =
        getCriterionLabel(criterion);
    const min = Number(range.min);
    const rawMax = range.max;

    if (!Number.isFinite(min))
        return criterionLabel;

    if (
        rawMax === null ||
        rawMax === undefined ||
        rawMax === ""
    ) {
        return `${criterionLabel} ${formatRangeValue(min)}+`;
    }

    const max = Number(rawMax);

    if (!Number.isFinite(max))
        return criterionLabel;

    return min === max
        ? `${criterionLabel} ${formatRangeValue(min)}`
        : `${criterionLabel} ${formatRangeValue(min)}–${formatRangeValue(max)}`;
}

function getGroupingLabel(key, profile, criterion) {
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

    if (
        criterion === "price" ||
        criterion === "cr" ||
        criterion === "spellLevel"
    ) {
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

        return getRangeLabel(
            key,
            profile,
            criterion
        );
    }

    if (criterion === "creatureType") {
        if (key === "unclassified") {
            return game.i18n.localize(
                "COMPENDIUM_CURATOR.GroupNoCreatureType"
            );
        }

        if (key.startsWith("custom:")) {
            return key.slice("custom:".length);
        }

        return getConfigLabel(
            CONFIG.DND5E?.creatureTypes,
            key
        );
    }

    if (criterion === "size") {
        return key === "unclassified"
            ? game.i18n.localize(
                "COMPENDIUM_CURATOR.GroupNoSize"
            )
            : getConfigLabel(
                CONFIG.DND5E?.actorSizes,
                key
            );
    }

    if (criterion === "spellSchool") {
        return key === "unclassified"
            ? game.i18n.localize(
                "COMPENDIUM_CURATOR.GroupNoSpellSchool"
            )
            : getConfigLabel(
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

function orderGroupKeys(keys, profile, criterion) {
    const keySet = new Set(keys);

    if (criterion === "rarity") {
        return [
            ...RARITY_ORDER.filter(key =>
                keySet.has(key)
            ),
            ...keys.filter(key =>
                !RARITY_ORDER.includes(key)
            ).sort()
        ];
    }

    if (
        criterion === "price" ||
        criterion === "cr" ||
        criterion === "spellLevel"
    ) {
        const configured =
            getGroupingRanges(
                profile,
                criterion
            ).map(range => range.key);
        const ordered = configured.filter(key =>
            keySet.has(key)
        );

        if (keySet.has("unclassified"))
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
        const ordered = configured.filter(key =>
            keySet.has(key)
        );

        if (keySet.has("unclassified"))
            ordered.push("unclassified");

        ordered.push(
            ...keys.filter(key =>
                !ordered.includes(key)
            ).sort()
        );

        return ordered;
    }

    return [...keys].sort((a, b) =>
        getGroupingLabel(
            a,
            profile,
            criterion
        ).localeCompare(
            getGroupingLabel(
                b,
                profile,
                criterion
            ),
            game.i18n.lang,
            { sensitivity: "base" }
        )
    );
}

function buildMixedGroups(
    entries,
    profile,
    inspector
) {
    if (!inspector?.isGrouped) {
        return [{
            key: "all",
            label: text(
                "Todos los objetos",
                "All objects"
            ),
            entries,
            count: entries.length
        }];
    }

    const criterion = getGroupingCriterion(
        profile,
        inspector
    );
    const grouped = new Map();

    for (const entry of entries) {
        const key = getGroupingKey(
            entry,
            profile,
            criterion
        );
        const current = grouped.get(key) ?? [];

        current.push(entry);
        grouped.set(key, current);
    }

    return orderGroupKeys(
        [...grouped.keys()],
        profile,
        criterion
    ).map(key => ({
        key,
        label: getGroupingLabel(
            key,
            profile,
            criterion
        ),
        entries: sortByName(
            grouped.get(key) ?? []
        ),
        count:
            grouped.get(key)?.length ?? 0
    }));
}

function buildRecursivePreview(
    profileContext,
    profile,
    profiles,
    contextById
) {
    const inspector = profileContext.inspector;
    const ownName = text(
        "Contenido propio",
        "Own content"
    );
    const ownEntries = dedupeEntries(
        getOwnActiveEntries(inspector)
            .map(entry => ({
                ...entry,
                origins: [ownName]
            }))
    );
    const tableGroups = [];
    const linkedEntries = [];
    const activeChildren =
        getActiveTableChildren(
            profile,
            profiles
        );

    if (ownEntries.length) {
        tableGroups.push({
            key: `own:${profile.id}`,
            label: ownName,
            entries: ownEntries,
            count: ownEntries.length,
            own: true,
            weight: null
        });
    }

    for (const relation of activeChildren) {
        const child =
            profiles?.[relation.profileId];

        if (!child)
            continue;

        const branchEntries = dedupeEntries(
            collectProfileLeaves(
                child.id,
                profiles,
                contextById,
                [child.name]
            )
        );

        tableGroups.push({
            key: `table:${child.id}`,
            label: child.name,
            entries: branchEntries,
            count: branchEntries.length,
            own: false,
            weight: relation.weight
        });
        linkedEntries.push(...branchEntries);
    }

    const uniqueLinkedEntries =
        dedupeEntries(linkedEntries);
    const allEntries = dedupeEntries([
        ...ownEntries,
        ...linkedEntries
    ]);
    const criterion =
        getGroupingCriterion(
            profile,
            inspector
        );

    return {
        hasLinkedTables:
            activeChildren.length > 0,
        ownCount: ownEntries.length,
        linkedCount:
            uniqueLinkedEntries.length,
        finalCount: allEntries.length,
        linkedTableCount:
            activeChildren.length,
        criterion,
        criterionLabel:
            getCriterionLabel(criterion),
        isGrouped:
            inspector?.isGrouped === true,
        tableGroups,
        mixedGroups: buildMixedGroups(
            allEntries,
            profile,
            inspector
        )
    };
}

function patchPrepareContext() {
    const prototype =
        TableManagerApplication.prototype;

    if (prototype[PATCH_FLAG])
        return;

    const original =
        prototype._prepareContext;

    if (typeof original !== "function")
        return;

    prototype._prepareContext =
        async function recursivePreviewPrepareContext(
            options
        ) {
            const context =
                await original.call(
                    this,
                    options
                );

            this._ccRecursivePreviewData =
                new Map();

            if (
                this._activeTab === "filters" ||
                !Array.isArray(context?.profiles)
            ) {
                return context;
            }

            const profiles =
                TableProfileStorageService
                    .getProfiles();
            const contextById = new Map(
                context.profiles
                    .filter(profile =>
                        profile?.id
                    )
                    .map(profile => [
                        profile.id,
                        profile
                    ])
            );

            for (
                const profileContext
                of context.profiles
            ) {
                if (
                    !profileContext?.id ||
                    !profileContext.inspector
                ) {
                    continue;
                }

                const profile =
                    profiles?.[
                        profileContext.id
                    ];

                if (!profile)
                    continue;

                const preview =
                    buildRecursivePreview(
                        profileContext,
                        profile,
                        profiles,
                        contextById
                    );

                if (!preview.hasLinkedTables)
                    continue;

                this._ccRecursivePreviewData.set(
                    profile.id,
                    preview
                );
            }

            return context;
        };

    Object.defineProperty(
        prototype,
        PATCH_FLAG,
        {
            value: true,
            configurable: false
        }
    );
}

function renderEntry(entry) {
    const subtitle = localizeMaybe(
        entry.subtitle
    );
    const origin = String(
        entry.originLabel ?? ""
    ).trim();
    const source = String(
        entry.source ?? ""
    ).trim();

    return `
        <li
            class="item cc-dnd5e-document-entry"
            data-uuid="${escape(entry.uuid)}"
        >
            <div class="item-row">
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
                                src="${escape(entry.img)}"
                                alt="${escape(entry.name)}"
                                draggable="false"
                            >
                        `
                        : ""
                    }

                    <div class="name name-stacked">
                        <span class="title">
                            ${escape(entry.name)}
                        </span>
                        ${subtitle
                            ? `
                                <span class="subtitle">
                                    ${escape(subtitle)}
                                </span>
                            `
                            : ""
                        }
                        ${origin
                            ? `
                                <span class="subtitle">
                                    <i class="fas fa-table-list" aria-hidden="true"></i>
                                    ${escape(origin)}
                                </span>
                            `
                            : ""
                        }
                    </div>
                </div>

                <div class="item-detail item-source ${source ? "" : "empty"}">
                    ${source
                        ? `<span class="condensed">${escape(source)}</span>`
                        : ""
                    }
                </div>

                <div class="item-detail item-controls"></div>
            </div>
        </li>
    `;
}

function renderGroup(group, showWeight) {
    const previewEntries =
        group.entries.slice(0, PREVIEW_LIMIT);
    const truncated =
        group.count > previewEntries.length;
    const weight =
        showWeight &&
        Number.isFinite(Number(group.weight))
            ? `
                <span class="hint">
                    ${escape(text("Peso", "Weight"))}:
                    ${escape(group.weight)}
                </span>
            `
            : "";

    return `
        <details
            style="
                background: rgb(0 0 0 / 12%);
                border-radius: 5px;
            "
        >
            <summary
                style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 1rem;
                    padding: 0.5rem 0.65rem;
                    cursor: pointer;
                    list-style: none;
                "
            >
                <span>
                    <i class="fas fa-chevron-down"></i>
                    ${escape(group.label)}
                </span>

                <span
                    style="
                        display: flex;
                        align-items: center;
                        gap: 0.65rem;
                    "
                >
                    ${weight}
                    <strong>${group.count}</strong>
                </span>
            </summary>

            <div style="padding: 0 0.55rem 0.55rem;">
                ${previewEntries.length
                    ? `
                        <section class="inventory-element cc-dnd5e-document-list">
                            <section class="items-list browser-results">
                                <div class="items-section card">
                                    <ol
                                        class="item-list unlist"
                                        style="
                                            max-height: 260px;
                                            overflow-y: auto;
                                        "
                                    >
                                        ${previewEntries
                                            .map(renderEntry)
                                            .join("")}
                                    </ol>
                                </div>
                            </section>
                        </section>
                    `
                    : `
                        <p class="hint" style="margin:0.5rem 0;">
                            ${escape(text(
                                "Esta tabla no aporta objetos activos.",
                                "This table has no active objects."
                            ))}
                        </p>
                    `
                }

                ${truncated
                    ? `
                        <p
                            class="hint"
                            style="
                                margin: 0.4rem 0 0;
                                text-align: right;
                            "
                        >
                            ${escape(text("Vista previa", "Preview"))}:
                            ${previewEntries.length} / ${group.count}
                        </p>
                    `
                    : ""
                }
            </div>
        </details>
    `;
}

function renderPreviewBlock(preview, mode) {
    const mixedLabel = preview.isGrouped
        ? text(
            `Mezclar · ${preview.criterionLabel}`,
            `Mix · ${preview.criterionLabel}`
        )
        : text(
            "Mezclar todos los objetos",
            "Mix all objects"
        );

    return `
        <div
            class="cc-table-filter-detail-block"
            data-cc-recursive-content-preview
        >
            <div class="cc-table-filter-detail-heading">
                <strong>
                    ${escape(text(
                        "Contenido resultante",
                        "Resulting content"
                    ))}
                </strong>
            </div>

            <p class="hint" style="margin:0 0 0.65rem;">
                ${escape(text(
                    "Incluye los objetos propios y los de todas las tablas enlazadas de forma recursiva.",
                    "Includes own objects and objects from all recursively linked tables."
                ))}
            </p>

            <div
                style="
                    display:grid;
                    grid-template-columns:minmax(140px, 1fr) minmax(190px, 1.3fr);
                    gap:0.55rem 0.8rem;
                    align-items:center;
                    margin-bottom:0.65rem;
                "
            >
                <label>
                    ${escape(text("Vista", "View"))}
                </label>

                <select data-cc-recursive-preview-mode>
                    <option
                        value="table"
                        ${mode === "table" ? "selected" : ""}
                    >
                        ${escape(text(
                            "Separar por tabla directa",
                            "Separate by direct table"
                        ))}
                    </option>
                    <option
                        value="distribution"
                        ${mode === "distribution" ? "selected" : ""}
                    >
                        ${escape(mixedLabel)}
                    </option>
                </select>
            </div>

            <p class="hint" style="margin:0 0 0.65rem;">
                ${escape(text("Propios", "Own"))}: ${preview.ownCount}
                · ${escape(text("De otras tablas", "From other tables"))}: ${preview.linkedCount}
                · <strong>${escape(text("Total", "Total"))}: ${preview.finalCount}</strong>
            </p>

            <div
                data-cc-recursive-preview-view="table"
                ${mode === "table" ? "" : "hidden"}
                style="display:flex;flex-direction:column;gap:0.55rem;"
            >
                ${preview.tableGroups
                    .map(group =>
                        renderGroup(
                            group,
                            !group.own
                        )
                    )
                    .join("")}
            </div>

            <div
                data-cc-recursive-preview-view="distribution"
                ${mode === "distribution" ? "" : "hidden"}
                style="display:flex;flex-direction:column;gap:0.55rem;"
            >
                ${preview.mixedGroups
                    .map(group =>
                        renderGroup(group, false)
                    )
                    .join("")}
            </div>
        </div>
    `;
}

function syncPreviewMode(
    profileRow,
    mode
) {
    for (
        const view
        of profileRow.querySelectorAll(
            "[data-cc-recursive-preview-view]"
        )
    ) {
        view.hidden =
            view.dataset.ccRecursivePreviewView !==
            mode;
    }
}

function updateInspectorCount(
    inspector,
    count
) {
    const summaryCount =
        inspector.querySelector(
            ".cc-table-content-object-count"
        );

    if (summaryCount) {
        summaryCount.textContent =
            game.i18n.format(
                "COMPENDIUM_CURATOR.GroupObjectCount",
                { count }
            );
    }

    const finalCount =
        inspector.querySelector(
            ".cc-table-filter-group-matches-title strong"
        );

    if (finalCount) {
        finalCount.textContent =
            String(count);
    }
}

function renderRecursivePreviews(
    application,
    element
) {
    const previews =
        application._ccRecursivePreviewData;

    if (!(previews instanceof Map))
        return;

    application._ccRecursivePreviewModes ??=
        new Map();

    for (const [profileId, preview] of previews) {
        const profileRow = element.querySelector(
            `[data-profile-id="${CSS.escape(profileId)}"]`
        );
        const inspector =
            profileRow?.matches(
                "details[data-cc-content-inspector]"
            )
                ? profileRow
                : profileRow?.querySelector(
                    "details[data-cc-content-inspector]"
                );

        if (!profileRow || !inspector)
            continue;

        updateInspectorCount(
            inspector,
            preview.finalCount
        );

        inspector.querySelector(
            "[data-cc-recursive-content-preview]"
        )?.remove();

        const finalObjectsHeading =
            inspector.querySelector(
                ".cc-table-filter-group-matches-title"
            );

        if (!finalObjectsHeading)
            continue;

        const mode =
            application._ccRecursivePreviewModes
                .get(profileId) ??
            "table";
        const wrapper =
            document.createElement("div");

        wrapper.innerHTML =
            renderPreviewBlock(
                preview,
                mode
            ).trim();

        const block =
            wrapper.firstElementChild;

        if (!block)
            continue;

        finalObjectsHeading.insertAdjacentElement(
            "afterend",
            block
        );

        const select = block.querySelector(
            "[data-cc-recursive-preview-mode]"
        );

        select?.addEventListener(
            "change",
            () => {
                const nextMode =
                    select.value === "distribution"
                        ? "distribution"
                        : "table";

                application._ccRecursivePreviewModes
                    .set(
                        profileId,
                        nextMode
                    );
                syncPreviewMode(
                    profileRow,
                    nextMode
                );
            }
        );

        activateDnd5eDocumentEntries(block);
    }
}

export function registerTableManagerRecursivePreview() {
    patchPrepareContext();

    Hooks.on(
        "renderTableManagerApplication",
        (application, element) => {
            if (!game.user.can("SETTINGS_MODIFY"))
                return;

            renderRecursivePreviews(
                application,
                element
            );
        }
    );
}
