import assert from "node:assert/strict";
import test from "node:test";

import {
    activateDnd5eDocumentEntries,
    ensureDnd5eDistributionIndexes,
    getDnd5eDistributionIndexEntry,
    prepareDnd5eDocumentEntries,
    prepareDnd5eIndexedEntries
} from "../scripts/ui/dnd5e-document-list.js";
import {
    registerTableManagerSynchronization
} from "../scripts/services/table-manager-sync-service.js";
import {
    OBJECT_OVERRIDES_CHANGED_HOOK
} from "../scripts/settings.js";

class Collection extends Map {
    [Symbol.iterator]() { return this.values(); }
}

let fixtureNumber = 0;

function fixture() {
    const collection = `test.items${++fixtureNumber}`;
    const uuid = `Compendium.${collection}.Item.abacus`;
    const source = {
        _id: "abacus",
        name: "Abacus",
        type: "loot",
        img: "icons/abacus.webp",
        system: {
            source: { book: "SRD", value: "SRD", custom: "" },
            price: { value: 2, denomination: "gp" }
        }
    };
    const original = {
        ...structuredClone(source), uuid, documentName: "Item",
        toObject: () => structuredClone(source)
    };
    const state = { reads: 0, loads: 0, overrides: {
        [uuid]: { documentName: "Item", documentType: "loot", patch: [
            { op: "set", path: "/name", value: "Z modified abacus" },
            { op: "set", path: "/img", value: "icons/modified.webp" },
            { op: "set", path: "/system/source/book", value: "Custom book" },
            { op: "set", path: "/system/price/value", value: 0 }
        ] }
    } };
    const pack = {
        collection, documentName: "Item", indexFields: new Set(),
        index: new Collection([[source._id, structuredClone(source)]]),
        async getIndex() { return this.index; },
        async getDocument() { state.loads++; return original; }
    };
    globalThis.game = {
        packs: new Collection([[collection, pack]]),
        i18n: { lang: "en" },
        settings: {
            get() { state.reads++; return { overrides: state.overrides }; }
        }
    };
    globalThis.CONFIG = { Item: { typeLabels: { loot: "Loot" } } };
    globalThis.foundry = { utils: {
        deepClone: structuredClone,
        mergeObject: (left, right) => ({ ...left, ...right })
    } };
    globalThis.fromUuidSync = () => null;
    return { uuid, source, original, pack, state };
}

test("table rows project overrides from an index without changing originals or eligibility", () => {
    const { uuid, source, pack, state } = fixture();
    const snapshot = structuredClone([...pack.index.entries()]);
    pack.index.set("other", { ...source, _id: "other", name: "Other" });
    const other = `Compendium.${pack.collection}.Item.other`;
    const rows = prepareDnd5eIndexedEntries([uuid, other, uuid]);

    assert.deepEqual(rows.map(row => row.uuid), [other, uuid]);
    const row = rows[1];
    assert.equal(row.name, "Z modified abacus");
    assert.equal(row.img, "icons/modified.webp");
    assert.equal(row.source, "Custom book");
    assert.equal(row.subtitle, "Loot");
    assert.equal(row.hasPositivePrice, true);
    assert.equal(row.available, true);
    assert.equal(state.reads, 1, "one override snapshot for the whole list");
    assert.equal(state.loads, 0, "list projection must remain index-only");
    assert.deepEqual(pack.index.get("abacus"), snapshot[0][1]);
});

test("category rows project the private cache and return to original after override removal", async () => {
    const { uuid, pack, state } = fixture();
    assert.equal(await ensureDnd5eDistributionIndexes({ force: true }), true);
    const baseline = structuredClone(getDnd5eDistributionIndexEntry(uuid));
    pack.index.clear(); // Browser rebuilding its index must not break the list.

    assert.equal(prepareDnd5eIndexedEntries([uuid])[0].name, "Z modified abacus");
    state.overrides[uuid].patch.push({
        op: "set", path: "/system/source/custom", value: "My source"
    });
    assert.equal(prepareDnd5eIndexedEntries([uuid])[0].source, "My source");
    assert.deepEqual(getDnd5eDistributionIndexEntry(uuid), baseline);

    delete state.overrides[uuid];
    const restored = prepareDnd5eIndexedEntries([uuid])[0];
    assert.equal(restored.name, baseline.name);
    assert.equal(restored.img, baseline.img);
    assert.equal(restored.source, "SRD");
    assert.equal(state.loads, 0);
});

test("full-document lists use the same projection and leave world copies independent", async () => {
    const { uuid, original, state } = fixture();
    const snapshot = original.toObject();
    const world = { ...original, uuid: "Item.copy", name: "Independent copy" };
    state.overrides[world.uuid] = state.overrides[uuid];
    globalThis.fromUuid = async id => id === uuid ? original : world;
    globalThis.fromUuidSync = id => id === world.uuid ? world : null;

    const rows = await prepareDnd5eDocumentEntries([uuid, world.uuid]);
    assert.equal(rows.find(row => row.uuid === uuid).name, "Z modified abacus");
    assert.equal(rows.find(row => row.uuid === world.uuid).name, "Independent copy");
    assert.equal(prepareDnd5eIndexedEntries([world.uuid])[0].name, "Independent copy");
    assert.deepEqual(original.toObject(), snapshot);
    assert.equal(original.name, "Abacus");
});

