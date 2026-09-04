import { TableProfileDirectObjectsApplication } from "./table-profile-direct-objects-application.js";
import { TableProfileStorageService } from "../services/table-profile-storage-service.js";
import { StorageService } from "../services/storage-service.js";
import { canUseTableChild, getTableChildren } from "../services/table-profile-relations-service.js";
import { categoryContentUuids, tableContentUuids, saveTableContent } from "../services/table-content-workspace-service.js";
import { prepareDnd5eIndexedEntries } from "../ui/dnd5e-document-list.js";

function text(es, en) { return game.i18n.lang.startsWith("es") ? es : en; }
function checked(control) {
    return typeof control.checked === "boolean" ? control.checked : control.hasAttribute("checked");
}
function sortByName(entries) {
    return entries.sort((a, b) => String(a.name).localeCompare(String(b.name), game.i18n.lang));
}
const template = name => ({
    "table-manager-content": "modules/compendium-curator/templates/table-manager-content.hbs",
    "table-content-preview": "modules/compendium-curator/templates/table-content-preview.hbs",
    "table-profile-direct-objects": "modules/compendium-curator/templates/table-profile-direct-objects.hbs",
    "table-profile-exclusions": "modules/compendium-curator/templates/table-profile-exclusions.hbs"
})[name];

/** Reuses the two-list inclusion editor and its live Browser subscription. */
export class TableManagerContentApplication extends TableProfileDirectObjectsApplication {
    constructor(managerApp, profileId, options = {}) {
        super(managerApp?.browserApp, managerApp, profileId, options);
        this._categoryIds = null;
        this._tableIds = null;
        this._excluded = null;
        this._expanded = new Set();
        this._previewCache = new Map();
        this._scrollPositions = new Map();
        this._saving = false;
        this._managerRenderHook = Hooks.on("renderApplicationV2", app => {
            if (app === this.managerApp && this.rendered && !this._saving) {
                this._previewCache.clear();
                void this.render({ force: true });
            }
        });
    }

