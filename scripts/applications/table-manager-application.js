import { TableProfileEditorApplication } from "./table-profile-editor-application.js";
import { TableDefaultsApplication } from "./table-defaults-application.js";
import { TableProfileStorageService } from "../services/table-profile-storage-service.js";
import { TableFilterGroupApplication } from "./table-filter-group-application.js";
import { TableProfilePreviewApplication } from "./table-profile-preview-application.js";
import { TableProfileExclusionsApplication } from "./table-profile-exclusions-application.js";
import { TableProfileInclusionsApplication } from "./table-profile-inclusions-application.js";
import { TableProfileService } from "../services/table-profile-service.js";
import { StorageService } from "../services/storage-service.js";
import { TableFilterGroupDetailsApplication } from "./table-filter-group-details-application.js";
import {
    activateDnd5eDocumentEntries,
    prepareDnd5eDocumentEntries,
    prepareDnd5eIndexedEntries
} from "../ui/dnd5e-document-list.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

const TABLE_DIALOG_CLASSES = [
    "cc-table-dialog"
];

const CONTENT_INSPECTOR_ENTRY_LIMIT = 150;

const CONTENT_INSPECTOR_RARITY_ORDER = [
    "mundane",
    "common",
    "uncommon",
    "rare",
    "veryRare",
    "legendary",
    "artifact"
];

const CONTENT_INSPECTOR_RARITY_LABELS = {
    mundane: "RarityMundane",
    common: "RarityCommon",
    uncommon: "RarityUncommon",
    rare: "RarityRare",
    veryRare: "RarityVeryRare",
    legendary: "RarityLegendary",
    artifact: "RarityArtifact"
};

function getRefreshSectionTitle(key, count) {
    const text = game.i18n.format(
        `COMPENDIUM_CURATOR.${key}`,
        { count }
    );

    return text
        .replace(/\s*\(\s*\d+\s*\)\s*$/, "")
        .trim();
}

function renderRefreshDocumentList(
    title,
    count,
    entries
) {
    const escape = foundry.utils.escapeHTML;

    const resultsLabel = escape(
        game.i18n.localize(
            "DND5E.CompendiumBrowser.Column.Results"
        )
    );

    const sourceLabel = escape(
        game.i18n.localize(
            "DND5E.CompendiumBrowser.Column.Source"
        )
    );

    const rows = entries
        .map(entry => {
            const uuid = escape(
                String(entry.uuid ?? "")
            );
            const name = escape(
                String(
                    entry.name ??
                    entry.uuid ??
                    ""
                )
            );
            const img = entry.img
                ? escape(String(entry.img))
                : "";
            const subtitle = entry.subtitle
                ? escape(
                    game.i18n.localize(
                        entry.subtitle
                    )
                )
                : "";
            const source = entry.source
                ? escape(String(entry.source))
                : "";

            return `
                <li
                    class="item cc-dnd5e-document-entry"
                    data-uuid="${uuid}"
                >
                    <div class="item-row">
                        <div
                            class="item-name rollable"
                            role="button"
                            data-cc-open-document
                        >
                            ${img
                                ? `
                                    <img
                                        class="item-image gold-icon"
                                        loading="lazy"
                                        src="${img}"
                                        alt="${name}"
                                        draggable="false"
                                    >
                                `
                                : ""
                            }

                            <div class="name name-stacked">
                                <span class="title">
                                    ${name}
                                </span>

                                ${subtitle
                                    ? `
                                        <span class="subtitle">
                                            ${subtitle}
                                        </span>
                                    `
                                    : ""
                                }
                            </div>
                        </div>

                        <div
                            class="item-detail item-source ${source ? "" : "empty"}"
                        >
                            ${source
                                ? `
                                    <span class="condensed">
                                        ${source}
                                    </span>
                                `
                                : ""
                            }
                        </div>

                        <div
                            class="item-detail item-controls"
                        ></div>
                    </div>
                </li>
            `;
        })
        .join("");

    return `
        <section class="cc-table-filter-refresh-section">
            <div class="cc-table-filter-group-matches-title">
                <h3>${escape(title)}</h3>
                <strong>${count}</strong>
            </div>

            <section class="inventory-element cc-dnd5e-document-list">
                <section class="items-list browser-results">
                    <div class="items-section card">
                        <div class="items-header header">
                            <h3 class="item-name">
                                ${resultsLabel}
                            </h3>

                            <div class="item-header item-source">
                                ${sourceLabel}
                            </div>

                            <div class="item-header item-controls"></div>
                        </div>

                        <ol class="item-list unlist">
                            ${rows}
                        </ol>
                    </div>
                </section>
            </section>
        </section>
    `;
}

function normalizeManagerSearchText(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase();
}

function getIndexedDocument(uuid) {
    const value = String(uuid ?? "");

    const parts = value.split(".");

    if (
        parts[0] === "Compendium" &&
        parts.length >= 4
    ) {
        const collection =
            `${parts[1]}.${parts[2]}`;

        const documentId =
            parts.at(-1);

        const indexed =
            game.packs
                ?.get(collection)
                ?.index
                ?.get(documentId);

        if (indexed)
            return indexed;
    }

    if (
        typeof fromUuidSync === "function"
    ) {
        return fromUuidSync(value) ?? null;
    }

    return null;
}

function getInspectorRarity(uuid) {
    const document =
        getIndexedDocument(uuid);

    const rarity =
        String(
            document?.system?.rarity ?? ""
        ).trim();

    return rarity || "mundane";
}

function getInspectorRarityLabel(key) {
    const localizationKey =
        CONTENT_INSPECTOR_RARITY_LABELS[key];

    return localizationKey
        ? game.i18n.localize(
            `COMPENDIUM_CURATOR.${localizationKey}`
        )
        : key;
}

