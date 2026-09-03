import assert from "node:assert/strict";
import test from "node:test";

import {
    CuratorOverrideSession
} from "../scripts/overrides/curator-override-session.js";
import {
    ObjectOverridePatchEngine
} from "../scripts/overrides/object-override-patch-engine.js";
import {
    ObjectOverrideStorageService,
    normalizePatch
} from "../scripts/overrides/object-override-storage-service.js";
import {
    ObjectOverrideResolver
} from "../scripts/overrides/object-override-resolver.js";
import {
    resolveCompendiumIndexEntry
} from "../scripts/overrides/object-override-projection.js";
import {
    compendiumSourceUuid,
    materializeItemOverride
} from "../scripts/overrides/object-override-import.js";
import {
    coerceControlValue,
    controlValue,
    replaceSyntheticDocumentSource,
    safeStoredPatch,
    safeUpdateData
} from "../scripts/hooks/item-sheet-overrides.js";


function originalItem() {
    const source = {
        _id: "item-1",
        name: "Longsword",
        type: "weapon",
        img: "icons/longsword.webp",
        system: {
            source: {
                book: "PHB",
                custom: ""
            },
            description: {
                value: "<p>Original description.</p>"
            },
            quantity: 1,
            weight: 3,
            properties: ["ver"]
        },
        effects: []
    };

    return {
        uuid: "Compendium.test.items.Item.item-1",
        persistenceCalls: [],
        toObject() {
            return structuredClone(source);
        },
        async update() {
            this.persistenceCalls.push("update");
            throw new Error("The original must never update.");
        },
        async createEmbeddedDocuments() {
            this.persistenceCalls.push("createEmbeddedDocuments");
            throw new Error("The original must never create embedded documents.");
        },
        async updateEmbeddedDocuments() {
            this.persistenceCalls.push("updateEmbeddedDocuments");
            throw new Error("The original must never update embedded documents.");
        },
        async deleteEmbeddedDocuments() {
            this.persistenceCalls.push("deleteEmbeddedDocuments");
            throw new Error("The original must never delete embedded documents.");
        }
    };
}


test("creates serializable set, remove and replace operations", () => {
    const original = {
        name: "Original",
        obsolete: true,
        system: {
            quantity: 1,
            tags: ["a"]
        }
    };
    const working = {
        name: "Modified",
        system: {
            quantity: 2,
            tags: ["a", "b"]
        }
    };

    const patch = ObjectOverridePatchEngine.diff(
        original,
        working
    );

    assert.deepEqual(
        patch.map(operation => [
            operation.op,
            operation.path
        ]),
        [
            ["set", "/name"],
            ["remove", "/obsolete"],
            ["set", "/system/quantity"],
            ["replace", "/system/tags"]
        ]
    );
    assert.ok(
        patch.every(operation =>
            operation.baseline &&
            typeof operation.baseline.exists === "boolean"
        )
    );
    assert.deepEqual(
        ObjectOverridePatchEngine.apply(original, patch),
        working
    );
    assert.doesNotThrow(() => JSON.stringify(patch));
});


test("supports explicit atomic object replacement", () => {
    const original = {
        system: {
            activity: {
                id: "a",
                name: "Attack",
                uses: 1
            }
        }
    };
    const working = {
        system: {
            activity: {
                id: "a",
                name: "Strike",
                uses: 2
            }
        }
    };

    const patch = ObjectOverridePatchEngine.diff(
        original,
        working,
        { atomicPaths: ["/system/activity"] }
    );

    assert.equal(patch.length, 1);
    assert.equal(patch[0].op, "replace");
    assert.equal(patch[0].path, "/system/activity");
    assert.deepEqual(
        ObjectOverridePatchEngine.apply(original, patch),
        working
    );
});


test("session keeps activities and effects as atomic patches", () => {
    const session = new CuratorOverrideSession(
        {
            system: {
                activities: {
                    attack: {
                        _id: "attack",
                        type: "attack",
                        name: "Strike"
                    }
                }
            },
            effects: [{ _id: "effect", name: "Blessed" }]
        },
        { atomicPaths: ["system.activities", "effects"] }
    );

    session.beginEditing();
    session.setField(
        "system.activities.attack.name",
        "Heavy Strike"
    );
    session.setField("effects", []);

    assert.deepEqual(
        session.patch.map(operation => ({
            op: operation.op,
            path: operation.path
        })),
        [
            { op: "replace", path: "/effects" },
            {
                op: "replace",
                path: "/system/activities"
            }
        ]
    );
});


