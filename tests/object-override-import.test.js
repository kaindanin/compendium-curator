import assert from "node:assert/strict";
import test from "node:test";

import {
    compendiumSourceUuid,
    materializeItemOverride,
    registerObjectOverrideActorImport
} from "../scripts/overrides/object-override-import.js";

const uuid = "Compendium.dnd5e.items.Item.ea4xclqsksEQB1QF";
const patch = [
    { op: "set", path: "/name", value: "Curated Abacus" },
    { op: "set", path: "/system/price/value", value: 200 },
    { op: "set", path: "/system/rarity", value: "rare" },
    { op: "set", path: "/system/description/value", value: "<p>Curated.</p>" }
];
const storage = {
    get(sourceUuid) {
        assert.equal(sourceUuid, uuid);
        return { documentName: "Item", documentType: "loot", patch };
    }
};

function importedSource() {
    return {
        _id: "new-inventory-item",
        name: "Abacus",
        type: "loot",
        _stats: { compendiumSource: uuid, duplicateSource: null },
        system: {
            price: { value: 2, denomination: "gp" },
            quantity: 1,
            rarity: "",
            description: { value: "<p>Official.</p>" }
        },
        flags: { babele: { translated: true } }
    };
}

test("materializes Foundry 14 imports with _stats and no legacy flags", () => {
    const source = importedSource();
    const before = structuredClone(source);
    const result = materializeItemOverride(source, { storage });

    assert.equal(result.name, "Curated Abacus");
    assert.equal(result.system.price.value, 200);
    assert.equal(result.system.price.denomination, "gp");
    assert.equal(result.system.rarity, "rare");
    assert.equal(result.system.description.value, "<p>Curated.</p>");
    assert.equal(result._id, source._id);
    assert.deepEqual(result._stats, source._stats);
    assert.deepEqual(result.flags.babele, source.flags.babele);
    assert.deepEqual(source, before);
});

test("prefers current compendium provenance while retaining both legacy flags", () => {
    assert.equal(compendiumSourceUuid({
        _stats: { compendiumSource: uuid },
        flags: { core: { sourceId: "Compendium.other.items.Item.other" } }
    }), uuid);
    assert.equal(compendiumSourceUuid({
        _stats: { compendiumSource: null },
        flags: { core: { sourceId: uuid } }
    }), uuid);
    assert.equal(compendiumSourceUuid({
        flags: { core: { sourceId: "", sourceUuid: uuid } }
    }), uuid);
    assert.equal(compendiumSourceUuid({
        _stats: { compendiumSource: "Actor.actor.Item.item" }
    }), null);
});

test("transferred inventory snapshots retain their own edits without reading overrides", () => {
    const copy = materializeItemOverride(importedSource(), { storage });
    copy.name = "Player's Abacus";
    copy.system.price.value = 5;
    const before = structuredClone(copy);

    assert.equal(materializeItemOverride(copy, {
        storage: { get() { assert.fail("Detached copies must not resolve overrides"); } }
    }), null);
    assert.deepEqual(copy, before);
});

test("imports without a patch also stay independent of later overrides", () => {
    const source = importedSource();
    const copy = materializeItemOverride(source, { storage: { get: () => null } });

    assert.equal(copy.name, source.name);
    assert.deepEqual(copy.system, source.system);
    assert.equal(materializeItemOverride(copy, { storage }), null);
    assert.equal(source.flags["compendium-curator"], undefined);
});

test("does not reapply compendium ancestry when duplicating world or Actor Items", () => {
    for (const duplicateSource of ["Item.world-item", "Actor.actor.Item.owned-item"]) {
        const source = importedSource();
        source._stats.duplicateSource = duplicateSource;
        assert.equal(materializeItemOverride(source, {
            storage: { get() { assert.fail("World duplicates are independent"); } }
        }), null);
    }
});

test("preCreateItem materializes only the new Actor Item using native _stats", t => {
    let preCreate;
    const previousHooks = globalThis.Hooks;
    const previousGame = globalThis.game;
    t.after(() => {
        globalThis.Hooks = previousHooks;
        globalThis.game = previousGame;
    });
    globalThis.Hooks = { on(name, handler) {
        assert.equal(name, "preCreateItem");
        preCreate = handler;
    } };
    globalThis.game = { settings: { get: () => ({
        version: 1,
        overrides: { [uuid]: { uuid, documentName: "Item", documentType: "loot", patch } }
    }) } };
    registerObjectOverrideActorImport();

    const source = importedSource();
    const before = structuredClone(source);
    let created;
    const document = {
        parent: { documentName: "Actor" },
        toObject: () => structuredClone(source),
        updateSource(value, options) {
            assert.deepEqual(options, { recursive: false });
            created = value;
        },
        update() { assert.fail("Must never persist an update to the source"); }
    };
    preCreate(document);
    assert.equal(created.name, "Curated Abacus");
    assert.equal(created.system.price.value, 200);
    assert.deepEqual(source, before);

    for (const parent of [null, { documentName: "Item" }]) {
        created = null;
        preCreate({ ...document, parent });
        assert.equal(created, null);
    }
});
