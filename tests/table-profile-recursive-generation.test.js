import assert from "node:assert/strict";
import test from "node:test";

globalThis.foundry ??= {
    utils: {
        deepClone: value => structuredClone(value)
    }
};

const {
    TableProfileGenerationService
} = await import(
    "../scripts/services/table-profile-generation-service.js"
);
const {
    generateStoredProfileTablesRecursively
} = await import(
    "../scripts/services/table-profile-recursive-generation-service.js"
);
const {
    TableProfileStorageService
} = await import(
    "../scripts/services/table-profile-storage-service.js"
);

test(
    "linked tables remain black boxes in parent generation",
    async () => {
        const originals = {
            getProfiles:
                TableProfileStorageService.getProfiles,
            generateNested:
                TableProfileGenerationService.generateNested,
            constant: globalThis.CONST
        };
        const profiles = {
            parent: {
                version: 2,
                id: "parent",
                type: "content",
                name: "Parent",
                revision: 1,
                draw: {
                    quantityMin: 1,
                    quantityMax: 1
                },
                restrictions: {
                    matches: ["Item.local"]
                },
                children: [{
                    profileId: "child",
                    enabled: true,
                    weight: 3
                }]
            },
            child: {
                version: 2,
                id: "child",
                type: "nested",
                name: "Child",
                revision: 1,
                children: []
            }
        };
        const childRoot = {
            uuid: "RollTable.child",
            name: "Child",
            img: "child.webp",
            results: [{
                documentUuid: "Item.child-internal"
            }]
        };
        const localResult = {
            id: "local-result",
            weight: 1,
            documentUuid: "Item.local",
            toObject() {
                return {
                    _id: this.id,
                    type: "document",
                    name: "Local",
                    documentUuid: this.documentUuid,
                    weight: this.weight,
                    range: [1, 1]
                };
            }
        };
        const parentRoot = {
            uuid: "RollTable.parent",
            name: "Parent",
            results: [localResult],
            created: [],
            async deleteEmbeddedDocuments(
                documentName,
                ids
            ) {
                assert.equal(
                    documentName,
                    "TableResult"
                );
                assert.deepEqual(
                    ids,
                    ["local-result"]
                );
                this.results = [];
            },
            async createEmbeddedDocuments(
                documentName,
                entries
            ) {
                assert.equal(
                    documentName,
                    "TableResult"
                );
                this.created = structuredClone(
                    entries
                );
                this.results = entries;
            },
            async update(data) {
                Object.assign(this, data);
            }
        };

        globalThis.CONST = {
            TABLE_RESULT_TYPES: {
                DOCUMENT: "document"
            }
        };
        TableProfileStorageService.getProfiles =
            () => profiles;
        TableProfileGenerationService.generateNested =
            async profile => {
                assert.equal(profile.id, "child");
                return {
                    profile,
                    root: childRoot
                };
            };

        try {
            const generated =
                await generateStoredProfileTablesRecursively(
                    { browserApp: {} },
                    "parent",
                    async profileId => {
                        assert.equal(
                            profileId,
                            "parent"
                        );
                        return {
                            profile: profiles.parent,
                            root: parentRoot
                        };
                    }
                );

            assert.equal(
                generated.root,
                parentRoot
            );
            assert.deepEqual(
                parentRoot.created.map(result =>
                    result.documentUuid
                ),
                [
                    "Item.local",
                    "RollTable.child"
                ]
            );
            assert.equal(
                parentRoot.created.some(result =>
                    result.documentUuid ===
                        "Item.child-internal"
                ),
                false
            );
            assert.equal(
                parentRoot.created[1].weight,
                3
            );
            assert.equal(
                parentRoot.formula,
                "1d4"
            );
        }
        finally {
            TableProfileStorageService.getProfiles =
                originals.getProfiles;
            TableProfileGenerationService.generateNested =
                originals.generateNested;
            globalThis.CONST = originals.constant;
        }
    }
);
