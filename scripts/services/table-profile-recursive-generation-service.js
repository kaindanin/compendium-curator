import { MODULE_ID } from "../settings.js";
import { TableManagerApplication } from "../applications/table-manager-application.js";
import { TableProfileStorageService } from "./table-profile-storage-service.js";
import { TableProfileGenerationService } from "./table-profile-generation-service.js";
import { TableProfileDrawService } from "./table-profile-draw-service.js";
import { getActiveTableChildren } from "./table-profile-relations-service.js";

const PATCH_FLAG = Symbol.for("compendium-curator.table-profile-recursive-generation");
const DRAW_PATCH_FLAG = Symbol.for("compendium-curator.table-profile-recursive-draw");
const MAX_TABLE_RANGE = 1_000_000;
const WEIGHT_PRECISION = 1000;

function positive(value, fallback = 1) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function gcd(a, b) {
    let left = Math.abs(Math.trunc(a));
    let right = Math.abs(Math.trunc(b));
    while (right) [left, right] = [right, left % right];
    return left || 1;
}

function integerize(entries) {
    if (!entries.length) return [];
    let weights = entries.map(entry => Math.max(1, Math.round(positive(entry.weight) * WEIGHT_PRECISION)));
    const divisor = weights.reduce((current, weight) => gcd(current, weight));
    weights = weights.map(weight => Math.max(1, Math.round(weight / divisor)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total > MAX_TABLE_RANGE) {
        const scale = total / MAX_TABLE_RANGE;
        weights = weights.map(weight => Math.max(1, Math.round(weight / scale)));
    }
    return entries.map((entry, index) => ({ ...entry, weight: weights[index] }));
}

function rawIndividualWeight(profile, uuid) {
    return positive(
        profile?.distribution?.individual?.weights?.[uuid],
        positive(
            profile?.weights?.overrides?.[uuid],
            positive(profile?.distribution?.individual?.defaultWeight, positive(profile?.weights?.default, 1))
        )
    );
}

function rawGroupedWeight(profile, resultKey) {
    const grouped = profile?.distribution?.grouped;
    const criterion = String(grouped?.grouping?.criterion ?? "rarity");
    for (const [key, group] of Object.entries(grouped?.groups ?? {})) {
        const id = String(group?.id ?? `auto:${criterion}:${encodeURIComponent(key)}`);
        if (`group:${id}` !== resultKey) continue;
        return positive(group?.weight, criterion === "rarity" ? positive(profile?.weights?.rarity?.[key], 1) : 1);
    }
    const prefix = `group:auto:${criterion}:`;
    if (criterion === "rarity" && resultKey.startsWith(prefix)) {
        let key = resultKey.slice(prefix.length);
        try { key = decodeURIComponent(key); } catch { /* keep encoded */ }
        return positive(profile?.weights?.rarity?.[key], 1);
    }
    return 1;
}

function rawRootWeight(profile, result) {
    const mode = String(profile?.distribution?.mode ?? "grouped");
    const key = String(result?.flags?.[MODULE_ID]?.resultKey ?? result?.documentUuid ?? "");
    if (mode === "individual") return rawIndividualWeight(profile, key);
    if (mode === "grouped") return rawGroupedWeight(profile, key);
    return 1;
}

function inferScale(profile, results) {
    for (const result of results) {
        const generated = Number(result?.weight);
        const raw = rawRootWeight(profile, result);
        if (Number.isFinite(generated) && generated > 0 && raw > 0) return generated / raw;
    }
    return 1;
}

async function mergeChildTables(root, profile, children) {
    const current = Array.from(root?.results ?? []);
    const scale = inferScale(profile, current);
    const entries = current.map(result => ({ kind: "existing", result, weight: positive(result.weight) }));
    for (const child of children) {
        entries.push({ kind: "child", child, weight: positive(child.weight) * scale });
    }

    const min = Math.max(1, Number.parseInt(profile?.draw?.quantityMin, 10) || 1);
    const max = Math.max(min, Number.parseInt(profile?.draw?.quantityMax, 10) || min);
    let cursor = 1;
    const results = integerize(entries).map(entry => {
        const start = cursor;
        const end = start + entry.weight - 1;
        cursor = end + 1;
        if (entry.kind === "existing") {
            const data = entry.result.toObject();
            delete data._id;
            return { ...data, weight: entry.weight, range: [start, end], drawn: false };
        }
        const child = entry.child;
        return {
            type: CONST.TABLE_RESULT_TYPES.DOCUMENT,
            name: String(child.profile?.name ?? child.table?.name ?? ""),
            img: String(child.table?.img ?? "icons/svg/d20-grey.svg"),
            documentUuid: String(child.table?.uuid ?? ""),
            weight: entry.weight,
            range: [start, end],
            drawn: false,
            flags: {
                [MODULE_ID]: {
                    managed: true,
                    profileId: profile.id,
                    nodeId: "root",
                    resultKey: `table:${child.profile.id}`,
                    quantityMin: min,
                    quantityMax: max
                }
            }
        };
    });

    const ids = current.map(result => result.id).filter(Boolean);
    if (ids.length) await root.deleteEmbeddedDocuments("TableResult", ids);
    if (results.length) await root.createEmbeddedDocuments("TableResult", results);
    await root.update({ formula: `1d${Math.max(1, cursor - 1)}` });
}

function hasGeneratedRoot(profile) {
    return Boolean(String(profile?.generation?.rootUuid ?? "").trim());
}

export function profileHasPendingTableDependencies(profile, profiles = TableProfileStorageService.getProfiles(), visited = new Set()) {
    const id = String(profile?.id ?? "").trim();
    if (!id || visited.has(id)) return false;
    const next = new Set(visited);
    next.add(id);
    for (const child of getActiveTableChildren(profile, profiles)) {
        const dependency = profiles?.[child.profileId];
        if (!dependency) return true;
        if (
            !hasGeneratedRoot(dependency) ||
            Number(dependency.generation?.generatedRevision ?? 0) !== Number(dependency.revision ?? 1) ||
            profileHasPendingTableDependencies(dependency, profiles, next)
        ) return true;
    }
    return false;
}

async function generateRecursive(application, profileId, originalGenerate, state) {
    if (state.generated.has(profileId)) return state.generated.get(profileId);
    if (state.stack.has(profileId)) throw new Error("TABLE_PROFILE_RECURSIVE_CYCLE");
    const profile = state.profiles?.[profileId];
    if (!profile) throw new Error("TABLE_PROFILE_NOT_FOUND");

    const stack = new Set(state.stack);
    stack.add(profileId);
    const children = [];
    for (const relation of getActiveTableChildren(profile, state.profiles)) {
        const childGenerated = await generateRecursive(
            application,
            relation.profileId,
            originalGenerate,
            { ...state, stack }
        );
        const childProfile = TableProfileStorageService.getProfiles()?.[relation.profileId] ?? state.profiles?.[relation.profileId];
        children.push({ profile: childProfile, table: childGenerated.root, weight: relation.weight });
    }

    let generated;
    let ownContent = false;
    if (profile.type === "content") {
        try {
            generated = await originalGenerate.call(application, profile.id);
            ownContent = true;
        }
        catch (error) {
            const childOnly = children.length && ["TABLE_PROFILE_NO_OBJECTS", "TABLE_PROFILE_NO_ACTIVE_GROUPS"].includes(error?.message);
            if (!childOnly) throw error;
            generated = await TableProfileGenerationService.generateNested({ ...profile, type: "nested" }, children);
        }
        if (ownContent && children.length && generated?.root) await mergeChildTables(generated.root, profile, children);
    }
    else {
        generated = await TableProfileGenerationService.generateNested(profile, children);
    }

    generated.profile = TableProfileStorageService.getProfiles()?.[profile.id] ?? generated.profile;
    state.generated.set(profileId, generated);
    return generated;
}

function profileIdFromTarget(target) {
    return String(target?.closest?.("[data-profile-id]")?.dataset?.profileId ?? "").trim();
}

function generationErrorKey(error) {
    if (error?.message === "TABLE_PROFILE_NO_ACTIVE_GROUPS") return "TableProfileNoActiveGroups";
    if (error?.message === "TABLE_PROFILE_NO_ACTIVE_CHILDREN") return "TableProfileNoActiveChildren";
    if (error?.message === "TABLE_PROFILE_NO_OBJECTS") return "TableProfileNoObjects";
    return "RollTableGenerationFailed";
}

function skippable(error) {
    return ["TABLE_PROFILE_NO_ACTIVE_GROUPS", "TABLE_PROFILE_NO_ACTIVE_CHILDREN", "TABLE_PROFILE_NO_OBJECTS"].includes(error?.message);
}

function patchActions(originalActions) {
    const actions = TableManagerApplication.DEFAULT_OPTIONS?.actions;
    if (!actions) return;

    actions.generateProfile = async function(event, target) {
        event.preventDefault();
        event.stopPropagation();
        const profileId = profileIdFromTarget(target);
        if (!profileId) return;
        target.disabled = true;
        this._closeProfileActionsPopover?.();
        try {
            const generated = await this.generateStoredProfileTables(profileId);
            ui.notifications.info(game.i18n.format("COMPENDIUM_CURATOR.RollTableGenerated", { name: generated.root.name }));
            await this.render({ force: true });
        }
        catch (error) {
            console.error("Compendium Curator | Error generando RollTables recursivas.", error);
            ui.notifications.error(game.i18n.localize(`COMPENDIUM_CURATOR.${generationErrorKey(error)}`));
        }
        finally {
            if (target.isConnected) target.disabled = false;
        }
    };

    actions.generateVisibleProfiles = async function(event, target) {
        event.preventDefault();
        event.stopPropagation();
        if (this._activeTab === "filters") return;
        const ids = [...new Set(Array.from(this.element.querySelectorAll(".cc-table-manager-profile[data-profile-id]"))
            .filter(element => !element.hidden).map(element => element.dataset.profileId).filter(Boolean))];
        if (!ids.length) return;
        target.disabled = true;
        let generated = 0;
        let skipped = 0;
        let failed = 0;
        for (const id of ids) {
            try { await this.generateStoredProfileTables(id); generated++; }
            catch (error) {
                if (skippable(error)) skipped++;
                else { failed++; console.error("Compendium Curator | Error generando una tabla visible recursiva.", { profileId: id, error }); }
            }
        }
        const summary = game.i18n.format("COMPENDIUM_CURATOR.VisibleTablesGenerationSummary", { generated, skipped, failed });
        failed ? ui.notifications.warn(summary) : ui.notifications.info(summary);
        await this.render({ force: true });
        if (target.isConnected) target.disabled = false;
    };

    for (const name of ["openGeneratedTable", "drawGeneratedTable", "quickDrawGeneratedTable"]) {
        const original = originalActions[name];
        if (typeof original !== "function") continue;
        actions[name] = async function(event, target) {
            const profileId = profileIdFromTarget(target);
            const profiles = TableProfileStorageService.getProfiles();
            const profile = profiles?.[profileId];
            if (profile && profileHasPendingTableDependencies(profile, profiles)) {
                try {
                    const generated = await this.generateStoredProfileTables(profileId);
                    ui.notifications.info(game.i18n.format("COMPENDIUM_CURATOR.RollTableAutoUpdated", { name: generated.root.name }));
                    await this.render({ force: true });
                }
                catch (error) {
                    console.error("Compendium Curator | Error actualizando dependencias recursivas.", error);
                    ui.notifications.error(game.i18n.localize("COMPENDIUM_CURATOR.RollTableGenerationFailed"));
                    return;
                }
            }
            return original.call(this, event, target);
        };
    }
}

function resultWeight(result) {
    const weight = Number(result?.weight);
    if (Number.isFinite(weight) && weight > 0) return weight;
    const start = Number(result?.range?.[0]);
    const end = Number(result?.range?.[1]);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start + 1 : 1;
}

function rollTableUuid(uuid) {
    const value = String(uuid ?? "");
    return /^RollTable\.[^.]+$/.test(value) || /^Compendium\.[^.]+\.[^.]+\.RollTable\.[^.]+$/.test(value);
}

async function collectLeaves(table, multiplier, leaves, active) {
    const tableUuid = String(table?.uuid ?? "");
    if (!tableUuid || active.has(tableUuid)) return;
    const results = Array.from(table.results ?? []).filter(result => Boolean(result?.documentUuid));
    const total = results.reduce((sum, result) => sum + resultWeight(result), 0);
    if (!(total > 0)) return;
    const next = new Set(active);
    next.add(tableUuid);
    for (const result of results) {
        const uuid = String(result.documentUuid ?? "");
        const probability = multiplier * resultWeight(result) / total;
        if (rollTableUuid(uuid)) {
            let child = null;
            try { child = await fromUuid(uuid); } catch { child = null; }
            if (child?.documentName === "RollTable") {
                await collectLeaves(child, probability, leaves, next);
                continue;
            }
        }
        const existing = leaves.get(uuid);
        if (existing) existing.weight += probability;
        else leaves.set(uuid, {
            uuid,
            name: String(result.name ?? "").trim() || uuid,
            img: String(result.img ?? "").trim() || "icons/svg/item-bag.svg",
            weight: probability
        });
    }
}

function patchDrawPool() {
    if (TableProfileDrawService[DRAW_PATCH_FLAG]) return;
    TableProfileDrawService.getDrawPool = async function(table) {
        if (table?.documentName !== "RollTable") throw new Error("INVALID_ROLL_TABLE");
        const leaves = new Map();
        await collectLeaves(table, 1, leaves, new Set());
        return [...leaves.values()].filter(entry => entry.uuid && entry.weight > 0);
    };
    Object.defineProperty(TableProfileDrawService, DRAW_PATCH_FLAG, { value: true, configurable: false });
}

export function registerTableProfileRecursiveGeneration() {
    const prototype = TableManagerApplication.prototype;
    if (prototype[PATCH_FLAG]) return;
    const originalGenerate = prototype.generateStoredProfileTables;
    const originalActions = { ...TableManagerApplication.DEFAULT_OPTIONS?.actions };
    if (typeof originalGenerate !== "function") return;

    prototype.generateStoredProfileTables = async function(profileId) {
        return generateRecursive(this, profileId, originalGenerate, {
            profiles: TableProfileStorageService.getProfiles(),
            generated: new Map(),
            stack: new Set()
        });
    };

    patchActions(originalActions);
    patchDrawPool();
    Object.defineProperty(prototype, PATCH_FLAG, { value: true, configurable: false });
}
