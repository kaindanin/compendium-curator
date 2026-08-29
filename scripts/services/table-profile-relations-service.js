import {
    MODULE_ID,
    TABLE_PROFILES_SETTING
} from "../settings.js";
import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";
import {
    TableProfileBundlePreflightService
} from "./table-profile-bundle-preflight-service.js";

const PATCH_FLAG =
    Symbol.for(
        "compendium-curator.table-profile-relations"
    );

const TABLE_PROFILE_BUNDLE_TYPE =
    "compendium-curator-table-profile-bundle";
const TABLE_PROFILE_BUNDLE_VERSION = 3;

function normalizePositiveNumber(value, fallback = 1) {
    const parsed = Number(value);

    return (
        Number.isFinite(parsed) &&
        parsed > 0
    )
        ? parsed
        : fallback;
}

function getChildId(sourceChild) {
    return String(
        typeof sourceChild === "string"
            ? sourceChild
            : sourceChild?.profileId ??
                sourceChild?.id ??
                ""
    ).trim();
}

export function getTableChildren(
    profile,
    profiles = TableProfileStorageService.getProfiles()
) {
    const profileId =
        String(profile?.id ?? "").trim();
    const children = [];
    const used = new Set();

    for (
        const sourceChild
        of Array.isArray(profile?.children)
            ? profile.children
            : []
    ) {
        const childProfileId =
            getChildId(sourceChild);

        if (
            !childProfileId ||
            childProfileId === profileId ||
            used.has(childProfileId) ||
            profiles?.[childProfileId]
                ?.version !== 2
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
                normalizePositiveNumber(
                    typeof sourceChild === "string"
                        ? 1
                        : sourceChild?.weight,
                    1
                )
        });
    }

    return children;
}

export function getActiveTableChildren(
    profile,
    profiles = TableProfileStorageService.getProfiles()
) {
    return getTableChildren(
        profile,
        profiles
    ).filter(child =>
        child.enabled === true
    );
}

function profileReaches(
    sourceProfileId,
    targetProfileId,
    profiles,
    visited = new Set()
) {
    const sourceId =
        String(sourceProfileId ?? "").trim();
    const targetId =
        String(targetProfileId ?? "").trim();

    if (
        !sourceId ||
        !targetId ||
        visited.has(sourceId)
    ) {
        return false;
    }

    visited.add(sourceId);

    const profile = profiles?.[sourceId];

    if (profile?.version !== 2)
        return false;

    for (
        const child
        of getTableChildren(
            profile,
            profiles
        )
    ) {
        if (child.profileId === targetId)
            return true;

        if (
            profileReaches(
                child.profileId,
                targetId,
                profiles,
                visited
            )
        ) {
            return true;
        }
    }

    return false;
}

export function canUseTableChild(
    profileId,
    childProfileId,
    profiles = TableProfileStorageService.getProfiles()
) {
    const parentId =
        String(profileId ?? "").trim();
    const childId =
        String(childProfileId ?? "").trim();

    if (
        !parentId ||
        !childId ||
        parentId === childId ||
        profiles?.[parentId]?.version !== 2 ||
        profiles?.[childId]?.version !== 2
    ) {
        return false;
    }

    return !profileReaches(
        childId,
        parentId,
        profiles
    );
}

