import assert from "node:assert/strict";
import test from "node:test";

globalThis.foundry = {
    utils: {
        deepClone: value => structuredClone(value)
    }
};
globalThis.game = {
    i18n: { lang: "es" },
    system: {
        id: "dnd5e",
        version: "5.1.0"
    }
};

const {
    TableManagerConfigurationService
} = await import(
    "../scripts/services/table-manager-configuration-service.js"
);

function validBundle() {
    return {
        type:
            "compendium-curator-table-manager-configuration",
        version: 1,
        systemId: "dnd5e",
        data: {
            tableDefaults: {},
            tableProfiles: {
                version: 6,
                folders: {
                    shops: {
                        id: "shops",
                        name: "Tiendas",
                        parentId: null
                    }
                },
                filterGroupFolders: {
                    creatures: {
                        id: "creatures",
                        name: "Criaturas",
                        parentId: null
                    }
                },
                filterGroups: {
                    magic: {
                        id: "magic",
                        name: "Magia",
                        folderId: "creatures",
                        matches: [
                            "Compendium.test.items.Item.a"
                        ],
                        manualIncludes: []
                    }
                },
                profiles: {
                    parent: {
                        version: 2,
                        id: "parent",
                        type: "content",
                        name: "Tienda",
                        folderId: "shops",
                        filterGroupIds: ["magic"],
                        manualExcludes: [],
                        children: [{
                            profileId: "child",
                            enabled: true,
                            weight: 2
                        }],
                        generation: {
                            rootUuid: "RollTable.old"
                        }
                    },
                    child: {
                        version: 2,
                        id: "child",
                        type: "content",
                        name: "Subtabla",
                        folderId: null,
                        filterGroupIds: [],
                        children: [],
                        generation: {
                            rootUuid: "RollTable.old-child"
                        }
                    }
                }
            }
        }
    };
}

function expectInvalid(mutator) {
    const bundle = validBundle();
    mutator(bundle.data.tableProfiles);

    assert.throws(
        () => TableManagerConfigurationService
            .validateImportBundle(bundle),
        /INVALID_TABLE_MANAGER/
    );
}

test("accepts a complete portable manager backup", () => {
    const result = TableManagerConfigurationService
        .validateImportBundle(validBundle());

    assert.equal(result.profileCount, 2);
    assert.equal(result.filterGroupCount, 1);
    assert.equal(result.folderCount, 1);
    assert.equal(result.filterGroupFolderCount, 1);
    assert.deepEqual(
        result.tableProfiles.profiles.parent
            .generation,
        {}
    );
});

test("accepts categories with nested filter groups", () => {
    const bundle = validBundle();
    const category = bundle.data.tableProfiles
        .filterGroups.magic;

    bundle.data.tableProfiles.version = 7;
    category.groups = [{
        id: "weapons",
        name: "Armas",
        browser: {
            filters: {
                documentClass: "Item",
                types: ["weapon"]
            }
        },
        matches: [],
        manualIncludes: []
    }];
    delete category.matches;
    delete category.manualIncludes;

    const result = TableManagerConfigurationService
        .validateImportBundle(bundle);

    assert.equal(
        result.tableProfiles.filterGroups.magic
            .groups[0].name,
        "Armas"
    );
});

test("rejects duplicate group names inside one category", () => {
    const bundle = validBundle();
    const category = bundle.data.tableProfiles
        .filterGroups.magic;

    category.groups = [{
        id: "one",
        name: "Armas",
        matches: [],
        manualIncludes: []
    }, {
        id: "two",
        name: "ARMAS",
        matches: [],
        manualIncludes: []
    }];
    delete category.matches;
    delete category.manualIncludes;

    assert.throws(
        () => TableManagerConfigurationService
            .validateImportBundle(bundle),
        /INVALID_TABLE_MANAGER/
    );
});

test("rejects missing filter groups", () => {
    expectInvalid(storage => {
        storage.profiles.parent.filterGroupIds = [
            "missing"
        ];
    });
});

test("rejects missing child profiles", () => {
    expectInvalid(storage => {
        storage.profiles.parent.children[0]
            .profileId = "missing";
    });
});

test("rejects invalid relation weights", () => {
    expectInvalid(storage => {
        storage.profiles.parent.children[0].weight = 0;
    });
});

test("rejects cyclic table relations", () => {
    expectInvalid(storage => {
        storage.profiles.child.children = [{
            profileId: "parent",
            enabled: true,
            weight: 1
        }];
    });
});

test("rejects orphaned and cyclic folders", () => {
    expectInvalid(storage => {
        storage.folders.shops.parentId = "missing";
    });

    expectInvalid(storage => {
        storage.folders.other = {
            id: "other",
            name: "Otra",
            parentId: "shops"
        };
        storage.folders.shops.parentId = "other";
    });
});

test("rejects orphaned filter group folders", () => {
    expectInvalid(storage => {
        storage.filterGroups.magic.folderId = "missing";
    });
});
