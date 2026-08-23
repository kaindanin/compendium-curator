import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";

const TABLE_PROFILE_BUNDLE_TYPE =
    "compendium-curator-table-profile-bundle";
const TABLE_PROFILE_BUNDLE_VERSION = 1;
const TABLE_PROFILE_BUNDLE_LIMIT = 500;

function normalizeComparableName(value) {
    return String(value ?? "")
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase();
}

function assertBundle(bundle) {
    const profiles = bundle?.profiles;
    const filterGroups = bundle?.filterGroups ?? {};
    const rootProfileId = String(
        bundle?.rootProfileId ?? ""
    ).trim();

    if (
        bundle?.type !== TABLE_PROFILE_BUNDLE_TYPE ||
        bundle?.version !== TABLE_PROFILE_BUNDLE_VERSION ||
        !profiles ||
        typeof profiles !== "object" ||
        Array.isArray(profiles) ||
        !filterGroups ||
        typeof filterGroups !== "object" ||
        Array.isArray(filterGroups) ||
        !profiles[rootProfileId]
    ) {
        throw new Error(
            "INVALID_TABLE_PROFILE_BUNDLE"
        );
    }

    const profileEntries = Object.entries(profiles);
    const filterGroupEntries =
        Object.entries(filterGroups);

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

    for (const [sourceId, profile] of profileEntries) {
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
            if (!filterGroups[filterGroupId]) {
                throw new Error(
                    "INVALID_TABLE_PROFILE_BUNDLE"
                );
            }
        }

        if (profile.type === "nested") {
            for (const child of profile.children ?? []) {
                const childProfile =
                    profiles[child?.profileId];

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

    return {
        profiles,
        filterGroups,
        rootProfileId,
        profileEntries,
        filterGroupEntries
    };
}

function getUuidAvailability(uuid) {
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
            available: Boolean(
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

function collectReferencedUuids(
    profiles,
    filterGroups
) {
    const referenced = new Set();

    for (const profile of Object.values(profiles)) {
        if (profile?.type !== "content")
            continue;

        for (const uuid of profile.manualIncludes ?? []) {
            const value = String(uuid ?? "").trim();

            if (value)
                referenced.add(value);
        }

        for (
            const filterGroupId
            of profile.filterGroupIds ?? []
        ) {
            const filterGroup =
                filterGroups?.[filterGroupId];

            for (const uuid of filterGroup?.matches ?? []) {
                const value =
                    String(uuid ?? "").trim();

                if (value)
                    referenced.add(value);
            }
        }
    }

    return referenced;
}

function analyzeAvailability(referenced) {
    const unavailableUuids = [];
    const missingPacks = new Map();
    let missingDocumentCount = 0;

    for (const uuid of referenced) {
        const availability =
            getUuidAvailability(uuid);

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

function getUniqueImportedName(
    rawName,
    usedNames
) {
    const desired = String(rawName ?? "").trim();
    const comparable =
        normalizeComparableName(desired);

    if (comparable && !usedNames.has(comparable)) {
        usedNames.add(comparable);
        return desired;
    }

    const base = game.i18n.format(
        "COMPENDIUM_CURATOR.ImportedCopyName",
        { name: desired }
    );
    let candidate = base;
    let index = 2;

    while (
        usedNames.has(
            normalizeComparableName(candidate)
        )
    ) {
        candidate = `${base} (${index})`;
        index++;
    }

    usedNames.add(
        normalizeComparableName(candidate)
    );

    return candidate;
}

function analyzeNameChanges(
    profileEntries,
    filterGroupEntries
) {
    const storage =
        TableProfileStorageService.getStorage();
    const usedProfileNames = new Set(
        Object.values(storage.profiles ?? {})
            .map(profile =>
                normalizeComparableName(profile?.name)
            )
            .filter(Boolean)
    );
    const usedFilterGroupNames = new Set(
        Object.values(storage.filterGroups ?? {})
            .map(group =>
                normalizeComparableName(group?.name)
            )
            .filter(Boolean)
    );
    const profileRenames = [];
    const filterGroupRenames = [];

    for (const [, group] of filterGroupEntries) {
        const from = String(group.name ?? "").trim();
        const to = getUniqueImportedName(
            from,
            usedFilterGroupNames
        );

        if (from !== to) {
            filterGroupRenames.push({
                from,
                to
            });
        }
    }

    for (const [, profile] of profileEntries) {
        const from = String(profile.name ?? "").trim();
        const to = getUniqueImportedName(
            from,
            usedProfileNames
        );

        if (from !== to) {
            profileRenames.push({
                from,
                to
            });
        }
    }

    return {
        profileRenames,
        filterGroupRenames,
        renameCount:
            profileRenames.length +
            filterGroupRenames.length
    };
}

function renderStat(label, value) {
    const escape = foundry.utils.escapeHTML;

    return `
        <div class="form-group">
            <label>${escape(label)}</label>
            <div class="form-fields">
                <strong>${escape(String(value))}</strong>
            </div>
        </div>
    `;
}

function renderRenameList(title, entries) {
    if (!entries.length)
        return "";

    const escape = foundry.utils.escapeHTML;
    const items = entries
        .map(entry => `
            <li>
                <span>${escape(entry.from)}</span>
                <i class="fas fa-arrow-right"></i>
                <strong>${escape(entry.to)}</strong>
            </li>
        `)
        .join("");

    return `
        <section class="cc-table-import-preflight-section">
            <h3>${escape(title)}</h3>
            <ul>${items}</ul>
        </section>
    `;
}

function renderMissingPacks(analysis) {
    if (
        !analysis.missingPacks.length &&
        analysis.missingDocumentCount === 0
    ) {
        return "";
    }

    const escape = foundry.utils.escapeHTML;
    const entries = analysis.missingPacks
        .map(pack => `
            <li>
                <code>${escape(pack.collection)}</code>
                <strong>${pack.count}</strong>
            </li>
        `);

    if (analysis.missingDocumentCount > 0) {
        entries.push(`
            <li>
                <span>${escape(
                    game.i18n.localize(
                        "COMPENDIUM_CURATOR.MissingDocuments"
                    )
                )}</span>
                <strong>${analysis.missingDocumentCount}</strong>
            </li>
        `);
    }

    return `
        <section class="cc-table-import-preflight-section warning">
            <h3>${escape(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.ImportPreflightMissingSources"
                )
            )}</h3>
            <ul>${entries.join("")}</ul>
            <p class="hint">
                ${escape(
                    game.i18n.localize(
                        "COMPENDIUM_CURATOR.ImportPreflightMissingHint"
                    )
                )}
            </p>
        </section>
    `;
}

export class TableProfileBundlePreflightService {

    static analyze(bundle) {
        const validated = assertBundle(bundle);
        const referenced = collectReferencedUuids(
            validated.profiles,
            validated.filterGroups
        );
        const availability =
            analyzeAvailability(referenced);
        const names = analyzeNameChanges(
            validated.profileEntries,
            validated.filterGroupEntries
        );
        const rootProfile =
            validated.profiles[
                validated.rootProfileId
            ];

        return {
            rootName: String(
                rootProfile?.name ?? ""
            ).trim(),
            rootType:
                rootProfile?.type ?? "content",
            profileCount:
                validated.profileEntries.length,
            filterGroupCount:
                validated.filterGroupEntries.length,
            sourceModuleVersion:
                String(
                    bundle?.moduleVersion ?? ""
                ).trim() || null,
            exportedAt:
                Number.isFinite(
                    Number(bundle?.exportedAt)
                )
                    ? Number(bundle.exportedAt)
                    : null,
            ...availability,
            ...names
        };
    }

    static async confirm(analysis) {
        const escape = foundry.utils.escapeHTML;
        const rootName = escape(
            analysis.rootName || "—"
        );
        const sourceVersion =
            analysis.sourceModuleVersion
                ? `
                    <p class="hint">
                        ${escape(
                            game.i18n.format(
                                "COMPENDIUM_CURATOR.ImportPreflightSourceVersion",
                                {
                                    version:
                                        analysis.sourceModuleVersion
                                }
                            )
                        )}
                    </p>
                `
                : "";
        const profileRenames = renderRenameList(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.ImportPreflightProfileRenames"
            ),
            analysis.profileRenames
        );
        const filterRenames = renderRenameList(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.ImportPreflightFilterRenames"
            ),
            analysis.filterGroupRenames
        );
        const missing = renderMissingPacks(analysis);
        const noWarnings =
            analysis.renameCount === 0 &&
            analysis.unavailableCount === 0
                ? `
                    <p class="hint">
                        ${escape(
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.ImportPreflightClean"
                            )
                        )}
                    </p>
                `
                : "";

        return foundry.applications.api.DialogV2
            .confirm({
                classes: [
                    "cc-table-dialog",
                    "cc-table-import-preflight"
                ],
                window: {
                    title: game.i18n.localize(
                        "COMPENDIUM_CURATOR.ImportPreflightTitle"
                    )
                },
                position: {
                    width: 560
                },
                content: `
                    <div class="cc-table-import-preflight-content">
                        <h2>${rootName}</h2>
                        ${sourceVersion}
                        <div class="cc-table-import-preflight-stats">
                            ${renderStat(
                                game.i18n.localize(
                                    "COMPENDIUM_CURATOR.ImportPreflightProfiles"
                                ),
                                analysis.profileCount
                            )}
                            ${renderStat(
                                game.i18n.localize(
                                    "COMPENDIUM_CURATOR.ImportPreflightFilterGroups"
                                ),
                                analysis.filterGroupCount
                            )}
                            ${renderStat(
                                game.i18n.localize(
                                    "COMPENDIUM_CURATOR.ImportPreflightReferenced"
                                ),
                                analysis.referencedCount
                            )}
                            ${renderStat(
                                game.i18n.localize(
                                    "COMPENDIUM_CURATOR.ImportPreflightAvailable"
                                ),
                                analysis.availableCount
                            )}
                            ${renderStat(
                                game.i18n.localize(
                                    "COMPENDIUM_CURATOR.ImportPreflightUnavailable"
                                ),
                                analysis.unavailableCount
                            )}
                        </div>
                        ${profileRenames}
                        ${filterRenames}
                        ${missing}
                        ${noWarnings}
                    </div>
                `,
                yes: {
                    label: game.i18n.localize(
                        "COMPENDIUM_CURATOR.Import"
                    )
                },
                no: {
                    label: game.i18n.localize(
                        "COMPENDIUM_CURATOR.Cancel"
                    )
                },
                rejectClose: false,
                modal: true
            });
    }

}
