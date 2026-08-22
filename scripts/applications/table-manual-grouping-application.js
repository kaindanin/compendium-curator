import { TableProfileStorageService } from "../services/table-profile-storage-service.js";
import { StorageService } from "../services/storage-service.js";
import {
    activateDnd5eDocumentEntries,
    prepareDnd5eIndexedEntries
} from "../ui/dnd5e-document-list.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

function getProfileFinalUuids(profile) {
    const hiddenUuids = new Set(
        StorageService.getHiddenUuids() ?? []
    );
    const finalUuids = new Set();

    for (const group of profile?.filterGroups ?? []) {
        for (const uuid of group?.matches ?? []) {
            if (uuid && !hiddenUuids.has(uuid)) {
                finalUuids.add(uuid);
            }
        }
    }

    for (const uuid of profile?.manualIncludes ?? []) {
        if (uuid && !hiddenUuids.has(uuid)) {
            finalUuids.add(uuid);
        }
    }

    for (const uuid of profile?.manualExcludes ?? []) {
        finalUuids.delete(uuid);
    }

    return finalUuids;
}

function makeManualGroup(number) {
    const key =
        `manual:${foundry.utils.randomID()}`;

    return {
        id: key,
        key,
        name: game.i18n.format(
            "COMPENDIUM_CURATOR.ManualGroupDefaultName",
            { number }
        ),
        members: []
    };
}

export class TableManualGroupingApplication
    extends HandlebarsApplicationMixin(
        ApplicationV2
    ) {

    constructor(
        manager,
        profileId,
        options = {}
    ) {
        super(options);

        this.manager = manager;
        this.profileId = profileId;
        this._draftGroups = null;
    }

    static DEFAULT_OPTIONS = {
        id:
            "compendium-curator-table-manual-groups",
        classes: [
            "dnd5e2",
            "compendium-curator",
            "cc-table-manual-grouping-app"
        ],
        actions: {
            addGroup: this.#onAddGroup,
            removeGroup: this.#onRemoveGroup,
            save: this.#onSave,
            cancel: this.#onCancel
        },
        window: {
            title:
                "COMPENDIUM_CURATOR.ManualGroupsTitle",
            resizable: true
        },
        position: {
            width: 720,
            height: 720
        }
    };

    static PARTS = {
        body: {
            template:
                "modules/compendium-curator/templates/table-manual-grouping.hbs"
        }
    };

    get profile() {
        return TableProfileStorageService
            .getProfiles()?.[this.profileId] ?? null;
    }

    _initializeDraft(profile = this.profile) {
        const storedGroups = profile?.distribution
            ?.grouped?.manualGroups;

        this._draftGroups = foundry.utils.deepClone(
            Array.isArray(storedGroups) &&
            storedGroups.length
                ? storedGroups
                : [makeManualGroup(1)]
        );
    }

    _captureDraftFromForm() {
        if (!this.element)
            return;

        const names = new Map();

        for (
            const input
            of this.element.querySelectorAll(
                "[data-cc-manual-group-name]"
            )
        ) {
            names.set(
                input.dataset.groupKey,
                String(input.value ?? "").trim()
            );
        }

        const membersByGroup = new Map(
            (this._draftGroups ?? []).map(
                group => [group.key, []]
            )
        );

        for (
            const select
            of this.element.querySelectorAll(
                "[data-cc-manual-assignment]"
            )
        ) {
            const groupMembers =
                membersByGroup.get(select.value);

            if (groupMembers) {
                groupMembers.push(
                    select.dataset.uuid
                );
            }
        }

        this._draftGroups = (
            this._draftGroups ?? []
        ).map(group => ({
            id: group.key,
            key: group.key,
            name: names.get(group.key) ?? group.name,
            members:
                membersByGroup.get(group.key) ?? []
        }));
    }

    async _prepareContext(options) {
        const context =
            await super._prepareContext(options);
        const profile = this.profile;

        if (!profile) {
            return {
                ...context,
                missingProfile: true,
                groups: [],
                entries: []
            };
        }

        if (!Array.isArray(this._draftGroups)) {
            this._initializeDraft(profile);
        }

        const assignmentByUuid = new Map();

        for (const group of this._draftGroups) {
            for (const uuid of group.members ?? []) {
                if (!assignmentByUuid.has(uuid)) {
                    assignmentByUuid.set(
                        uuid,
                        group.key
                    );
                }
            }
        }

        const entries = prepareDnd5eIndexedEntries(
            getProfileFinalUuids(profile)
        ).map(entry => {
            const assignment =
                assignmentByUuid.get(entry.uuid) ?? "";

            return {
                ...entry,
                options: this._draftGroups.map(
                    group => ({
                        key: group.key,
                        name: group.name,
                        selected:
                            assignment === group.key
                    })
                ),
                unassigned: !assignment
            };
        });

        context.profileName = profile.name;
        context.groups = this._draftGroups.map(
            group => ({
                ...group,
                count: entries.filter(entry =>
                    assignmentByUuid.get(
                        entry.uuid
                    ) === group.key
                ).length,
                canRemove:
                    this._draftGroups.length > 1
            })
        );
        context.entries = entries;
        context.hasEntries = entries.length > 0;

        return context;
    }

    async _onRender(context, options) {
        await super._onRender(context, options);

        activateDnd5eDocumentEntries(
            this.element
        );

        const search = this.element.querySelector(
            "[data-cc-manual-group-search]"
        );

        search?.addEventListener("input", event => {
            const query = String(
                event.target.value ?? ""
            ).trim().toLocaleLowerCase();

            for (
                const row
                of this.element.querySelectorAll(
                    "[data-cc-manual-assignment-row]"
                )
            ) {
                row.hidden = Boolean(query) &&
                    !String(
                        row.dataset.searchText ?? ""
                    )
                        .toLocaleLowerCase()
                        .includes(query);
            }
        });
    }

    static #onAddGroup(event) {
        event.preventDefault();

        this._captureDraftFromForm();
        this._draftGroups ??= [];
        this._draftGroups.push(
            makeManualGroup(
                this._draftGroups.length + 1
            )
        );

        this.render({ force: true });
    }

    static #onRemoveGroup(event, target) {
        event.preventDefault();

        this._captureDraftFromForm();

        if ((this._draftGroups?.length ?? 0) <= 1) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.ManualGroupsRequired"
                )
            );
            return;
        }

        const key = target
            .closest("[data-cc-manual-group-row]")
            ?.dataset?.groupKey;

        this._draftGroups = this._draftGroups
            .filter(group => group.key !== key);

        this.render({ force: true });
    }

    static async #onSave(event, target) {
        event.preventDefault();
        this._captureDraftFromForm();

        const names = this._draftGroups.map(
            group => String(group.name ?? "").trim()
        );

        if (names.some(name => !name)) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.ManualGroupNameRequired"
                )
            );
            return;
        }

        const comparable = names.map(name =>
            name.toLocaleLowerCase(game.i18n.lang)
        );

        if (new Set(comparable).size !== names.length) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.ManualGroupNamesUnique"
                )
            );
            return;
        }

        target.disabled = true;

        try {
            await TableProfileStorageService
                .setManualGroupingGroups(
                    this.profileId,
                    this._draftGroups
                );

            this.manager?._openContentInspectors
                ?.add(this.profileId);
            this.manager?.render({ force: true });

            ui.notifications.info(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.ManualGroupsSaved"
                )
            );

            await this.close();
        }
        finally {
            if (target.isConnected) {
                target.disabled = false;
            }
        }
    }

    static #onCancel(event) {
        event.preventDefault();
        this.close();
    }
}
