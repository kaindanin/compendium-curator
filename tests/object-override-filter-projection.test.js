import assert from "node:assert/strict";
import test from "node:test";

import {
    collectDnd5eFilterKeys,
    installCompendiumBrowserOverrideFiltering,
    matchesDnd5eFilters
} from "../scripts/overrides/object-override-filter-projection.js";


class Collection extends Map {
    [Symbol.iterator]() { return this.values(); }
}


test("the filter evaluator mirrors scalar, collection and nested D&D5e filters", () => {
    const document = {
        name: "Ábaco modificado",
        system: {
            rarity: "rare",
            price: { value: 25 },
            properties: new Set(["mgc", "ada"])
        }
    };
    const filters = [
        { k: "name", o: "icontains", v: "MODIFICADO" },
        { k: "system.rarity", o: "in", v: new Set(["rare"]) },
        { k: "system.price.value", o: "gte", v: 20 },
        { o: "OR", v: [
            { k: "system.properties", o: "has", v: "ada" },
            { k: "system.properties", o: "has", v: "fin" }
        ] }
    ];

    assert.equal(matchesDnd5eFilters(document, filters, "es"), true);
    assert.equal(matchesDnd5eFilters(document, [
        ...filters,
        { o: "NOT", v: { k: "system.rarity", o: "exact", v: "rare" } }
    ], "es"), false);
    assert.deepEqual(
        collectDnd5eFilterKeys(filters),
        new Set([
            "name",
            "system.rarity",
            "system.price.value",
            "system.properties"
        ])
    );
});


test("Compendium Browser fetch evaluates filters after applying overrides", async () => {
    const collection = "test.items";
    const sources = [
        {
            _id: "abacus",
            id: "abacus",
            uuid: `Compendium.${collection}.Item.abacus`,
            name: "Abacus",
            type: "loot",
            system: {
                rarity: "common",
                price: { value: 1 },
                source: { book: "SRD", value: "SRD", slug: "srd" }
            }
        },
        {
            _id: "wand",
            id: "wand",
            uuid: `Compendium.${collection}.Item.wand`,
            name: "Rare wand",
            type: "loot",
            system: {
                rarity: "rare",
                price: { value: 50 },
                source: { book: "DMG", value: "DMG", slug: "dmg" }
            }
        }
    ];
    const overrides = {
        [sources[0].uuid]: {
            documentName: "Item",
            documentType: "loot",
            patch: [
                { op: "set", path: "/name", value: "Rare modified abacus" },
                { op: "set", path: "/system/rarity", value: "rare" },
                { op: "set", path: "/system/price/value", value: 100 },
                { op: "set", path: "/system/source/book", value: "XGE" }
            ]
        },
        [sources[1].uuid]: {
            documentName: "Item",
            documentType: "loot",
            patch: [
                { op: "set", path: "/system/rarity", value: "common" }
            ]
        }
    };
    const pack = {
        collection,
        documentName: "Item",
        metadata: { packageType: "system" }
    };
    globalThis.game = {
        packs: new Collection([[collection, pack]]),
        i18n: { lang: "en" },
        system: { title: "D&D 5e" },
        settings: { get: () => ({ overrides }) }
    };
    globalThis.foundry = { utils: {
        getProperty: (object, path) => path.split(".")
            .reduce((value, key) => value?.[key], object)
    } };
    const calls = [];
    class Browser {
        static async fetch(_documentClass, options) {
            calls.push(options);
            return sources;
        }
    }
    const Item = { metadata: { name: "Item" } };
    assert.equal(installCompendiumBrowserOverrideFiltering(Browser), true);

    const filters = [
        { k: "name", o: "icontains", v: "modified" },
        { k: "system.rarity", o: "exact", v: "rare" },
        { k: "system.price.value", o: "gte", v: 75 },
        { k: "system.source.slug", o: "exact", v: "xge" }
    ];
    const results = await Browser.fetch(Item, {
        filters,
        indexFields: new Set(["name"])
    });

    assert.deepEqual(results.map(entry => entry.uuid), [sources[0].uuid]);
    assert.equal(results[0].name, "Rare modified abacus");
    assert.equal(results[0].system.source.slug, "xge");
    assert.deepEqual(filters, [
        { k: "name", o: "icontains", v: "modified" },
        { k: "system.rarity", o: "exact", v: "rare" },
        { k: "system.price.value", o: "gte", v: 75 },
        { k: "system.source.slug", o: "exact", v: "xge" }
    ], "native fetch must not mutate the caller's filters");
    assert.deepEqual(calls[0].filters, []);
    assert.equal(calls[0].indexFields.has("system.rarity"), true);
    assert.equal(calls[0].indexFields.has("system.price.value"), true);
    assert.equal(calls[0].indexFields.has("system.source"), true);
    assert.equal(calls[0].indexFields.has("system.source.slug"), false);
    assert.equal(sources[0].name, "Abacus", "the original index is untouched");
    assert.equal(sources[1].system.rarity, "rare");
});