test("rejects unsafe patch paths", () => {
    assert.throws(
        () => ObjectOverridePatchEngine.apply({}, [{
            op: "set",
            path: "/__proto__/polluted",
            value: true
        }]),
        /Unsafe/
    );
    assert.equal({}.polluted, undefined);
});


test("accepts serializable fields and rejects embedded structures", () => {
    assert.deepEqual(
        safeUpdateData({
            name: "Modified",
            img: "icons/changed.webp",
            system: {
                source: {
                    book: "DMG",
                    custom: "Curator"
                },
                description: {
                    value: "<p>Changed.</p>"
                },
                quantity: 2,
                properties: ["ada", "mgc"],
                damage: {
                    parts: [["1d8", "slashing"]]
                },
                uses: {
                    recovery: [{
                        period: "day",
                        type: "recoverAll"
                    }]
                },
                activities: {
                    attack: {
                        name: "Changed attack"
                    }
                },
                advancement: {
                    level: {
                        type: "ItemGrant"
                    }
                }
            },
            effects: [{ name: "Unsafe" }]
        }),
        {
            name: "Modified",
            img: "icons/changed.webp",
            "system.source.book": "DMG",
            "system.source.custom": "Curator",
            "system.description.value": "<p>Changed.</p>",
            "system.quantity": 2,
            "system.properties": ["ada", "mgc"],
            "system.damage.parts": [["1d8", "slashing"]],
            "system.uses.recovery": [{
                period: "day",
                type: "recoverAll"
            }],
            "system.activities.attack.name": "Changed attack",
            effects: [{ name: "Unsafe" }]
        }
    );
});


test("accepts checkbox maps produced by D&D5e item forms", () => {
    assert.deepEqual(
        safeUpdateData({
            system: {
                properties: {
                    ada: true,
                    stealthDisadvantage: false,
                    foc: true,
                    mgc: true
                }
            }
        }),
        {
            "system.properties.ada": true,
            "system.properties.stealthDisadvantage": false,
            "system.properties.foc": true,
            "system.properties.mgc": true
        }
    );
});


test("rebuilds the complete synthetic source in one root update", () => {
    const calls = [];
    const document = {
        updateSource(source, options) {
            calls.push({ source, options });
        }
    };
    const source = {
        name: "Magic Missile",
        system: {
            range: { value: 150, units: "ft" }
        }
    };

    assert.equal(
        replaceSyntheticDocumentSource(document, source),
        document
    );
    assert.deepEqual(calls, [{
        source,
        options: { recursive: false }
    }]);
    assert.notEqual(calls[0].source, source);
    assert.notEqual(calls[0].source.system, source.system);
});


test("reads D&D5e checkbox attributes instead of native properties", () => {
    const checked = {
        matches(selector) {
            return selector === "dnd5e-checkbox";
        },
        hasAttribute(name) {
            return name === "checked";
        }
    };
    const unchecked = {
        ...checked,
        hasAttribute() {
            return false;
        }
    };

    assert.equal(controlValue(checked), true);
    assert.equal(controlValue(unchecked), false);
    assert.equal(coerceControlValue(checked, true), true);
    assert.equal(coerceControlValue(unchecked, false), false);
});


test("keeps prepared collections from D&D5e compound controls", () => {
    const values = ["slashing", "fire"];
    const multiSelect = {
        value: "",
        matches(selector) {
            return selector.includes("multi-select");
        },
        querySelectorAll() {
            return [];
        }
    };

    assert.deepEqual(
        coerceControlValue(multiSelect, values),
        values
    );
});


test("reads formula values from their internal D&D5e input", () => {
    const formula = {
        tagName: "FORMULA-INPUT",
        value: "",
        matches(selector) {
            return selector === "formula-input";
        },
        querySelector(selector) {
            return selector === "input" ? { value: "2 + @mod" } : null;
        }
    };

    assert.equal(controlValue(formula), "2 + @mod");
    assert.equal(
        coerceControlValue(formula, "2 + @mod"),
        "2 + @mod"
    );
    formula.querySelector = selector =>
        selector === "input" ? { value: "150" } : null;
    assert.equal(coerceControlValue(formula, "150", 120), 150);
    formula.querySelector = selector =>
        selector === "input" ? { value: "" } : null;
    assert.equal(coerceControlValue(formula, undefined), "");
    assert.equal(coerceControlValue(formula, null), "");
    assert.equal(coerceControlValue(formula, null, 120), null);
});


test("trusts prepared values from unknown form-associated controls", () => {
    const customControl = {
        tagName: "DND5E-FUTURE-CONTROL",
        value: "",
        matches() {
            return false;
        }
    };
    const prepared = { mode: "safe", values: [1, 2] };

    assert.deepEqual(
        coerceControlValue(customControl, prepared),
        prepared
    );
});


