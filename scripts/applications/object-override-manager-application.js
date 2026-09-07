import { ObjectOverrideStorageService } from "../overrides/object-override-storage-service.js";
import { filterOverrideRows, loadOverrideRows } from "../overrides/object-override-manager-model.js";
import { OBJECT_OVERRIDES_CHANGED_HOOK } from "../settings.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const localize = key => game.i18n.localize(`COMPENDIUM_CURATOR.${key}`);
const format = (key, data) => game.i18n.format(`COMPENDIUM_CURATOR.${key}`, data);
const FIELD_LABELS = {
    name: "Name", img: "Image", effects: "Effects",
    "system.description.value": "Description", "system.description.chat": "ChatDescription",
    "system.description.unidentified": "UnidentifiedDescription",
    "system.unidentified.description": "UnidentifiedDescription",
    "system.source": "Source", "system.price": "Price", "system.weight": "Weight",
    "system.quantity": "Quantity", "system.rarity": "Rarity", "system.properties": "Properties",
    "system.activities": "Activities", "system.advancement": "Advancement",
    "system.armor": "Armor", "system.damage": "Damage", "system.range": "Range",
    "system.uses": "Uses", "system.type": "Type", "system.identifier": "Identifier",
    "system.source.book": "Source", "system.source.custom": "Source",
    "system.uses.max": "UsesMaximum", "system.uses.spent": "UsesSpent"
};

