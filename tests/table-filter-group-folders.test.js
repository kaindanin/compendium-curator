import assert from "node:assert/strict";
import test from "node:test";

let currentStorage = {
    version: 6,
    folders: {
        tables: {
            id: "tables",
            name: "Tablas",
            parentId: null
        }
    },
    filterGroupFolders: {},
    filterGroups: {
        beasts: {
            id: "beasts",
            name: "Bestias",
            matches: [],
            manualIncludes: [],
            revision: 1
        }
    },
    profiles: {
        animals: {
            id: "animals",
            version: 2,
            type: "content",
            name: "Animales",
            folderId: "tables",
            filterGroupIds: ["beasts"],
            children: [],
            revision: 1,
            generation: {}
        }
    }
};
let nextId = 0;

globalThis.foundry = {
    utils: {
        deepClone: value => structuredClone(value),
        randomID: () => `group-folder-${++nextId}`
    }
};
globalThis.game = {
    settings: {
        get: () => currentStorage,
        set: async (_module, _setting, value) => {
            currentStorage = structuredClone(value);
            return currentStorage;
        }
    }
};
globalThis.fromUuidSync = () => null;

const {
    TableProfileStorageService
} = await import(
    "../scripts/services/table-profile-storage-service.js"
);

test(
    "filter group folders stay independent from table folders",
    async () => {
        const folder = await TableProfileStorageService
            .createFilterGroupFolder("Criaturas");
        await TableProfileStorageService
            .moveFilterGroupToFolder("beasts", folder.id);

        const storage = TableProfileStorageService.getStorage();

        assert.equal(
            storage.filterGroups.beasts.folderId,
            folder.id
        );
        assert.equal(
            storage.profiles.animals.folderId,
            "tables"
        );
        assert.equal(
            storage.folders.tables.name,
            "Tablas"
        );
    }
);
