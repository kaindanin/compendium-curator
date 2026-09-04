import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { saveTableContent, categoryContentUuids, tableContentUuids } from "../scripts/services/table-content-workspace-service.js";
import { TableProfileStorageService } from "../scripts/services/table-profile-storage-service.js";
import { TableProfileService } from "../scripts/services/table-profile-service.js";
import { StorageService } from "../scripts/services/storage-service.js";

globalThis.foundry = {
    utils: { deepClone: structuredClone },
    applications: {
        api: {
            ApplicationV2: class {
                async _prepareContext() { return {}; }
                async _preClose() {}
                async close() { await this._preClose({}); }
            },
            HandlebarsApplicationMixin: cls => cls
        },
        handlebars: { renderTemplate: async (_path, data) => JSON.stringify(data) }
    }
};
globalThis.Hooks = { on: () => 1, off() {} };
globalThis.document = { addEventListener() {}, removeEventListener() {} };
globalThis.CONFIG = { Item: { typeLabels: { loot: "Loot" } } };
const { TableManagerContentApplication } = await import("../scripts/applications/table-manager-content-application.js");

function setup(t) {
    const state = { writes: 0, storage: {
        version: 10,
        profiles: {
            parent: { id: "parent", version: 2, type: "content", name: "Parent", revision: 4,
                filterGroupIds: ["first"], directUuids: ["Item.original"], manualExcludes: ["Item.old"],
                children: [{ profileId: "child", enabled: true, weight: 7 }],
                itemRules: { excludeZeroPrice: true }, generation: { rootUuid: "RollTable.keep" } },
            child: { id: "child", version: 2, type: "content", name: "Child", filterGroupIds: [], directUuids: [], children: [] },
            other: { id: "other", version: 2, type: "content", name: "Other", filterGroupIds: [], directUuids: [], children: [] }
        },
        filterGroups: { first: { id: "first", name: "First", matches: [] }, second: { id: "second", name: "Second", matches: [] } },
        folders: { keep: { name: "Untouched" } }
    } };
    globalThis.game = { i18n: { lang: "en", localize: key => key }, packs: [], settings: {
        get: () => ({ overrides: {} }),
        async set(module, key, storage) {
            assert.equal(module, "compendium-curator");
            assert.equal(key, "tableProfiles", "must not write global hidden state");
            state.writes++;
            state.storage = storage;
        }
    } };
    t.mock.method(TableProfileStorageService, "getStorage", () => structuredClone(state.storage));
    t.mock.method(TableProfileStorageService, "getProfiles", () => structuredClone(state.storage.profiles));
    t.mock.method(TableProfileStorageService, "getFilterGroups", () => structuredClone(state.storage.filterGroups));
    t.mock.method(StorageService, "getHiddenUuids", () => []);
    globalThis.fromUuidSync = uuid => ({ uuid, name: uuid, documentName: "Item", type: "loot", system: { price: { value: 1, denomination: "gp" } } });
    return state;
}

test("saves all four sections atomically and preserves source configuration and relation weights", async t => {
    const state = setup(t);
    const before = structuredClone(state.storage);
    await saveTableContent("parent", {
        categoryIds: ["second"], tableIds: ["child", "other"],
        inclusions: ["Item.new", "Item.new"], exclusions: ["Item.new", "Item.old"]
    });
    const parent = state.storage.profiles.parent;
    assert.equal(state.writes, 1);
    assert.deepEqual(parent.filterGroupIds, ["second"]);
    assert.deepEqual(parent.directUuids, ["Item.new"]);
    assert.deepEqual(parent.manualExcludes, ["Item.new", "Item.old"]);
    assert.deepEqual(parent.children, [
        { profileId: "child", enabled: true, weight: 7 },
        { profileId: "other", enabled: true, weight: 1 }
    ]);
    assert.equal(parent.revision, 5);
    assert.deepEqual(parent.itemRules, before.profiles.parent.itemRules);
    assert.deepEqual(parent.generation, before.profiles.parent.generation);
    assert.deepEqual(state.storage.profiles.child, before.profiles.child);
    assert.deepEqual(state.storage.profiles.other, before.profiles.other);
    assert.deepEqual(state.storage.filterGroups, before.filterGroups);
    assert.deepEqual(state.storage.folders, before.folders);
});

test("rejects deleted categories and cyclic table links before any write", async t => {
    const state = setup(t);
    const draft = { categoryIds: ["missing"], tableIds: ["child"], inclusions: [], exclusions: [] };
    await assert.rejects(saveTableContent("parent", draft), /TABLE_FILTER_GROUP_NOT_FOUND/);
    draft.categoryIds = ["first"];
    state.storage.profiles.child.children = [{ profileId: "parent", weight: 1, enabled: true }];
    await assert.rejects(saveTableContent("parent", draft), /INVALID_NESTED_TABLE_CHILD/);
    assert.equal(state.writes, 0);
});

