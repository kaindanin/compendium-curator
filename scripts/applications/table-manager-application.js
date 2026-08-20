import { TableProfileEditorApplication } from "./table-profile-editor-application.js";
import { TableDefaultsApplication } from "./table-defaults-application.js";
import { TableProfileStorageService } from "../services/table-profile-storage-service.js";
import { TableFilterGroupApplication } from "./table-filter-group-application.js";
import { TableProfilePreviewApplication } from "./table-profile-preview-application.js";
import { TableProfileExclusionsApplication } from "./table-profile-exclusions-application.js";
import { TableProfileInclusionsApplication } from "./table-profile-inclusions-application.js";
import { TableProfileService } from "../services/table-profile-service.js";
import { TableFilterGroupDetailsApplication } from "./table-filter-group-details-application.js";
import { activateDnd5eDocumentEntries, prepareDnd5eDocumentEntries } from "../ui/dnd5e-document-list.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TABLE_DIALOG_CLASSES = [ "cc-table-dialog" ];

function getRefreshSectionTitle(
    key,
    count
) {

    const text =
        game.i18n.format(
            `COMPENDIUM_CURATOR.${key}`,
            {
                count
            }
        );

    /*
     * Las traducciones actuales incluyen
     * el contador al final: "(3)".
     *
     * Lo quitamos porque ahora se mostrará
     * como contador independiente.
     */
    return text
        .replace(
            /\s*\(\s*\d+\s*\)\s*$/,
            ""
        )
        .trim();

}


function renderRefreshDocumentList(
    title,
    count,
    entries
) {

    const escape =
        foundry.utils.escapeHTML;

    const resultsLabel =
        escape(
            game.i18n.localize(
                "DND5E.CompendiumBrowser.Column.Results"
            )
        );

    const sourceLabel =
        escape(
            game.i18n.localize(
                "DND5E.CompendiumBrowser.Column.Source"
            )
        );

    const rows =
        entries
            .map(entry => {

                const uuid =
                    escape(
                        String(
                            entry.uuid ?? ""
                        )
                    );

                const name =
                    escape(
                        String(
                            entry.name ??
                            entry.uuid ??
                            ""
                        )
                    );

                const img =
                    entry.img
                        ? escape(
                            String(entry.img)
                        )
                        : "";

                const subtitle =
                    entry.subtitle
                        ? escape(
                            game.i18n.localize(
                                entry.subtitle
                            )
                        )
                        : "";

                const source =
                    entry.source
                        ? escape(
                            String(entry.source)
                        )
                        : "";

                return `
                    <li
                        class="
                            item
                            cc-dnd5e-document-entry
                        "
                        data-uuid="${uuid}"
                    >

                        <div class="item-row">

                            <div
                                class="item-name rollable"
                                role="button"
                                data-cc-open-document
                            >

                                ${
                                    img
                                        ? `
                                            <img
                                                class="
                                                    item-image
                                                    gold-icon
                                                "
                                                loading="lazy"
                                                src="${img}"
                                                alt="${name}"
                                                draggable="false"
                                            >
                                        `
                                        : ""
                                }

                                <div
                                    class="
                                        name
                                        name-stacked
                                    "
                                >

                                    <span class="title">
                                        ${name}
                                    </span>

                                    ${
                                        subtitle
                                            ? `
                                                <span
                                                    class="subtitle"
                                                >
                                                    ${subtitle}
                                                </span>
                                            `
                                            : ""
                                    }

                                </div>

                            </div>


                            <div
                                class="
                                    item-detail
                                    item-source
                                    ${
                                        source
                                            ? ""
                                            : "empty"
                                    }
                                "
                            >

                                ${
                                    source
                                        ? `
                                            <span
                                                class="condensed"
                                            >
                                                ${source}
                                            </span>
                                        `
                                        : ""
                                }

                            </div>


                            <div
                                class="
                                    item-detail
                                    item-controls
                                "
                            ></div>

                        </div>

                    </li>
                `;

            })
            .join("");

    return `
        <section
            class="cc-table-filter-refresh-section"
        >

            <div
                class="
                    cc-table-filter-group-matches-title
                "
            >

                <h3>
                    ${escape(title)}
                </h3>

                <strong>
                    ${count}
                </strong>

            </div>


            <section
                class="
                    inventory-element
                    cc-dnd5e-document-list
                "
            >

                <section
                    class="
                        items-list
                        browser-results
                    "
                >

                    <div
                        class="
                            items-section
                            card
                        "
                    >

                        <div
                            class="
                                items-header
                                header
                            "
                        >

                            <h3 class="item-name">
                                ${resultsLabel}
                            </h3>

                            <div
                                class="
                                    item-header
                                    item-source
                                "
                            >
                                ${sourceLabel}
                            </div>

                            <div
                                class="
                                    item-header
                                    item-controls
                                "
                            ></div>

                        </div>


                        <ol
                            class="
                                item-list
                                unlist
                            "
                        >
                            ${rows}
                        </ol>

                    </div>

                </section>

            </section>

        </section>
    `;

}

