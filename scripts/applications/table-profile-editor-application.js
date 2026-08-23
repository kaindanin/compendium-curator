import {
    TableDefaultsService
} from "../services/table-defaults-service.js";

import {
    TableProfileStorageService
} from "../services/table-profile-storage-service.js";

import {
    TableProfileService
} from "../services/table-profile-service.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

const CONTENT_PRESETS = [
    {
        id: "loot",
        icon: "fa-treasure-chest",
        label: "PresetLoot",
        hint: "PresetLootHint"
    },
    {
        id: "shopType",
        icon: "fa-shop",
        label: "PresetShopByType",
        hint: "PresetShopByTypeHint"
    },
    {
        id: "shopPrice",
        icon: "fa-coins",
        label: "PresetShopByPrice",
        hint: "PresetShopByPriceHint"
    },
    {
        id: "shopManual",
        icon: "fa-layer-group",
        label: "PresetCustomShop",
        hint: "PresetCustomShopHint"
    },
    {
        id: "simple",
        icon: "fa-list",
        label: "PresetSimpleList",
        hint: "PresetSimpleListHint"
    }
];

function buildRarityGroups(rarityWeights) {
    return Object.fromEntries(
        Object.entries(rarityWeights)
            .map(([key, weight]) => [
                key,
                {
                    id:
                        `auto:rarity:${encodeURIComponent(key)}`,
                    key,
                    weight:
                        Number(weight) > 0
                            ? Number(weight)
                            : 1,
                    distribution: {
                        mode: "uniform"
                    }
                }
            ])
    );
}

function buildStarterManualGroups() {
    const names = [
        "ShopGroupBasicEquipment",
        "ShopGroupConsumables",
        "ShopGroupSpecialItems",
        "ShopGroupFeaturedRewards"
    ];

    return names.map(label => {
        const key =
            `manual:${foundry.utils.randomID()}`;

        return {
            id: key,
            key,
            name: game.i18n.localize(
                `COMPENDIUM_CURATOR.${label}`
            ),
            members: []
        };
    });
}

function getGroupingDefinition(criterion) {
    if (criterion === "type") {
        return {
            type: "field",
            criterion: "type",
            field: "type"
        };
    }

    if (criterion === "manual") {
        return {
            type: "manual",
            criterion: "manual"
        };
    }

    if (criterion === "price") {
        return {
            type: "range",
            criterion: "price",
            field: "system.price"
        };
    }

    return {
        type: "field",
        criterion: "rarity",
        field: "system.rarity"
    };
}

