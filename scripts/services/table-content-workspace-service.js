import { MODULE_ID, TABLE_PROFILES_SETTING } from "../settings.js";
import { TableProfileStorageService } from "./table-profile-storage-service.js";
import { canUseTableChild, getTableChildren } from "./table-profile-relations-service.js";
import { TableProfileService } from "./table-profile-service.js";
import { buildDirectContentGenerationSources } from "./table-manager-direct-content-editor-service.js";

function unique(values) {
    return [...new Set(Array.from(values ?? []).map(value => String(value).trim()).filter(Boolean))];
}

/** Save the four sections together, without modifying any source category/table. */
export async function saveTableContent(profileId, draft) {
    const storage = foundry.utils.deepClone(TableProfileStorageService.getStorage());
    const profile = storage.profiles?.[profileId];
    if (profile?.version !== 2)
        throw new Error("TABLE_PROFILE_NOT_FOUND");

    const tableIds = unique(draft.tableIds);
    for (const id of tableIds) {
        if (!canUseTableChild(profileId, id, storage.profiles))
            throw new Error("INVALID_NESTED_TABLE_CHILD");
    }
    const categoryIds = unique(draft.categoryIds);
    if (profile.type === "content" && categoryIds.some(id => !storage.filterGroups?.[id]))
        throw new Error("TABLE_FILTER_GROUP_NOT_FOUND");

    const children = getTableChildren(profile, storage.profiles);
    for (const child of children)
        child.enabled = tableIds.includes(child.profileId);
    for (const id of tableIds) {
        if (!children.some(child => child.profileId === id))
            children.push({ profileId: id, enabled: true, weight: 1 });
    }
    const next = { children };
    if (profile.type === "content") {
        next.filterGroupIds = categoryIds;
        next.directUuids = unique(draft.inclusions).sort();
        next.manualExcludes = unique(draft.exclusions).sort();
    }
    if (Object.entries(next).every(([key, value]) =>
        JSON.stringify(profile[key] ?? []) === JSON.stringify(value))) {
        return false;
    }
    Object.assign(profile, next);
    profile.revision = Number(profile.revision ?? 1) + 1;
    await game.settings.set(MODULE_ID, TABLE_PROFILES_SETTING, storage);
    return true;
}

/** Read-only category preview, using its own rules and persisted filter criteria. */
export async function categoryContentUuids(browserApp, category) {
    const preview = await TableProfileService.resolveLocalContentSources(browserApp, {
        filterGroups: [category], directUuids: [], manualExcludes: []
    });
    return unique(preview.candidates.map(entry => entry.uuid));
}

/** Linked tables keep their own rules/weights. Parent exclusions never descend. */
export async function tableContentUuids(browserApp, profileId, profiles, categories, visited = new Set()) {
    if (visited.has(profileId) || !profiles[profileId])
        return [];
    const path = new Set([...visited, profileId]);
    const profile = profiles[profileId];
    const sources = await buildDirectContentGenerationSources(profile, browserApp, categories);
    const uuids = sources.flatMap(source => source.groups
        .filter(group => group.enabled && group.effectiveShare > 0)
        .flatMap(group => group.entries.filter(entry => entry.effectiveShare > 0).map(entry => entry.uuid)));
    for (const child of getTableChildren(profile, profiles)) {
        if (!child.enabled)
            continue;
        uuids.push(...await tableContentUuids(browserApp, child.profileId, profiles, categories, path));
    }
    return unique(uuids);
}
