import assert from "node:assert/strict";
import test from "node:test";

globalThis.foundry ??= {
    utils: {
        deepClone: value => structuredClone(value)
    }
};

const {
    TableGenerationTransaction,
    TableProfileGenerationService
} = await import(
    "../scripts/services/table-profile-generation-service.js"
);
const {
    TableGenerationFolderService
} = await import(
    "../scripts/services/table-generation-folder-service.js"
);
const {
    TableGenerationTargetService
} = await import(
    "../scripts/services/table-generation-target-service.js"
);
const {
    TableProfileStorageService
} = await import(
    "../scripts/services/table-profile-storage-service.js"
);

function fakeTable({
    uuid,
    name,
    results = []
}) {
    return {
        uuid,
        name,
        img: "old.webp",
        description: "old description",
        formula: "1d1",
        replacement: false,
        displayRoll: false,
        folder: "old-folder",
        flags: { old: true },
        results: results.map((result, index) => ({
            id: `result-${index}`,
            ...result
        })),
        deleted: false,

        toObject() {
            return {
                name: this.name,
                img: this.img,
                description: this.description,
                formula: this.formula,
                replacement: this.replacement,
                displayRoll: this.displayRoll,
                folder: this.folder,
                flags: structuredClone(this.flags),
                results: this.results.map(result => ({
                    _id: result.id,
                    name: result.name,
                    range: result.range
                }))
            };
        },

        async update(data) {
            Object.assign(this, structuredClone(data));
        },

        async deleteEmbeddedDocuments() {
            this.results = [];
        },

        async createEmbeddedDocuments(
            documentName,
            entries
        ) {
            assert.equal(documentName, "TableResult");
            this.results = entries.map((entry, index) => ({
                id: `restored-${index}`,
                ...structuredClone(entry)
            }));
        },

        async delete() {
            this.deleted = true;
        }
    };
}

test("rolls back updated and newly created tables", async () => {
    const originalCleanup =
        TableGenerationFolderService.cleanupTarget;
    let cleanedTarget = null;

    TableGenerationFolderService.cleanupTarget =
        async target => {
            cleanedTarget = target;
        };

    try {
        const target = { key: "world" };
        const existing = fakeTable({
            uuid: "RollTable.existing",
            name: "Original",
            results: [{
                name: "Old result",
                range: [1, 1]
            }]
        });
        const created = fakeTable({
            uuid: "RollTable.created",
            name: "Created"
        });
        const transaction =
            new TableGenerationTransaction(target);

        transaction.remember(existing);
        transaction.registerCreated(created);

        await existing.update({
            name: "Changed",
            formula: "1d20",
            folder: "new-folder",
            flags: { managed: true }
        });
        existing.results = [{
            id: "new-result",
            name: "New result",
            range: [1, 20]
        }];

        await transaction.rollback();

        assert.equal(created.deleted, true);
        assert.equal(existing.name, "Original");
        assert.equal(existing.formula, "1d1");
        assert.equal(existing.folder, "old-folder");
        assert.deepEqual(existing.flags, { old: true });
        assert.deepEqual(
            existing.results.map(result => ({
                name: result.name,
                range: result.range
            })),
            [{
                name: "Old result",
                range: [1, 1]
            }]
        );
        assert.equal(cleanedTarget, target);
    }
    finally {
        TableGenerationFolderService.cleanupTarget =
            originalCleanup;
    }
});

test("captures an existing table only once", () => {
    const table = fakeTable({
        uuid: "RollTable.existing",
        name: "Original"
    });
    const transaction =
        new TableGenerationTransaction({ key: "world" });

    transaction.remember(table);
    table.name = "Changed after snapshot";
    transaction.remember(table);

    assert.equal(transaction.snapshots.size, 1);
    assert.equal(
        transaction.snapshots.get(table.uuid)
            .data.name,
        "Original"
    );
});

