import assert from "node:assert/strict";
import test from "node:test";

import {
    CuratorOverrideSession
} from "../scripts/overrides/curator-override-session.js";
import {
    ObjectOverridePatchEngine
} from "../scripts/overrides/object-override-patch-engine.js";
import {
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


test("sheet adapter accepts scalars and rejects complex structures", () => {
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
                properties: ["mgc"],
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
            "system.source.book": "DMG",
            "system.source.custom": "Curator",
            "system.description.value": "<p>Changed.</p>",
            "system.quantity": 2
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
