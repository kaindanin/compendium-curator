import assert from "node:assert/strict";
import test from "node:test";
import { filterOverrideRows, loadOverrideRows, prepareOverrideRow } from "../scripts/overrides/object-override-manager-model.js";
import { ObjectOverridePatchEngine } from "../scripts/overrides/object-override-patch-engine.js";
import { ObjectOverrideStorageService } from "../scripts/overrides/object-override-storage-service.js";
import { ItemSheetOverrideController } from "../scripts/hooks/item-sheet-overrides.js";

const uuid = "Compendium.test.items.Item.abacus";
const original = {
    name: "Ábaco", type: "loot", img: "icons/svg/item-bag.svg",
    system: { price: { value: 2, denomination: "gp" }, source: { book: "PHB" }, description: { value: "<p>Original</p>" } },
    effects: []
};
function documentFor(id = uuid) {
    return { uuid: id, type: "loot", documentName: "Item", toObject: () => structuredClone(original),
        update() { assert.fail("Must never persist original"); },
        delete() { assert.fail("Must never delete original"); } };
}
function recordFor(name = "Ábaco de oro") {
    return { version: 1, documentName: "Item", documentType: "loot", updatedAt: 123,
        patch: ObjectOverridePatchEngine.diff(original, { ...original, name }) };
}

test("manager resolves saved modifications without changing originals or patch records", () => {
    const document = documentFor();
    document.system = { schema: { getField: path => path === "price.value" ? { label: "DND5E.Price" } : undefined } };
    const snapshot = document.toObject();
    const working = structuredClone(original);
    working.name = "Ábaco de oro";
    working.system.price.value = 20;
    working.effects.push({ _id: "effect1", name: "Prueba" });
    const record = { ...recordFor(), patch: ObjectOverridePatchEngine.diff(original, working) };
    const saved = structuredClone(record);
    const row = prepareOverrideRow(uuid, record, document, "Objetos de prueba");
    assert.equal(row.name, "Ábaco de oro");
    assert.equal(row.originalName, "Ábaco");
    assert.equal(row.source, "PHB");
    assert.equal(row.packLabel, "Objetos de prueba");
    assert.equal(row.renamed, true);
    assert.equal(row.available, true);
    assert.deepEqual(row.changes.map(change => change.path), ["/effects", "/name", "/system/price/value"]);
    assert.equal(row.changes[2].before.value, 2);
    assert.equal(row.changes[2].nativeLabel, "DND5E.Price");
    assert.equal(row.changes[2].after.value, 20);
    assert.deepEqual(document.toObject(), snapshot);
    assert.deepEqual(record, saved);
});

test("search matches original and modified names, ignores accents and combines filters", () => {
    const rows = [prepareOverrideRow(uuid, recordFor("Calculadora"), documentFor())];
    assert.equal(filterOverrideRows(rows, { search: " ABACO " }).length, 1);
    assert.equal(filterOverrideRows(rows, { search: "calculadora", type: "loot", packId: "test.items" }).length, 1);
    assert.equal(filterOverrideRows(rows, { search: "abaco", type: "weapon" }).length, 0);
    assert.equal(filterOverrideRows(rows, { packId: "other.pack" }).length, 0);
    assert.equal(filterOverrideRows(rows, { search: "missing" }).length, 0);
});

test("only persisted patches are loaded and unavailable sources remain visible", async () => {
    const records = { [uuid]: recordFor(), "Compendium.missing.pack.Item.gone": recordFor("Ausente"), empty: { patch: [] } };
    const calls = [];
    const rows = await loadOverrideRows(records, {
        loadDocument: async id => { calls.push(id); if (id !== uuid) throw new Error("Unavailable"); return documentFor(id); },
        packLabel: () => null
    });
    assert.equal(rows.length, 2);
    assert.deepEqual(calls.sort(), Object.keys(records).filter(key => key !== "empty").sort());
    assert.equal(rows[1].available, false);
    assert.equal(rows[1].name, "Ausente");
    assert.equal(rows[1].originalName, "Ábaco");
    assert.equal(rows[1].changes[0].before.value, "Ábaco");
    assert.equal(Object.keys(records).length, 3);
});

test("incompatible record metadata never applies a patch to a different document type", () => {
    const row = prepareOverrideRow(uuid, { ...recordFor(), documentType: "weapon" }, documentFor());
    assert.equal(row.name, "Ábaco");
    assert.equal(row.changes.length, 0);
});

