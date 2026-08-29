import assert from "node:assert/strict";
import test from "node:test";

let storage = {
    version: 6,
    folders: {},
    filterGroupFolders: {},
    filterGroups: {},
    profiles: {
        shop: {
            id: "shop",
            version: 2,
            type: "content",
            name: "Tienda",
            filterGroupIds: [],
            manualIncludes: [
                "Compendium.test.items.Item.legacy"
            ],
            globalFilters: {
                browser: {
                    filters: {
                        documentClass: "Item",
                        types: ["equipment"]
                    }
                },
                matches: [
                    "Compendium.test.items.Item.legacy"
                ]
            },
            revision: 3,
            generation: {}
        }
    }
};

globalThis.foundry = {
    utils: {
        deepClone: value => structuredClone(value),
        equals: (left, right) =>
            JSON.stringify(left) === JSON.stringify(right),
        randomID: () => "generated"
    }
};
globalThis.game = {
    settings: {
        get: () => storage,
        set: async (_module, _key, value) => {
            storage = structuredClone(value);
            return storage;
        }
    }
};

const {
    TableProfileStorageService
} = await import(
    "../scripts/services/table-profile-storage-service.js"
);

test("migrates, stores and clears table restrictions", async () => {
    const migrated = TableProfileStorageService
        .getProfiles().shop;

    assert.deepEqual(migrated.directUuids, [
        "Compendium.test.items.Item.legacy"
    ]);
    assert.deepEqual(migrated.restrictions.matches, [
        "Compendium.test.items.Item.legacy"
    ]);
    assert.equal(migrated.globalFilters, undefined);

    const saved = await TableProfileStorageService
        .setGlobalFilters("shop", {
            browser: {
                tab: "physical",
                advanced: false,
                filters: {
                    documentClass: "Item",
                    types: ["weapon"]
                }
            },
            matches: [
                "Compendium.test.items.Item.b",
                "Compendium.test.items.Item.a",
                "Compendium.test.items.Item.a"
            ]
        });

    assert.equal(saved.revision, 4);
    assert.deepEqual(saved.restrictions.matches, [
        "Compendium.test.items.Item.a",
        "Compendium.test.items.Item.b"
    ]);
    assert.equal(
        saved.restrictions.browser.filters.documentClass,
        "Item"
    );

    const cleared = await TableProfileStorageService
        .setGlobalFilters("shop", null);

    assert.equal(cleared.revision, 5);
    assert.equal(cleared.restrictions, null);
});

test("stores direct objects as a separate local source", async () => {
    const saved = await TableProfileStorageService
        .setDirectUuids("shop", [
            "Compendium.test.items.Item.b",
            "Compendium.test.items.Item.a",
            "Compendium.test.items.Item.a"
        ]);

    assert.deepEqual(saved.directUuids, [
        "Compendium.test.items.Item.a",
        "Compendium.test.items.Item.b"
    ]);
});