test("generateDirect restores the profile tables when a later node fails", async () => {
    const originals = {
        resolveTarget:
            TableGenerationTargetService.resolveTarget,
        withWritableTarget:
            TableGenerationTargetService.withWritableTarget,
        resolveManagedTable:
            TableGenerationTargetService.resolveManagedTable,
        getCreateContext:
            TableGenerationTargetService.getCreateContext,
        resolvePlacement:
            TableGenerationFolderService.resolvePlacement,
        applyPlacementToData:
            TableGenerationFolderService.applyPlacementToData,
        cleanupTarget:
            TableGenerationFolderService.cleanupTarget,
        getProfileFolderPath:
            TableProfileStorageService.getProfileFolderPath,
        rollTable: globalThis.RollTable,
        game: globalThis.game,
        constant: globalThis.CONST
    };

    const existing = fakeTable({
        uuid: "RollTable.group",
        name: "Original group",
        results: [{
            name: "Original result",
            range: [1, 1]
        }]
    });
    const created = fakeTable({
        uuid: "RollTable.source",
        name: "Created source"
    });
    const failure = new Error("SIMULATED_ROOT_FAILURE");
    let resolveCount = 0;

    globalThis.game = {
        i18n: {
            format: key => key,
            localize: key => key
        }
    };
    globalThis.CONST = {
        TABLE_RESULT_TYPES: {
            DOCUMENT: "document"
        }
    };
    globalThis.RollTable = {
        create: async () => created
    };
    TableGenerationTargetService.resolveTarget =
        async () => ({ key: "world", mode: "world" });
    TableGenerationTargetService.withWritableTarget =
        async (target, callback) => callback();
    TableGenerationTargetService.resolveManagedTable =
        async () => {
            resolveCount++;

            if (resolveCount === 1)
                return existing;

            if (resolveCount === 2)
                return null;

            throw failure;
        };
    TableGenerationTargetService.getCreateContext =
        () => ({});
    TableGenerationFolderService.resolvePlacement =
        async () => null;
    TableGenerationFolderService.applyPlacementToData =
        () => {};
    TableGenerationFolderService.cleanupTarget =
        async () => {};
    TableProfileStorageService.getProfileFolderPath =
        () => [];

    try {
        const profile = {
            version: 2,
            id: "profile",
            type: "content",
            name: "Profile",
            revision: 1,
            generation: {},
            draw: {
                quantityMin: 1,
                quantityMax: 1
            }
        };
        const sources = [{
            key: "filter:group",
            name: "Source",
            weight: 1,
            groups: [{
                key: "common",
                label: "Common",
                enabled: true,
                weight: 1,
                entries: [{
                    uuid: "Item.entry",
                    name: "Entry",
                    img: "entry.webp",
                    weight: 1
                }]
            }]
        }];

        await assert.rejects(
            TableProfileGenerationService
                .generateDirect(
                    profile,
                    sources
                ),
            failure
        );

        assert.equal(created.deleted, true);
        assert.equal(existing.name, "Original group");
        assert.deepEqual(
            existing.results.map(result =>
                result.name
            ),
            ["Original result"]
        );
    }
    finally {
        TableGenerationTargetService.resolveTarget =
            originals.resolveTarget;
        TableGenerationTargetService.withWritableTarget =
            originals.withWritableTarget;
        TableGenerationTargetService.resolveManagedTable =
            originals.resolveManagedTable;
        TableGenerationTargetService.getCreateContext =
            originals.getCreateContext;
        TableGenerationFolderService.resolvePlacement =
            originals.resolvePlacement;
        TableGenerationFolderService.applyPlacementToData =
            originals.applyPlacementToData;
        TableGenerationFolderService.cleanupTarget =
            originals.cleanupTarget;
        TableProfileStorageService.getProfileFolderPath =
            originals.getProfileFolderPath;
        globalThis.RollTable = originals.rollTable;
        globalThis.game = originals.game;
        globalThis.CONST = originals.constant;
    }
});