export async function setTableChildEnabled(
    profileId,
    childProfileId,
    enabled
) {
    const storage = foundry.utils.deepClone(
        TableProfileStorageService.getStorage()
    );
    const profile =
        storage.profiles?.[profileId];
    const childProfile =
        storage.profiles?.[childProfileId];

    if (
        !profile ||
        profile.version !== 2 ||
        !childProfile ||
        childProfile.version !== 2
    ) {
        throw new Error(
            "INVALID_NESTED_TABLE_CHILD"
        );
    }

    const children = getTableChildren(
        profile,
        storage.profiles
    );
    const previous = children.find(child =>
        child.profileId === childProfileId
    );
    const requested = enabled === true;

    if (
        requested &&
        !canUseTableChild(
            profileId,
            childProfileId,
            storage.profiles
        )
    ) {
        throw new Error(
            "INVALID_NESTED_TABLE_CHILD"
        );
    }

    if (
        previous?.enabled === requested ||
        (!previous && !requested)
    ) {
        return profile;
    }

    if (previous) {
        previous.enabled = requested;
    }
    else {
        children.push({
            profileId: childProfileId,
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

    return TableProfileStorageService
        .getProfiles()?.[profileId] ??
        null;
}

export async function setTableChildWeight(
    profileId,
    childProfileId,
    weight
) {
    const normalizedWeight =
        normalizePositiveNumber(
            weight,
            null
        );

    if (normalizedWeight === null) {
        throw new Error(
            "INVALID_TABLE_WEIGHT"
        );
    }

    const storage = foundry.utils.deepClone(
        TableProfileStorageService.getStorage()
    );
    const profile =
        storage.profiles?.[profileId];

    if (
        !profile ||
        profile.version !== 2 ||
        storage.profiles?.[childProfileId]
            ?.version !== 2
    ) {
        throw new Error(
            "INVALID_NESTED_TABLE_CHILD"
        );
    }

    const children = getTableChildren(
        profile,
        storage.profiles
    );
    const child = children.find(candidate =>
        candidate.profileId === childProfileId
    );

    if (!child) {
        throw new Error(
            "INVALID_NESTED_TABLE_CHILD"
        );
    }

    if (child.weight === normalizedWeight)
        return profile;

    child.weight = normalizedWeight;
    profile.children = children;
    profile.revision =
        Number(profile.revision ?? 1) + 1;

    await game.settings.set(
        MODULE_ID,
        TABLE_PROFILES_SETTING,
        storage
    );

    return TableProfileStorageService
        .getProfiles()?.[profileId] ??
        null;
}

function validateBundleRelations(bundle) {
    const profiles = bundle?.profiles;

    if (
        !profiles ||
        typeof profiles !== "object" ||
        Array.isArray(profiles)
    ) {
        throw new Error(
            "INVALID_TABLE_PROFILE_BUNDLE"
        );
    }

    for (
        const [profileId, profile]
        of Object.entries(profiles)
    ) {
        if (
            !profileId ||
            profile?.version !== 2 ||
            (
                profile.children !== undefined &&
                !Array.isArray(profile.children)
            )
        ) {
            throw new Error(
                "INVALID_TABLE_PROFILE_BUNDLE"
            );
        }

        const seen = new Set();

        for (const child of profile.children ?? []) {
            const childId = getChildId(child);

            if (
                !childId ||
                childId === profileId ||
                seen.has(childId) ||
                profiles?.[childId]
                    ?.version !== 2
            ) {
                throw new Error(
                    "INVALID_TABLE_PROFILE_BUNDLE"
                );
            }

            seen.add(childId);
        }
    }

    const visiting = new Set();
    const visited = new Set();

    const visit = profileId => {
        if (visited.has(profileId))
            return;

        if (visiting.has(profileId)) {
            throw new Error(
                "INVALID_TABLE_PROFILE_BUNDLE"
            );
        }

        visiting.add(profileId);

        for (
            const child
            of profiles[profileId]?.children ?? []
        ) {
            visit(getChildId(child));
        }

        visiting.delete(profileId);
        visited.add(profileId);
    };

    for (const profileId of Object.keys(profiles))
        visit(profileId);
}

function exportProfileBundle(profileId) {
    const storage =
        TableProfileStorageService.getStorage();
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

        for (
            const child
            of getTableChildren(
                profile,
                storage.profiles
            )
        ) {
            pending.push(child.profileId);
        }
    }

    const profiles = {};
    const filterGroupIds = new Set();

    for (const currentId of profileIds) {
        const profile = foundry.utils.deepClone(
            storage.profiles[currentId]
        );

        profile.children = getTableChildren(
            profile,
            storage.profiles
        );
        profile.generation = {
            masterUuid: null,
            groupUuids: {},
            rootUuid: null,
            nodes: {},
            generatedRevision: 0
        };
        profile.folderId = null;
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

    const bundle = {
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

    validateBundleRelations(bundle);

    return bundle;
}

function patchPortableRelations() {
    if (TableProfileStorageService[PATCH_FLAG])
        return;

    const originalImport =
        TableProfileStorageService
            .importProfileBundle
            .bind(TableProfileStorageService);
    const originalRemove =
        TableProfileStorageService
            .removeProfile
            .bind(TableProfileStorageService);
    const originalPreflightAnalyze =
        TableProfileBundlePreflightService
            .analyze
            .bind(TableProfileBundlePreflightService);

    TableProfileStorageService.exportProfileBundle =
        exportProfileBundle;

    TableProfileStorageService.importProfileBundle =
        async function importBundleWithRelations(bundle) {
            validateBundleRelations(bundle);

            const sourceIds =
                Object.keys(bundle.profiles ?? {});
            const imported =
                await originalImport(bundle);

            if (
                sourceIds.length !==
                imported.importedProfileIds.length
            ) {
                throw new Error(
                    "INVALID_TABLE_PROFILE_BUNDLE"
                );
            }

            const idMap = new Map(
                sourceIds.map((sourceId, index) => [
                    sourceId,
                    imported.importedProfileIds[index]
                ])
            );
            const storage = foundry.utils.deepClone(
                TableProfileStorageService.getStorage()
            );

            for (const sourceId of sourceIds) {
                const destinationId =
                    idMap.get(sourceId);
                const destination =
                    storage.profiles?.[destinationId];
                const sourceProfile =
                    bundle.profiles[sourceId];

                if (!destination)
                    continue;

                destination.children = (
                    sourceProfile.children ?? []
                ).map(child => ({
                    profileId:
                        idMap.get(
                            getChildId(child)
                        ),
                    enabled:
                        typeof child === "string" ||
                        child?.enabled !== false,
                    weight:
                        normalizePositiveNumber(
                            typeof child === "string"
                                ? 1
                                : child?.weight,
                            1
                        )
                })).filter(child =>
                    Boolean(child.profileId)
                );
            }

            await game.settings.set(
                MODULE_ID,
                TABLE_PROFILES_SETTING,
                storage
            );

            const profiles =
                TableProfileStorageService
                    .getProfiles();
            const rootId =
                imported.rootProfile?.id;

            return {
                ...imported,
                rootProfile:
                    profiles?.[rootId] ??
                    imported.rootProfile
            };
        };

    TableProfileStorageService.removeProfile =
        async function removeProfileWithRelations(
            profileId
        ) {
            const removed =
                await originalRemove(profileId);
            const storage = foundry.utils.deepClone(
                TableProfileStorageService.getStorage()
            );
            let changed = false;

            for (
                const profile
                of Object.values(
                    storage.profiles ?? {}
                )
            ) {
                const children =
                    Array.isArray(profile.children)
                        ? profile.children
                        : [];
                const nextChildren =
                    children.filter(child =>
                        getChildId(child) !== profileId
                    );

                if (
                    nextChildren.length ===
                    children.length
                ) {
                    continue;
                }

                profile.children = nextChildren;
                profile.revision =
                    Number(
                        profile.revision ?? 1
                    ) + 1;
                changed = true;
            }

            if (changed) {
                await game.settings.set(
                    MODULE_ID,
                    TABLE_PROFILES_SETTING,
                    storage
                );
            }

            return removed;
        };

    TableProfileBundlePreflightService.analyze =
        function analyzeBundleWithRelations(bundle) {
            validateBundleRelations(bundle);

            const compatible =
                foundry.utils.deepClone(bundle);

            for (
                const profile
                of Object.values(
                    compatible.profiles ?? {}
                )
            ) {
                if (profile?.type !== "nested")
                    continue;

                profile.children = (
                    profile.children ?? []
                ).filter(child =>
                    compatible.profiles?.[
                        getChildId(child)
                    ]?.type === "content"
                );
            }

            return originalPreflightAnalyze(
                compatible
            );
        };

    Object.defineProperty(
        TableProfileStorageService,
        PATCH_FLAG,
        {
            value: true,
            configurable: false
        }
    );
}

export function registerTableProfileRelations() {
    patchPortableRelations();
}