test("bulk reset writes once, deduplicates selection, preserves unrelated and newly changed records", async t => {
    const second = "Compendium.test.items.Item.second";
    const third = "Compendium.test.items.Item.third";
    let storage = { version: 1, overrides: { [uuid]: recordFor(), [second]: recordFor("Segundo"), [third]: recordFor("Tercero") } };
    const expectedRecords = structuredClone(storage.overrides);
    storage.overrides[second] = recordFor("Cambio mientras confirma");
    const snapshotThird = structuredClone(storage.overrides[third]);
    let writes = 0;
    const oldGame = globalThis.game;
    t.after(() => { globalThis.game = oldGame; });
    globalThis.game = { settings: {
        get: () => structuredClone(storage),
        set: async (module, key, value) => {
            assert.equal(module, "compendium-curator"); assert.equal(key, "objectOverrides");
            storage = structuredClone(value); writes++;
        }
    } };
    const removed = await ObjectOverrideStorageService.removeMany([uuid, uuid, second, "missing"], { expectedRecords });
    assert.deepEqual(removed, [uuid]);
    assert.equal(writes, 1);
    assert.equal(storage.overrides[uuid], undefined);
    assert.deepEqual(storage.overrides[third], snapshotThird);
    assert.equal(storage.overrides[second].patch[0].value, "Cambio mientras confirma");
    assert.deepEqual(await ObjectOverrideStorageService.removeMany([uuid]), []);
    assert.equal(writes, 1);
    assert.deepEqual(await ObjectOverrideStorageService.removeMany([second, third]), [second, third]);
    assert.equal(writes, 2);
    assert.deepEqual(storage.overrides, {});
});

test("removing an override resets the open session including drafts without persisting the original", async t => {
    const previous = { game: globalThis.game, Hooks: globalThis.Hooks };
    t.after(() => Object.assign(globalThis, previous));
    const callbacks = new Map();
    globalThis.Hooks = { on: (name, callback) => { callbacks.set(name, callback); return 1; }, off: name => callbacks.delete(name) };
    globalThis.game = { settings: { get: () => ({ overrides: { [uuid]: recordFor() } }) } };
    const document = documentFor();
    const snapshot = document.toObject();
    const controller = new ItemSheetOverrideController({ document });
    assert.equal(controller.session.workingSource.name, "Ábaco de oro");
    controller.session.beginEditing();
    controller.session.setField("name", "Borrador");
    controller._dirtyControlPaths.add("name");
    await controller.resetRemovedOverride();
    assert.equal(controller.session.editing, false);
    assert.deepEqual(controller.session.patch, []);
    assert.deepEqual(controller.session.workingSource, snapshot);
    assert.equal(controller._dirtyControlPaths.size, 0);
    assert.deepEqual(document.toObject(), snapshot);
    controller.syntheticSheet = {};
    controller.dispose();
    assert.equal(callbacks.size, 0);
});

test("row buttons prevent disclosure toggling but still bubble to native ApplicationV2 actions", async t => {
    const previous = { foundry: globalThis.foundry, Hooks: globalThis.Hooks, game: globalThis.game, CONFIG: globalThis.CONFIG };
    t.after(() => Object.assign(globalThis, previous));
    class ApplicationV2 { async _onRender() {} }
    globalThis.foundry = { applications: { api: { ApplicationV2, HandlebarsApplicationMixin: base => base } } };
    globalThis.Hooks = { on: () => 1, off() {} };
    const { ObjectOverrideManagerApplication, displayOverrideValue } = await import("../scripts/applications/object-override-manager-application.js");
    const app = new ObjectOverrideManagerApplication();
    let listener;
    app.element = {
        querySelector: () => null,
        querySelectorAll: selector => selector === "summary button"
            ? [{ addEventListener: (_name, callback) => { listener = callback; } }]
            : []
    };
    await app._onRender({}, {});
    let prevented = false;
    listener({ preventDefault: () => { prevented = true; }, stopPropagation: () => assert.fail("Native actions must receive the click") });
    assert.equal(prevented, true);
    assert.equal(typeof ObjectOverrideManagerApplication.DEFAULT_OPTIONS.actions.openItem, "function");
    assert.equal(typeof ObjectOverrideManagerApplication.DEFAULT_OPTIONS.actions.resetItem, "function");
    globalThis.game = { i18n: { localize: value => value } };
    globalThis.CONFIG = { DND5E: { currencies: { gp: { label: "Oro" } }, itemProperties: { ada: { label: "Adamantino" } } } };
    assert.equal(displayOverrideValue({ exists: true, value: "gp" }, "/system/price/denomination"), "Oro");
    assert.equal(displayOverrideValue({ exists: true, value: ["ada"] }, "/system/properties"), "Adamantino");
    assert.equal(displayOverrideValue({ exists: true, value: "<Sword> & Staff" }, "/name"), "<Sword> & Staff");
});
