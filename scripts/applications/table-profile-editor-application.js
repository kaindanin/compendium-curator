import { TableProfileService } from "../services/table-profile-service.js";
import { CuratorState } from "../state/curator-state.js";
import { TableDefaultsService } from "../services/table-defaults-service.js";
import { TableProfileStorageService } from "../services/table-profile-storage-service.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

export class TableProfileEditorApplication
    extends HandlebarsApplicationMixin(
        ApplicationV2
    ) {

    constructor(browserApp, options = {}) {

        super(options);

        this.browserApp = browserApp;
        this._step = "configure";
        this._draft = null;
        this._ccRefreshTimer = null;

    }

    static DEFAULT_OPTIONS = {

        id: "compendium-curator-table-profile-editor",

        classes: [
            "dnd5e2",
            "compendium-curator",
            "cc-table-profile-editor-app"
        ],

        actions: {
            next: this.#onNext,
            back: this.#onBack,
            save: this.#onSave
        },

        window: {
            title:
                "COMPENDIUM_CURATOR.NewTableProfile",
            resizable: true
        },

        position: {
            width: 620,
            height: 560
        }

    };

    static PARTS = {

        body: {
            template:
                "modules/compendium-curator/templates/table-profile-editor.hbs"
        }

    };

    scheduleRefresh() {

        if (this._step !== "preview")
            return;

        clearTimeout(
            this._ccRefreshTimer
        );

        this._ccRefreshTimer =
            setTimeout(() => {

                this._ccRefreshTimer = null;

                if (!this.rendered)
                    return;

                this.render({
                    force: true
                });

            }, 100);

    }

    async _prepareContext(options) {

        const context =
            await super._prepareContext(
                options
            );

        context.isPreviewStep =
            this._step === "preview";

        context.isConfigureStep =
            this._step === "configure";

        if (context.isConfigureStep) {

            context.profileTypes = [
                {
                    value: "content",
                    label:
                        "COMPENDIUM_CURATOR.TableProfileTypeContent"
                },
                {
                    value: "nested",
                    label:
                        "COMPENDIUM_CURATOR.TableProfileTypeNested"
                }
            ];

            context.groupingOptions = [
                {
                    value: "rarity",
                    label:
                        "COMPENDIUM_CURATOR.GroupByRarity"
                }
            ];

            const rarityLabels = {
                mundane:
                    "RarityMundane",

                common:
                    "RarityCommon",

                uncommon:
                    "RarityUncommon",

                rare:
                    "RarityRare",

                veryRare:
                    "RarityVeryRare",

                legendary:
                    "RarityLegendary",

                artifact:
                    "RarityArtifact"
            };

            const tableDefaults =
                TableDefaultsService.get();

            context.rarityGroups =
                Object.entries(
                    rarityLabels
                ).map(
                    ([key, localizationKey]) => ({
                        key,

                        weight:
                            tableDefaults
                                .rarityWeights
                                ?.[key] ?? 1,

                        label:
                            game.i18n.localize(
                                `COMPENDIUM_CURATOR.${localizationKey}`
                            )
                    })
                );

            return context;

        }

        const candidates =
            await TableProfileService
                .getBrowserCandidates(
                    this.browserApp
                );

        const selection =
            CuratorState.getSelection(
                this.browserApp
            );

        const useCuratorSelection =
            this.browserApp._ccCuratorMode === true &&
            selection.size > 0;

        const includedCandidates =
            useCuratorSelection
                ? candidates.filter(candidate =>
                    selection.has(candidate.uuid)
                )
                : candidates;

        context.candidateCount =
            includedCandidates.length;

        context.candidates =
            includedCandidates.map(candidate => ({
                uuid:
                    candidate.uuid,

                name:
                    candidate.name,

                type:
                    candidate.type
            }));

        context.hasCandidates =
            includedCandidates.length > 0;

        return context;

    }

    _setBrowserLocked(locked) {

        const browser =
            this.browserApp;

        if (!browser?.element)
            return;

        browser.element.classList.toggle(
            "cc-table-browser-locked",
            locked
        );

        const content =
            browser.element.querySelector(
                ".window-content"
            );

        if (content)
            content.inert = locked;

    }

    static async #onNext() {

        const draft =
            await TableProfileService
                .createContentDraft(
                    this.browserApp
                );

        if (!draft?.includedCount)
            return;

        this._draft = draft;
        this._step = "configure";

        this._setBrowserLocked(true);

        this.render({
            force: true
        });

    }

    static #onBack() {

        this._step = "preview";
        this._draft = null;

        this._setBrowserLocked(false);

        this.render({
            force: true
        });

    }

    static async #onSave() {

        if (this._step !== "configure")
            return;

        const nameInput =
            this.element.querySelector(
                '[name="profileName"]'
            );

        const typeInput =
            this.element.querySelector(
                '[name="profileType"]'
            );

        const groupingInput =
            this.element.querySelector(
                '[name="grouping"]'
            );

        const name =
            String(
                nameInput?.value ?? ""
            ).trim();

        const profileType =
            typeInput?.value === "nested"
                ? "nested"
                : "content";

        if (
            TableProfileStorageService
                .isNameTaken(name)
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

        const weights = {};

        if (profileType === "content") {

            for (
                const input
                of this.element.querySelectorAll(
                    '[name^="weight."]'
                )
            ) {

                const key =
                    input.name.replace(
                        "weight.",
                        ""
                    );

                const value =
                    Number.parseInt(
                        input.value,
                        10
                    );

                if (
                    !Number.isInteger(value) ||
                    value < 1
                ) {

                    ui.notifications.warn(
                        game.i18n.localize(
                            "COMPENDIUM_CURATOR.InvalidTableWeight"
                        )
                    );

                    input.focus();

                    return;

                }

                weights[key] = value;

            }
        
        }

        let profile;

        if (profileType === "nested") {

            profile = {
                version: 2,
                type: "nested",

                name,

                revision: 1,

                children: [],

                generation: {
                    masterUuid: null,
                    groupUuids: {},
                    generatedRevision: 0
                }
            };

        }
        else {

            profile = {
                version: 2,
                type: "content",

                name,

                revision: 1,

                filterGroups: [],

                manualIncludes: [],
                manualExcludes: [],

                grouping: {
                    type:
                        groupingInput?.value ??
                        "rarity",

                    weights
                },

                generation: {
                    masterUuid: null,
                    groupUuids: {},
                    generatedRevision: 0
                }
            };

        }

        await TableProfileStorageService.create(
            profile
        );

        const tableManager =
            this.browserApp
                ?._ccTableManager;

        if (tableManager?.rendered) {

            tableManager.render({
                force: true
            });

        }

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.TableProfileSaved"
            )
        );

        await this.close();

    }

    async _preClose(options) {

        clearTimeout(
            this._ccRefreshTimer
        );

        this._setBrowserLocked(false);

        await super._preClose(options);

    }

}