    static DEFAULT_OPTIONS = {
        id: "compendium-curator-table-manager-content",
        classes: ["dnd5e2", "compendium-curator", "cc-table-filter-group-app", "cc-table-content-workspace"],
        window: { title: "COMPENDIUM_CURATOR.ManageContent" },
        position: { width: 920, height: 720 },
        actions: { save: this.#onSave, cancel: this.#onCancel }
    };
    static PARTS = { body: { template: template("table-manager-content") } };

    _categoryPreview(category) {
        const key = `category:${category.id}`;
        if (!this._previewCache.has(key))
            this._previewCache.set(key, categoryContentUuids(this.browserApp, category));
        return this._previewCache.get(key);
    }

    async _previewRow(kind, source, profiles, categories) {
        const key = `${kind}:${source.id}`;
        const row = { id: source.id, name: source.name, key, open: this._expanded.has(key) };
        if (!row.open) return row;
        try {
            if (!this._previewCache.has(key)) {
                this._previewCache.set(key, kind === "category"
                    ? categoryContentUuids(this.browserApp, source)
                    : tableContentUuids(this.browserApp, source.id, profiles, categories));
            }
            const entries = prepareDnd5eIndexedEntries(await this._previewCache.get(key));
            row.count = entries.length;
            row.previewHtml = await foundry.applications.handlebars.renderTemplate(
                template("table-content-preview"), { entries, key }
            );
        }
        catch (error) {
            this._previewCache.delete(key);
            row.error = text("No se pudo cargar la vista previa.", "The preview could not be loaded.");
            console.error("Compendium Curator | Content preview failed.", error);
        }
        return row;
    }

    async _prepareContext(options) {
        for (const element of this.element?.querySelectorAll?.("[data-cc-scroll-key]") ?? [])
            this._scrollPositions.set(element.dataset.ccScrollKey, element.scrollTop);
        const context = await super._prepareContext(options);
        if (!context.exists) return context;
        const profiles = TableProfileStorageService.getProfiles();
        const profile = profiles[this.profileId];
        const categories = TableProfileStorageService.getFilterGroups();
        this._categoryIds ??= new Set(profile.filterGroupIds ?? []);
        this._tableIds ??= new Set(getTableChildren(profile, profiles).filter(c => c.enabled).map(c => c.profileId));
        this._excluded ??= new Set(profile.manualExcludes ?? []);
        context.supportsLocalContent = profile.type === "content";
        context.intro = text(
            "Selecciona el contenido de esta tabla. Las vistas previas son de solo lectura; las tablas enlazadas conservan su configuración original.",
            "Select this table's content. Previews are read-only; linked tables keep their original configuration."
        );
        context.categoriesLabel = text("Categorías", "Categories");
        context.tablesLabel = text("Tablas", "Tables");
        context.previewHint = text("Vista previa del contenido de origen, sin edición.", "Read-only preview of the source content.");
        context.exclusionsHint = text(
            "Marca objetos para excluirlos de esta tabla. Seguirán visibles en gris: no se ocultan en Curator ni se alteran las tablas enlazadas.",
            "Check objects to exclude them from this table. They remain visible in gray: this does not hide them in Curator or alter linked tables."
        );
        for (const key of ["categories", "tables", "inclusions", "exclusions"])
            context[`${key}Open`] = this._expanded.has(key);
        context.groups = context.supportsLocalContent ? await Promise.all(sortByName(Object.values(categories)).map(async category => ({
            ...await this._previewRow("category", category, profiles, categories),
            checked: this._categoryIds.has(category.id)
        }))) : [];
        const configured = new Set(getTableChildren(profile, profiles).map(c => c.profileId));
        context.tables = await Promise.all(sortByName(Object.values(profiles).filter(candidate =>
            candidate.version === 2 && candidate.id !== profile.id &&
            (configured.has(candidate.id) || canUseTableChild(profile.id, candidate.id, profiles))
        )).map(async candidate => ({
            ...await this._previewRow("table", candidate, profiles, categories),
            checked: this._tableIds.has(candidate.id)
        })));
        context.selectedGroupCount = this._categoryIds.size;
        context.selectedTableCount = this._tableIds.size;
        context.excludedCount = this._excluded.size;
        context.inclusionsHtml = await foundry.applications.handlebars.renderTemplate(
            template("table-profile-direct-objects"), { ...context, embedded: true }
        );
        if (context.exclusionsOpen && context.supportsLocalContent) {
            const hidden = new Set(StorageService.getHiddenUuids());
            const uuids = new Set(this._selection.values().filter(uuid => !hidden.has(uuid)));
            for (const id of this._categoryIds) {
                if (!categories[id]) continue;
                for (const uuid of await this._categoryPreview(categories[id])) uuids.add(uuid);
            }
            // Keep old exclusions manageable even if their source is deselected.
            for (const uuid of this._excluded) uuids.add(uuid);
            const candidates = prepareDnd5eIndexedEntries(uuids).map(entry => ({
                ...entry, excluded: this._excluded.has(entry.uuid)
            }));
            context.exclusionsHtml = await foundry.applications.handlebars.renderTemplate(
                template("table-profile-exclusions"), { embedded: true, candidates, hasCandidates: candidates.length > 0 }
            );
        }
        return context;
    }

    async _onRender(context, options) {
        await super._onRender(context, options);
        for (const details of this.element.querySelectorAll("details[data-cc-content-key]")) {
            details.addEventListener("toggle", () => {
                const key = details.dataset.ccContentKey;
                const wasOpen = this._expanded.has(key);
                if (details.open) this._expanded.add(key);
                else this._expanded.delete(key);
                if (details.open && !wasOpen && (key.includes(":") || key === "exclusions"))
                    void this.render({ force: true });
            });
        }
        for (const control of this.element.querySelectorAll("summary input"))
            control.addEventListener("click", event => event.stopPropagation());
        for (const control of this.element.querySelectorAll('[name="filterGroupIds"], [name="tableProfileIds"]')) {
            control.addEventListener("change", () => {
                const selected = control.name === "filterGroupIds" ? this._categoryIds : this._tableIds;
                if (checked(control)) selected.add(control.value);
                else selected.delete(control.value);
                void this.render({ force: true });
            });
        }
        for (const control of this.element.querySelectorAll(".cc-table-profile-exclusion-checkbox")) {
            control.addEventListener("change", () => {
                const selected = checked(control);
                if (selected) this._excluded.add(control.dataset.uuid);
                else this._excluded.delete(control.dataset.uuid);
                control.closest(".cc-dnd5e-document-entry")?.classList.toggle("cc-hidden-entry", selected);
                this.element.querySelector("[data-cc-excluded-count]").textContent = this._excluded.size;
            });
        }
        for (const element of this.element.querySelectorAll("[data-cc-scroll-key]"))
            element.scrollTop = this._scrollPositions.get(element.dataset.ccScrollKey) ?? 0;
    }

    static async #onSave(event, target) {
        event.preventDefault();
        if (this._saving || !this._selection || !this._categoryIds) return;
        this._saving = true;
        target.disabled = true;
        try {
            await saveTableContent(this.profileId, {
                categoryIds: this._categoryIds, tableIds: this._tableIds,
                inclusions: this._selection.values(), exclusions: this._excluded
            });
            if (this.managerApp?.rendered) await this.managerApp.render({ force: true });
            await this.close();
        }
        catch (error) {
            console.error("Compendium Curator | Error saving table content.", error);
            ui.notifications.error(text("No se pudo guardar el contenido de la tabla.", "The table content could not be saved."));
        }
        finally {
            this._saving = false;
            if (target.isConnected) target.disabled = false;
        }
    }
    static async #onCancel() { await this.close(); }
    async _preClose(options) {
        Hooks.off("renderApplicationV2", this._managerRenderHook);
        this._previewCache.clear();
        if (this.managerApp?._ccContentManager === this) this.managerApp._ccContentManager = null;
        await super._preClose(options);
    }
}