test("coerces optional numeric controls without storing empty text", () => {
    const numberInput = {
        value: "",
        matches(selector) {
            return selector.includes("input[type='number']");
        }
    };

    assert.equal(coerceControlValue(numberInput, null), null);
    numberInput.value = "17";
    assert.equal(coerceControlValue(numberInput, 0), 17);
});


test("filters derived source labels from stored patches", () => {
    const patch = safeStoredPatch([
        { op: "set", path: "/system/source/book", value: "PHB" },
        { op: "remove", path: "/system/source/label" },
        { op: "remove", path: "/system/source/value" },
        { op: "remove", path: "/system/source/slug" },
        { op: "remove", path: "/system/source/bookPlaceholder" }
    ]);

    assert.deepEqual(patch, [
        { op: "set", path: "/system/source/book", value: "PHB" }
    ]);
});


test("accepts activities and effects but keeps other lifecycles blocked", () => {
    assert.deepEqual(
        safeUpdateData({
            system: {
                activities: {
                    attack: { name: "Unsafe activity" }
                },
                advancement: [{ type: "ItemGrant" }],
                contents: [{ id: "embedded-item" }],
                container: "parent-item",
                equipped: true
            },
            effects: [{ name: "Local effect" }]
        }),
        {
            "system.activities.attack.name": "Unsafe activity",
            "system.equipped": true,
            effects: [{ name: "Local effect" }]
        }
    );
});


test("session edits never mutate the original document", () => {
    const original = originalItem();

    // 1. Snapshot profundo del documento real antes de editar.
    const originalSnapshot = original.toObject();
    const session = CuratorOverrideSession.fromDocument(
        original
    );

    session.beginEditing();

    // 2. Modificación de varios campos mediante la sesión.
    session.setField("/name", "Curator Longsword");
    session.setField(
        "/system/source/custom",
        "Curator test"
    );
    session.setField(
        "/system/description/value",
        "<p>Modified description.</p>"
    );
    session.setField("/system/quantity", 4);

    // 3. workingSource contiene los cambios.
    assert.equal(
        session.workingSource.name,
        "Curator Longsword"
    );
    assert.equal(
        session.workingSource.system.source.custom,
        "Curator test"
    );
    assert.equal(
        session.workingSource.system.quantity,
        4
    );

    // 4. El original sigue idéntico y nunca recibió update().
    assert.deepEqual(
        original.toObject(),
        originalSnapshot
    );
    assert.deepEqual(original.persistenceCalls, []);
});


test("resetting one field removes it from the diff", () => {
    const session = CuratorOverrideSession.fromDocument(
        originalItem()
    );

    session.beginEditing();
    session.setField("/name", "Changed");
    session.setField("/system/quantity", 5);

    assert.ok(
        session.patch.some(operation =>
            operation.path === "/name"
        )
    );

    // 5. Restablecer el campo lo elimina del diff.
    session.resetField("/name");

    assert.equal(session.workingSource.name, "Longsword");
    assert.ok(
        !session.patch.some(operation =>
            operation.path === "/name"
        )
    );
    assert.ok(
        session.patch.some(operation =>
            operation.path === "/system/quantity"
        )
    );
});


test("reset all restores the source and leaves an empty diff", () => {
    const session = CuratorOverrideSession.fromDocument(
        originalItem()
    );

    session.beginEditing();
    session.setField("/name", "Changed");
    session.setField("/system/weight", 10);

    // 6. Restablecer todo devuelve la sesión al original.
    session.resetAll();

    assert.deepEqual(
        session.workingSource,
        session.originalSource
    );
    assert.deepEqual(session.patch, []);
});


test("cancel reverts only unapplied changes", () => {
    const session = CuratorOverrideSession.fromDocument(
        originalItem()
    );

    session.beginEditing();
    session.setField("/name", "Applied name");
    session.apply();

    session.beginEditing();
    session.setField("/name", "Unapplied name");
    session.setField("/system/quantity", 8);

    // 7. Cancelar vuelve al último estado aplicado.
    session.cancel();

    assert.equal(session.workingSource.name, "Applied name");
    assert.equal(session.workingSource.system.quantity, 1);
    assert.deepEqual(
        session.patch,
        session.appliedPatch
    );
});