function fieldLabel(path, nativeLabel) {
    const dotted = path.replace(/^\//, "").replaceAll("/", ".");
    const key = Object.keys(FIELD_LABELS).sort((a, b) => b.length - a.length)
        .find(key => dotted === key || dotted.startsWith(`${key}.`));
    const group = key && localize(`ModifiedField${FIELD_LABELS[key]}`);
    if (key === dotted) return group;
    if (nativeLabel) {
        const label = game.i18n.localize(nativeLabel);
        if (label !== nativeLabel) return group && group !== label ? `${group} · ${label}` : label;
    }
    const suffix = key ? dotted.slice(key.length).replace(/^\./, "") : dotted.replace(/^system\./, "");
    return [group, suffix].filter(Boolean).join(" · ");
}

export function displayOverrideValue(state, path = "", type = "") {
    if (!state) return localize("ModifiedValueUnknown");
    if (!state.exists) return localize("ModifiedValueAbsent");
    const value = state.value;
    if (value === null || value === "") return "—";
    if (typeof value === "boolean") return localize(value ? "ModifiedValueYes" : "ModifiedValueNo");
    const config = CONFIG.DND5E ?? {};
    const choices = {
        "/system/attunement": config.attunementTypes,
        "/system/rarity": config.itemRarity,
        "/system/price/denomination": config.currencies,
        "/system/weight/units": config.weightUnits,
        "/system/properties": config.itemProperties,
        "/system/type/value": type === "equipment" ? config.equipmentTypes : undefined
    }[path];
    const choiceLabel = value => {
        const choice = choices?.[value];
        const label = typeof choice === "object" ? choice?.label : choice;
        return typeof label === "string" ? game.i18n.localize(label) : String(value);
    };
    if (typeof value === "object") {
        if (Array.isArray(value) && value.every(entry => typeof entry !== "object"))
            return value.map(choiceLabel).join(", ") || "—";
        return format("ModifiedStructureCount", { count: Object.keys(value).length });
    }
    if (!path.includes("description")) return choiceLabel(value);
    // Native descriptions are HTML. Render a plain-text comparison, never executable markup.
    const fragment = document.createElement("template");
    fragment.innerHTML = String(value);
    for (const node of fragment.content.querySelectorAll("script, style")) node.remove();
    return fragment.content.textContent.trim() || "—";
}

function typeLabel(type) {
    const label = CONFIG.Item?.typeLabels?.[type];
    return label ? game.i18n.localize(label) : type;
}

export class ObjectOverrideManagerApplication extends HandlebarsApplicationMixin(ApplicationV2) {
    static instance = null;

    static async open() {
        if (!game.user.can("SETTINGS_MODIFY")) return;
        this.instance ??= new this();
        await this.instance.render({ force: true });
        this.instance.bringToFront();
        return this.instance;
    }

    static DEFAULT_OPTIONS = {
        id: "compendium-curator-object-overrides",
        classes: ["dnd5e2", "compendium-curator", "cc-object-overrides-app"],
        window: { title: "COMPENDIUM_CURATOR.ModifiedObjectsTitle", resizable: true },
        position: { width: 780, height: 650 },
        actions: {
            openItem: this.#onOpenItem,
            resetItem: this.#onResetItem,
            resetSelected: this.#onResetSelected,
            selectVisible: this.#onSelectVisible,
            clearSelection: this.#onClearSelection
        }
    };

    static PARTS = {
        body: { template: "modules/compendium-curator/templates/object-override-manager.hbs" }
    };

    constructor(options = {}) {
        super(options);
        this.filters = { search: "", type: "", packId: "" };
        this.selected = new Set();
        this.expanded = new Set();
        this._rowsPromise = null;
        this._busy = false;
        this._closed = false;
        this._hooks = [
            [OBJECT_OVERRIDES_CHANGED_HOOK, Hooks.on(OBJECT_OVERRIDES_CHANGED_HOOK, () => this.invalidate())],
            ...["updateItem", "deleteItem", "updateCompendium", "createCompendium", "deleteCompendium"].map(name => [
                name, Hooks.on(name, () => this.invalidate())
            ])
        ];
    }

    invalidate() {
        this._rowsPromise = null;
        if (this.rendered) void this.refresh().catch(error => this.reportError(error));
    }

    reportError(error) {
        console.error("compendium-curator | Object override manager", error);
        ui.notifications.error(localize("ModifiedOperationFailed"));
    }

    async refresh() {
        this._refreshAgain = true;
        if (this._refreshing) return this._refreshing;
        this._refreshing = (async () => {
            while (this._refreshAgain && !this._closed) {
                this._refreshAgain = false;
                this._scrollTop = this.element?.querySelector(".cc-modified-list")?.scrollTop ?? 0;
                const active = document.activeElement;
                this._focus = this.element?.contains(active) && active.name
                    ? { name: active.name, start: active.selectionStart, end: active.selectionEnd }
                    : null;
                await this.render({ force: true });
            }
        })();
        try { await this._refreshing; }
        finally { this._refreshing = null; }
    }

    async _prepareContext(options) {
        if (!game.user.can("SETTINGS_MODIFY")) throw new Error("Object override management requires SETTINGS_MODIFY.");
        const context = await super._prepareContext(options);
        this._rowsPromise ??= loadOverrideRows(ObjectOverrideStorageService.getStorage().overrides);
        const rows = await this._rowsPromise;
        this._rows = rows;
        const existing = new Set(rows.map(row => row.uuid));
        for (const uuid of this.selected) if (!existing.has(uuid)) this.selected.delete(uuid);
        const visible = filterOverrideRows(rows, this.filters);
        this._visible = visible;
        const packs = new Map(rows.map(row => [row.packId, row.packLabel]));
        const packLabels = new Map([...packs].map(([id, label]) => [id,
            [...packs.values()].filter(value => value === label).length > 1 ? `${label} (${id})` : label
        ]));
        return Object.assign(context, {
            filters: this.filters,
            types: [...new Set(rows.map(row => row.type))].map(value => ({
                value, label: typeLabel(value), selected: this.filters.type === value
            })).sort((a, b) => a.label.localeCompare(b.label)),
            packs: [...packLabels].map(([value, label]) => ({
                value, label, selected: this.filters.packId === value
            })).sort((a, b) => a.label.localeCompare(b.label)),
            rows: visible.map(row => ({
                ...row, packLabel: packLabels.get(row.packId), typeLabel: typeLabel(row.type),
                selected: this.selected.has(row.uuid), expanded: this.expanded.has(row.uuid),
                changes: row.changes.map(change => ({
                    label: fieldLabel(change.path, change.nativeLabel),
                    before: displayOverrideValue(change.before, change.path, row.type),
                    after: displayOverrideValue(change.after, change.path, row.type)
                }))
            })),
            count: format("ModifiedObjectCount", { visible: visible.length, total: rows.length }),
            selectedCount: format("ModifiedSelectedCount", { count: this.selected.size }),
            emptyMessage: localize(rows.length ? "ModifiedNoMatches" : "ModifiedEmpty"),
            busy: this._busy, resetDisabled: this._busy || !this.selected.size
        });
    }

    async _onRender(context, options) {
        await super._onRender(context, options);
        for (const input of this.element.querySelectorAll("[data-cc-modified-filter]")) {
            input.addEventListener(input.name === "search" ? "input" : "change", () => {
                this.filters[input.name] = input.value;
                void this.refresh().catch(error => this.reportError(error));
            });
        }
        for (const input of this.element.querySelectorAll("[data-cc-modified-select]")) {
            input.addEventListener("click", event => event.stopPropagation());
            input.addEventListener("change", () => {
                if (input.checked) this.selected.add(input.value);
                else this.selected.delete(input.value);
                void this.refresh().catch(error => this.reportError(error));
            });
        }
        for (const button of this.element.querySelectorAll("summary button"))
            button.addEventListener("click", event => event.preventDefault());
        for (const details of this.element.querySelectorAll("details[data-uuid]")) {
            details.addEventListener("toggle", () => {
                if (details.open) this.expanded.add(details.dataset.uuid);
                else this.expanded.delete(details.dataset.uuid);
            });
        }
        const list = this.element.querySelector(".cc-modified-list");
        if (list) list.scrollTop = this._scrollTop ?? 0;
        if (this._focus) {
            const input = this.element.querySelector(`[name="${this._focus.name}"]`);
            input?.focus();
            if (input?.type === "search" && this._focus.start !== null)
                input.setSelectionRange(this._focus.start, this._focus.end);
        }
    }

    static async #onOpenItem(_event, target) {
        try {
            const item = await fromUuid(target.dataset.uuid);
            if (!item) return ui.notifications.warn(localize("ModifiedSourceUnavailable"));
            const controller = item.sheet._ccOverrideController;
            if (controller && !controller.disposed) {
                if (controller.view !== "modified") await controller.show("modified");
                controller.syntheticSheet?.bringToFront();
            }
            else await item.sheet.render({ force: true });
        }
        catch (error) { this.reportError(error); }
    }

    static async #onResetItem(_event, target) { await this.resetOverrides([target.dataset.uuid]); }
    static async #onResetSelected() { await this.resetOverrides([...this.selected]); }
    static async #onSelectVisible() {
        for (const row of this._visible) this.selected.add(row.uuid);
        await this.refresh();
    }
    static async #onClearSelection() { this.selected.clear(); await this.refresh(); }

    async resetOverrides(uuids) {
        if (this._busy || !game.user.can("SETTINGS_MODIFY")) return;
        const targets = this._rows.filter(row => uuids.includes(row.uuid));
        if (!targets.length) return;
        this._busy = true;
        try {
            const content = document.createElement("div");
            const message = document.createElement("p");
            message.textContent = localize("ModifiedResetConfirm");
            const list = document.createElement("ul");
            list.style.cssText = "max-height:250px;overflow:auto";
            for (const row of targets) {
                const entry = document.createElement("li");
                entry.textContent = `${row.name} — ${row.packLabel}`;
                list.append(entry);
            }
            content.append(message, list);
            const confirmed = await DialogV2.confirm({
                window: { title: localize("ModifiedReset") }, content: content.outerHTML,
                yes: { label: localize("ModifiedReset") }, default: "no",
                rejectClose: false, modal: true
            });
            if (!confirmed || !game.user.can("SETTINGS_MODIFY")) return;
            const removed = await ObjectOverrideStorageService.removeMany(targets.map(row => row.uuid), {
                expectedRecords: Object.fromEntries(targets.map(row => [row.uuid, row.record]))
            });
            for (const uuid of removed) this.selected.delete(uuid);
            ui.notifications.info(format("ModifiedResetCount", { count: removed.length }));
            if (removed.length !== targets.length) ui.notifications.warn(localize("ModifiedResetChanged"));
            this._rowsPromise = null;
        }
        catch (error) { this.reportError(error); }
        finally { this._busy = false; await this.refresh(); }
    }

    async _preClose(options) {
        this._closed = true;
        for (const [name, id] of this._hooks) Hooks.off(name, id);
        if (ObjectOverrideManagerApplication.instance === this) ObjectOverrideManagerApplication.instance = null;
        await super._preClose(options);
    }
}
