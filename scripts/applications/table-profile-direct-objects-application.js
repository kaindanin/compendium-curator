import {
    TableProfileService
} from "../services/table-profile-service.js";
import {
    TableProfileStorageService
} from "../services/table-profile-storage-service.js";
import {
    activateDnd5eDocumentEntries,
    prepareDnd5eDocumentEntries
} from "../ui/dnd5e-document-list.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

export class TableProfileDirectObjectsApplication
    extends HandlebarsApplicationMixin(
        ApplicationV2
    ) {

    constructor(
        browserApp,
        managerApp,
        profileId,
        options = {}
    ) {
        super(options);
        this.browserApp = browserApp;
        this.managerApp = managerApp;
        this.profileId = profileId;
        this._candidateUuids = new Set();
    }

    static DEFAULT_OPTIONS = {
        id:
            "compendium-curator-table-profile-direct-objects",
        classes: [
            "dnd5e2",
            "cc-table-profile-direct-objects-app"
        ],
        window: {
            title:
                "COMPENDIUM_CURATOR.ManualInclusions"
        },
        position: {
            width: 620,
            height: 650
        },
        actions: {
            save: this.#onSave,
            cancel: this.#onCancel,
            selectAll: this.#onSelectAll,
            clearAll: this.#onClearAll
        }
    };

    static PARTS = {
        body: {
            template:
                "modules/compendium-curator/templates/table-profile-direct-objects.hbs"
        }
    };

    async _prepareContext(options) {
        const context = await super
            ._prepareContext(options);
        const profile = TableProfileStorageService
            .getProfiles()?.[this.profileId];

        if (!profile) {
            context.profileName = "";
            context.candidates = [];
            context.candidateCount = 0;
            context.selectedCount = 0;
            context.hasCandidates = false;
            return context;
        }

        const selected = new Set(
            profile.directUuids ?? []
        );
        const candidatesByUuid = new Map();
        const browserCandidates =
            await TableProfileService
                .getBrowserCandidates(
                    this.browserApp
                );

        for (const candidate of browserCandidates) {
            if (candidate?.uuid) {
                candidatesByUuid.set(
                    candidate.uuid,
                    candidate
                );
            }
        }

        for (const uuid of selected) {
            if (candidatesByUuid.has(uuid))
                continue;

            const document = await fromUuid(uuid);

            if (document?.uuid) {
                candidatesByUuid.set(
                    document.uuid,
                    document
                );
            }
        }

        const candidates = [
            ...candidatesByUuid.values()
        ].sort((a, b) =>
            String(a?.name ?? "").localeCompare(
                String(b?.name ?? ""),
                game.i18n.lang,
                { sensitivity: "base" }
            )
        );

        this._candidateUuids = new Set(
            candidates.map(candidate => candidate.uuid)
        );

        const prepared =
            await prepareDnd5eDocumentEntries(
                candidates
                    .map(candidate => candidate.uuid)
                    .filter(Boolean)
            );

        context.profileName = profile.name;
        context.candidates = prepared.map(candidate => ({
            ...candidate,
            included: selected.has(candidate.uuid)
        }));
        context.selectedCount = context.candidates
            .filter(candidate => candidate.included)
            .length;
        context.candidateCount = context.candidates.length;
        context.hasCandidates =
            context.candidates.length > 0;
        return context;
    }

    async _onRender(context, options) {
        await super._onRender(context, options);
        activateDnd5eDocumentEntries(this.element);

        for (
            const checkbox
            of this.element.querySelectorAll(
                ".cc-table-profile-direct-object-checkbox"
            )
        ) {
            checkbox.addEventListener(
                "change",
                () => this.#updateSelectedCount()
            );
        }
    }

    static async #onSave() {
        const profile = TableProfileStorageService
            .getProfiles()?.[this.profileId];

        if (!profile)
            return;

        const directUuids = new Set(
            (profile.directUuids ?? [])
                .filter(uuid =>
                    !this._candidateUuids.has(uuid)
                )
        );

        for (
            const checkbox
            of this.element.querySelectorAll(
                ".cc-table-profile-direct-object-checkbox"
            )
        ) {
            const checked =
                typeof checkbox.checked === "boolean"
                    ? checkbox.checked
                    : checkbox.hasAttribute("checked");

            if (checked) {
                directUuids.add(
                    checkbox.dataset.uuid
                );
            }
        }

        await TableProfileStorageService
            .setDirectUuids(
                this.profileId,
                directUuids
            );

        ui.notifications.info(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.ManualInclusionsSaved"
            )
        );

        if (this.managerApp?.rendered) {
            await this.managerApp.render({
                force: true
            });
        }

        if (this.managerApp?.managerApp?.rendered) {
            await this.managerApp.managerApp.render({
                force: true
            });
        }

        await this.close();
    }

    static async #onCancel() {
        await this.close();
    }

    static #onSelectAll() {
        this.#setAllSelected(true);
    }

    static #onClearAll() {
        this.#setAllSelected(false);
    }

    #setAllSelected(selected) {
        for (
            const checkbox
            of this.element.querySelectorAll(
                ".cc-table-profile-direct-object-checkbox"
            )
        ) {
            checkbox.checked = selected;
            checkbox.toggleAttribute("checked", selected);
        }

        this.#updateSelectedCount();
    }

    #updateSelectedCount() {
        const count = [
            ...this.element.querySelectorAll(
                ".cc-table-profile-direct-object-checkbox"
            )
        ].filter(checkbox =>
            typeof checkbox.checked === "boolean"
                ? checkbox.checked
                : checkbox.hasAttribute("checked")
        ).length;

        const counter = this.element.querySelector(
            "[data-cc-inclusion-selected-count]"
        );

        if (counter) {
            counter.innerHTML = `
                <i class="fas fa-thumbtack"></i>
                ${game.i18n.format(
                    "COMPENDIUM_CURATOR.InclusionSelectedCount",
                    { count }
                )}
            `;
        }
    }
}
