import assert from "node:assert/strict";
import test from "node:test";

import {
    createOfficialContextMenu,
    findPackEntry
} from "../scripts/services/compendium-context-menu-service.js";


test("resolves legacy compendium UUIDs to their pack entry", () => {
    const pack = {
        collection: "dnd5e.items",
        index: new Map()
    };

    assert.deepEqual(
        findPackEntry(
            "Compendium.dnd5e.items.entry-1",
            [pack]
        ),
        { pack, entryId: "entry-1" }
    );
});


test("prefers the indexed id for typed compendium UUIDs", () => {
    const indexed = {
        _id: "entry-2",
        uuid: "Compendium.dnd5e.items.Item.entry-2"
    };
    const pack = {
        collection: "dnd5e.items",
        index: {
            find(predicate) {
                return predicate(indexed) ? indexed : undefined;
            }
        }
    };

    assert.equal(
        findPackEntry(indexed.uuid, [pack]).entryId,
        "entry-2"
    );
});


test("ignores non-compendium and unmatched UUIDs", () => {
    assert.equal(findPackEntry("Item.entry-1", []), null);
    assert.equal(
        findPackEntry(
            "Compendium.other.items.entry-1",
            [{ collection: "dnd5e.items" }]
        ),
        null
    );
});


test("creates Item and Actor menus through the official hook flow", () => {
    const calls = [];
    const application = {
        _getEntryContextOptions() {
            return [{ name: "official" }];
        }
    };

    globalThis.document = {
        createElement() {
            return { detached: true };
        }
    };
    globalThis.Hooks = {
        callAll(...args) {
            calls.push(args);
            args[2].push({ name: "system" });
        }
    };
    class TestContextMenu {
        constructor(...args) {
            this.args = args;
        }
    }
    globalThis.foundry = {
        applications: {
            ux: {
                ContextMenu: {
                    implementation: TestContextMenu
                }
            }
        }
    };

    const menu = createOfficialContextMenu(application, {
        documentName: "Item"
    });
    const actorMenu = createOfficialContextMenu(application, {
        documentName: "Actor"
    });

    assert.equal(menu.args[0].detached, true);
    assert.equal(
        menu.args[1],
        ".item-list > .item[data-uuid]"
    );
    assert.deepEqual(
        menu.args[2].map(entry => entry.name),
        ["official", "system"]
    );
    assert.deepEqual(menu.args[3], {
        fixed: true,
        jQuery: false,
        relative: "cursor"
    });
    assert.equal(calls[0][0], "getItemContextOptions");
    assert.equal(calls[0][1], application);
    assert.deepEqual(
        actorMenu.args[2].map(entry => entry.name),
        ["official", "system"]
    );
    assert.equal(calls[1][0], "getActorContextOptions");
    assert.equal(calls[1][1], application);

    delete globalThis.document;
    delete globalThis.Hooks;
    delete globalThis.foundry;
});
