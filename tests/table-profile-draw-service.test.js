import assert from "node:assert/strict";
import test from "node:test";

const {
    TableProfileDrawService
} = await import(
    "../scripts/services/table-profile-draw-service.js"
);

function result(
    documentUuid,
    weight,
    name = documentUuid
) {
    return {
        documentUuid,
        weight,
        name,
        img: "item.webp"
    };
}

test(
    "draw pool expands linked compendium RollTables natively",
    async () => {
        const childUuid =
            "Compendium.world.tables.RollTable.child";
        const child = {
            documentName: "RollTable",
            uuid: childUuid,
            results: [
                result("Item.first", 1, "First"),
                result("Item.second", 3, "Second")
            ]
        };
        const root = {
            documentName: "RollTable",
            uuid: "RollTable.root",
            results: [
                result(childUuid, 2, "Child"),
                result("Item.direct", 1, "Direct")
            ]
        };

        globalThis.fromUuid = async uuid =>
            uuid === childUuid
                ? child
                : null;

        const pool =
            await TableProfileDrawService
                .getDrawPool(root);
        const weights = Object.fromEntries(
            pool.map(entry => [
                entry.uuid,
                entry.weight
            ])
        );

        assert.equal(pool.length, 3);
        assert.equal(weights["Item.first"], 1 / 6);
        assert.equal(weights["Item.second"], 1 / 2);
        assert.equal(weights["Item.direct"], 1 / 3);
        assert.ok(
            Math.abs(
                Object.values(weights).reduce(
                    (sum, weight) => sum + weight,
                    0
                ) - 1
            ) < Number.EPSILON * 4
        );
    }
);

test(
    "draw pool keeps unresolved RollTables as leaves",
    async () => {
        globalThis.fromUuid = async () => null;
        const unresolvedUuid =
            "Compendium.world.tables.RollTable.missing";
        const root = {
            documentName: "RollTable",
            uuid: "RollTable.root",
            results: [result(unresolvedUuid, 1)]
        };

        const pool =
            await TableProfileDrawService
                .getDrawPool(root);

        assert.deepEqual(
            pool.map(entry => entry.uuid),
            [unresolvedUuid]
        );
    }
);
