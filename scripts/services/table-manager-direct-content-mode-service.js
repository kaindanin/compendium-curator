import {
    MODULE_ID,
    TABLE_PROFILES_SETTING
} from "../settings.js";
import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";
import {
    StorageService
} from "./storage-service.js";
import {
    activateDnd5eDocumentEntries,
    getDnd5eDistributionIndexEntry,
    prepareDnd5eIndexedEntries
} from "../ui/dnd5e-document-list.js";

const DIRECT_MODE = "direct";
const PREVIEW_LIMIT = 150;
const CRITERIA = [
    "rarity", "type", "source", "price", "cr",
    "spellLevel", "creatureType", "size", "spellSchool", "manual"
];
const RARITY_ORDER = [
    "mundane", "common", "uncommon", "rare",
    "veryRare", "legendary", "artifact"
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
    return game.i18n.lang.startsWith("es") ? es : en;
}

function esc(value) {
    return foundry.utils.escapeHTML(String(value ?? ""));
}

function localizeMaybe(value) {
    const key = String(value ?? "").trim();
    return key && game.i18n.has(key) ? game.i18n.localize(key) : key;
}

function sortEntries(entries) {
    return [...entries].sort((a, b) =>
        String(a?.name ?? "").localeCompare(
            String(b?.name ?? ""), game.i18n.lang, { sensitivity: "base" }
        )
    );
}

function dedupe(entries) {
    const map = new Map();
    for (const entry of entries ?? []) {
        const uuid = String(entry?.uuid ?? "").trim();
        if (!uuid) continue;
        const current = map.get(uuid);
        if (current) {
            const origins = new Set([
                ...(current.origins ?? []), ...(entry.origins ?? [])
            ]);
            current.origins = [...origins].filter(Boolean);
            current.originLabel = current.origins.join(" · ");
            continue;
        }
        const origins = [...new Set(entry.origins ?? [])].filter(Boolean);
        map.set(uuid, {
            ...entry,
            uuid,
            origins,
            originLabel: origins.join(" · ")
        });
    }
    return sortEntries([...map.values()]);
}

function criterionLabel(criterion) {
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
    return game.i18n.localize(
        `COMPENDIUM_CURATOR.${keys[criterion] ?? "GroupByRarity"}`
    );
}

function profileCriterion(profile) {
    const value = String(
        profile?.distribution?.grouped?.grouping?.criterion ?? "rarity"
    );
    return CRITERIA.includes(value) ? value : "rarity";
}

function ranges(profile, criterion) {
    const grouped = profile?.distribution?.grouped;
    const value = profileCriterion(profile) === criterion
        ? grouped?.grouping?.ranges
        : grouped?.configurations?.[criterion]?.ranges;
    return Array.isArray(value) ? value : [];
}