function buildContentInspector(profile) {
    const hiddenUuids =
        new Set(
            StorageService.getHiddenUuids()
        );

    const finalUuids =
        new Set();

    for (
        const group
        of profile?.filterGroups ?? []
    ) {
        for (
            const uuid
            of group?.matches ?? []
        ) {
            if (
                uuid &&
                !hiddenUuids.has(uuid)
            ) {
                finalUuids.add(uuid);
            }
        }
    }

    for (
        const uuid
        of profile?.manualIncludes ?? []
    ) {
        if (
            uuid &&
            !hiddenUuids.has(uuid)
        ) {
            finalUuids.add(uuid);
        }
    }

    for (
        const uuid
        of profile?.manualExcludes ?? []
    ) {
        finalUuids.delete(uuid);
    }

    for (const uuid of hiddenUuids) {
        finalUuids.delete(uuid);
    }

    const byRarity =
        new Map();

    for (const uuid of finalUuids) {
        const rarity =
            getInspectorRarity(uuid);

        const entries =
            byRarity.get(rarity) ?? [];

        entries.push(uuid);
        byRarity.set(rarity, entries);
    }

    const orderedKeys = [
        ...CONTENT_INSPECTOR_RARITY_ORDER
            .filter(key => byRarity.has(key)),
        ...[...byRarity.keys()]
            .filter(key =>
                !CONTENT_INSPECTOR_RARITY_ORDER
                    .includes(key)
            )
            .sort((a, b) =>
                String(a).localeCompare(
                    String(b),
                    game.i18n.lang,
                    { sensitivity: "base" }
                )
            )
    ];

    const rarityGroups =
        orderedKeys.map(key => {
            const uuids =
                byRarity.get(key) ?? [];

            const allEntries =
                prepareDnd5eIndexedEntries(
                    uuids
                );

            const entries =
                allEntries.slice(
                    0,
                    CONTENT_INSPECTOR_ENTRY_LIMIT
                );

            return {
                key,
                label:
                    getInspectorRarityLabel(key),
                count:
                    uuids.length,
                entries,
                previewCount:
                    entries.length,
                truncated:
                    uuids.length >
                    entries.length
            };
        });

    return {
        finalCount:
            finalUuids.size,
        hasObjects:
            finalUuids.size > 0,
        rarityGroups
    };
}