test("mismatched overrides and unavailable documents retain the normal list behavior", () => {
    const { uuid, state } = fixture();
    state.overrides[uuid].documentType = "weapon";
    assert.equal(prepareDnd5eIndexedEntries([uuid])[0].name, "Abacus");
    const missing = prepareDnd5eIndexedEntries(["Item.missing"])[0];
    assert.equal(missing.available, false);
    assert.equal(missing.uuid, "Item.missing");
});

test("full documents retain derived source labels when only their name is overridden", async () => {
    const { uuid, original, state } = fixture();
    const raw = original.toObject();
    raw.system.source = { custom: "" };
    original.toObject = () => structuredClone(raw);
    state.overrides[uuid].patch = [{ op: "set", path: "/name", value: "Renamed" }];
    globalThis.fromUuid = async () => original;
    let row = (await prepareDnd5eDocumentEntries([uuid]))[0];
    assert.equal(row.name, "Renamed");
    assert.equal(row.source, "SRD");
    state.overrides[uuid].patch.push({
        op: "set", path: "/system/source/custom", value: "My source"
    });
    row = (await prepareDnd5eDocumentEntries([uuid]))[0];
    assert.equal(row.source, "My source");
});

test("modified native tooltips attach only to the name, never the weight or row", async () => {
    const { uuid, source, original, pack, state } = fixture();
    let finish;
    const tooltipStarted = new Promise(resolve => { finish = resolve; });
    CONFIG.Item.documentClass = class {
        constructor(data) { this.source = data; }
        async richTooltip() {
            finish();
            return { content: `${this.source.name}: ${this.source.system.price.value}` };
        }
    };
    function row(id) {
        const control = {
            dataset: {}, isConnected: true, querySelector: () => null,
            addEventListener(_event, handler) { this.click = handler; }
        };
        return {
            dataset: { uuid: id, tooltip: "old whole-row hover" },
            querySelector: () => control, control
        };
    }
    pack.index.set("other", { ...source, _id: "other" });
    const changed = row(uuid);
    const unchanged = row(`Compendium.${pack.collection}.Item.other`);
    activateDnd5eDocumentEntries({ querySelectorAll: () => [changed, unchanged] });
    await tooltipStarted;
    await Promise.resolve();

    assert.equal(changed.control.dataset.tooltip, "Z modified abacus: 0");
    assert.match(unchanged.control.dataset.tooltip, /class="loading"/);
    assert.equal(changed.dataset.tooltip, undefined);
    assert.equal(unchanged.dataset.tooltip, undefined);
    assert.equal(state.loads, 1);
    assert.equal(state.reads, 1);
    assert.equal(original.name, "Abacus");
    let opened = false;
    globalThis.fromUuid = async id => {
        assert.equal(id, uuid);
        return { sheet: { render: () => { opened = true; } } };
    };
    await changed.control.click({ preventDefault() {}, stopPropagation() {} });
    assert.equal(opened, true);
});

test("an override change refreshes open managers without re-evaluating saved filters", async t => {
    fixture();
    const hooks = new Map();
    globalThis.Hooks = { on: (name, handler) => hooks.set(name, handler) };
    const timers = new Map();
    let timerId = 0;
    t.mock.method(globalThis, "setTimeout", handler => {
        timers.set(++timerId, handler);
        return timerId;
    });
    t.mock.method(globalThis, "clearTimeout", id => timers.delete(id));
    class TableManagerApplication {
        rendered = true;
        _ccFilterGroupsInitialSync = true;
        browserApp = { element: { isConnected: true } };
        renders = 0;
        render() { this.renders++; }
    }
    const manager = new TableManagerApplication();
    Object.defineProperty(manager, "_ccFilterGroupSyncPromise", {
        get() { throw new Error("Display refresh must not synchronize filters"); }
    });
    registerTableManagerSynchronization();
    hooks.get("renderApplicationV2")(manager);
    hooks.get(OBJECT_OVERRIDES_CHANGED_HOOK)();
    hooks.get(OBJECT_OVERRIDES_CHANGED_HOOK)();
    assert.equal(timers.size, 1, "coalesce rapid override changes");
    await [...timers.values()][0]();
    assert.equal(manager.renders, 1);

    timers.clear();
    hooks.get("updateItem")();
    const pendingSync = [...timers.entries()];
    hooks.get(OBJECT_OVERRIDES_CHANGED_HOOK)();
    assert.deepEqual([...timers.entries()], pendingSync,
        "an override must not cancel a pending native document sync");

    manager.rendered = false;
    timers.clear();
    hooks.get(OBJECT_OVERRIDES_CHANGED_HOOK)();
    assert.equal(timers.size, 0, "closed managers are not refreshed");
});