test("closing and reopening starts a new empty session", () => {
    const original = originalItem();
    const first = CuratorOverrideSession.fromDocument(original);

    first.beginEditing();
    first.setField("/name", "Temporary name");
    first.apply();
    assert.equal(first.appliedPatch.length, 1);
    first.dispose();

    // 8. Sin almacenamiento, una nueva sesión no conserva el patch.
    const reopened = CuratorOverrideSession.fromDocument(original);

    assert.deepEqual(reopened.patch, []);
    assert.deepEqual(reopened.appliedPatch, []);
    assert.equal(reopened.workingSource.name, "Longsword");
    assert.deepEqual(original.persistenceCalls, []);
});


test("rehydrates a session from a persisted patch", () => {
    const original = originalItem();
    const first = CuratorOverrideSession.fromDocument(original);

    first.beginEditing();
    first.setField("/name", "Persistent name");
    first.setField("/system/quantity", 7);
    const persistedPatch = first.apply();

    const reopened = CuratorOverrideSession.fromDocument(
        original,
        { appliedPatch: persistedPatch }
    );

    assert.equal(reopened.workingSource.name, "Persistent name");
    assert.equal(reopened.workingSource.system.quantity, 7);
    assert.deepEqual(reopened.patch, persistedPatch);
    assert.deepEqual(original.persistenceCalls, []);
});


test("normalizes persisted override records safely", () => {
    const storage = ObjectOverrideStorageService.normalizeStorage({
        version: 999,
        overrides: {
            "Compendium.test.items.Item.item-1": {
                documentName: "Item",
                documentType: "weapon",
                patch: [
                    {
                        op: "set",
                        path: "/name",
                        value: "Stored",
                        baseline: {
                            exists: true,
                            value: "Original"
                        }
                    },
                    {
                        op: "execute",
                        path: "/name",
                        value: "Unsafe"
                    }
                ],
                updatedAt: 12
            },
            invalid: {
                patch: [{
                    op: "set",
                    path: "/name",
                    value: "Ignored"
                }]
            }
        }
    });

    assert.equal(storage.version, 1);
    assert.deepEqual(
        storage.overrides[
            "Compendium.test.items.Item.item-1"
        ].patch,
        [{
            op: "set",
            path: "/name",
            value: "Stored",
            baseline: {
                exists: true,
                value: "Original"
            }
        }]
    );
    assert.equal(Object.keys(storage.overrides).length, 1);
});


test("resolves a compendium document from its original source plus patch", () => {
    const source = originalItem();
    const patch = [{
        op: "set",
        path: "/name",
        value: "Curated Longsword"
    }, {
        op: "set",
        path: "/system/quantity",
        value: 3
    }];
    const storage = {
        get(uuid) {
            assert.equal(uuid, source.uuid);
            return {
                documentName: "Item",
                documentType: "weapon",
                patch
            };
        }
    };

    const resolved = ObjectOverrideResolver.resolveDocument(
        {
            ...source,
            documentName: "Item",
            type: "weapon"
        },
        { storage }
    );

    assert.equal(resolved.originalSource.name, "Longsword");
    assert.equal(resolved.source.name, "Curated Longsword");
    assert.equal(resolved.source.system.quantity, 3);
    assert.deepEqual(source.toObject(), resolved.originalSource);
});


test("does not apply an override saved for another document class or type", () => {
    const source = originalItem();
    const storage = {
        get() {
            return {
                documentName: "Actor",
                documentType: "npc",
                patch: [{
                    op: "set",
                    path: "/name",
                    value: "Wrong document"
                }]
            };
        }
    };

    const resolved = ObjectOverrideResolver.resolveDocument(
        {
            ...source,
            documentName: "Item",
            type: "weapon"
        },
        { storage }
    );

    assert.equal(resolved.source.name, "Longsword");
    assert.deepEqual(resolved.patch, []);
    assert.equal(resolved.record, null);
});


test("fails closed when a stored patch contains an unsafe path", () => {
    const source = originalItem();
    const storage = {
        get() {
            return {
                documentName: "Item",
                documentType: "weapon",
                patch: [{
                    op: "set",
                    path: "/__proto__/polluted",
                    value: true
                }]
            };
        }
    };

    const resolved = ObjectOverrideResolver.resolveDocument(
        {
            ...source,
            documentName: "Item",
            type: "weapon"
        },
        { storage }
    );

    assert.equal(resolved.source.name, "Longsword");
    assert.equal({}.polluted, undefined);
    assert.deepEqual(resolved.patch, []);
});


