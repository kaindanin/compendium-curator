import assert from "node:assert/strict";
import test from "node:test";
import { StorageService } from "../scripts/services/storage-service.js";
import { TableProfileService } from "../scripts/services/table-profile-service.js";
import { TableDirectInclusionSelection } from "../scripts/services/table-direct-inclusion-selection-service.js";

globalThis.foundry = {
    utils: { deepClone: structuredClone },
    applications: { api: {
        ApplicationV2: class {
            rendered = true;
            element = { querySelector: () => null };
            renders = 0;
            render() { this.renders++; }
            async _preClose() {}
        },
        HandlebarsApplicationMixin: cls => cls
    } }
};
globalThis.Hooks = { on: () => 1, off() {} };
globalThis.document = { addEventListener() {}, removeEventListener() {} };
globalThis.game = { i18n: { lang: "es" } };
globalThis.CONFIG = {
    Item: { documentClass: { documentName: "Item" }, dataModels: {} },
    Actor: { documentClass: { documentName: "Actor" }, dataModels: {} }
};
const { TableProfileDirectObjectsApplication } = await import("../scripts/applications/table-profile-direct-objects-application.js");

const documents = [
    { uuid: "Item.wizard", name: "Mago", type: "class", documentName: "Item" },
    { uuid: "Item.bard", name: "Bardo", type: "class", documentName: "Item" },
    { uuid: "Item.abacus", name: "Ábaco", type: "loot", documentName: "Item" },
    { uuid: "Actor.goblin", name: "Goblin", type: "npc", documentName: "Actor" }
];

class Browser {
    state = { documentClass: "Item", types: new Set(["class"]) };
    // D&D5e returns a fresh merged snapshot; assigning to it cannot set native filters.
    get currentFilters() { return structuredClone(this.state); }
    element = {
        querySelector: selector => selector.startsWith("search") ? { value: "Mago" } : null,
        querySelectorAll: () => []
    };
    static applyFilters() { return []; }
    static async fetch(documentClass, { filters, types }) {
        return documents.filter(entry => entry.documentName === documentClass.documentName &&
            (!types.size || types.has(entry.type)) && filters.every(filter =>
                filter.k !== "name" || entry.name.toLowerCase().includes(filter.v.toLowerCase())));
    }
}

function setup(t) {
    t.mock.method(StorageService, "getHiddenUuids", () => []);
    const browser = new Browser();
    const app = new TableProfileDirectObjectsApplication(browser, {}, "profile");
    app._selection = new TableDirectInclusionSelection();
    t.after(() => app._preClose({}));
    return { browser, app };
}

async function refresh(app) {
    app._refreshGeneration++;
    app._refreshPending = true;
    await app._refreshLiveResults();
    assert.equal(app._browserError, false);
    return app._browserCandidates.map(entry => entry.uuid);
}

test("inclusions use effective Browser filters, not a stale Mago input", async t => {
    const { app, browser } = setup(t);
    const before = structuredClone(browser.state);
    assert.deepEqual(await refresh(app), ["Item.wizard", "Item.bard"]);
    assert.deepEqual(browser.state, before);
});

test("search, clear, and document-tab changes refresh results without losing selections", async t => {
    const { app, browser } = setup(t);
    browser.state.name = "Mago";
    assert.deepEqual(await refresh(app), ["Item.wizard"]);
    app._selection.select("Item.wizard");
    delete browser.state.name;
    assert.deepEqual(await refresh(app), ["Item.wizard", "Item.bard"]);
    assert.deepEqual(app._selection.available(app._browserCandidates).map(e => e.uuid), ["Item.bard"]);
    browser.state = { documentClass: "Item", types: new Set(["loot"]) };
    assert.deepEqual(await refresh(app), ["Item.abacus"]);
    browser.state = { documentClass: "Actor", types: new Set(["npc"]) };
    assert.deepEqual(await refresh(app), ["Actor.goblin"]);
    assert.deepEqual(app._selection.values(), ["Item.wizard"]);
});

test("late results cannot overwrite a newer Browser filter snapshot", async t => {
    const { app, browser } = setup(t);
    let resolveFirst;
    let started;
    const firstStarted = new Promise(resolve => { started = resolve; });
    const originalFetch = TableProfileService.getBrowserCandidates;
    let calls = 0;
    t.mock.method(TableProfileService, "getBrowserCandidates", async (...args) => {
        if (calls++ === 0) {
            started();
            return new Promise(resolve => { resolveFirst = resolve; });
        }
        return originalFetch.apply(TableProfileService, args);
    });
    const pending = refresh(app);
    await firstStarted;
    browser.state = { documentClass: "Actor", types: new Set(["npc"]) };
    app._refreshGeneration++;
    app._refreshPending = true;
    resolveFirst([documents[0]]);
    assert.deepEqual(await pending, ["Actor.goblin"]);
    assert.equal(app.renders, 1);
});