export class TableProfileEditorApplication
    extends HandlebarsApplicationMixin(
        ApplicationV2
    ) {

    constructor(browserApp, options = {}) {

        super(options);
        this.browserApp = browserApp;

        this.profileType =
            browserApp
                ?._ccTableManager
                ?._activeTab === "nested"
                ? "nested"
                : "content";

        this.selectedPreset = "loot";
        this._draftName = "";
        this._includeCurrentSelection = true;
        this._selectionSnapshot = null;
        this._selectionPromise = null;
        this._refreshTimer = null;

    }

    static DEFAULT_OPTIONS = {
        id: "compendium-curator-table-profile-editor",
        classes: [
            "dnd5e2",
            "compendium-curator",
            "cc-table-profile-editor-app"
        ],
        actions: {
            selectPreset: this.#onSelectPreset,
            save: this.#onSave,
            saveAndGenerate:
                this.#onSaveAndGenerate,
            cancel: this.#onCancel
        },
        window: {
            title: "COMPENDIUM_CURATOR.NewTableProfile",
            resizable: true
        },
        position: {
            width: 480,
            height: 620
        }
    };

    static PARTS = {
        body: {
            template:
                "modules/compendium-curator/templates/table-profile-editor.hbs"
        }
    };

    scheduleRefresh() {
        clearTimeout(this._refreshTimer);

        this._refreshTimer = setTimeout(() => {
            this._refreshTimer = null;
            this._selectionSnapshot = null;
            this._selectionPromise = null;

            if (this.rendered) {
                this.render({ force: true });
            }
        }, 180);
    }

    async _getSelectionSnapshot() {
        if (
            this.profileType !== "content" ||
            !this.browserApp
        ) {
            return null;
        }

        if (this._selectionSnapshot) {
            return this._selectionSnapshot;
        }

        this._selectionPromise ??= (async () => {
            try {
                const draft =
                    await TableProfileService
                        .createContentDraft(
                            this.browserApp
                        );
                const filterGroups =
                    TableProfileService
                        .getFilterDisplayGroups(
                            this.browserApp,
                            draft?.browser?.filters ?? {}
                        );
                const count = Number(
                    draft?.includedCount ??
                    draft?.matches?.length ??
                    0
                );
                const hasNameFilter = Boolean(
                    String(
                        draft?.browser?.filters?.name ??
                        ""
                    ).trim()
                );
                const hasFilters =
                    filterGroups.length > 0 ||
                    hasNameFilter;

                return {
                    draft,
                    count,
                    hasFilters,
                    available:
                        hasFilters &&
                        count > 0
                };
            }
            catch (error) {
                console.error(
                    "Compendium Curator | Error preparando la selección inicial del perfil.",
                    error
                );

                return {
                    draft: null,
                    count: 0,
                    hasFilters: false,
                    available: false,
                    error: true
                };
            }
        })();

        this._selectionSnapshot =
            await this._selectionPromise;

        return this._selectionSnapshot;
    }

    async _prepareContext(options) {
        const context =
            await super._prepareContext(options);

        context.profileTypeLabel =
            this.profileType === "nested"
                ? "COMPENDIUM_CURATOR.TableProfileTypeNested"
                : "COMPENDIUM_CURATOR.TableProfileTypeContent";

        context.isContent =
            this.profileType === "content";
        context.profileName = this._draftName;

        if (context.isContent) {
            context.presets = CONTENT_PRESETS.map(
                preset => ({
                    ...preset,
                    localizedLabel:
                        game.i18n.localize(
                            `COMPENDIUM_CURATOR.${preset.label}`
                        ),
                    localizedHint:
                        game.i18n.localize(
                            `COMPENDIUM_CURATOR.${preset.hint}`
                        ),
                    selected:
                        preset.id ===
                        this.selectedPreset
                })
            );

            const selection =
                await this._getSelectionSnapshot();

            context.currentSelectionCount =
                selection?.count ?? 0;
            context.canIncludeCurrentSelection =
                selection?.available === true;
            context.currentSelectionHasFilters =
                selection?.hasFilters === true;
            context.currentSelectionError =
                selection?.error === true;
            context.includeCurrentSelection =
                this._includeCurrentSelection &&
                context.canIncludeCurrentSelection;
            context.canGenerateImmediately =
                context.includeCurrentSelection &&
                Boolean(
                    this.browserApp
                        ?._ccTableManager
                        ?.generateStoredProfileTables
                );
        }

        return context;
    }

    async _onRender(context, options) {
        await super._onRender(context, options);

        const nameInput = this.element.querySelector(
            '[name="profileName"]'
        );

        nameInput?.addEventListener("input", event => {
            this._draftName = String(
                event.target.value ?? ""
            );
        });

        const includeInput = this.element.querySelector(
            '[name="includeCurrentSelection"]'
        );

        includeInput?.addEventListener(
            "change",
            event => {
                this._includeCurrentSelection =
                    event.target.checked === true;

                const generateButton =
                    this.element.querySelector(
                        '[data-action="saveAndGenerate"]'
                    );

                if (generateButton) {
                    generateButton.disabled =
                        !this._includeCurrentSelection;
                }
            }
        );
    }

    static #onSelectPreset(event, target) {
        event.preventDefault();

        const preset = String(
            target.dataset.preset ?? ""
        );

        if (!CONTENT_PRESETS.some(
            candidate => candidate.id === preset
        )) {
            return;
        }

        const nameInput = this.element.querySelector(
            '[name="profileName"]'
        );
        const includeInput = this.element.querySelector(
            '[name="includeCurrentSelection"]'
        );

        this._draftName = String(
            nameInput?.value ?? this._draftName
        );
        this._includeCurrentSelection =
            includeInput?.checked ??
            this._includeCurrentSelection;
        this.selectedPreset = preset;
        this.render({ force: true });
    }

    static async #onSave(event, target) {
        return this._saveProfile(
            event,
            target,
            false
        );
    }

    static async #onSaveAndGenerate(event, target) {
        return this._saveProfile(
            event,
            target,
            true
        );
    }

    async _saveProfile(
        event,
        target,
        generateImmediately
    ) {
        const nameInput =
            this.element.querySelector(
                '[name="profileName"]'
            );

        const name =
            String(nameInput?.value ?? "").trim();

        if (!name) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.ProfileNameRequired"
                )
            );
            nameInput?.focus();
            return;
        }

        const profileType =
            this.profileType === "nested"
                ? "nested"
                : "content";

        let profile;

        if (profileType === "nested") {
            profile = {
                version: 2,
                type: "nested",
                name,
                revision: 1,
                children: [],
                draw: {
                    count: 1,
                    priceAdjustment: 100,
                    quantityMin: 1,
                    quantityMax: 1
                },
                itemRules: {
                    excludeZeroPrice: false,
                    includeHidden: false
                },
                generation: {
                    masterUuid: null,
                    groupUuids: {},
                    rootUuid: null,
                    nodes: {},
                    generatedRevision: 0
                }
            };
        }
        else {
            const tableDefaults =
                TableDefaultsService.get();

            const rarityWeights =
                foundry.utils.deepClone(
                    tableDefaults
                        ?.rarityWeights ?? {}
                );

            const preset = CONTENT_PRESETS.some(
                candidate =>
                    candidate.id ===
                    this.selectedPreset
            )
                ? this.selectedPreset
                : "loot";
            const criterion = {
                shopType: "type",
                shopPrice: "price",
                shopManual: "manual"
            }[preset] ?? "rarity";
            const distributionMode =
                preset === "simple"
                    ? "individual"
                    : "grouped";
            const isShopPreset = [
                "shopType",
                "shopPrice",
                "shopManual"
            ].includes(preset);

            profile = {
                version: 2,
                type: "content",
                name,
                revision: 1,
                filterGroupIds: [],
                manualIncludes: [],
                manualExcludes: [],
                draw: {
                    count:
                        isShopPreset ? 10 : 1,
                    priceAdjustment: 100,
                    quantityMin: 1,
                    quantityMax:
                        isShopPreset ? 3 : 1
                },
                itemRules: {
                    excludeZeroPrice:
                        isShopPreset,
                    includeHidden: false
                },
                distribution: {
                    version: 2,
                    mode: distributionMode,
                    individual: {
                        defaultWeight: 1,
                        weights: {}
                    },
                    grouped: {
                        grouping:
                            getGroupingDefinition(
                                criterion
                            ),
                        groups:
                            criterion === "rarity"
                                ? buildRarityGroups(
                                    rarityWeights
                                )
                                : {},
                        configurations: {},
                        manualGroups:
                            criterion === "manual"
                                ? buildStarterManualGroups()
                                : []
                    }
                },
                weights: {
                    default: 1,
                    rarity:
                        rarityWeights,
                    overrides: {}
                },
                generation: {
                    masterUuid: null,
                    groupUuids: {},
                    rootUuid: null,
                    nodes: {},
                    generatedRevision: 0
                }
            };
        }

        let initialFilterGroup = null;

        if (
            profileType === "content" &&
            this._includeCurrentSelection
        ) {
            const selection =
                await this._getSelectionSnapshot();

            if (selection?.available) {
                let groupName = game.i18n.format(
                    "COMPENDIUM_CURATOR.InitialSelectionGroupName",
                    { profile: name }
                );
                const baseName = groupName;
                let suffix = 2;

                while (
                    TableProfileStorageService
                        .isFilterGroupNameTaken(
                            null,
                            groupName
                        )
                ) {
                    groupName =
                        `${baseName} (${suffix})`;
                    suffix++;
                }

                initialFilterGroup = {
                    name: groupName,
                    browser:
                        selection.draft.browser,
                    matches:
                        selection.draft.matches
                };
            }
        }

        if (
            generateImmediately &&
            !initialFilterGroup
        ) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.CurrentSelectionUnavailable"
                )
            );
            return;
        }

        target.disabled = true;

        let createdProfile;

        try {
            createdProfile =
                await TableProfileStorageService.create(
                profile,
                initialFilterGroup
            );
        }
        catch (error) {
            if (
                error?.message ===
                    "TABLE_PROFILE_NAME_TAKEN"
            ) {
                ui.notifications.warn(
                    game.i18n.localize(
                        "COMPENDIUM_CURATOR.TableProfileNameTaken"
                    )
                );
                nameInput?.focus();
                nameInput?.select();
                return;
            }

            throw error;
        }
        finally {
            if (target.isConnected) {
                target.disabled = false;
            }
        }

        const tableManager =
            this.browserApp?._ccTableManager;

        let generated = null;

        if (
            generateImmediately &&
            tableManager
                ?.generateStoredProfileTables
        ) {
            try {
                generated =
                    await tableManager
                        .generateStoredProfileTables(
                            createdProfile.id
                        );
            }
            catch (error) {
                console.error(
                    "Compendium Curator | Error generando la RollTable al crear el perfil.",
                    error
                );

                ui.notifications.error(
                    game.i18n.localize(
                        "COMPENDIUM_CURATOR.RollTableGenerationFailed"
                    )
                );
            }
        }

        if (tableManager?.rendered) {
            tableManager._activeTab =
                profileType === "nested"
                    ? "nested"
                    : "content";

            tableManager.render({ force: true });
        }

        ui.notifications.info(
            generated
                ? game.i18n.format(
                    "COMPENDIUM_CURATOR.RollTableGenerated",
                    { name: generated.root.name }
                )
                : game.i18n.localize(
                    "COMPENDIUM_CURATOR.TableProfileSaved"
                )
        );

        await this.close();
    }

    static async #onCancel() {
        await this.close();
    }

    async _preClose(options) {
        clearTimeout(this._refreshTimer);
        await super._preClose(options);
    }

}