function number(value) {
    const parsed = Number(String(value ?? "").trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
}

function challengeRating(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value >= 0 ? value : null;
    const raw = String(value ?? "").trim();
    const fraction = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (fraction) {
        const top = Number(fraction[1]);
        const bottom = Number(fraction[2]);
        return Number.isFinite(top) && bottom > 0 ? top / bottom : null;
    }
    const parsed = number(raw);
    return parsed !== null && parsed >= 0 ? parsed : null;
}

function rangeKey(value, profile, criterion) {
    if (value === null) return "unclassified";
    return ranges(profile, criterion).find(range => {
        const min = Number(range?.min);
        const rawMax = range?.max;
        const max = rawMax === null || rawMax === undefined || rawMax === ""
            ? null
            : Number(rawMax);
        return Number.isFinite(min) && value >= min &&
            (max === null || (Number.isFinite(max) && value <= max));
    })?.key ?? "unclassified";
}

function basePrice(document) {
    const price = document?.system?.price;
    const value = Number(price?.value);
    const denomination = String(price?.denomination ?? "").trim();
    const conversion = Number(
        CONFIG.DND5E?.currencies?.[denomination]?.conversion
    );
    return Number.isFinite(value) && value >= 0 &&
        Number.isFinite(conversion) && conversion > 0
        ? value / conversion
        : null;
}

function sourceValue(document, entry) {
    const source = document?.system?.source;
    if (typeof source === "string")
        return source.trim() || entry?.source || "unclassified";
    return String(
        source?.value ?? source?.book ?? source?.label ?? entry?.source ?? ""
    ).trim() || "unclassified";
}

function groupKey(entry, profile, criterion) {
    const document = getDnd5eDistributionIndexEntry(entry.uuid);
    if (criterion === "type")
        return String(document?.type ?? "").trim() || "unclassified";
    if (criterion === "source") return sourceValue(document, entry);
    if (criterion === "price") return rangeKey(basePrice(document), profile, criterion);
    if (criterion === "cr")
        return rangeKey(challengeRating(document?.system?.details?.cr), profile, criterion);
    if (criterion === "spellLevel") {
        const level = number(document?.system?.level);
        return rangeKey(level !== null && level >= 0 ? level : null, profile, criterion);
    }
    if (criterion === "creatureType") {
        const type = document?.system?.details?.type;
        const value = String(
            typeof type === "string" ? type : type?.value ?? ""
        ).trim();
        if (!value) return "unclassified";
        if (value !== "custom") return value;
        const custom = String(type?.custom ?? "").trim();
        return custom ? `custom:${custom}` : "unclassified";
    }
    if (criterion === "size")
        return String(document?.system?.traits?.size ?? "").trim() || "unclassified";
    if (criterion === "spellSchool")
        return String(document?.system?.school ?? "").trim() || "unclassified";
    if (criterion === "manual") {
        return (profile?.distribution?.grouped?.manualGroups ?? [])
            .find(group => Array.isArray(group?.members) && group.members.includes(entry.uuid))
            ?.key ?? "unclassified";
    }
    return String(document?.system?.rarity ?? "").trim() || "mundane";
}

function configLabel(collection, key) {
    const config = collection?.[key];
    const raw = typeof config === "string" ? config : config?.label;
    return raw ? localizeMaybe(raw) : key;
}

function rangeLabel(key, profile, criterion) {
    const range = ranges(profile, criterion).find(candidate => candidate?.key === key);
    if (!range) return key;
    const format = value => new Intl.NumberFormat(
        game.i18n.lang, { maximumFractionDigits: 3 }
    ).format(value);
    const min = Number(range.min);
    const rawMax = range.max;
    const max = rawMax === null || rawMax === undefined || rawMax === ""
        ? null
        : Number(rawMax);
    const label = criterionLabel(criterion);
    if (!Number.isFinite(min)) return label;
    if (max === null) return `${label} ${format(min)}+`;
    if (!Number.isFinite(max)) return label;
    return min === max
        ? `${label} ${format(min)}`
        : `${label} ${format(min)}–${format(max)}`;
}

function groupLabel(key, profile, criterion) {
    if (criterion === "rarity") {
        const label = RARITY_LABELS[key];
        return label
            ? game.i18n.localize(`COMPENDIUM_CURATOR.${label}`)
            : key;
    }
    if (criterion === "type") {
        if (key === "unclassified")
            return game.i18n.localize("COMPENDIUM_CURATOR.GroupUnclassified");
        const systemType = CONFIG.DND5E?.itemTypes?.[key];
        const raw = [
            CONFIG.Item?.typeLabels?.[key],
            CONFIG.Actor?.typeLabels?.[key],
            typeof systemType === "string" ? systemType : systemType?.label
        ].find(value => typeof value === "string" && value.trim());
        return raw ? localizeMaybe(raw) : key;
    }
    if (criterion === "source")
        return key === "unclassified"
            ? game.i18n.localize("COMPENDIUM_CURATOR.GroupNoSource")
            : key;
    if (["price", "cr", "spellLevel"].includes(criterion)) {
        if (key === "unclassified") {
            const suffix = criterion === "price"
                ? "GroupNoPrice"
                : criterion === "cr"
                    ? "GroupNoChallengeRating"
                    : "GroupNoSpellLevel";
            return game.i18n.localize(`COMPENDIUM_CURATOR.${suffix}`);
        }
        return rangeLabel(key, profile, criterion);
    }
    if (criterion === "creatureType") {
        if (key === "unclassified")
            return game.i18n.localize("COMPENDIUM_CURATOR.GroupNoCreatureType");
        if (key.startsWith("custom:")) return key.slice("custom:".length);
        return configLabel(CONFIG.DND5E?.creatureTypes, key);
    }
    if (criterion === "size")
        return key === "unclassified"
            ? game.i18n.localize("COMPENDIUM_CURATOR.GroupNoSize")
            : configLabel(CONFIG.DND5E?.actorSizes, key);
    if (criterion === "spellSchool")
        return key === "unclassified"
            ? game.i18n.localize("COMPENDIUM_CURATOR.GroupNoSpellSchool")
            : configLabel(CONFIG.DND5E?.spellSchools, key);
    if (criterion === "manual") {
        if (key === "unclassified")
            return game.i18n.localize("COMPENDIUM_CURATOR.GroupNoManualGroup");
        return (profile?.distribution?.grouped?.manualGroups ?? [])
            .find(group => group?.key === key)?.name ?? key;
    }
    return key;
}

function orderedKeys(keys, profile, criterion) {
    const set = new Set(keys);
    if (criterion === "rarity") {
        return [
            ...RARITY_ORDER.filter(key => set.has(key)),
            ...keys.filter(key => !RARITY_ORDER.includes(key)).sort()
        ];
    }
    if (["price", "cr", "spellLevel"].includes(criterion)) {
        const configured = ranges(profile, criterion).map(range => range.key);
        const ordered = configured.filter(key => set.has(key));
        if (set.has("unclassified")) ordered.push("unclassified");
        ordered.push(...keys.filter(key => !ordered.includes(key)).sort());
        return ordered;
    }
    if (criterion === "manual") {
        const configured = (profile?.distribution?.grouped?.manualGroups ?? [])
            .map(group => group.key);
        const ordered = configured.filter(key => set.has(key));
        if (set.has("unclassified")) ordered.push("unclassified");
        ordered.push(...keys.filter(key => !ordered.includes(key)).sort());
        return ordered;
    }
    return [...keys].sort((a, b) =>
        groupLabel(a, profile, criterion).localeCompare(
            groupLabel(b, profile, criterion),
            game.i18n.lang,
            { sensitivity: "base" }
        )
    );
}

function groupedEntries(entries, profile, criterion) {
    const byKey = new Map();
    for (const entry of entries) {
        const key = groupKey(entry, profile, criterion);
        const current = byKey.get(key) ?? [];
        current.push(entry);
        byKey.set(key, current);
    }
    return orderedKeys([...byKey.keys()], profile, criterion).map(key => ({
        key,
        label: groupLabel(key, profile, criterion),
        entries: sortEntries(byKey.get(key) ?? []),
        count: byKey.get(key)?.length ?? 0
    }));
}

function sourceCriterion(profile, sourceKey, sourceProfile = profile) {
    const stored = String(
        profile?.contentLayout?.sources?.[sourceKey]?.criterion ?? ""
    );
    return CRITERIA.includes(stored) ? stored : profileCriterion(sourceProfile);
}

function ownSources(profile, filterGroups) {
    const hidden = profile?.itemRules?.includeHidden === true
        ? new Set()
        : new Set(StorageService.getHiddenUuids());
    const excluded = new Set(profile?.manualExcludes ?? []);
    const excludeZeroPrice = profile?.itemRules?.excludeZeroPrice === true;
    const ids = [...new Set(profile.filterGroupIds ?? [])];
    const sources = [];

    const eligible = uuids => prepareDnd5eIndexedEntries(uuids)
        .filter(entry => entry.available !== false &&
            !hidden.has(entry.uuid) && !excluded.has(entry.uuid) &&
            (!excludeZeroPrice || entry.documentName !== "Item" || entry.hasPositivePrice));
    for (const id of ids) {
        const filterGroup = filterGroups?.[id];
        if (!filterGroup) continue;
        const entries = dedupe(
            eligible([
                ...(filterGroup.matches ?? []),
                ...(filterGroup.manualIncludes ?? [])
            ])
                .map(entry => ({
                    ...entry,
                    origins: [filterGroup.name]
                }))
        );
        const key = `filter:${id}`;
        const criterion = sourceCriterion(profile, key);
        sources.push({
            key,
            icon: "fas fa-filter",
            kind: text("Grupo", "Group"),
            name: filterGroup.name,
            entries,
            groups: groupedEntries(entries, profile, criterion),
            criterion,
            weight: null
        });
    }

    return sources;
}

function tableSources(profile, profiles, preview) {
    return (preview?.tableGroups ?? [])
        .filter(group => !group.own)
        .map(group => {
            const childId = String(group.key ?? "").replace(/^table:/, "");
            const child = profiles?.[childId];
            const key = `table:${childId}`;
            const criterion = sourceCriterion(profile, key, child ?? profile);
            const entries = dedupe(group.entries ?? []);
            return {
                key,
                icon: "fas fa-table-list",
                kind: text("Tabla", "Table"),
                name: child?.name ?? group.label,
                entries,
                groups: groupedEntries(entries, child ?? profile, criterion),
                criterion,
                weight: group.weight ?? 1
            };
        });
}

async function saveLayout(profileId, mutate) {
    const storage = foundry.utils.deepClone(
        TableProfileStorageService.getStorage()
    );
    const profile = storage.profiles?.[profileId];
    if (!profile || profile.type !== "content")
        throw new Error("TABLE_PROFILE_NOT_FOUND");

    const layout = profile.contentLayout &&
        typeof profile.contentLayout === "object" &&
        !Array.isArray(profile.contentLayout)
        ? foundry.utils.deepClone(profile.contentLayout)
        : { mode: null, sources: {} };
    layout.sources ??= {};
    const before = foundry.utils.deepClone(layout);
    mutate(layout, profile);
    if (foundry.utils.equals(before, layout)) return;

    profile.contentLayout = layout;
    profile.revision = Number(profile.revision ?? 1) + 1;
    await game.settings.set(MODULE_ID, TABLE_PROFILES_SETTING, storage);
}

async function saveMode(profileId, mode) {
    if (mode === DIRECT_MODE) {
        return saveLayout(profileId, layout => {
            layout.mode = DIRECT_MODE;
        });
    }
    if (!["individual", "grouped"].includes(mode)) return;

    const storage = foundry.utils.deepClone(
        TableProfileStorageService.getStorage()
    );
    const profile = storage.profiles?.[profileId];
    if (!profile || profile.type !== "content")
        throw new Error("TABLE_PROFILE_NOT_FOUND");

    const layout = profile.contentLayout &&
        typeof profile.contentLayout === "object" &&
        !Array.isArray(profile.contentLayout)
        ? foundry.utils.deepClone(profile.contentLayout)
        : { mode: null, sources: {} };
    const changed = layout.mode === DIRECT_MODE || profile.distribution?.mode !== mode;
    if (!changed) return;

    layout.mode = null;
    profile.contentLayout = layout;
    profile.distribution ??= {};
    profile.distribution.mode = mode;
    profile.revision = Number(profile.revision ?? 1) + 1;
    await game.settings.set(MODULE_ID, TABLE_PROFILES_SETTING, storage);
}

function updateCount(inspector, count) {
    const summary = inspector.querySelector(
        ".cc-table-content-object-count"
    );
    if (summary) {
        summary.textContent = game.i18n.format(
            "COMPENDIUM_CURATOR.GroupObjectCount", { count }
        );
    }
    const final = inspector.querySelector(
        ".cc-table-filter-group-matches-title strong"
    );
    if (final) final.textContent = String(count);
}

function renderEntry(entry) {
    const subtitle = localizeMaybe(entry.subtitle);
    const origin = String(entry.originLabel ?? "").trim();
    const source = String(entry.source ?? "").trim();
    return `
        <li class="item cc-dnd5e-document-entry" data-uuid="${esc(entry.uuid)}">
            <div class="item-row">
                <div class="item-name rollable" role="button" data-cc-open-document>
                    ${entry.img ? `<img class="item-image gold-icon" loading="lazy" src="${esc(entry.img)}" alt="${esc(entry.name)}" draggable="false">` : ""}
                    <div class="name name-stacked">
                        <span class="title">${esc(entry.name)}</span>
                        ${subtitle ? `<span class="subtitle">${esc(subtitle)}</span>` : ""}
                        ${origin ? `<span class="subtitle"><i class="fas fa-sitemap"></i> ${esc(origin)}</span>` : ""}
                    </div>
                </div>
                <div class="item-detail item-source ${source ? "" : "empty"}">
                    ${source ? `<span class="condensed">${esc(source)}</span>` : ""}
                </div>
                <div class="item-detail item-controls"></div>
            </div>
        </li>`;
}

function renderGroup(group) {
    const entries = group.entries.slice(0, PREVIEW_LIMIT);
    return `
        <details style="background:rgb(0 0 0 / 12%);border-radius:5px;">
            <summary style="display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:0.5rem 0.65rem;cursor:pointer;list-style:none;">
                <span><i class="fas fa-chevron-down"></i> ${esc(group.label)}</span>
                <strong>${group.count}</strong>
            </summary>
            <div style="padding:0 0.55rem 0.55rem;">
                ${entries.length ? `
                    <section class="inventory-element cc-dnd5e-document-list">
                        <section class="items-list browser-results">
                            <div class="items-section card">
                                <ol class="item-list unlist" style="max-height:260px;overflow-y:auto;">
                                    ${entries.map(renderEntry).join("")}
                                </ol>
                            </div>
                        </section>
                    </section>` : `<p class="hint">${esc(text("No hay objetos.", "No objects."))}</p>`}
                ${group.count > entries.length ? `<p class="hint" style="text-align:right;">${esc(text("Vista previa", "Preview"))}: ${entries.length} / ${group.count}</p>` : ""}
            </div>
        </details>`;
}

function criterionOptions(selected) {
    return CRITERIA.map(value =>
        `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(criterionLabel(value))}</option>`
    ).join("");
}

function renderSource(source) {
    const weight = source.weight === null
        ? ""
        : `<span class="hint">${esc(text("Peso", "Weight"))}: ${esc(source.weight)}</span>`;
    return `
        <details data-cc-direct-source="${esc(source.key)}" style="background:rgb(0 0 0 / 12%);border-radius:5px;">
            <summary style="display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:0.55rem 0.65rem;cursor:pointer;list-style:none;">
                <span><i class="fas fa-chevron-down"></i> <i class="${esc(source.icon)}"></i> <span class="hint">${esc(source.kind)}:</span> ${esc(source.name)}</span>
                <span style="display:flex;align-items:center;gap:0.65rem;">${weight}<strong>${source.entries.length}</strong></span>
            </summary>
            <div style="display:flex;flex-direction:column;gap:0.6rem;padding:0 0.55rem 0.55rem;">
                <div style="display:grid;grid-template-columns:minmax(140px,1fr) minmax(180px,1.3fr);gap:0.55rem 0.8rem;align-items:center;padding-top:0.55rem;">
                    <label>${esc(text("Agrupar por", "Group by"))}</label>
                    <select data-cc-direct-source-grouping data-source-key="${esc(source.key)}">
                        ${criterionOptions(source.criterion)}
                    </select>
                </div>
                <div style="display:flex;flex-direction:column;gap:0.55rem;">
                    ${source.groups.length
                        ? source.groups.map(renderGroup).join("")
                        : `<p class="hint">${esc(text("Este contenido no aporta objetos activos.", "This content has no active objects."))}</p>`}
                </div>
            </div>
        </details>`;
}

function replaceModeSelect(application, profileId, row, direct) {
    const original = row.querySelector("[data-cc-distribution-mode]");
    if (!original) return null;

    const replacement = original.cloneNode(false);
    const individual = original.querySelector('option[value="individual"]')
        ?.textContent?.trim() || text("Individual", "Individual");
    const grouped = original.querySelector('option[value="grouped"]')
        ?.textContent?.trim() || text("Por grupos", "Grouped");
    for (const [value, label] of [
        ["individual", individual],
        ["grouped", grouped],
        [DIRECT_MODE, text("Separar por contenido directo", "Separate by direct content")]
    ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        replacement.append(option);
    }
    replacement.value = direct ? DIRECT_MODE : original.value;
    original.replaceWith(replacement);

    replacement.addEventListener("change", async () => {
        replacement.disabled = true;
        try {
            await saveMode(profileId, replacement.value);
            await application.render({ force: true });
        }
        catch (error) {
            console.error(
                "Compendium Curator | Error cambiando el modo de distribución.", error
            );
            ui.notifications.error(text(
                "No se pudo cambiar el modo de distribución.",
                "The distribution mode could not be changed."
            ));
            replacement.disabled = false;
        }
    });
    return replacement;
}

function configureDirect(application, profile, profiles, filterGroups, row, preview, modeSelect) {
    const distribution = modeSelect?.closest(".cc-table-filter-detail-block");
    if (!distribution) return;

    const grid = modeSelect.parentElement;
    if (grid) [...grid.children].slice(2).forEach(element => element.hidden = true);
    const hint = distribution.querySelector(":scope > p.hint");
    if (hint) {
        hint.textContent = text(
            "El contenido se divide primero por sus grupos de filtros y tablas enlazadas. Cada bloque tiene su propia agrupación.",
            "Content is split first by its filter groups and linked tables. Each block has its own grouping."
        );
    }

    let sibling = distribution.nextElementSibling;
    while (sibling) {
        sibling.hidden = true;
        sibling = sibling.nextElementSibling;
    }

    const sources = [
        ...ownSources(profile, filterGroups),
        ...tableSources(profile, profiles, preview)
    ];
    const inspector = row.matches("details[data-cc-content-inspector]")
        ? row
        : row.querySelector("details[data-cc-content-inspector]");
    if (inspector) updateCount(
        inspector,
        dedupe(sources.flatMap(source => source.entries)).length
    );

    const wrapper = document.createElement("div");
    wrapper.dataset.ccDirectContent = "";
    wrapper.style.cssText = "display:flex;flex-direction:column;gap:0.55rem;";
    wrapper.innerHTML = `
        <p class="hint" style="margin:0;">${esc(text(
            "Cada grupo de filtros y cada tabla enlazada es un bloque independiente. Abre cada bloque para elegir su agrupación.",
            "Each filter group and linked table is an independent block. Open each block to choose its grouping."
        ))}</p>
        ${sources.length
            ? sources.map(renderSource).join("")
            : `<p class="hint">${esc(text("Esta tabla todavía no tiene contenido directo.", "This table does not have direct content yet."))}</p>`}`;
    distribution.insertAdjacentElement("afterend", wrapper);

    for (const select of wrapper.querySelectorAll("[data-cc-direct-source-grouping]")) {
        select.addEventListener("change", async () => {
            const sourceKey = String(select.dataset.sourceKey ?? "");
            select.disabled = true;
            try {
                await saveLayout(profile.id, layout => {
                    layout.sources[sourceKey] = {
                        ...(layout.sources[sourceKey] ?? {}),
                        criterion: select.value
                    };
                });
                await application.render({ force: true });
            }
            catch (error) {
                console.error(
                    "Compendium Curator | Error cambiando la agrupación del contenido directo.", error
                );
                ui.notifications.error(text(
                    "No se pudo cambiar la agrupación de este contenido.",
                    "This content grouping could not be changed."
                ));
                select.disabled = false;
            }
        });
    }
    activateDnd5eDocumentEntries(wrapper);
}

function appendInheritedIndividual(row, preview) {
    const inspector = row.matches("details[data-cc-content-inspector]")
        ? row
        : row.querySelector("details[data-cc-content-inspector]");
    const list = inspector?.querySelector(
        ":scope > div > section.inventory-element ol.item-list"
    );
    if (!list) return;
    const existing = new Set(
        [...list.querySelectorAll("[data-uuid]")].map(element => element.dataset.uuid)
    );
    const additions = (preview?.mixedGroups?.[0]?.entries ?? [])
        .filter(entry => !existing.has(entry.uuid));
    if (!additions.length) return;
    list.insertAdjacentHTML("beforeend", additions.map(renderEntry).join(""));
    activateDnd5eDocumentEntries(list);
}

function appendInheritedGrouped(row, preview) {
    const inspector = row.matches("details[data-cc-content-inspector]")
        ? row
        : row.querySelector("details[data-cc-content-inspector]");
    const body = inspector?.querySelector(":scope > div");
    if (!body) return;

    const byKey = new Map();
    for (const details of body.querySelectorAll(":scope > details")) {
        const marker = details.querySelector(
            "[data-cc-group-probability][data-group-key]"
        );
        if (marker?.dataset.groupKey) byKey.set(marker.dataset.groupKey, details);
    }
    let last = [...byKey.values()].at(-1) ?? null;

    for (const group of preview?.mixedGroups ?? []) {
        const details = byKey.get(group.key);
        if (details) {
            const list = details.querySelector("ol.item-list");
            const existing = new Set(
                [...details.querySelectorAll("[data-uuid]")]
                    .map(element => element.dataset.uuid)
            );
            const additions = group.entries.filter(entry => !existing.has(entry.uuid));
            if (list && additions.length) {
                list.insertAdjacentHTML("beforeend", additions.map(renderEntry).join(""));
                activateDnd5eDocumentEntries(list);
            }
            const count = details.querySelector("summary strong");
            if (count) count.textContent = String(group.count);
            continue;
        }

        const holder = document.createElement("div");
        holder.innerHTML = renderGroup(group).trim();
        const created = holder.firstElementChild;
        if (!created) continue;
        created.dataset.ccInheritedGroup = group.key;
        if (last) last.insertAdjacentElement("afterend", created);
        else body.append(created);
        last = created;
        activateDnd5eDocumentEntries(created);
    }
}

function integrateLinked(row, profile, preview) {
    if (!preview?.hasLinkedTables) return;
    if (profile.distribution?.mode === "individual")
        appendInheritedIndividual(row, preview);
    else
        appendInheritedGrouped(row, preview);
}

function enhanceManager(application, element) {
    const profiles = TableProfileStorageService.getProfiles();
    const filterGroups = TableProfileStorageService.getFilterGroups();
    const previews = application._ccRecursivePreviewData;
    for (const profile of Object.values(profiles)) {
        if (profile?.version !== 2 || profile.type !== "content") continue;
        const row = element.querySelector(
            `[data-profile-id="${CSS.escape(profile.id)}"]`
        );
        if (!row) continue;

        /*
         * El editor directo puede contener miles de objetos. No
         * construimos su vista provisional mientras la tabla esté
         * cerrada; el editor definitivo se montará al abrirla.
         */
        if (
            row.matches("details[data-cc-content-inspector]") &&
            !row.open
        ) {
            continue;
        }

        row.querySelector("[data-cc-recursive-content-preview]")?.remove();
        const direct = profile?.contentLayout?.mode === DIRECT_MODE;
        const preview = previews instanceof Map ? previews.get(profile.id) : null;
        const modeSelect = replaceModeSelect(
            application, profile.id, row, direct
        );

        if (direct) {
            configureDirect(
                application, profile, profiles, filterGroups,
                row, preview, modeSelect
            );
        }
        else {
            integrateLinked(row, profile, preview);
        }

    }
}

export function registerTableManagerDirectContentMode() {
    Hooks.on(
        "renderTableManagerApplication",
        (application, element) => {
            if (!game.user.can("SETTINGS_MODIFY")) return;
            enhanceManager(application, element);
        }
    );
}