test("unchanged save is a no-op and deselecting a table keeps its relation weight", async t => {
    const state = setup(t);
    const draft = { categoryIds: ["first"], tableIds: ["child"], inclusions: ["Item.original"], exclusions: ["Item.old"] };
    assert.equal(await saveTableContent("parent", draft), false);
    assert.equal(state.writes, 0);
    await saveTableContent("parent", { ...draft, tableIds: [] });
    assert.deepEqual(state.storage.profiles.parent.children, [{ profileId: "child", weight: 7, enabled: false }]);
});

test("drafts survive Browser rerenders, preserve invisible exclusions, and cancel without persisting", async t => {
    const state = setup(t);
    const manager = { browserApp: {} };
    const app = new TableManagerContentApplication(manager, "parent");
    await app._prepareContext({});
    app._selection.select("Item.new");
    app._categoryIds.add("second");
    app._tableIds.add("other");
    app._excluded.add("Item.new");
    app._browserCandidates = [{ uuid: "Item.another" }];
    const context = await app._prepareContext({});
    assert.equal(context.selectedCount, 2);
    assert.equal(context.selectedGroupCount, 2);
    assert.equal(context.selectedTableCount, 2);
    assert.equal(context.excludedCount, 2);
    assert.deepEqual(context.candidates.map(e => e.uuid), ["Item.another"]);
    assert.equal(state.writes, 0);
    await TableManagerContentApplication.DEFAULT_OPTIONS.actions.cancel.call(app);
    const reopened = new TableManagerContentApplication(manager, "parent");
    const restored = await reopened._prepareContext({});
    assert.equal(restored.selectedCount, 1);
    assert.equal(restored.excludedCount, 1);
    assert.equal(state.writes, 0);
    await reopened.close();
});

test("category preview uses its own persisted criteria and includes, never the draft parent rules", async t => {
    setup(t);
    const category = { id: "first", groups: [{ browser: { filters: { type: "loot" } } }], manualIncludes: ["Item.manual"] };
    t.mock.method(TableProfileService, "resolveLocalContentSources", async (_browser, profile) => {
        assert.deepEqual(profile.filterGroups, [category]);
        assert.deepEqual(profile.manualExcludes, []);
        return { candidates: [{ uuid: "Item.auto" }, { uuid: "Item.manual" }, { uuid: "Item.auto" }] };
    });
    assert.deepEqual(await categoryContentUuids({}, category), ["Item.auto", "Item.manual"]);
});

test("table preview traverses enabled links safely without inheriting parent exclusions", async t => {
    const state = setup(t);
    const calls = [];
    t.mock.method(TableProfileService, "resolveLocalContentSources", async (_browser, profile) => {
        calls.push({ id: profile.id, excluded: profile.manualExcludes });
        return { sources: [] };
    });
    // Defensive cycle guard; existing corrupt data must not recurse forever.
    state.storage.profiles.child.children = [{ profileId: "parent", enabled: true, weight: 1 }];
    await tableContentUuids({}, "parent", state.storage.profiles, state.storage.filterGroups);
    assert.deepEqual(calls.map(c => c.id), ["parent", "child"]);
    assert.deepEqual(calls[0].excluded, ["Item.old"]);
    assert.equal(calls[1].excluded, undefined);
});

test("table previews deduplicate local and linked objects and omit disabled links", async t => {
    const state = setup(t);
    state.storage.profiles.parent.children.push({ profileId: "other", enabled: false, weight: 1 });
    t.mock.method(TableProfileService, "resolveLocalContentSources", async (_browser, profile) => ({
        sources: [{ kind: "direct", candidates: [
            { uuid: "Item.shared" }, { uuid: `Item.${profile.id}` }
        ] }]
    }));
    assert.deepEqual(
        new Set(await tableContentUuids({}, "parent", state.storage.profiles, state.storage.filterGroups)),
        new Set(["Item.shared", "Item.parent", "Item.child"])
    );
});

test("workspace templates keep section order, shared lists, and non-editable source previews", () => {
    const root = new URL("../templates/", import.meta.url);
    const main = readFileSync(new URL("table-manager-content.hbs", root), "utf8");
    const keys = [...main.matchAll(/data-cc-content-key="(categories|tables|inclusions|exclusions)"/g)].map(m => m[1]);
    assert.deepEqual(keys, ["categories", "tables", "inclusions", "exclusions"]);
    const preview = readFileSync(new URL("table-content-preview.hbs", root), "utf8");
    assert.match(preview, /data-cc-preview-only/);
    assert.doesNotMatch(preview, /<input|<button|<select|draggable="true"/);
    const manager = readFileSync(new URL("table-manager.hbs", root), "utf8");
    assert.doesNotMatch(manager, /data-action="profileInclusions"|data-action="manualExclusions"/);
    assert.match(manager, /data-action="filterGroupInclusions"/, "category UI stays unchanged");
    const linked = readFileSync(new URL("../scripts/services/table-manager-linked-table-expanded-preview-service.js", import.meta.url), "utf8");
    assert.match(linked, /"\[data-cc-manage-content\]"/, "cloned linked-table previews must remove the new pencil");
});
