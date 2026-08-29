import assert from "node:assert/strict";
import test from "node:test";

let nextId = 0;
let storage = {
    version: 6,
    folders: {},
    filterGroupFolders: {},
    filterGroups: {
        magic: {
            id: "magic",
            name: "Magia",
            revision: 4,
            browser: {
                tab: "physical",
                filters: {
                    documentClass: "Item",
                    types: ["equipment"]
                }
            },
            matches: [
                "Compendium.test.items.Item.a",
                "Compendium.test.items.Item.a"
            ],
            manualIncludes: [
                "Compendium.test.items.Item.b"
            ],
            refreshedAt: 123
        }
    },
    profiles: {
        shop: {
            id: "shop",
            version: 2,
            type: "content",
            name: "Tienda",
            filterGroupIds: ["magic"],
            revision: 2,
            generation: {}
        }
    }
};

globalThis.foundry = {
    utils: {
        deepClone: value => structuredClone(value),
        equals: (left, right) =>
            JSON.stringify(left) === JSON.stringify(right),
        randomID: () => `group-${++nextId}`
    }
};
globalThis.game = {
    user: {
        can: () => true
    },
    i18n: {
        format: (_key, data) => `${data.name} copy`
    },
    modules: new Map([["compendium-curator", {
        version: "0.4.0"
    }]]),
    packs: new Map(),
    settings: {
        get: () => storage,
        set: async (_module, _key, value) => {
            storage = structuredClone(value);
            return storage;
        }
    }
};
globalThis.fromUuidSync = () => null;

const {
    TableProfileStorageService
} = await import(
    "../scripts/services/table-profile-storage-service.js"
);
const {
    TableProfileService
} = await import(
    "../scripts/services/table-profile-service.js"
);

test("migrates each legacy category into one deterministic group", async () => {
    const normalized =
        TableProfileStorageService.getStorage();
    const category = normalized.filterGroups.magic;

    assert.equal(normalized.version, 7);
    assert.equal(category.name, "Magia");
    assert.equal(category.groups.length, 1);
    assert.equal(category.groups[0].id, "magic-legacy");
    assert.equal(category.groups[0].name, "Magia");
    assert.deepEqual(
        category.groups[0].browser.filters.types,
        ["equipment"]
    );
    assert.deepEqual(category.groups[0].matches, [
        "Compendium.test.items.Item.a"
    ]);
    assert.deepEqual(
        TableProfileStorageService
            .getProfiles().shop
            .filterGroups[0].matches,
        [
            "Compendium.test.items.Item.a",
            "Compendium.test.items.Item.b"
        ]
    );

    assert.equal(
        await TableProfileStorageService
            .migrateStorage(),
        true
    );
    assert.equal(storage.version, 7);
    assert.equal(storage.filterGroups.magic.browser, undefined);
    assert.equal(storage.filterGroups.magic.matches, undefined);
});

test("stores zero-match groups and validates names inside their category", async () => {
    const created = await TableProfileStorageService
        .addCategoryFilterGroup("magic", {
            name: "  Armas mágicas  ",
            browser: {
                tab: "physical",
                filters: {
                    documentClass: "Item",
                    types: ["weapon"]
                }
            },
            matches: []
        });

    assert.equal(created.name, "Armas mágicas");
    assert.deepEqual(created.matches, []);
    assert.equal(
        TableProfileStorageService
            .isCategoryGroupNameTaken(
                "magic",
                "ARMAS MÁGICAS"
            ),
        true
    );

    await assert.rejects(
        TableProfileStorageService
            .addCategoryFilterGroup("magic", {
                name: "armas mágicas",
                browser: { filters: {} },
                matches: []
            }),
        /FILTER_GROUP_NAME_TAKEN/
    );

    const duplicate = await TableProfileStorageService
        .duplicateCategoryFilterGroup(
            "magic",
            created.id,
            "Armas mágicas (copia)"
        );

    assert.deepEqual(duplicate.matches, []);

    await TableProfileStorageService
        .deleteCategoryFilterGroup(
            "magic",
            duplicate.id
        );

    assert.equal(
        TableProfileStorageService
            .getCategoryFilterGroup(
                "magic",
                duplicate.id
            ),
        null
    );
});

test("exports the category hierarchy with bundle version 2", () => {
    const bundle = TableProfileStorageService
        .exportProfileBundle("shop");

    assert.equal(bundle.version, 2);
    assert.ok(Array.isArray(
        bundle.filterGroups.magic.groups
    ));
    assert.equal(
        bundle.filterGroups.magic.matches,
        undefined
    );
});

test("imports legacy version 1 bundles without losing criteria", async () => {
    const imported = await TableProfileStorageService
        .importProfileBundle({
            type:
                "compendium-curator-table-profile-bundle",
            version: 1,
            rootProfileId: "legacy-shop",
            profiles: {
                "legacy-shop": {
                    id: "legacy-shop",
                    version: 2,
                    type: "content",
                    name: "Tienda antigua",
                    filterGroupIds: ["legacy-category"],
                    children: [],
                    generation: {}
                }
            },
            filterGroups: {
                "legacy-category": {
                    id: "legacy-category",
                    name: "Categoría antigua",
                    browser: {
                        filters: {
                            documentClass: "Item",
                            name: "poción"
                        }
                    },
                    matches: [],
                    manualIncludes: []
                }
            }
        });

    const [category] =
        imported.rootProfile.filterGroups;

    assert.equal(category.name, "Categoría antigua");
    assert.equal(category.groups.length, 1);
    assert.equal(
        category.groups[0].browser.filters.name,
        "poción"
    );
});

test("combines groups with OR and deduplicates categories by UUID", async () => {
    const original =
        TableProfileService.getBrowserCandidates;
    const documents = {
        a: {
            uuid: "Compendium.test.items.Item.a",
            name: "A",
            system: { rarity: "common" }
        },
        b: {
            uuid: "Compendium.test.items.Item.b",
            name: "B",
            system: { rarity: "common" }
        },
        c: {
            uuid: "Compendium.test.items.Item.c",
            name: "C",
            system: { rarity: "rare" }
        }
    };

    TableProfileService.getBrowserCandidates =
        async (_app, filters) => ({
            first: [documents.a, documents.b],
            second: [documents.b, documents.c],
            third: [documents.c]
        })[filters.marker] ?? [];

    try {
        const preview = await TableProfileService
            .getProfilePreview({}, {
                filterGroups: [{
                    id: "one",
                    name: "Primera",
                    groups: [{
                        browser: {
                            filters: { marker: "first" }
                        }
                    }, {
                        browser: {
                            filters: { marker: "second" }
                        }
                    }]
                }, {
                    id: "two",
                    name: "Segunda",
                    groups: [{
                        browser: {
                            filters: { marker: "third" }
                        }
                    }]
                }],
                manualExcludes: []
            });

        assert.deepEqual(
            preview.groups.map(group => group.count),
            [3, 1]
        );
        assert.equal(preview.totalMatches, 4);
        assert.equal(preview.uniqueCount, 3);
        assert.equal(preview.duplicateEntriesRemoved, 1);
        assert.equal(preview.overlappingObjects, 1);
    }
    finally {
        TableProfileService.getBrowserCandidates =
            original;
    }
});
