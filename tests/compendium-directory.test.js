import assert from "node:assert/strict";
import test from "node:test";

import {
    collectFolderOptions,
    normalizeFolderId,
    purgeFolderDeletion,
    snapshotFolderDeletion,
    synchronizeIndexFolder
} from "../scripts/hooks/compendium-directory.js";


test("normalizes compendium folder references", () => {
    assert.equal(normalizeFolderId(null), null);
    assert.equal(normalizeFolderId("folder-a"), "folder-a");
    assert.equal(
        normalizeFolderId({ id: "folder-b" }),
        "folder-b"
    );
    assert.equal(
        normalizeFolderId({ _id: "folder-c" }),
        "folder-c"
    );
});


test("builds hierarchical bulk-move folder options", () => {
    const tree = {
        children: [{
            folder: { id: "a", name: "A" },
            children: [{
                folder: { id: "b", name: "B" },
                children: []
            }]
        }, {
            folder: { id: "c", name: "C" },
            children: []
        }]
    };

    assert.deepEqual(collectFolderOptions(tree), [{
        id: "a",
        name: "A",
        depth: 0
    }, {
        id: "b",
        name: "B",
        depth: 1
    }, {
        id: "c",
        name: "C",
        depth: 0
    }]);
});


test("synchronizes a moved document into the compendium index", () => {
    const index = new Map([["entry-1", {
        _id: "entry-1",
        folder: null
    }]]);
    const document = { id: "entry-1" };
    const pack = {
        index,
        indexDocument() {}
    };

    synchronizeIndexFolder(pack, document, "folder-1");

    assert.equal(
        index.get("entry-1").folder,
        "folder-1"
    );
});


test("purges deleted folder branches from a compendium index", () => {
    const folders = new Map([
        ["root", {
            id: "root",
            folder: null
        }],
        ["child", {
            id: "child",
            folder: "root"
        }],
        ["safe", {
            id: "safe",
            folder: null
        }]
    ]);
    const index = new Map([
        ["root-entry", {
            _id: "root-entry",
            folder: "root"
        }],
        ["child-entry", {
            _id: "child-entry",
            folder: "child"
        }],
        ["safe-entry", {
            _id: "safe-entry",
            folder: "safe"
        }]
    ]);
    let initialized = 0;
    const pack = {
        folders,
        index,
        initializeTree() {
            initialized += 1;
        }
    };
    const snapshot = snapshotFolderDeletion(
        pack,
        "root",
        true
    );

    purgeFolderDeletion(snapshot);

    assert.deepEqual(
        Array.from(index.keys()),
        ["safe-entry"]
    );
    assert.deepEqual(
        Array.from(folders.keys()),
        ["safe"]
    );
    assert.equal(initialized, 1);
});
