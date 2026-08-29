import { MODULE_ID } from "../settings.js";
import { TableProfileStorageService } from "./table-profile-storage-service.js";
import { TableProfileGenerationService } from "./table-profile-generation-service.js";
import { getActiveTableChildren } from "./table-profile-relations-service.js";
import {
    buildDirectContentGenerationSources
} from "./table-manager-direct-content-editor-service.js";

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
        if (
            profile?.contentLayout?.mode ===
                "direct"
        ) {
            generated =
                await TableProfileGenerationService
                    .generateDirect(
                        profile,
                        await buildDirectContentGenerationSources(
                            profile,
                            application.browserApp
                        ),
                        children
                    );
            generated.profile =
                TableProfileStorageService
                    .getProfiles()?.[profile.id] ??
                generated.profile;
            state.generated.set(
                profileId,
                generated
            );
            return generated;
        }

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

export function generateStoredProfileTablesRecursively(
    application,
    profileId,
    originalGenerate
) {
    return generateRecursive(
        application,
        profileId,
        originalGenerate,
        {
            profiles:
                TableProfileStorageService
                    .getProfiles(),
            generated: new Map(),
            stack: new Set()
        }
    );
}
