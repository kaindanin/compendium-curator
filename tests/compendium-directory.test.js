import assert from "node:assert/strict";
import test from "node:test";

import {
    collectFolderOptions,
    normalizeFolderId,
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