export class TableManagerApplication
    extends HandlebarsApplicationMixin(
        ApplicationV2
    ) {

    constructor(browserApp, options = {}) {
        super(options);

        this.browserApp = browserApp;
        this._profileEditor = null;
        this._defaultsEditor = null;
        this._filterGroupEditor = null;
        this._profilePreview = null;
        this._profileExclusions = null;
        this._profileInclusions = null;
        this._filterGroupDetails = null;
        this._profileActionsPopover = null;
        this._profileActionsProfileId = null;
        this._profileActionsOutsideHandler = null;
        this._profileActionsViewportHandler = null;
        this._activeTab = "content";
        this._searchQuery = "";
    }


    static DEFAULT_OPTIONS = {
        id:
            "compendium-curator-table-manager",
        classes: [
            "dnd5e2",
            "compendium-curator",
            "cc-table-manager-app"
        ],
        actions: {
            changeManagerTab:
                this.#onChangeManagerTab,
            clearManagerSearch:
                this.#onClearManagerSearch,
            createProfile:
                this.#onCreateProfile,
            configureDefaults:
                this.#onConfigureDefaults,
            addCurrentFilters:
                this.#onAddCurrentFilters,
            previewProfile:
                this.#onPreviewProfile,
            manualInclusions:
                this.#onManualInclusions,
            manualExclusions:
                this.#onManualExclusions,
            renameProfile:
                this.#onRenameProfile,
            duplicateProfile:
                this.#onDuplicateProfile,
            deleteProfile:
                this.#onDeleteProfile,
            renameFilterGroup:
                this.#onRenameFilterGroup,
            duplicateFilterGroup:
                this.#onDuplicateFilterGroup,
            deleteGlobalFilterGroup:
                this.#onDeleteGlobalFilterGroup,
            toggleProfileActions:
                this.#onToggleProfileActions,
            filterGroupDetails:
                this.#onFilterGroupDetails,
            refreshFilterGroup:
                this.#onRefreshFilterGroup,
            loadFilterGroup:
                this.#onLoadFilterGroup,
            unlinkFilterGroup:
                this.#onUnlinkFilterGroup
        },
        window: {
            title:
                "COMPENDIUM_CURATOR.TableManagerTitle",
            resizable: true
        },
        position: {
            width: 720,
            height: 520
        }
    };


    static PARTS = {
        body: {
            template:
                "modules/compendium-curator/templates/table-manager.hbs"
        }
    };


    async _prepareContext(options) {
        const context =
            await super._prepareContext(options);

        await TableProfileStorageService
            .migrateStorage();

        const profiles =
            Object.values(
                TableProfileStorageService
                    .getProfiles()
            )
                .filter(profile =>
                    profile?.version === 2
                )
                .map(profile => {
                    const filterGroupCount =
                        Array.isArray(
                            profile.filterGroups
                        )
                            ? profile.filterGroups.length
                            : 0;

                    const filterGroups =
                        Array.isArray(
                            profile.filterGroups
                        )
                            ? profile.filterGroups
                                .map(group => ({
                                    id: group.id,
                                    name: group.name
                                }))
                                .sort((a, b) =>
                                    String(a.name ?? "")
                                        .localeCompare(
                                            String(b.name ?? ""),
                                            game.i18n.lang,
                                            {
                                                sensitivity: "base"
                                            }
                                        )
                                )
                            : [];

                    const type =
                        profile.type === "nested"
                            ? "nested"
                            : "content";

                    const isContent =
                        type === "content";
                    const isNested =
                        type === "nested";

                    const childCount =
                        Array.isArray(profile.children)
                            ? profile.children.length
                            : 0;

                    const typeLabel =
                        game.i18n.localize(
                            isNested
                                ? "COMPENDIUM_CURATOR.TableProfileTypeNested"
                                : "COMPENDIUM_CURATOR.TableProfileTypeContent"
                        );

                    const typeIcon =
                        isNested
                            ? "fas fa-table-list"
                            : "fas fa-boxes-stacked";

                    const summary =
                        isNested
                            ? game.i18n.format(
                                "COMPENDIUM_CURATOR.SubtableCount",
                                { count: childCount }
                            )
                            : game.i18n.format(
                                "COMPENDIUM_CURATOR.FilterGroupCount",
                                { count: filterGroupCount }
                            );

                    const revision =
                        Number(profile.revision ?? 1);

                    const generatedRevision =
                        Number(
                            profile.generation
                                ?.generatedRevision ?? 0
                        );

                    let statusKey =
                        "TableProfileNeverGenerated";

                    if (
                        generatedRevision > 0 &&
                        generatedRevision < revision
                    ) {
                        statusKey =
                            "TableProfilePendingChanges";
                    }
                    else if (
                        generatedRevision > 0 &&
                        generatedRevision === revision
                    ) {
                        statusKey =
                            "TableProfileUpToDate";
                    }

                    const status =
                        game.i18n.localize(
                            `COMPENDIUM_CURATOR.${statusKey}`
                        );

                    const inspector =
                        isContent
                            ? buildContentInspector(
                                profile
                            )
                            : null;

                    return {
                        id: profile.id,
                        name: profile.name,
                        type,
                        isContent,
                        isNested,
                        typeLabel,
                        typeIcon,
                        summary,
                        childCount,
                        filterGroupCount,
                        filterGroups,
                        inspector,
                        status,
                        searchText: [
                            profile.name,
                            typeLabel,
                            status,
                            ...filterGroups.map(
                                group => group.name
                            )
                        ]
                            .filter(Boolean)
                            .join(" ")
                    };
                })
                .sort((a, b) =>
                    String(a.name ?? "")
                        .localeCompare(
                            String(b.name ?? ""),
                            game.i18n.lang,
                            {
                                sensitivity: "base"
                            }
                        )
                );

        const contentProfiles =
            profiles.filter(
                profile => profile.isContent
            );

        const nestedProfiles =
            profiles.filter(
                profile => profile.isNested
            );

        const filterGroups =
            Object.values(
                TableProfileStorageService
                    .getFilterGroups()
            )
                .map(filterGroup => {
                    const usedBy =
                        profiles
                            .filter(profile =>
                                profile.filterGroups
                                    .some(group =>
                                        group.id ===
                                            filterGroup.id
                                    )
                            )
                            .map(profile => ({
                                id: profile.id,
                                name: profile.name
                            }))
                            .sort((a, b) =>
                                String(a.name ?? "")
                                    .localeCompare(
                                        String(b.name ?? ""),
                                        game.i18n.lang,
                                        {
                                            sensitivity: "base"
                                        }
                                    )
                            );

                    const matchCount =
                        Array.isArray(
                            filterGroup.matches
                        )
                            ? filterGroup.matches.length
                            : 0;

                    const useCount =
                        usedBy.length;

                    return {
                        id: filterGroup.id,
                        name: filterGroup.name,
                        matchCount,
                        useCount,
                        usedBy,
                        matchesLabel:
                            game.i18n.format(
                                "COMPENDIUM_CURATOR.CurrentFilterMatches",
                                { count: matchCount }
                            ),
                        usageLabel:
                            `${useCount} ${game.i18n.localize(
                                "COMPENDIUM_CURATOR.TableProfiles"
                            ).toLocaleLowerCase()}`,
                        searchText: [
                            filterGroup.name,
                            ...usedBy.map(
                                profile => profile.name
                            )
                        ]
                            .filter(Boolean)
                            .join(" ")
                    };
                })
                .sort((a, b) =>
                    String(a.name ?? "")
                        .localeCompare(
                            String(b.name ?? ""),
                            game.i18n.lang,
                            {
                                sensitivity: "base"
                            }
                        )
                );

        if (
            ![
                "content",
                "nested",
                "filters"
            ].includes(this._activeTab)
        ) {
            this._activeTab = "content";
        }

        const isContentTab =
            this._activeTab === "content";
        const isNestedTab =
            this._activeTab === "nested";
        const isFilterGroupsTab =
            this._activeTab === "filters";

        context.isContentTab = isContentTab;
        context.isNestedTab = isNestedTab;
        context.isFilterGroupsTab =
            isFilterGroupsTab;

        context.contentTabClass =
            isContentTab ? "active" : "";
        context.nestedTabClass =
            isNestedTab ? "active" : "";
        context.filterGroupsTabClass =
            isFilterGroupsTab ? "active" : "";

        context.contentProfileCount =
            contentProfiles.length;
        context.nestedProfileCount =
            nestedProfiles.length;
        context.filterGroupCount =
            filterGroups.length;

        context.profiles =
            isNestedTab
                ? nestedProfiles
                : contentProfiles;

        context.hasProfiles =
            context.profiles.length > 0;

        context.filterGroups = filterGroups;
        context.hasFilterGroups =
            filterGroups.length > 0;

        context.searchQuery =
            this._searchQuery;

        context.searchLabel =
            this.browserApp
                ?.element
                ?.querySelector(
                    'search > input[name="name"]'
                )
                ?.placeholder ??
            game.i18n.localize(
                "COMPENDIUM_CURATOR.TableProfiles"
            );

        return context;
    }


    async _onRender(context, options) {
        await super._onRender(
            context,
            options
        );

        const input =
            this.element.querySelector(
                '[name="managerSearch"]'
            );

        input?.addEventListener(
            "input",
            event => {
                this._searchQuery =
                    String(
                        event.target?.value ?? ""
                    );
                this._applyManagerSearch();
            }
        );

        activateDnd5eDocumentEntries(
            this.element
        );

        this._applyManagerSearch();
    }


    _applyManagerSearch() {
        const query =
            normalizeManagerSearchText(
                this._searchQuery
            );

        for (
            const entry
            of this.element.querySelectorAll(
                "[data-cc-search-text]"
            )
        ) {
            const haystack =
                normalizeManagerSearchText(
                    entry.dataset.ccSearchText
                );

            entry.hidden =
                Boolean(query) &&
                !haystack.includes(query);
        }
    }


    _refreshApplicationsForFilterGroup(
        filterGroupId
    ) {
        const affectedProfiles =
            new Set(
                TableProfileStorageService
                    .getFilterGroupUsage(
                        filterGroupId
                    )
                    .map(profile => profile.id)
            );

        if (
            this._profilePreview?.rendered &&
            affectedProfiles.has(
                this._profilePreview.profileId
            )
        ) {
            this._profilePreview.render({
                force: true
            });
        }

        if (
            this._profileExclusions?.rendered &&
            affectedProfiles.has(
                this._profileExclusions.profileId
            )
        ) {
            this._profileExclusions.render({
                force: true
            });
        }

        if (
            this._profileInclusions?.rendered &&
            affectedProfiles.has(
                this._profileInclusions.profileId
            )
        ) {
            this._profileInclusions.render({
                force: true
            });
        }

        if (
            this._filterGroupDetails?.rendered &&
            this._filterGroupDetails
                .filterGroupId === filterGroupId
        ) {
            this._filterGroupDetails.render({
                force: true
            });
        }
    }


    async _preClose(options) {
        this._closeProfileActionsPopover();

        const applications = [
            "_profileEditor",
            "_defaultsEditor",
            "_filterGroupEditor",
            "_profilePreview",
            "_profileExclusions",
            "_profileInclusions",
            "_filterGroupDetails"
        ];

        for (const property of applications) {
            const application = this[property];
            this[property] = null;

            if (application?.rendered) {
                await application.close();
            }
        }

        if (this.browserApp) {
            this.browserApp._ccTableManagerLocked =
                false;

            if (
                this.browserApp.element
                    ?.isConnected
            ) {
                this.browserApp
                    ._ccRefreshToolbar?.();
            }

            if (
                this.browserApp._ccTableManager ===
                this
            ) {
                this.browserApp._ccTableManager =
                    null;
            }
        }

        await super._preClose(options);
    }


    static #onChangeManagerTab(event, target) {
        event.preventDefault();

        const tab =
            String(target.dataset?.tab ?? "");

        if (
            ![
                "content",
                "nested",
                "filters"
            ].includes(tab) ||
            tab === this._activeTab
        ) {
            return;
        }

        this._activeTab = tab;
        this._closeProfileActionsPopover();

        this.render({
            force: true
        });
    }


    static #onClearManagerSearch(
        event,
        target
    ) {
        event.preventDefault();

        this._searchQuery = "";

        const input =
            target
                .closest("search")
                ?.querySelector(
                    '[name="managerSearch"]'
                );

        if (input)
            input.value = "";

        this._applyManagerSearch();
        input?.focus();
    }


    static async #onCreateProfile() {
        if (this._activeTab === "filters") {
            const storedGroup =
                await TableFilterGroupApplication
                    .createFromCurrentFilters(
                        this.browserApp
                    );

            if (storedGroup) {
                this.render({
                    force: true
                });
            }

            return;
        }

        if (this._profileEditor?.rendered) {
            this._profileEditor.bringToFront();
            return;
        }

        this._profileEditor ??=
            new TableProfileEditorApplication(
                this.browserApp
            );

        this._profileEditor.render({
            force: true
        });
    }


    refreshProfileEditor() {
        if (!this._profileEditor?.rendered)
            return;

        this._profileEditor.scheduleRefresh();
    }


    static #onConfigureDefaults() {
        if (this._defaultsEditor?.rendered) {
            this._defaultsEditor.bringToFront();
            return;
        }

        this._defaultsEditor =
            new TableDefaultsApplication();

        this._defaultsEditor.render({
            force: true
        });
    }


    static async #onAddCurrentFilters(
        event,
        target
    ) {
        const profileId =
            target
                .closest("[data-profile-id]")
                ?.dataset?.profileId;

        if (!profileId)
            return;

        if (this._filterGroupEditor?.rendered) {
            if (
                this._filterGroupEditor
                    .profileId === profileId
            ) {
                this._filterGroupEditor
                    .bringToFront();
                return;
            }

            await this._filterGroupEditor.close();
        }

        this._filterGroupEditor =
            new TableFilterGroupApplication(
                this.browserApp,
                this,
                profileId
            );

        this._filterGroupEditor.render({
            force: true
        });
    }


    static async #onPreviewProfile(
        event,
        target
    ) {
        const profileId =
            target
                .closest("[data-profile-id]")
                ?.dataset?.profileId;

        if (!profileId)
            return;

        if (this._profilePreview?.rendered) {
            if (
                this._profilePreview
                    .profileId === profileId
            ) {
                this._profilePreview
                    .bringToFront();
                return;
            }

            await this._profilePreview.close();
        }

        this._profilePreview =
            new TableProfilePreviewApplication(
                this.browserApp,
                profileId
            );

        this._profilePreview.render({
            force: true
        });
    }


    static async #onManualInclusions(
        event,
        target
    ) {
        const profileId =
            target
                .closest("[data-profile-id]")
                ?.dataset?.profileId;

        if (!profileId)
            return;

        if (this._profileInclusions?.rendered) {
            if (
                this._profileInclusions
                    .profileId === profileId
            ) {
                this._profileInclusions
                    .bringToFront();
                return;
            }

            await this._profileInclusions.close();
        }

        this._profileInclusions =
            new TableProfileInclusionsApplication(
                this.browserApp,
                this,
                profileId
            );

        this._profileInclusions.render({
            force: true
        });
    }


    static async #onManualExclusions(
        event,
        target
    ) {
        const profileId =
            target
                .closest("[data-profile-id]")
                ?.dataset?.profileId;

        if (!profileId)
            return;

        if (this._profileExclusions?.rendered) {
            if (
                this._profileExclusions
                    .profileId === profileId
            ) {
                this._profileExclusions
                    .bringToFront();
                return;
            }

            await this._profileExclusions.close();
        }

        this._profileExclusions =
            new TableProfileExclusionsApplication(
                this.browserApp,
                this,
                profileId
            );

        this._profileExclusions.render({
            force: true
        });
    }


    static async #onRenameProfile(
        event,
        target
    ) {
        event.preventDefault();
        event.stopPropagation();

        const profileId =
            target
                .closest("[data-profile-id]")
                ?.dataset?.profileId;

        if (!profileId)
            return;

        const profile =
            TableProfileStorageService
                .getProfiles()?.[profileId];

        if (!profile)
            return;

        const field =
            document.createElement("div");
        field.className = "form-group";

        const label =
            document.createElement("label");
        label.textContent =
            game.i18n.localize(
                "COMPENDIUM_CURATOR.ProfileName"
            );

        const input =
            document.createElement("input");
        input.type = "text";
        input.name = "profileName";
        input.autocomplete = "off";
        input.autofocus = true;
        input.value = profile.name;

        field.append(label, input);

        const result =
            await foundry.applications.api
                .DialogV2.input({
                    window: {
                        title:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.RenameProfile"
                            )
                    },
                    content: field.outerHTML,
                    ok: {
                        label:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.Rename"
                            )
                    },
                    rejectClose: false,
                    modal: true
                });

        if (!result)
            return;

        const name =
            String(
                result.profileName ?? ""
            ).trim();

        if (!name) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.ProfileNameRequired"
                )
            );
            return;
        }

        if (name === profile.name)
            return;

        try {
            await TableProfileStorageService
                .renameProfile(
                    profileId,
                    name
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
                return;
            }
            throw error;
        }

        this.render({
            force: true
        });

        const applications = [
            this._profilePreview,
            this._profileInclusions,
            this._profileExclusions
        ];

        for (const application of applications) {
            if (
                application?.rendered &&
                application.profileId === profileId
            ) {
                application.render({
                    force: true
                });
            }
        }
    }


    static async #onDuplicateProfile(
        event,
        target
    ) {
        event.preventDefault();
        event.stopPropagation();

        const profileId =
            target
                .closest("[data-profile-id]")
                ?.dataset?.profileId;

        if (!profileId)
            return;

        const profile =
            TableProfileStorageService
                .getProfiles()?.[profileId];

        if (!profile)
            return;

        let suggestedName =
            game.i18n.format(
                "COMPENDIUM_CURATOR.ProfileCopyName",
                { profile: profile.name }
            );

        if (
            TableProfileStorageService
                .isNameTaken(suggestedName)
        ) {
            const baseName = suggestedName;
            let index = 2;

            while (
                TableProfileStorageService
                    .isNameTaken(
                        `${baseName} (${index})`
                    )
            ) {
                index++;
            }

            suggestedName =
                `${baseName} (${index})`;
        }

        const field =
            document.createElement("div");
        field.className = "form-group";

        const label =
            document.createElement("label");
        label.textContent =
            game.i18n.localize(
                "COMPENDIUM_CURATOR.ProfileName"
            );

        const input =
            document.createElement("input");
        input.type = "text";
        input.name = "profileName";
        input.autocomplete = "off";
        input.autofocus = true;
        input.value = suggestedName;

        field.append(label, input);

        const result =
            await foundry.applications.api
                .DialogV2.input({
                    window: {
                        title:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.DuplicateProfile"
                            )
                    },
                    content: field.outerHTML,
                    ok: {
                        label:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.Duplicate"
                            )
                    },
                    rejectClose: false,
                    modal: true
                });

        if (!result)
            return;

        const name =
            String(
                result.profileName ?? ""
            ).trim();

        if (!name) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.ProfileNameRequired"
                )
            );
            return;
        }

        if (
            TableProfileStorageService
                .isNameTaken(name)
        ) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.TableProfileNameTaken"
                )
            );
            return;
        }

        await TableProfileStorageService
            .duplicateProfile(
                profileId,
                name
            );

        this.render({
            force: true
        });
    }


    static async #onDeleteProfile(
        event,
        target
    ) {
        event.preventDefault();
        event.stopPropagation();

        const profileId =
            target
                .closest("[data-profile-id]")
                ?.dataset?.profileId;

        if (!profileId)
            return;

        const profile =
            TableProfileStorageService
                .getProfiles()?.[profileId];

        if (!profile)
            return;

        const confirmed =
            await foundry.applications.api
                .DialogV2.confirm({
                    classes:
                        TABLE_DIALOG_CLASSES,
                    window: {
                        title:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.DeleteProfile"
                            )
                    },
                    content:
                        `<p>${game.i18n.format(
                            "COMPENDIUM_CURATOR.ProfileDeleteConfirm",
                            {
                                profile:
                                    foundry.utils.escapeHTML(
                                        profile.name
                                    )
                            }
                        )}</p>`,
                    rejectClose: false,
                    modal: true
                });

        if (!confirmed)
            return;

        const profileApplications = [
            "_filterGroupEditor",
            "_profilePreview",
            "_profileInclusions",
            "_profileExclusions",
            "_filterGroupDetails"
        ];

        for (const property of profileApplications) {
            const application = this[property];

            if (
                application?.profileId !== profileId
            ) {
                continue;
            }

            if (application.rendered) {
                await application.close();
            }

            this[property] = null;
        }

        await TableProfileStorageService
            .removeProfile(profileId);

        this.render({
            force: true
        });
    }


    static async #onRenameFilterGroup(
        event,
        target
    ) {
        event.preventDefault();
        event.stopPropagation();

        const filterGroupId =
            target
                .closest("[data-filter-group-id]")
                ?.dataset?.filterGroupId;

        if (!filterGroupId)
            return;

        const filterGroup =
            TableProfileStorageService
                .getFilterGroup(filterGroupId);

        if (!filterGroup)
            return;

        const field =
            document.createElement("div");
        field.className = "form-group";

        const label =
            document.createElement("label");
        label.textContent =
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupName"
            );

        const input =
            document.createElement("input");
        input.type = "text";
        input.name = "filterGroupName";
        input.autocomplete = "off";
        input.autofocus = true;
        input.value = filterGroup.name;

        field.append(label, input);

        const result =
            await foundry.applications.api
                .DialogV2.input({
                    window: {
                        title:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.RenameFilterGroup"
                            )
                    },
                    content: field.outerHTML,
                    ok: {
                        label:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.Rename"
                            )
                    },
                    rejectClose: false,
                    modal: true
                });

        if (!result)
            return;

        const name =
            String(
                result.filterGroupName ?? ""
            ).trim();

        if (!name) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNameRequired"
                )
            );
            return;
        }

        if (name === filterGroup.name)
            return;

        if (
            TableProfileStorageService
                .isFilterGroupNameTaken(
                    null,
                    name,
                    filterGroupId
                )
        ) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNameTaken"
                )
            );
            return;
        }

        await TableProfileStorageService
            .renameFilterGroup(
                filterGroupId,
                name
            );

        this.render({ force: true });
        this._refreshApplicationsForFilterGroup(
            filterGroupId
        );
    }


    static async #onDuplicateFilterGroup(
        event,
        target
    ) {
        event.preventDefault();
        event.stopPropagation();

        const filterGroupId =
            target
                .closest("[data-filter-group-id]")
                ?.dataset?.filterGroupId;

        if (!filterGroupId)
            return;

        const filterGroup =
            TableProfileStorageService
                .getFilterGroup(filterGroupId);

        if (!filterGroup)
            return;

        let suggestedName =
            game.i18n.format(
                "COMPENDIUM_CURATOR.FilterGroupCopyName",
                { group: filterGroup.name }
            );

        if (
            TableProfileStorageService
                .isFilterGroupNameTaken(
                    null,
                    suggestedName
                )
        ) {
            const baseName = suggestedName;
            let index = 2;

            while (
                TableProfileStorageService
                    .isFilterGroupNameTaken(
                        null,
                        `${baseName} (${index})`
                    )
            ) {
                index++;
            }

            suggestedName =
                `${baseName} (${index})`;
        }

        const field =
            document.createElement("div");
        field.className = "form-group";

        const label =
            document.createElement("label");
        label.textContent =
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupName"
            );

        const input =
            document.createElement("input");
        input.type = "text";
        input.name = "filterGroupName";
        input.autocomplete = "off";
        input.autofocus = true;
        input.value = suggestedName;

        field.append(label, input);

        const result =
            await foundry.applications.api
                .DialogV2.input({
                    window: {
                        title:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.DuplicateFilterGroup"
                            )
                    },
                    content: field.outerHTML,
                    ok: {
                        label:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.Duplicate"
                            )
                    },
                    rejectClose: false,
                    modal: true
                });

        if (!result)
            return;

        const name =
            String(
                result.filterGroupName ?? ""
            ).trim();

        if (!name) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNameRequired"
                )
            );
            return;
        }

        if (
            TableProfileStorageService
                .isFilterGroupNameTaken(
                    null,
                    name
                )
        ) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNameTaken"
                )
            );
            return;
        }

        await TableProfileStorageService
            .duplicateFilterGroup(
                filterGroupId,
                name
            );

        this.render({ force: true });
    }


    static async #onDeleteGlobalFilterGroup(
        event,
        target
    ) {
        event.preventDefault();
        event.stopPropagation();

        const filterGroupId =
            target
                .closest("[data-filter-group-id]")
                ?.dataset?.filterGroupId;

        if (!filterGroupId)
            return;

        const filterGroup =
            TableProfileStorageService
                .getFilterGroup(filterGroupId);

        if (!filterGroup)
            return;

        const usage =
            TableProfileStorageService
                .getFilterGroupUsage(
                    filterGroupId
                );

        if (usage.length > 0) {
            ui.notifications.warn(
                game.i18n.format(
                    "COMPENDIUM_CURATOR.FilterGroupDeleteBlocked",
                    {
                        name: filterGroup.name,
                        profiles:
                            usage
                                .map(profile =>
                                    profile.name
                                )
                                .join(", ")
                    }
                )
            );
            return;
        }

        const confirmed =
            await foundry.applications.api
                .DialogV2.confirm({
                    classes:
                        TABLE_DIALOG_CLASSES,
                    window: {
                        title:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.DeleteFilterGroup"
                            )
                    },
                    content:
                        `<p>${game.i18n.format(
                            "COMPENDIUM_CURATOR.DeleteFilterGroupConfirm",
                            {
                                name:
                                    foundry.utils.escapeHTML(
                                        filterGroup.name
                                    )
                            }
                        )}</p>`,
                    rejectClose: false,
                    modal: true
                });

        if (!confirmed)
            return;

        await TableProfileStorageService
            .deleteGlobalFilterGroup(
                filterGroupId
            );

        if (
            this._filterGroupDetails?.rendered &&
            this._filterGroupDetails
                .filterGroupId === filterGroupId
        ) {
            await this._filterGroupDetails.close();
            this._filterGroupDetails = null;
        }

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupDeleted"
            )
        );

        this.render({ force: true });
    }


    static #onToggleProfileActions(
        event,
        target
    ) {
        event.preventDefault();
        event.stopPropagation();

        const profile =
            target.closest(
                ".cc-table-manager-profile"
            );

        if (!profile)
            return;

        const profileId =
            profile.dataset.profileId;
        const filterGroupId =
            profile.dataset.filterGroupId;

        const resourceId =
            profileId ||
            (
                filterGroupId
                    ? `filter:${filterGroupId}`
                    : null
            );

        if (!resourceId)
            return;

        if (
            this._profileActionsPopover &&
            this._profileActionsProfileId ===
                resourceId
        ) {
            this._closeProfileActionsPopover();
            return;
        }

        this._openProfileActionsPopover(
            profile,
            target
        );
    }


    _openProfileActionsPopover(
        profile,
        anchor
    ) {
        this._closeProfileActionsPopover();

        const sourceMenu =
            profile.querySelector(
                ".cc-table-manager-profile-menu"
            );

        if (!sourceMenu)
            return;

        const popover =
            sourceMenu.cloneNode(true);

        popover.hidden = false;
        popover.classList.add(
            "cc-table-manager-profile-menu-popover"
        );

        const profileId =
            profile.dataset.profileId;
        const filterGroupId =
            profile.dataset.filterGroupId;

        const resourceId =
            profileId ||
            (
                filterGroupId
                    ? `filter:${filterGroupId}`
                    : null
            );

        if (profileId) {
            popover.dataset.profileId =
                profileId;
        }

        if (filterGroupId) {
            popover.dataset.filterGroupId =
                filterGroupId;
        }

        popover.addEventListener(
            "click",
            event => {
                const button =
                    event.target.closest(
                        "button[data-action]"
                    );

                if (!button || button.disabled)
                    return;

                event.preventDefault();
                event.stopPropagation();

                const action =
                    button.dataset.action;

                const originalButton =
                    profile.querySelector(
                        `.cc-table-manager-profile-menu button[data-action="${action}"]`
                    );

                this._closeProfileActionsPopover();
                originalButton?.click();
            }
        );

        document.body.append(popover);

        this._positionProfileActionsPopover(
            popover,
            anchor
        );

        this._profileActionsPopover = popover;
        this._profileActionsProfileId =
            resourceId;

        this._profileActionsOutsideHandler =
            event => {
                if (
                    popover.contains(event.target) ||
                    anchor.contains(event.target)
                ) {
                    return;
                }

                this._closeProfileActionsPopover();
            };

        this._profileActionsViewportHandler =
            () => {
                this._closeProfileActionsPopover();
            };

        document.addEventListener(
            "pointerdown",
            this._profileActionsOutsideHandler,
            true
        );
        document.addEventListener(
            "scroll",
            this._profileActionsViewportHandler,
            true
        );
        window.addEventListener(
            "resize",
            this._profileActionsViewportHandler
        );
    }


    _positionProfileActionsPopover(
        popover,
        anchor
    ) {
        const margin = 8;
        const gap = 6;
        const anchorRect =
            anchor.getBoundingClientRect();
        const popoverRect =
            popover.getBoundingClientRect();

        let left =
            anchorRect.right -
            popoverRect.width;
        let top =
            anchorRect.bottom + gap;

        left = Math.min(
            left,
            window.innerWidth -
                popoverRect.width -
                margin
        );
        left = Math.max(margin, left);

        if (
            top + popoverRect.height >
            window.innerHeight - margin
        ) {
            top =
                anchorRect.top -
                popoverRect.height -
                gap;
        }

        top = Math.max(margin, top);

        popover.style.left =
            `${Math.round(left)}px`;
        popover.style.top =
            `${Math.round(top)}px`;
    }


    _closeProfileActionsPopover() {
        if (
            this._profileActionsOutsideHandler
        ) {
            document.removeEventListener(
                "pointerdown",
                this._profileActionsOutsideHandler,
                true
            );
        }

        if (
            this._profileActionsViewportHandler
        ) {
            document.removeEventListener(
                "scroll",
                this._profileActionsViewportHandler,
                true
            );
            window.removeEventListener(
                "resize",
                this._profileActionsViewportHandler
            );
        }

        this._profileActionsPopover?.remove();
        this._profileActionsPopover = null;
        this._profileActionsProfileId = null;
        this._profileActionsOutsideHandler = null;
        this._profileActionsViewportHandler = null;
    }


    static async #onFilterGroupDetails(
        event,
        target
    ) {
        event.preventDefault();
        event.stopPropagation();

        const profileId =
            target
                .closest("[data-profile-id]")
                ?.dataset?.profileId ?? null;

        const filterGroupId =
            target
                .closest("[data-filter-group-id]")
                ?.dataset?.filterGroupId;

        if (!filterGroupId)
            return;

        const filterGroup =
            TableProfileStorageService
                .getFilterGroup(filterGroupId);

        const profile = profileId
            ? TableProfileStorageService
                .getProfiles()?.[profileId]
            : null;

        if (!filterGroup) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNotFound"
                )
            );
            return;
        }

        if (this._filterGroupDetails?.rendered) {
            if (
                this._filterGroupDetails
                    .filterGroupId === filterGroupId
            ) {
                this._filterGroupDetails
                    .bringToFront();
                return;
            }

            await this._filterGroupDetails.close();
        }

        this._filterGroupDetails =
            new TableFilterGroupDetailsApplication(
                this.browserApp,
                profile,
                filterGroup
            );

        this._filterGroupDetails.render({
            force: true
        });
    }


    static async #onRefreshFilterGroup(
        event,
        target
    ) {
        event.preventDefault();
        event.stopPropagation();

        const profileId =
            target
                .closest("[data-profile-id]")
                ?.dataset?.profileId ?? null;

        const filterGroupId =
            target
                .closest("[data-filter-group-id]")
                ?.dataset?.filterGroupId;

        if (!filterGroupId)
            return;

        const filterGroup =
            TableProfileStorageService
                .getFilterGroup(filterGroupId);

        if (!filterGroup)
            return;

        const filters =
            TableProfileService
                .compactBrowserFilters(
                    filterGroup.browser
                        ?.filters ?? {}
                );

        if (!filters)
            return;

        const currentCandidates =
            await TableProfileService
                .getBrowserCandidates(
                    this.browserApp,
                    filters
                );

        const currentByUuid = new Map();

        for (
            const candidate
            of currentCandidates
        ) {
            currentByUuid.set(
                candidate.uuid,
                candidate
            );
        }

        if (!Array.isArray(filterGroup.matches)) {
            const confirmed =
                await foundry.applications.api
                    .DialogV2.confirm({
                        classes:
                            TABLE_DIALOG_CLASSES,
                        window: {
                            title:
                                game.i18n.localize(
                                    "COMPENDIUM_CURATOR.RefreshFilterGroup"
                                )
                        },
                        content:
                            `<p>${game.i18n.format(
                                "COMPENDIUM_CURATOR.InitializeFilterGroupMatches",
                                {
                                    name:
                                        foundry.utils.escapeHTML(
                                            filterGroup.name
                                        ),
                                    count:
                                        currentByUuid.size
                                }
                            )}</p>`,
                        rejectClose: false,
                        modal: true
                    });

            if (!confirmed)
                return;

            await TableProfileStorageService
                .updateFilterGroupMatches(
                    profileId,
                    filterGroupId,
                    currentByUuid.keys(),
                    filters
                );

            ui.notifications.info(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupRefreshed"
                )
            );

            this.render({ force: true });
            this._refreshApplicationsForFilterGroup(
                filterGroupId
            );
            return;
        }

        const previous =
            new Set(filterGroup.matches);

        const added = [
            ...currentByUuid.values()
        ].filter(candidate =>
            !previous.has(candidate.uuid)
        );

        const removedUuids = [
            ...previous
        ].filter(uuid =>
            !currentByUuid.has(uuid)
        );

        if (
            added.length === 0 &&
            removedUuids.length === 0
        ) {
            await TableProfileStorageService
                .updateFilterGroupMatches(
                    profileId,
                    filterGroupId,
                    currentByUuid.keys(),
                    filters
                );

            ui.notifications.info(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.NoFilterGroupChanges"
                )
            );
            return;
        }

        const addedEntries =
            await prepareDnd5eDocumentEntries(
                added.map(
                    candidate => candidate.uuid
                )
            );

        const removedEntries =
            await prepareDnd5eDocumentEntries(
                removedUuids
            );

        const addedHtml =
            added.length
                ? renderRefreshDocumentList(
                    getRefreshSectionTitle(
                        "NewMatches",
                        added.length
                    ),
                    added.length,
                    addedEntries
                )
                : "";

        const removedHtml =
            removedUuids.length
                ? renderRefreshDocumentList(
                    getRefreshSectionTitle(
                        "RemovedMatches",
                        removedUuids.length
                    ),
                    removedUuids.length,
                    removedEntries
                )
                : "";

        const confirmed =
            await foundry.applications.api
                .DialogV2.confirm({
                    classes:
                        TABLE_DIALOG_CLASSES,
                    window: {
                        title:
                            game.i18n.format(
                                "COMPENDIUM_CURATOR.RefreshFilterGroupTitle",
                                {
                                    name:
                                        filterGroup.name
                                }
                            )
                    },
                    position: {
                        width: 650
                    },
                    content: `
                        <div
                            class="dnd5e2 cc-table-filter-refresh-preview"
                        >
                            ${addedHtml}
                            ${removedHtml}
                        </div>
                    `,
                    render: (_event, dialog) => {
                        activateDnd5eDocumentEntries(
                            dialog.window.content
                        );
                    },
                    rejectClose: false,
                    modal: true
                });

        if (!confirmed)
            return;

        await TableProfileStorageService
            .updateFilterGroupMatches(
                profileId,
                filterGroupId,
                currentByUuid.keys(),
                filters
            );

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupRefreshed"
            )
        );

        this.render({ force: true });
        this._refreshApplicationsForFilterGroup(
            filterGroupId
        );
    }


    static async #onLoadFilterGroup(
        event,
        target
    ) {
        event.preventDefault();
        event.stopPropagation();

        const filterGroupId =
            target
                .closest("[data-filter-group-id]")
                ?.dataset?.filterGroupId;

        if (!filterGroupId)
            return;

        const filterGroup =
            TableProfileStorageService
                .getFilterGroup(filterGroupId);

        if (!filterGroup?.browser) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNotFound"
                )
            );
            return;
        }

        const loaded =
            await TableProfileService
                .loadBrowserFilters(
                    this.browserApp,
                    filterGroup.browser
                );

        if (loaded === null)
            return;

        if (loaded === false) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupFiltersLoadFailed"
                )
            );
            return;
        }

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupFiltersLoaded"
            )
        );
    }


    static async #onUnlinkFilterGroup(
        event,
        target
    ) {
        event.preventDefault();
        event.stopPropagation();

        const profileElement =
            target.closest(
                "[data-profile-id]"
            );
        const filterGroupElement =
            target.closest(
                "[data-filter-group-id]"
            );

        const profileId =
            profileElement?.dataset?.profileId;
        const filterGroupId =
            filterGroupElement
                ?.dataset?.filterGroupId;

        if (!profileId || !filterGroupId)
            return;

        const profile =
            TableProfileStorageService
                .getProfiles()?.[profileId];
        const filterGroup =
            TableProfileStorageService
                .getFilterGroup(filterGroupId);

        if (!profile || !filterGroup)
            return;

        const confirmed =
            await foundry.applications.api
                .DialogV2.confirm({
                    classes:
                        TABLE_DIALOG_CLASSES,
                    window: {
                        title:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.UnlinkFilterGroup"
                            )
                    },
                    content:
                        `<p>${game.i18n.format(
                            "COMPENDIUM_CURATOR.UnlinkFilterGroupConfirm",
                            {
                                name:
                                    foundry.utils.escapeHTML(
                                        filterGroup.name
                                    ),
                                profile:
                                    foundry.utils.escapeHTML(
                                        profile.name
                                    )
                            }
                        )}</p>`,
                    rejectClose: false,
                    modal: true
                });

        if (!confirmed)
            return;

        await TableProfileStorageService
            .removeFilterGroup(
                profileId,
                filterGroupId
            );

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupUnlinked"
            )
        );

        this.render({ force: true });

        const applications = [
            this._profilePreview,
            this._profileExclusions
        ];

        for (const application of applications) {
            if (
                application?.rendered &&
                application.profileId === profileId
            ) {
                application.render({
                    force: true
                });
            }
        }

        if (
            this._filterGroupDetails?.rendered &&
            this._filterGroupDetails
                .filterGroupId === filterGroupId
        ) {
            this._filterGroupDetails.render({
                force: true
            });
        }
    }

}
