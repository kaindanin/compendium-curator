import assert from "node:assert/strict";
import test from "node:test";

import {
    TableDirectInclusionSelection
} from "../scripts/services/table-direct-inclusion-selection-service.js";

test("keeps selected inclusions when browser results change", () => {
    const selection =
        new TableDirectInclusionSelection();
    const firstResults = [
        { uuid: "Item.sword" },
        { uuid: "Item.shield" }
    ];

    selection.select("Item.sword");

    assert.deepEqual(
        selection.available(firstResults)
            .map(entry => entry.uuid),
        ["Item.shield"]
    );

    const nextResults = [
        { uuid: "Item.potion" }
    ];

    assert.deepEqual(
        selection.values(),
        ["Item.sword"]
    );
    assert.deepEqual(
        selection.available(nextResults)
            .map(entry => entry.uuid),
        ["Item.potion"]
    );
});

test("deselected inclusions return only when filters match", () => {
    const selection =
        new TableDirectInclusionSelection([
            "Item.sword"
        ]);

    selection.deselect("Item.sword");

    assert.deepEqual(selection.values(), []);
    assert.deepEqual(
        selection.available([
            { uuid: "Item.sword" }
        ]).map(entry => entry.uuid),
        ["Item.sword"]
    );
    assert.deepEqual(
        selection.available([
            { uuid: "Item.potion" }
        ]).map(entry => entry.uuid),
        ["Item.potion"]
    );
});

test("bulk selection deduplicates and can be cleared", () => {
    const selection =
        new TableDirectInclusionSelection([
            "Item.sword"
        ]);

    selection.selectAll([
        { uuid: "Item.shield" },
        { uuid: "Item.shield" },
        "Item.potion"
    ]);

    assert.deepEqual(selection.values(), [
        "Item.potion",
        "Item.shield",
        "Item.sword"
    ]);

    selection.clear();
    assert.equal(selection.size, 0);
});
