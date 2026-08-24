import assert from "node:assert/strict";
import test from "node:test";

const storage = {
    version: 6,
    folders: {
        tables: {
            id: "tables",
            name: "Tablas",
            parentId: null
        }
    },
    filterGroupFolders: {
        groups: {
            id: "groups",
            name: "Grupos",
            parentId: null
        }
    },
    filterGroups: {
        beasts: {
            id: "beasts",
            name: "Bestias",
            folderId: "groups",
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

globalThis.foundry = {
    utils: {
        deepClone: value => structuredClone(value)
    }
};
globalThis.game = {
    i18n: { lang: "es" },
    modules: new Map([
        ["compendium-curator", { version: "0.4.0" }]
    ]),
    settings: {
        get: () => storage
    }
};
globalThis.fromUuidSync = () => null;

const {
    TableProfileStorageService
} = await import(
    "../scripts/services/table-profile-storage-service.js"
);

test(
    "single table exports omit table and group folder locations",
    () => {
        const bundle = TableProfileStorageService
            .exportProfileBundle("animals");

        assert.equal(
            bundle.profiles.animals.folderId,
            null
        );
        assert.equal(
            Object.hasOwn(
                bundle.filterGroups.beasts,
                "folderId"
            ),
            false
        );
        assert.equal(
            Object.hasOwn(bundle, "folders"),
            false
        );
        assert.equal(
            Object.hasOwn(bundle, "filterGroupFolders"),
            false
        );
    }
);