export class TableManagerApplication
    extends HandlebarsApplicationMixin(
        ApplicationV2
    ) {

    constructor(browserApp, options = {}) {

        super(options);

        this.browserApp = browserApp;
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

    }

    static DEFAULT_OPTIONS = {

        id: "compendium-curator-table-manager",

        classes: [
            "dnd5e2",
            "compendium-curator",
            "cc-table-manager-app"
        ],

        actions: {
            
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

            toggleProfileActions:
                this.#onToggleProfileActions,

            filterGroupDetails:
                this.#onFilterGroupDetails,

            refreshFilterGroup:
                this.#onRefreshFilterGroup,

            loadFilterGroup:
                this.#onLoadFilterGroup,

            deleteFilterGroup:
                this.#onDeleteFilterGroup
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
            await super._prepareContext(
                options
            );


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
                .map(profile => {

                    const filterGroupCount =
                        Array.isArray(
                            profile.filterGroups
                        )
                            ? profile
                                .filterGroups
                                .length
                            : 0;

                    const filterGroups =
                        Array.isArray(
                            profile.filterGroups
                        )
                            ? profile.filterGroups
                                .map(
                                    group => ({
                                        id: group.id,
                                        name: group.name
                                    })
                                )
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
                        Array.isArray(
                            profile.children
                        )
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
                                {
                                    count:
                                        childCount
                                }
                            )
                            : game.i18n.format(
                                "COMPENDIUM_CURATOR.FilterGroupCount",
                                {
                                    count:
                                        filterGroupCount
                                }
                            );

                    const revision =
                        Number(
                            profile.revision ?? 1
                        );

                    const generatedRevision =
                        Number(
                            profile
                                .generation
                                ?.generatedRevision ??
                            0
                        );

                    let statusKey =
                        "TableProfileNeverGenerated";

                    if (
                        generatedRevision > 0 &&
                        generatedRevision <
                            revision
                    ) {
                        statusKey =
                            "TableProfilePendingChanges";
                    }
                    else if (
                        generatedRevision > 0 &&
                        generatedRevision ===
                            revision
                    ) {
                        statusKey =
                            "TableProfileUpToDate";
                    }

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

                        status:
                            game.i18n.localize(
                                `COMPENDIUM_CURATOR.${statusKey}`
                            )
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

        context.profiles = profiles;

        context.hasProfiles =
            profiles.length > 0;

        return context;

    }

    async _preClose(options) {

        this._closeProfileActionsPopover();

        const profileEditor =
            this._profileEditor;

        this._profileEditor = null;

        /*
        * El Gestor controla explícitamente
        * el cierre de su editor.
        */
        if (profileEditor?.rendered)
            await profileEditor.close();

        const defaultsEditor =
            this._defaultsEditor;

        this._defaultsEditor = null;

        if (defaultsEditor?.rendered)
            await defaultsEditor.close();

        const filterGroupEditor =
            this._filterGroupEditor;

        this._filterGroupEditor = null;

        if (filterGroupEditor?.rendered)
            await filterGroupEditor.close();

        const profilePreview =
            this._profilePreview;

        this._profilePreview = null;

        if (profilePreview?.rendered)
            await profilePreview.close();

        const profileExclusions =
            this._profileExclusions;

        this._profileExclusions = null;

        if (profileExclusions?.rendered)
            await profileExclusions.close();

        const profileInclusions =
            this._profileInclusions;

        this._profileInclusions = null;

        if (profileInclusions?.rendered)
            await profileInclusions.close();

        const filterGroupDetails =
            this._filterGroupDetails;

        this._filterGroupDetails =
            null;

        if (filterGroupDetails?.rendered)
            await filterGroupDetails.close();

        if (this.browserApp) {

            this.browserApp._ccTableManagerLocked =
                false;

            if (
                this.browserApp
                    .element
                    ?.isConnected
            ) {
                this.browserApp
                    ._ccRefreshToolbar
                    ?.();
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

    static #onCreateProfile() {

        if (
            this._profileEditor?.rendered
        ) {

            this._profileEditor
                .bringToFront();

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

        if (
            this._defaultsEditor
                ?.rendered
        ) {

            this._defaultsEditor
                .bringToFront();

            return;

        }

        this._defaultsEditor =
            new TableDefaultsApplication();

        this._defaultsEditor.render({
            force: true
        });

    }

    static async #onAddCurrentFilters( event, target ) {

        const profileId =
            target
                .closest(
                    "[data-profile-id]"
                )
                ?.dataset
                ?.profileId;

        if (!profileId)
            return;

        if (
            this._filterGroupEditor
                ?.rendered
        ) {

            if (
                this._filterGroupEditor
                    .profileId ===
                profileId
            ) {

                this._filterGroupEditor
                    .bringToFront();

                return;

            }

            await this
                ._filterGroupEditor
                .close();

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

    static async #onPreviewProfile( event, target ) {

        const profileId =
            target
                .closest(
                    "[data-profile-id]"
                )
                ?.dataset
                ?.profileId;

        if (!profileId)
            return;

        if (
            this._profilePreview
                ?.rendered
        ) {

            if (
                this._profilePreview
                    .profileId ===
                profileId
            ) {

                this._profilePreview
                    .bringToFront();

                return;

            }

            await this
                ._profilePreview
                .close();

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

    static async #onManualInclusions( event, target ) {

        const profileId =
            target
                .closest(
                    "[data-profile-id]"
                )
                ?.dataset
                ?.profileId;

        if (!profileId)
            return;

        if (
            this._profileInclusions
                ?.rendered
        ) {

            if (
                this._profileInclusions
                    .profileId ===
                profileId
            ) {

                this._profileInclusions
                    .bringToFront();

                return;

            }

            await this
                ._profileInclusions
                .close();

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

    static async #onManualExclusions( event, target ) {

        const profileId =
            target
                .closest(
                    "[data-profile-id]"
                )
                ?.dataset
                ?.profileId;

        if (!profileId)
            return;

        if (
            this._profileExclusions
                ?.rendered
        ) {

            if (
                this._profileExclusions
                    .profileId ===
                profileId
            ) {

                this._profileExclusions
                    .bringToFront();

                return;

            }

            await this
                ._profileExclusions
                .close();

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
                .closest(
                    "[data-profile-id]"
                )
                ?.dataset
                ?.profileId;

        if (!profileId)
            return;

        const profile =
            TableProfileStorageService
                .getProfiles()
                ?.[profileId];

        if (!profile)
            return;

        const field =
            document.createElement("div");

        field.className =
            "form-group";

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

        field.append(
            label,
            input
        );

        const result =
            await foundry
                .applications
                .api
                .DialogV2
                .input({

                    window: {
                        title:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.RenameProfile"
                            )
                    },

                    content:
                        field.outerHTML,

                    ok: {
                        label:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.Rename"
                            )
                    },

                    rejectClose:
                        false,

                    modal:
                        true

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

        if (
            TableProfileStorageService
                .isNameTaken(
                    name,
                    profileId
                )
        ) {

            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.TableProfileNameTaken"
                )
            );

            return;

        }

        await TableProfileStorageService
            .renameProfile(
                profileId,
                name
            );

        this.render({
            force: true
        });

        /*
        * Las ventanas que muestran el nombre
        * del perfil se actualizan también.
        */

        if (
            this._profilePreview
                ?.rendered &&
            this._profilePreview
                .profileId ===
                    profileId
        ) {

            this._profilePreview.render({
                force: true
            });

        }

        if (
            this._profileInclusions
                ?.rendered &&
            this._profileInclusions
                .profileId ===
                    profileId
        ) {

            this._profileInclusions.render({
                force: true
            });

        }

        if (
            this._profileExclusions
                ?.rendered &&
            this._profileExclusions
                .profileId ===
                    profileId
        ) {

            this._profileExclusions.render({
                force: true
            });

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
                .closest(
                    "[data-profile-id]"
                )
                ?.dataset
                ?.profileId;

        if (!profileId)
            return;

        const profile =
            TableProfileStorageService
                .getProfiles()
                ?.[profileId];

        if (!profile)
            return;

        let suggestedName =
            game.i18n.format(
                "COMPENDIUM_CURATOR.ProfileCopyName",
                {
                    profile:
                        profile.name
                }
            );

        /*
        * Si ya existe "Copia de X",
        * proponemos automáticamente (2), (3)...
        */
        if (
            TableProfileStorageService
                .isNameTaken(
                    suggestedName
                )
        ) {

            const baseName =
                suggestedName;

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

        field.className =
            "form-group";

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

        field.append(
            label,
            input
        );

        const result =
            await foundry
                .applications
                .api
                .DialogV2
                .input({

                    window: {
                        title:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.DuplicateProfile"
                            )
                    },

                    content:
                        field.outerHTML,

                    ok: {
                        label:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.Duplicate"
                            )
                    },

                    rejectClose:
                        false,

                    modal:
                        true

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
                .isNameTaken(
                    name
                )
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
                .closest(
                    "[data-profile-id]"
                )
                ?.dataset
                ?.profileId;

        if (!profileId)
            return;

        const profile =
            TableProfileStorageService
                .getProfiles()
                ?.[profileId];

        if (!profile)
            return;

        const confirmed =
            await foundry
                .applications
                .api
                .DialogV2
                .confirm({

                    classes:
                        TABLE_DIALOG_CLASSES,

                    window: {
                        title:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.DeleteProfile"
                            )
                    },

                    content:
                        `<p>${
                            game.i18n.format(
                                "COMPENDIUM_CURATOR.ProfileDeleteConfirm",
                                {
                                    profile:
                                        foundry.utils.escapeHTML(
                                            profile.name
                                        )
                                }
                            )
                        }</p>`,

                    rejectClose:
                        false,

                    modal:
                        true

                });

        if (!confirmed)
            return;


        /*
        * Cerramos cualquier ventana que esté
        * utilizando este perfil antes de borrarlo.
        */
        const profileApplications = [
            "_filterGroupEditor",
            "_profilePreview",
            "_profileInclusions",
            "_profileExclusions",
            "_filterGroupDetails"
        ];

        for (
            const property
            of profileApplications
        ) {

            const application =
                this[property];

            if (
                application?.profileId !==
                    profileId
            ) {
                continue;
            }

            if (application.rendered) {
                await application.close();
            }

            this[property] = null;

        }


        await TableProfileStorageService
            .removeProfile(
                profileId
            );


        this.render({
            force: true
        });

    }

    static #onToggleProfileActions( event, target ) {

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

        if (!profileId)
            return;

        /*
        * Pulsar otra vez Acciones sobre
        * el mismo perfil cierra el menú.
        */
        if (
            this._profileActionsPopover &&
            this._profileActionsProfileId ===
                profileId
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


        /*
        * El menú visible se crea fuera
        * de la ventana del Gestor.
        */
        const popover =
            sourceMenu.cloneNode(true);

        popover.hidden = false;

        popover.classList.add(
            "cc-table-manager-profile-menu-popover"
        );

        const profileId =
            profile.dataset.profileId;

        popover.dataset.profileId =
            profileId;


        /*
        * Los botones clonados están fuera
        * de ApplicationV2, así que reenviamos
        * la acción al botón original oculto.
        *
        * De esta forma conservamos intactos
        * todos los handlers actuales.
        */
        popover.addEventListener(
            "click",
            event => {

                const button =
                    event.target.closest(
                        "button[data-action]"
                    );

                if (
                    !button ||
                    button.disabled
                ) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();

                const action =
                    button.dataset.action;

                const originalButton =
                    profile.querySelector(
                        `.cc-table-manager-profile-menu
                            button[data-action="${action}"]`
                    );

                this._closeProfileActionsPopover();

                originalButton?.click();

            }
        );


        document.body.append(
            popover
        );


        /*
        * Lo posicionamos respecto al botón
        * Acciones, pero en coordenadas globales.
        */
        this._positionProfileActionsPopover(
            popover,
            anchor
        );


        this._profileActionsPopover =
            popover;

        this._profileActionsProfileId =
            profileId;


        /*
        * Clic fuera del menú:
        * cerrar.
        */
        this._profileActionsOutsideHandler =
            event => {

                if (
                    popover.contains(
                        event.target
                    ) ||
                    anchor.contains(
                        event.target
                    )
                ) {
                    return;
                }

                this._closeProfileActionsPopover();

            };


        /*
        * Si cambia la geometría de la interfaz
        * cerramos el menú para evitar que quede
        * flotando lejos de su perfil.
        */
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


        /*
        * Por defecto se alinea por la derecha
        * y se abre hacia abajo.
        */
        let left =
            anchorRect.right -
            popoverRect.width;

        let top =
            anchorRect.bottom +
            gap;


        /*
        * Evitar salir por el lateral derecho.
        */
        left =
            Math.min(
                left,
                window.innerWidth -
                    popoverRect.width -
                    margin
            );


        /*
        * Evitar salir por el lateral izquierdo.
        */
        left =
            Math.max(
                margin,
                left
            );


        /*
        * Si no cabe debajo, abrir hacia arriba.
        */
        if (
            top +
                popoverRect.height >
            window.innerHeight -
                margin
        ) {

            top =
                anchorRect.top -
                popoverRect.height -
                gap;

        }


        /*
        * Última protección contra el borde
        * superior de la pantalla.
        */
        top =
            Math.max(
                margin,
                top
            );


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


        this._profileActionsPopover
            ?.remove();


        this._profileActionsPopover =
            null;

        this._profileActionsProfileId =
            null;

        this._profileActionsOutsideHandler =
            null;

        this._profileActionsViewportHandler =
            null;

    }

    static async #onFilterGroupDetails(
        event,
        target
    ) {

        event.preventDefault();
        event.stopPropagation();

        const profileId =
            target
                .closest(
                    "[data-profile-id]"
                )
                ?.dataset
                ?.profileId;

        const filterGroupId =
            target
                .closest(
                    "[data-filter-group-id]"
                )
                ?.dataset
                ?.filterGroupId;

        if (
            !profileId ||
            !filterGroupId
        ) {
            return;
        }

        const profile =
            TableProfileStorageService
                .getProfiles()
                ?.[profileId];

        const filterGroup =
            profile
                ?.filterGroups
                ?.find(
                    group =>
                        group.id ===
                            filterGroupId
                );

        if (
            !profile ||
            !filterGroup
        ) {

            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.FilterGroupNotFound"
                )
            );

            return;

        }

        if (
            this._filterGroupDetails
                ?.rendered
        ) {

            if (
                this._filterGroupDetails
                    .profileId ===
                        profileId &&
                this._filterGroupDetails
                    .filterGroupId ===
                        filterGroupId
            ) {

                this._filterGroupDetails
                    .bringToFront();

                return;

            }

            await this
                ._filterGroupDetails
                .close();

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

        const profileElement =
            target.closest(
                "[data-profile-id]"
            );

        const filterGroupElement =
            target.closest(
                "[data-filter-group-id]"
            );

        const profileId =
            profileElement
                ?.dataset
                ?.profileId;

        const filterGroupId =
            filterGroupElement
                ?.dataset
                ?.filterGroupId;

        if (
            !profileId ||
            !filterGroupId
        ) {
            return;
        }

        const profile =
            TableProfileStorageService
                .getProfiles()
                ?.[profileId];

        const filterGroup =
            profile
                ?.filterGroups
                ?.find(
                    group =>
                        group.id ===
                            filterGroupId
                );

        if (!filterGroup)
            return;

        const filters =
            TableProfileService
                .compactBrowserFilters(
                    filterGroup
                        ?.browser
                        ?.filters ??
                    {}
                );

        if (!filters)
            return;

        const currentCandidates =
            await TableProfileService
                .getBrowserCandidates(
                    this.browserApp,
                    filters
                );

        const currentByUuid =
            new Map();

        for (
            const candidate
            of currentCandidates
        ) {

            currentByUuid.set(
                candidate.uuid,
                candidate
            );

        }

        /*
        * Grupos antiguos todavía no tienen
        * snapshot. En ese caso establecemos
        * la situación actual como base.
        */
        if (
            !Array.isArray(
                filterGroup.matches
            )
        ) {

            const confirmed =
                await foundry
                    .applications
                    .api
                    .DialogV2
                    .confirm({

                        classes:
                            TABLE_DIALOG_CLASSES,

                        window: {
                            title:
                                game.i18n.localize(
                                    "COMPENDIUM_CURATOR.RefreshFilterGroup"
                                )
                        },

                        content:
                            `<p>${
                                game.i18n.format(
                                    "COMPENDIUM_CURATOR.InitializeFilterGroupMatches",
                                    {
                                        name:
                                            foundry.utils.escapeHTML(
                                                filterGroup.name
                                            ),

                                        count:
                                            currentByUuid.size
                                    }
                                )
                            }</p>`,

                        rejectClose:
                            false,

                        modal:
                            true

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

            this.render({
                force: true
            });

            return;

        }

        const previous =
            new Set(
                filterGroup.matches
            );

        const added =
            [
                ...currentByUuid.values()
            ].filter(
                candidate =>
                    !previous.has(
                        candidate.uuid
                    )
            );

        const removedUuids =
            [...previous].filter(
                uuid =>
                    !currentByUuid.has(
                        uuid
                    )
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
                    candidate =>
                        candidate.uuid
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
            await foundry
                .applications
                .api
                .DialogV2
                .confirm({

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
                            class="
                                dnd5e2
                                cc-table-filter-refresh-preview
                            "
                        >

                            ${addedHtml}

                            ${removedHtml}

                        </div>
                    `,

                    render:
                        (_event, dialog) => {

                            activateDnd5eDocumentEntries(
                                dialog.window.content
                            );

                        },

                    rejectClose:
                        false,

                    modal:
                        true

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

        this.render({
            force: true
        });

        if (
            this._profilePreview
                ?.rendered &&
            this._profilePreview
                .profileId ===
                    profileId
        ) {

            this._profilePreview.render({
                force: true
            });

        }

        if (
            this._profileExclusions
                ?.rendered &&
            this._profileExclusions
                .profileId ===
                    profileId
        ) {

            this._profileExclusions.render({
                force: true
            });

        }

    }

    static async #onLoadFilterGroup(
        event,
        target
    ) {

        event.preventDefault();
        event.stopPropagation();

        const profileId =
            target
                .closest(
                    "[data-profile-id]"
                )
                ?.dataset
                ?.profileId;

        const filterGroupId =
            target
                .closest(
                    "[data-filter-group-id]"
                )
                ?.dataset
                ?.filterGroupId;

        if (
            !profileId ||
            !filterGroupId
        ) {
            return;
        }

        const profile =
            TableProfileStorageService
                .getProfiles()
                ?.[profileId];

        const filterGroup =
            profile
                ?.filterGroups
                ?.find(
                    group =>
                        group.id ===
                            filterGroupId
                );

        if (
            !filterGroup
                ?.browser
        ) {

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


        /*
        * null = esta operación fue sustituida
        * por otra carga más reciente.
        *
        * No es un error.
        */
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

    static async #onDeleteFilterGroup(
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
            profileElement
                ?.dataset
                ?.profileId;

        const filterGroupId =
            filterGroupElement
                ?.dataset
                ?.filterGroupId;

        if (
            !profileId ||
            !filterGroupId
        ) {
            return;
        }

        const profile =
            TableProfileStorageService
                .getProfiles()
                ?.[profileId];

        const filterGroup =
            profile
                ?.filterGroups
                ?.find(
                    group =>
                        group.id ===
                            filterGroupId
                );

        if (!filterGroup)
            return;

        const confirmed =
            await foundry
                .applications
                .api
                .DialogV2
                .confirm({

                    classes:
                        TABLE_DIALOG_CLASSES,

                    window: {
                        title:
                            game.i18n.localize(
                                "COMPENDIUM_CURATOR.DeleteFilterGroup"
                            )
                    },

                    content:
                        `<p>${
                            game.i18n.format(
                                "COMPENDIUM_CURATOR.DeleteFilterGroupConfirm",
                                {
                                    name:
                                        foundry.utils.escapeHTML(
                                            filterGroup.name
                                        )
                                }
                            )
                        }</p>`,

                    rejectClose:
                        false,

                    modal:
                        true
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
                "COMPENDIUM_CURATOR.FilterGroupDeleted"
            )
        );

        this.render({
            force: true
        });

        if (
            this._profilePreview
                ?.rendered &&
            this._profilePreview
                .profileId ===
                    profileId
        ) {

            this._profilePreview.render({
                force: true
            });

        }

        if (
            this._profileExclusions
                ?.rendered &&
            this._profileExclusions
                .profileId ===
                    profileId
        ) {

            this._profileExclusions.render({
                force: true
            });

        }

    }



}