test("resolves a compendium index entry without loading its document", () => {
    let toObjectCalls = 0;
    const pack = {
        collection: "test.items",
        documentName: "Item"
    };
    const entry = {
        _id: "item-1",
        type: "weapon",
        toObject() {
            toObjectCalls += 1;
            return {
                _id: "item-1",
                name: "Longsword",
                type: "weapon",
                img: "icons/original.webp"
            };
        }
    };
    const storage = {
        get(uuid) {
            assert.equal(
                uuid,
                "Compendium.test.items.Item.item-1"
            );
            return {
                documentName: "Item",
                documentType: "weapon",
                patch: [{
                    op: "set",
                    path: "/name",
                    value: "Curated Longsword"
                }, {
                    op: "set",
                    path: "/img",
                    value: "icons/curated.webp"
                }]
            };
        }
    };

    const resolved = resolveCompendiumIndexEntry(
        pack,
        entry,
        { storage }
    );

    assert.equal(toObjectCalls, 1);
    assert.equal(resolved.source.name, "Curated Longsword");
    assert.equal(resolved.source.img, "icons/curated.webp");
});


test("materializes a compendium override into a new Actor Item source", () => {
    const source = {
        _id: "actor-item-id",
        name: "Longsword",
        type: "weapon",
        system: { quantity: 1 },
        flags: {
            core: {
                sourceId: "Compendium.test.items.Item.item-1"
            }
        }
    };
    const storage = {
        get(uuid) {
            assert.equal(uuid, source.flags.core.sourceId);
            return {
                documentName: "Item",
                documentType: "weapon",
                patch: [{
                    op: "set",
                    path: "/name",
                    value: "Curated Longsword"
                }, {
                    op: "set",
                    path: "/system/quantity",
                    value: 4
                }]
            };
        }
    };

    const materialized = materializeItemOverride(
        source,
        { storage }
    );

    assert.equal(compendiumSourceUuid(source), source.flags.core.sourceId);
    assert.equal(materialized.name, "Curated Longsword");
    assert.equal(materialized.system.quantity, 4);
    assert.equal(materialized._id, "actor-item-id");
    assert.equal(source.name, "Longsword");
    assert.equal(source.system.quantity, 1);
});


test("does not materialize a world Item without a compendium source", () => {
    assert.equal(materializeItemOverride({
        name: "World item",
        type: "weapon",
        flags: {}
    }), null);
});


test("persists, reloads and removes a world override", async () => {
    let stored = {
        version: 1,
        overrides: {}
    };
    const previousGame = globalThis.game;

    globalThis.game = {
        settings: {
            get() {
                return structuredClone(stored);
            },
            async set(_moduleId, _setting, value) {
                stored = structuredClone(value);
            }
        }
    };

    try {
        const patch = normalizePatch([{
            op: "set",
            path: "/name",
            value: "Stored name",
            baseline: {
                exists: true,
                value: "Longsword"
            }
        }]);

        await ObjectOverrideStorageService.save(
            "Compendium.test.items.Item.item-1",
            patch,
            {
                documentName: "Item",
                documentType: "weapon"
            }
        );

        assert.deepEqual(
            ObjectOverrideStorageService.getPatch(
                "Compendium.test.items.Item.item-1"
            ),
            patch
        );

        assert.equal(
            await ObjectOverrideStorageService.remove(
                "Compendium.test.items.Item.item-1"
            ),
            true
        );
        assert.deepEqual(
            ObjectOverrideStorageService.getPatch(
                "Compendium.test.items.Item.item-1"
            ),
            []
        );
    }
    finally {
        if (previousGame === undefined)
            delete globalThis.game;
        else
            globalThis.game = previousGame;
    }
});


test("filters unsafe persisted paths before applying them", () => {
    assert.deepEqual(
        safeStoredPatch([
            {
                op: "set",
                path: "/name",
                value: "Safe"
            },
            {
                op: "set",
                path: "/effects/effect/name",
                value: "Unsafe nested patch"
            },
            {
                op: "set",
                path: "/system/quantity",
                value: 3
            },
            {
                op: "replace",
                path: "/system/properties",
                value: ["ada", "mgc"]
            },
            {
                op: "replace",
                path: "/system/activities",
                value: { attack: { type: "attack" } }
            },
            {
                op: "set",
                path: "/system/activities/attack/name",
                value: "Rejected nested patch"
            },
            {
                op: "replace",
                path: "/effects",
                value: [{ _id: "effect", name: "Local" }]
            }
        ]),
        [
            {
                op: "set",
                path: "/name",
                value: "Safe"
            },
            {
                op: "set",
                path: "/system/quantity",
                value: 3
            },
            {
                op: "replace",
                path: "/system/properties",
                value: ["ada", "mgc"]
            },
            {
                op: "replace",
                path: "/system/activities",
                value: { attack: { type: "attack" } }
            },
            {
                op: "replace",
                path: "/effects",
                value: [{ _id: "effect", name: "Local" }]
            }
        ]
    );
});
