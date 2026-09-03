import {
    CuratorOverrideSession
} from "../overrides/curator-override-session.js";
import {
    ObjectOverridePatchEngine
} from "../overrides/object-override-patch-engine.js";
import {
    ObjectOverrideStorageService
} from "../overrides/object-override-storage-service.js";
import {
    ObjectOverrideResolver
} from "../overrides/object-override-resolver.js";


const PLAY_MODE = 1;
const EDIT_MODE = 2;
const MODULE_ID = "compendium-curator";
const controllers = new WeakMap();
const preparedRoots = new WeakSet();
const ITEM_SHEET_CLASS_NAMES = new Set([
    "ItemSheet5e",
    "ContainerSheet"
]);

const SAFE_AUXILIARY_SHEET_CLASS_NAMES = new Set([
    "CreatureTypeConfig",
    "MovementSensesConfig",
    "SourceConfig",
    "StartingEquipmentConfig"
]);

const BLOCKED_PATH_PREFIXES = [
    "items",
    "system.advancement",
    "system.contents",
    "system.container",
    "system.source.bookPlaceholder",
    "system.source.label",
    "system.source.slug",
    "system.source.value"
];

const BLOCKED_SYNTHETIC_METHODS = [
    "createAdvancement",
    "updateAdvancement",
    "deleteAdvancement"
];

const ATOMIC_PATCH_PATHS = [
    "effects",
    "system.activities"
];

const ATOMIC_CONTROL_PATHS = [
    "system.properties",
    "system.damage.parts",
    "system.uses.recovery"
];

const SAFE_ACTIONS = new Set([
    "changeMode",
    "close",
    "copyUuid",
    "editDocument",
    "showDocument",
    "showIcon",
    "tab",
    "toggleCollapsed",
    "toggleControls"
]);

const SAFE_EDIT_ACTIONS = new Set([
    ...SAFE_ACTIONS,
    "addRecovery",
    "deleteCraft",
    "deleteRecovery",
    "editDescription",
    "editImage",
    "showConfiguration",
    "toggleState"
]);

const NAMED_CONTROL_SELECTOR = "[name]";


function localize(key) {
    return game.i18n.localize(
        `COMPENDIUM_CURATOR.${key}`
    );
}


function isPlainObject(value) {
    if (!value || typeof value !== "object")
        return false;

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}


function isSafeValue(value) {
    return value === null ||
        ["string", "number", "boolean"].includes(typeof value) ||
        (
            Array.isArray(value) &&
            value.every(isSafeValue)
        ) ||
        (
            isPlainObject(value) &&
            Object.values(value).every(isSafeValue)
        );
}


function pathIsBlocked(path) {
    if (path.startsWith("effects."))
        return true;

    return BLOCKED_PATH_PREFIXES.some(prefix =>
        path === prefix || path.startsWith(`${prefix}.`)
    );
}


function pathIsSafe(path, value = null) {
    const normalized = String(path ?? "").trim();

    if (!normalized || pathIsBlocked(normalized))
        return false;

    if (normalized === "name")
        return typeof value === "string" || value === null;

    if (normalized === "img")
        return typeof value === "string" || value === null;

    if (normalized === "effects")
        return Array.isArray(value) && isSafeValue(value);

    if (!normalized.startsWith("system."))
        return false;

    return isSafeValue(value);
}


function flattenLeaves(value, prefix = "", output = new Map()) {
    if (isPlainObject(value)) {
        for (const [key, child] of Object.entries(value)) {
            const path = prefix ? `${prefix}.${key}` : key;
            flattenLeaves(child, path, output);
        }
        return output;
    }

    if (prefix)
        output.set(prefix, value);

    return output;
}


function safeUpdateData(updateData) {
    const safe = {};

    for (
        const [path, value]
        of flattenLeaves(updateData).entries()
    ) {
        if (pathIsSafe(path, value))
            safe[path] = value;
    }

    return safe;
}


function replaceSyntheticDocumentSource(document, source) {
    document.updateSource(
        structuredClone(source),
        { recursive: false }
    );

    return document;
}


function controlPath(control) {
    return String(
        control?.getAttribute?.("name") ??
        control?.name ??
        ""
    ).trim();
}


function controlValue(control) {
    if (control?.matches?.("input[type='checkbox']")) {
        return Boolean(control.checked);
    }

    if (control?.matches?.("dnd5e-checkbox"))
        return control.hasAttribute("checked");

    if (control?.matches?.("formula-input")) {
        return control.querySelector("input")?.value ??
            control.value ??
            "";
    }

    if (control?.matches?.("multi-select, string-tags")) {
        return Array.from(
            control.querySelectorAll(".tag[data-key]"),
            tag => tag.dataset.key
        );
    }

    if (control?.matches?.("select[multiple]")) {
        return Array.from(
            control.selectedOptions ?? [],
            option => option.value
        );
    }

    const value = control?.value;

    if (value instanceof Set)
        return Array.from(value);

    if (value !== undefined)
        return value;

    return null;
}


function atomicControlPath(path) {
    return ATOMIC_CONTROL_PATHS.find(prefix =>
        path === prefix || path.startsWith(`${prefix}.`)
    ) ?? path;
}


function coerceControlValue(
    control,
    preparedValue,
    currentValue = undefined
) {
    const value = controlValue(control);

    if (value === null)
        return preparedValue;

    if (control?.matches?.("formula-input")) {
        if (value === "")
            return typeof currentValue === "number" ? null : "";

        if (
            typeof currentValue === "number" &&
            String(Number(value)) === String(value).trim()
        ) {
            return Number(value);
        }

        return value;
    }

    if (control?.matches?.("dnd5e-checkbox"))
        return Boolean(value);

    if (
        control?.tagName?.includes("-") &&
        preparedValue !== undefined
    ) {
        return preparedValue;
    }

    if (
        control?.matches?.(
            "multi-select, string-tags, select[multiple]"
        ) &&
        (
            Array.isArray(preparedValue) ||
            isPlainObject(preparedValue)
        )
    ) {
        return preparedValue;
    }

    if (control?.matches?.("input[type='number'], input[type='range']")) {
        if (value === "")
            return null;

        const number = Number(value);
        return Number.isNaN(number) ? preparedValue : number;
    }

    if (control?.matches?.("input[type='radio']"))
        return preparedValue;

    if (typeof preparedValue === "number") {
        if (value === "")
            return null;

        const number = Number(value);
        return Number.isNaN(number) ? preparedValue : number;
    }

    if (typeof preparedValue === "boolean")
        return Boolean(value);

    return value;
}


function safeStoredPatch(patch) {
    return Array.from(patch ?? []).filter(operation => {
        if (
            !operation ||
            !["set", "remove", "replace"].includes(
                operation.op
            )
        ) {
            return false;
        }

        let path;

        try {
            path = ObjectOverridePatchEngine
                .segments(operation.path)
                .join(".");
        }
        catch {
            return false;
        }

        if (
            path.startsWith("effects.") ||
            path.startsWith("system.activities.")
        ) {
            return false;
        }

        return pathIsSafe(
            path,
            operation.op === "remove"
                ? null
                : operation.value
        );
    });
}


function copyPosition(app) {
    const position = app?.position ?? {};
    const result = {};

    for (const key of ["top", "left", "width", "height"]) {
        if (Number.isFinite(position[key]))
            result[key] = position[key];
    }

    return result;
}


function captureViewState(app) {
    const root = app?.element;

    return {
        position: copyPosition(app),
        primaryTab: app?.tabGroups?.primary ?? null,
        scroll: Array.from(
            root?.querySelectorAll(
                ".window-content, [data-application-part]"
            ) ?? []
        ).map(element => ({
            part: element.dataset.applicationPart ?? null,
            top: element.scrollTop,
            left: element.scrollLeft
        })),
        details: Array.from(
            root?.querySelectorAll("details") ?? []
        ).map((element, index) => ({
            index,
            open: element.open
        }))
    };
}


function restoreViewState(app, state) {
    if (!app?.element || !state)
        return;

    if (state.primaryTab && app.tabGroups?.primary !== state.primaryTab) {
        try {
            app.changeTab(
                state.primaryTab,
                "primary",
                { updatePosition: false }
            );
        }
        catch {
            // La pestaña puede no existir en todos los tipos de Item.
        }
    }

    const scrollable = Array.from(
        app.element.querySelectorAll(
            ".window-content, [data-application-part]"
        )
    );

    for (const [index, saved] of state.scroll.entries()) {
        const target = saved.part
            ? scrollable.find(element =>
                element.dataset.applicationPart === saved.part
            )
            : scrollable[index];

        if (!target)
            continue;

        target.scrollTop = saved.top;
        target.scrollLeft = saved.left;
    }

    const details = app.element.querySelectorAll("details");

    for (const saved of state.details) {
        if (details[saved.index])
            details[saved.index].open = saved.open;
    }
}


function setApplicationEditable(app, editable) {
    const descriptor = Object.getOwnPropertyDescriptor(
        app,
        "isEditable"
    );

    if (descriptor?.get?._ccOverrideGetter)
        return;

    const getter = () => editable;
    getter._ccOverrideGetter = true;

    Object.defineProperty(app, "isEditable", {
        configurable: true,
        get: getter
    });
}


function clearApplicationEditable(app) {
    const descriptor = Object.getOwnPropertyDescriptor(
        app,
        "isEditable"
    );

    if (descriptor?.get?._ccOverrideGetter)
        delete app.isEditable;
}


function blockControl(control, blocked = true) {
    if ("disabled" in control)
        control.disabled = blocked;

    control.toggleAttribute("aria-disabled", blocked);
    control.classList.toggle("cc-override-control-blocked", blocked);
}


class ItemSheetOverrideController {
    constructor(originalSheet) {
        this.originalSheet = originalSheet;
        this.originalDocument = originalSheet.document;
        this.session = CuratorOverrideSession.fromDocument(
            this.originalDocument,
            {
                appliedPatch: safeStoredPatch(
                    ObjectOverrideResolver.getRecord(
                        this.originalDocument
                    )?.patch ?? []
                ),
                atomicPaths: ATOMIC_PATCH_PATHS
            }
        );
        this.view = "original";
        this.switching = false;
        this.disposed = false;
        this.syntheticDocument = null;
        this.syntheticSheet = null;
        this._viewState = null;
        this._suppressLocalRender = false;
        this._openModifiedOnFirstRender = true;
        this._dirtyControlPaths = new Set();

        controllers.set(originalSheet, this);
        originalSheet._ccOverrideController = this;
    }


    _createSyntheticDocument() {
        if (this.syntheticDocument)
            return this.syntheticDocument;

        const controller = this;
        const ItemClass = CONFIG.Item.documentClass;

        class CuratorSyntheticItem extends ItemClass {
            async update(data = {}, options = {}) {
                return controller._applySyntheticUpdate(
                    data,
                    options
                );
            }


            async createEmbeddedDocuments(
                embeddedName,
                data = [],
                options = {}
            ) {
                return controller._createSyntheticEmbeddedDocuments(
                    embeddedName,
                    data,
                    options
                );
            }


            async updateEmbeddedDocuments(
                embeddedName,
                updates = [],
                options = {}
            ) {
                return controller._updateSyntheticEmbeddedDocuments(
                    embeddedName,
                    updates,
                    options
                );
            }


            async deleteEmbeddedDocuments(
                embeddedName,
                ids = [],
                options = {}
            ) {
                return controller._deleteSyntheticEmbeddedDocuments(
                    embeddedName,
                    ids,
                    options
                );
            }


            async deleteActivity(id) {
                return controller._deleteSyntheticActivity(id);
            }


            async delete() {
                return controller._blockedOperation();
            }
        }

        for (const method of BLOCKED_SYNTHETIC_METHODS) {
            Object.defineProperty(
                CuratorSyntheticItem.prototype,
                method,
                {
                    configurable: true,
                    value() {
                        return controller._blockedOperation();
                    }
                }
            );
        }

        this.syntheticDocument = new CuratorSyntheticItem(
            this.session.workingSource
        );
        this._applyFullSyntheticSource(
            this.session.workingSource
        );
        this._reconcileSyntheticSource();
        this.syntheticDocument._ccOverrideController = this;
        this._hardenEmbeddedDocuments();

        this.syntheticSheet = this.syntheticDocument.sheet;
        this.syntheticSheet._ccOverrideController = this;
        this.syntheticSheet._processSubmitData = async (
            _event,
            _form,
            submitData,
            options = {}
        ) => {
            await this._applySyntheticUpdate(
                this._scopedSubmitData(submitData),
                { ...options, render: false }
            );
            return { updated: this.syntheticDocument };
        };
        controllers.set(this.syntheticSheet, this);
        setApplicationEditable(this.syntheticSheet, true);

        return this.syntheticDocument;
    }


    _hardenEmbeddedDocuments() {
        for (
            const activity
            of this.syntheticDocument?.system.activities ?? []
        ) {
            const id = activity.id;

            Object.defineProperties(activity, {
                update: {
                    configurable: true,
                    value: (updates = {}, options = {}) =>
                        this._updateSyntheticActivity(
                            id,
                            updates,
                            options
                        )
                },
                delete: {
                    configurable: true,
                    value: options => this._deleteSyntheticActivity(
                        id,
                        options
                    )
                }
            });
        }

        for (const effect of this.syntheticDocument?.effects ?? []) {
            const id = effect.id;

            Object.defineProperties(effect, {
                update: {
                    configurable: true,
                    value: (updates = {}, options = {}) =>
                        this._updateSyntheticEmbeddedDocuments(
                            "ActiveEffect",
                            [{ ...updates, _id: id }],
                            options
                        ).then(effects => effects[0] ?? effect)
                },
                delete: {
                    configurable: true,
                    value: options =>
                        this._deleteSyntheticEmbeddedDocuments(
                            "ActiveEffect",
                            [id],
                            options
                        ).then(() => effect)
                }
            });

            if (effect.parent === this.syntheticDocument)
                continue;

            for (const method of ["clone"]) {
                Object.defineProperty(effect, method, {
                    configurable: true,
                    value: () => this._blockedOperation()
                });
            }
        }
    }


    _blockedOperation() {
        ui.notifications.warn(
            localize("ObjectOverrideStructureBlocked")
        );
        return Promise.resolve([]);
    }


    _canEditStructures() {
        return !this.disposed &&
            this.view === "modified" &&
            this.session.editing;
    }


    async _applySyntheticStructure(path, value, options = {}) {
        if (!this._canEditStructures()) {
            await this._blockedOperation();
            return this.syntheticDocument;
        }

        const previousSource = this.session.workingSource;

        try {
            this.session.setField(path, value);
            this._replaceSyntheticSource(
                this.session.workingSource
            );
        }
        catch (error) {
            this.session.captureWorkingSource(previousSource);
            this._replaceSyntheticSource(previousSource);
            throw error;
        }

        if (
            options.render !== false &&
            !this._suppressLocalRender &&
            this.syntheticSheet?.rendered
        ) {
            const state = captureViewState(
                this.syntheticSheet
            );

            await this.syntheticSheet.render({
                force: true,
                mode: EDIT_MODE
            });
            restoreViewState(this.syntheticSheet, state);
        }

        return this.syntheticDocument;
    }


    async _createSyntheticEmbeddedDocuments(
        embeddedName,
        data,
        options = {}
    ) {
        if (
            embeddedName !== "ActiveEffect" ||
            !this._canEditStructures()
        ) {
            return this._blockedOperation();
        }

        const EffectClass = CONFIG.ActiveEffect.documentClass;
        const existing = Array.from(
            this.syntheticDocument.effects ?? [],
            effect => effect.toObject()
        );
        const usedIds = new Set(
            existing.map(effect => effect._id)
        );
        const createdIds = [];

        for (const source of Array.from(data ?? [])) {
            const candidate = structuredClone(source);
            let id = options.keepId ? candidate._id : null;

            while (!id || usedIds.has(id))
                id = foundry.utils.randomID(16);

            candidate._id = id;

            if (candidate.origin === this.syntheticDocument.uuid) {
                candidate.origin = this.originalDocument.uuid;
            }

            const effect = new EffectClass(candidate, {
                parent: this.syntheticDocument
            });

            existing.push(effect.toObject());
            usedIds.add(id);
            createdIds.push(id);
        }

        await this._applySyntheticStructure(
            "effects",
            existing,
            options
        );

        return createdIds
            .map(id => this.syntheticDocument.effects.get(id))
            .filter(Boolean);
    }


    async _updateSyntheticEmbeddedDocuments(
        embeddedName,
        updates,
        options = {}
    ) {
        if (
            embeddedName !== "ActiveEffect" ||
            !this._canEditStructures()
        ) {
            return this._blockedOperation();
        }

        const changedIds = [];

        try {
            for (const source of Array.from(updates ?? [])) {
                const id = source?._id ?? source?.id;
                const effect = this.syntheticDocument.effects.get(id);

                if (!effect)
                    continue;

                const changes = structuredClone(source);
                delete changes._id;
                delete changes.id;
                effect.updateSource(changes);
                changedIds.push(id);
            }

            await this._applySyntheticStructure(
                "effects",
                Array.from(
                    this.syntheticDocument.effects,
                    effect => effect.toObject()
                ),
                options
            );
        }
        catch (error) {
            this._replaceSyntheticSource(
                this.session.workingSource
            );
            throw error;
        }

        return changedIds
            .map(id => this.syntheticDocument.effects.get(id))
            .filter(Boolean);
    }


    async _deleteSyntheticEmbeddedDocuments(
        embeddedName,
        ids,
        options = {}
    ) {
        if (
            embeddedName !== "ActiveEffect" ||
            !this._canEditStructures()
        ) {
            return this._blockedOperation();
        }

        const idSet = new Set(Array.from(ids ?? [], String));
        const deleted = Array.from(
            this.syntheticDocument.effects ?? []
        ).filter(effect => idSet.has(effect.id));
        const remaining = Array.from(
            this.syntheticDocument.effects ?? [],
            effect => effect.toObject()
        ).filter(effect => !idSet.has(effect._id));

        await this._applySyntheticStructure(
            "effects",
            remaining,
            options
        );

        return deleted;
    }


    async _deleteSyntheticActivity(id) {
        if (!this._canEditStructures()) {
            await this._blockedOperation();
            return this.syntheticDocument;
        }

        const current = ObjectOverridePatchEngine.get(
            this.session.workingSource,
            "system.activities"
        );
        const activities = current.exists &&
            isPlainObject(current.value)
            ? current.value
            : {};

        if (!Object.hasOwn(activities, id))
            return this.syntheticDocument;

        delete activities[id];
        await this._applySyntheticStructure(
            "system.activities",
            activities
        );
        return this.syntheticDocument;
    }


    async _updateSyntheticActivity(id, updates, options = {}) {
        if (!this._canEditStructures()) {
            await this._blockedOperation();
            return this.syntheticDocument;
        }

        const activity = this.syntheticDocument.system.activities?.get(id);

        if (!activity)
            return this.syntheticDocument;

        const previousSource = this.session.workingSource;

        try {
            activity.updateSource(structuredClone(updates ?? {}));
            await this._applySyntheticStructure(
                "system.activities",
                Object.fromEntries(
                    Array.from(
                        this.syntheticDocument.system.activities,
                        entry => [entry.id, entry.toObject()]
                    )
                ),
                options
            );
        }
        catch (error) {
            this.session.captureWorkingSource(previousSource);
            this._replaceSyntheticSource(previousSource);
            throw error;
        }

        return this.syntheticDocument.system.activities.get(id) ??
            this.syntheticDocument;
    }


    async _applySyntheticUpdate(data, options = {}) {
        if (this.disposed)
            return this.syntheticDocument;

        if (!this._canEditStructures()) {
            await this._blockedOperation();
            return this.syntheticDocument;
        }

        const safe = safeUpdateData(data);

        if (!Object.keys(safe).length)
            return this.syntheticDocument;

        const previousSource = this.session.workingSource;

        try {
            for (const [path, value] of Object.entries(safe))
                this.session.setField(path, value);

            this._replaceSyntheticSource(
                this.session.workingSource
            );
        }
        catch (error) {
            this.session.captureWorkingSource(previousSource);
            this._replaceSyntheticSource(previousSource);
            throw error;
        }

        if (
            options.render !== false &&
            !this._suppressLocalRender &&
            this.syntheticSheet?.rendered
        ) {
            const state = captureViewState(
                this.syntheticSheet
            );

            await this.syntheticSheet.render({
                force: true,
                mode: this.session.editing
                    ? EDIT_MODE
                    : PLAY_MODE
            });
            restoreViewState(this.syntheticSheet, state);
        }

        return this.syntheticDocument;
    }


    _replaceSyntheticSource(source) {
        this._createSyntheticDocument();
        this._applyFullSyntheticSource(source);
        this._reconcileSyntheticSource();
        this._hardenEmbeddedDocuments();
    }


    _applyFullSyntheticSource(source) {
        replaceSyntheticDocumentSource(
            this.syntheticDocument,
            source
        );
    }


    _reconcileSyntheticSource() {
        const actualSource = this.syntheticDocument.toObject();

        for (const operation of this.session.patch) {
            const path = ObjectOverridePatchEngine
                .segments(operation.path)
                .join(".");
            const actual = ObjectOverridePatchEngine.get(
                actualSource,
                path
            );
            const working = ObjectOverridePatchEngine.get(
                this.session.workingSource,
                path
            );

            if (
                actual.exists === working.exists &&
                ObjectOverridePatchEngine.equals(
                    actual.value,
                    working.value
                )
            ) {
                continue;
            }

            if (actual.exists)
                this.session.setField(path, actual.value);
            else
                this.session.removeField(path);
        }
    }


    async show(view) {
        if (
            this.disposed ||
            view === this.view ||
            this.session.editing
        ) {
            return;
        }

        const current = this.view === "original"
            ? this.originalSheet
            : this.syntheticSheet;

        this._viewState = captureViewState(current);
        this.switching = true;

        try {
            await current?.close();
            this.view = view;

            const target = view === "original"
                ? this.originalSheet
                : this._createSyntheticDocument().sheet;

            if (view === "modified") {
                target._mode = this.session.editing
                    ? EDIT_MODE
                    : PLAY_MODE;
            }

            await target.render(true, {
                mode: target._mode ?? PLAY_MODE,
                position: this._viewState.position
            });

            restoreViewState(target, this._viewState);
        }
        finally {
            this.switching = false;
        }
    }


    async beginEditing() {
        if (this.view !== "modified" || this.session.editing)
            return;

        this.session.beginEditing();
        this._dirtyControlPaths.clear();
        const state = captureViewState(this.syntheticSheet);
        this.syntheticSheet._mode = EDIT_MODE;

        await this.syntheticSheet.render({
            force: true,
            mode: EDIT_MODE
        });
        restoreViewState(this.syntheticSheet, state);
    }


    async _closeStructureEditors() {
        const applications = new Set(
            Object.values(this.syntheticDocument?.apps ?? {})
        );

        for (const effect of this.syntheticDocument?.effects ?? []) {
            for (const app of Object.values(effect.apps ?? {}))
                applications.add(app);
        }

        applications.delete(this.syntheticSheet);

        await Promise.allSettled(
            Array.from(applications, app => app?.close?.())
        );
    }


    _scopedSubmitData(submitData) {
        const scoped = {};
        const form = this.syntheticSheet?.element;

        for (const dirtyPath of this._dirtyControlPaths) {
            const path = atomicControlPath(dirtyPath);
            const prepared = ObjectOverridePatchEngine.get(
                submitData,
                path
            );
            const working = ObjectOverridePatchEngine.get(
                this.session.workingSource,
                path
            );
            let value = prepared.exists
                ? prepared.value
                : working.value;

            if (path === dirtyPath) {
                const control = form?.querySelector(
                    `[name="${CSS.escape(dirtyPath)}"]`
                );

                if (control) {
                    value = coerceControlValue(
                        control,
                        prepared.exists
                            ? prepared.value
                            : undefined,
                        working.value
                    );
                }
            }
            else if (!prepared.exists) {
                continue;
            }

            if (pathIsSafe(path, value))
                scoped[path] = value;
        }

        return scoped;
    }


    async applyEditing() {
        if (!this.session.editing)
            return;

        this._suppressLocalRender = true;

        try {
            const form = this.syntheticSheet.element;
            const event = new Event("submit", {
                cancelable: true
            });
            const formData = new foundry.applications.ux
                .FormDataExtended(form);
            const submitData = this.syntheticSheet
                ._prepareSubmitData(
                    event,
                    form,
                    formData
                );

            const scopedSubmitData = this._scopedSubmitData(
                submitData
            );
            await this._applySyntheticUpdate(
                scopedSubmitData,
                { render: false }
            );
            await this._closeStructureEditors();
        }
        finally {
            this._suppressLocalRender = false;
        }

        await ObjectOverrideStorageService.save(
            this.originalDocument.uuid,
            this.session.patch,
            {
                documentName:
                    this.originalDocument.documentName,
                documentType: this.originalDocument.type
            }
        );
        this.session.apply();
        this._dirtyControlPaths.clear();
        this.syntheticSheet.editingDescriptionTarget = null;
        this.syntheticSheet._mode = PLAY_MODE;

        const state = captureViewState(this.syntheticSheet);
        await this.syntheticSheet.render({
            force: true,
            mode: PLAY_MODE
        });
        restoreViewState(this.syntheticSheet, state);
    }


    async cancelEditing() {
        if (!this.session.editing)
            return;

        await this._closeStructureEditors();
        this.session.cancel();
        this._dirtyControlPaths.clear();
        this._replaceSyntheticSource(
            this.session.workingSource
        );
        this.syntheticSheet.editingDescriptionTarget = null;
        this.syntheticSheet._mode = PLAY_MODE;

        const state = captureViewState(this.syntheticSheet);
        await this.syntheticSheet.render({
            force: true,
            mode: PLAY_MODE
        });
        restoreViewState(this.syntheticSheet, state);
    }


    async resetField(path) {
        return this.resetFields([path]);
    }


    async resetFields(paths) {
        if (!this.session.editing)
            return;

        const normalizedPaths = [
            ...new Set(
                Array.from(paths ?? [])
                    .map(path => String(path ?? "").trim())
                    .filter(Boolean)
            )
        ];

        if (!normalizedPaths.length)
            return;

        if (normalizedPaths.some(path =>
            ATOMIC_PATCH_PATHS.includes(path)
        )) {
            await this._closeStructureEditors();
        }

        for (const path of normalizedPaths)
            this.session.resetField(path);

        for (const path of normalizedPaths) {
            for (const dirtyPath of this._dirtyControlPaths) {
                if (atomicControlPath(dirtyPath) === path)
                    this._dirtyControlPaths.delete(dirtyPath);
            }
        }

        this._replaceSyntheticSource(
            this.session.workingSource
        );

        const state = captureViewState(this.syntheticSheet);
        await this.syntheticSheet.render({
            force: true,
            mode: EDIT_MODE
        });
        restoreViewState(this.syntheticSheet, state);
    }


    async resetAll() {
        const editing = this.session.editing;

        if (editing)
            await this._closeStructureEditors();

        if (!editing) {
            await ObjectOverrideStorageService.remove(
                this.originalDocument.uuid
            );
        }

        this.session.resetAll();
        this._dirtyControlPaths.clear();

        if (!editing)
            this.session.apply();

        this._replaceSyntheticSource(
            this.session.workingSource
        );

        const state = captureViewState(this.syntheticSheet);
        await this.syntheticSheet.render({
            force: true,
            mode: editing ? EDIT_MODE : PLAY_MODE
        });
        restoreViewState(this.syntheticSheet, state);
    }


    _viewSwitchHtml() {
        const disabled = this.session.editing
            ? "disabled"
            : "";

        return `
            <div class="cc-item-override-view-switch"
                 data-cc-item-override-view-switch role="group"
                 aria-label="${localize("ObjectOverrideView")}">
                <button type="button" data-cc-override-view="original"
                    class="unbutton ${this.view === "original" ? "active" : ""}"
                    aria-pressed="${this.view === "original"}"
                    ${disabled}>
                    ${localize("ObjectOverrideOriginal")}
                </button>
                <button type="button" data-cc-override-view="modified"
                    class="unbutton ${this.view === "modified" ? "active" : ""}"
                    aria-pressed="${this.view === "modified"}"
                    ${disabled}>
                    ${localize("ObjectOverrideModified")}
                </button>
            </div>
        `;
    }


    _resetAllButtonHtml() {
        return `
            <button type="button"
                class="header-control icon fa-solid fa-rotate-left cc-item-override-reset-all"
                data-cc-override-reset-all
                data-tooltip="${localize("ObjectOverrideResetAll")}"
                aria-label="${localize("ObjectOverrideResetAll")}">
            </button>
        `;
    }


    _injectViewSwitch(app) {
        app.element
            .querySelector("[data-cc-item-override-view-switch]")
            ?.remove();
        app.element
            .querySelector("[data-cc-override-reset-all]")
            ?.remove();

        const header = app.element.querySelector(
            ".window-header"
        );

        if (!header)
            return;

        const modeToggle = header.querySelector(
            ":scope > .mode-slider"
        );

        if (modeToggle) {
            modeToggle.insertAdjacentHTML(
                "beforebegin",
                this._viewSwitchHtml()
            );

            if (this.view === "modified") {
                modeToggle.insertAdjacentHTML(
                    "afterend",
                    this._resetAllButtonHtml()
                );
            }
        }
        else {
            header.insertAdjacentHTML(
                "afterbegin",
                this._viewSwitchHtml()
            );
        }
    }


    _markBlockedStructures(app) {
        for (
            const section
            of app.element.querySelectorAll(
                "section[data-tab='contents'], " +
                "section[data-tab='advancement']"
            )
        ) {
            section.classList.add(
                "cc-override-locked-structure"
            );

            for (
                const control
                of section.querySelectorAll(
                    "button, input, select, textarea, [contenteditable='true']"
                )
            ) {
                blockControl(control);
            }

            if (
                this.view === "modified" &&
                this.session.editing &&
                !section.querySelector(
                    ":scope > .cc-override-locked-notice"
                )
            ) {
                section.insertAdjacentHTML(
                    "afterbegin",
                    `<p class="cc-override-locked-notice">
                        <i class="fa-solid fa-lock" inert></i>
                        ${localize("ObjectOverrideStructureBlocked")}
                    </p>`
                );
            }
        }
    }


    _actionIsAllowed(action, target, editing) {
        if (
            target.closest("[data-activity-id]") &&
            [
                "deleteDocument",
                "editDocument",
                "showDocument"
            ].includes(action)
        ) {
            return editing;
        }

        const allowed = editing
            ? SAFE_EDIT_ACTIONS
            : SAFE_ACTIONS;

        if (allowed.has(action))
            return true;

        if (!editing)
            return false;

        if (
            action === "addDocument" &&
            ["activities", "effects"].includes(
                this.syntheticSheet?.tabGroups?.primary
            )
        ) {
            return true;
        }

        return action === "create" && Boolean(
            target.closest("section[data-tab='effects']")
        );
    }


    async _handleActivityAction(action, target) {
        const entry = target.closest("[data-activity-id]");

        if (!entry)
            return false;

        const activity = this.syntheticDocument.system
            .activities?.get(entry.dataset.activityId);

        if (!activity)
            return true;

        if (action === "deleteDocument") {
            await activity.deleteDialog({
                sheet: this.syntheticSheet
            });
            return true;
        }

        if (["editDocument", "showDocument"].includes(action)) {
            await this.syntheticSheet._renderChild(activity.sheet);
            return true;
        }

        return false;
    }


    _configureControls(app) {
        const editing =
            this.view === "modified" &&
            this.session.editing;

        app.element.classList.toggle(
            "cc-item-override-original",
            this.view === "original"
        );
        app.element.classList.toggle(
            "cc-item-override-modified",
            this.view === "modified"
        );
        app.element.classList.toggle(
            "cc-item-override-editing",
            editing
        );

        if (this.view === "original")
            return;

        for (
            const control
            of app.element.querySelectorAll(
                NAMED_CONTROL_SELECTOR
            )
        ) {
            const safe = editing && pathIsSafe(
                controlPath(control),
                controlValue(control)
            );
            blockControl(control, !safe);
        }

        for (
            const control
            of app.element.querySelectorAll(
                "[contenteditable]"
            )
        ) {
            const path = control.closest(
                ".prosemirror[name]"
            )?.getAttribute("name");
            const safe = editing && pathIsSafe(path, "");

            control.contentEditable = safe ? "true" : "false";
            control.classList.toggle(
                "cc-override-control-blocked",
                !safe
            );
        }

        for (
            const control
            of app.element.querySelectorAll(
                "[data-action]"
            )
        ) {
            if (
                editing &&
                control.closest("prose-mirror")
            ) {
                continue;
            }

            if (
                control.closest(
                    "[data-cc-item-override-view-switch]"
                )
            ) {
                continue;
            }

            const action = control.dataset.action;
            const allowed =
                (editing && action === "addDocument") ||
                this._actionIsAllowed(
                    action,
                    control,
                    editing
                );

            blockControl(control, !allowed);
        }

        this._markBlockedStructures(app);
    }


    _injectFieldResets(app) {
        if (!this.session.editing)
            return;

        const insertReset = (
            host,
            paths,
            placement = "field"
        ) => {
            if (!host || !paths.length)
                return;

            const normalizedPaths = [...new Set(paths)];
            const key = normalizedPaths.join("|");

            if (
                host.querySelector(
                    `:scope > [data-cc-override-reset-key="${CSS.escape(key)}"]`
                )
            ) {
                return;
            }

            host.classList.add(
                "cc-override-reset-host",
                `cc-override-reset-host-${placement}`
            );

            const button = document.createElement("button");
            button.type = "button";
            button.className =
                "unbutton cc-override-reset-field";
            button.dataset.ccOverrideResetKey = key;
            button.dataset.ccOverrideResetFields =
                JSON.stringify(normalizedPaths);
            button.dataset.tooltip =
                localize("ObjectOverrideResetField");
            button.setAttribute(
                "aria-label",
                localize("ObjectOverrideResetField")
            );
            button.innerHTML =
                '<i class="fa-solid fa-rotate-left" inert></i>';
            host.append(button);
        };

        for (
            const compact
            of app.element.querySelectorAll(
                ".sheet-header .weight, .sheet-header .price"
            )
        ) {
            const paths = Array.from(
                compact.querySelectorAll(
                    NAMED_CONTROL_SELECTOR
                ),
                control => controlPath(control)
            ).filter(path =>
                pathIsSafe(path) &&
                this.session.hasDifference(path)
            );

            insertReset(compact, paths, "compact");
        }

        const propertyControls = app.element.querySelectorAll(
            "[name^='system.properties.']"
        );

        if (
            propertyControls.length &&
            this.session.hasDifference("system.properties")
        ) {
            insertReset(
                propertyControls[0].closest(".form-group"),
                ["system.properties"],
                "properties"
            );
        }

        if (this.session.hasDifference("img")) {
            insertReset(
                app.element.querySelector(".sheet-header .left"),
                ["img"],
                "image"
            );
        }

        for (
            const card
            of app.element.querySelectorAll(
                ".card.description[data-target]"
            )
        ) {
            const path = String(card.dataset.target ?? "").trim();

            if (
                pathIsSafe(path, "") &&
                this.session.hasDifference(path)
            ) {
                insertReset(
                    card.querySelector(":scope > .header"),
                    [path],
                    "description"
                );
            }
        }

        for (const [tab, path] of [
            ["activities", "system.activities"],
            ["effects", "effects"]
        ]) {
            if (!this.session.hasDifference(path))
                continue;

            insertReset(
                app.element.querySelector(
                    `section[data-tab='${tab}']`
                ),
                [path],
                "structure"
            );
        }

        for (
            const labelTop
            of app.element.querySelectorAll(
                ".form-group.label-top"
            )
        ) {
            const paths = Array.from(
                labelTop.querySelectorAll(
                    NAMED_CONTROL_SELECTOR
                ),
                control => controlPath(control)
            ).filter(path =>
                pathIsSafe(path) &&
                this.session.hasDifference(path)
            );

            if (paths.length) {
                labelTop.classList.add(
                    "cc-override-reset-fields-grouped"
                );
                insertReset(labelTop, paths, "label-top");
            }
        }

        for (
            const control
            of app.element.querySelectorAll(
                NAMED_CONTROL_SELECTOR
            )
        ) {
            const path = controlPath(control);
            const compact = control.closest(
                ".sheet-header .weight, .sheet-header .price"
            );

            if (
                compact ||
                control.closest(
                    ".cc-override-reset-fields-grouped"
                ) ||
                path.startsWith("system.properties.") ||
                !pathIsSafe(path, controlValue(control)) ||
                !this.session.hasDifference(path)
            ) {
                continue;
            }

            let host = control.closest(".form-group");
            let placement = host?.classList.contains("label-top")
                ? "label-top"
                : "form-group";

            if (control.classList.contains("document-name")) {
                host = control.closest(".identity-info");
                placement = "name";
            }
            else if (control.closest(".item-rarity")) {
                host = control.closest(".item-rarity");
                placement = "subtitle";
            }
            else if (!host) {
                host = control.parentElement;
                placement = "fallback";
            }

            insertReset(host, [path], placement);
        }
    }


    _prepareEventGuards(app) {
        const root = app.element;

        if (preparedRoots.has(root))
            return;

        preparedRoots.add(root);

        const markDirtyControl = event => {
            if (!this.session.editing)
                return;

            const control = event.target?.closest?.(
                NAMED_CONTROL_SELECTOR
            );
            const path = controlPath(control);

            if (pathIsSafe(path, controlValue(control)))
                this._dirtyControlPaths.add(path);

        };

        root.addEventListener(
            "input",
            markDirtyControl,
            true
        );
        root.addEventListener(
            "change",
            markDirtyControl,
            true
        );

        root.addEventListener("drop", event => {
            if (this.view === "original")
                return;

            const safeDropControl = event.target.closest?.(
                NAMED_CONTROL_SELECTOR
            );

            if (
                this.session.editing &&
                safeDropControl &&
                !safeDropControl.closest(
                    ".cc-override-locked-structure"
                ) &&
                pathIsSafe(
                    controlPath(safeDropControl),
                    controlValue(safeDropControl)
                )
            ) {
                return;
            }

            if (
                event.target.closest(
                    "[data-cc-item-override-view-switch]"
                )
            ) {
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();
            ui.notifications.warn(
                localize("ObjectOverrideDropBlocked")
            );
        }, true);

        root.addEventListener("dragover", event => {
            if (this.view === "original")
                return;

            const safeDropControl = event.target.closest?.(
                NAMED_CONTROL_SELECTOR
            );

            if (
                this.session.editing &&
                safeDropControl &&
                !safeDropControl.closest(
                    ".cc-override-locked-structure"
                ) &&
                pathIsSafe(
                    controlPath(safeDropControl),
                    controlValue(safeDropControl)
                )
            ) {
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);

        root.addEventListener("contextmenu", event => {
            if (this.view === "original")
                return;

            if (
                event.target.closest(
                    "[data-cc-item-override-view-switch]"
                )
            ) {
                return;
            }

            if (
                !this.session.editing ||
                event.target.closest(
                    ".cc-override-locked-structure"
                )
            ) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        }, true);

        root.addEventListener("click", event => {
            const target = event.target;
            const reset = target.closest(
                "[data-cc-override-reset-fields]"
            );

            if (reset) {
                event.preventDefault();
                event.stopImmediatePropagation();
                let paths = [];

                try {
                    paths = JSON.parse(
                        reset.dataset.ccOverrideResetFields
                    );
                }
                catch {
                    paths = [];
                }

                void this.resetFields(paths);
                return;
            }

            const resetAll = target.closest(
                "[data-cc-override-reset-all]"
            );

            if (resetAll) {
                event.preventDefault();
                event.stopImmediatePropagation();
                void this.resetAll().catch(error => {
                    console.error(
                        `${MODULE_ID} | Item override reset failed`,
                        error
                    );
                    ui.notifications.error(error.message);
                });
                return;
            }

            const viewSwitch = target.closest(
                "[data-cc-item-override-view-switch]"
            );

            if (viewSwitch) {
                const control = target.closest("button");

                if (control) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    void this._onViewSwitchClick(
                        event,
                        control
                    ).catch(error => {
                        console.error(
                            `${MODULE_ID} | Item override action failed`,
                            error
                        );
                        ui.notifications.error(error.message);
                    });
                }
                return;
            }

            if (this.view === "original")
                return;

            if (
                target.closest("[data-context-menu]") &&
                !this.session.editing
            ) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }

            if (
                target.closest(
                    ".cc-override-locked-structure"
                )
            ) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }

            const action = target.closest(
                "[data-action]"
            )?.dataset.action;

            if (
                this.session.editing &&
                [
                    "deleteDocument",
                    "editDocument",
                    "showDocument"
                ].includes(action) &&
                target.closest("[data-activity-id]")
            ) {
                event.preventDefault();
                event.stopImmediatePropagation();
                void this._handleActivityAction(
                    action,
                    target
                ).catch(error => {
                    console.error(
                        `${MODULE_ID} | Activity override action failed`,
                        error
                    );
                    ui.notifications.error(error.message);
                });
                return;
            }

            if (action === "toggleState") {
                const path = target.closest(
                    "[data-property]"
                )?.dataset.property;

                if (path)
                    this._dirtyControlPaths.add(path);
            }

            if (action === "editImage") {
                const path = target.closest(
                    "[data-edit]"
                )?.dataset.edit;

                if (pathIsSafe(path, ""))
                    this._dirtyControlPaths.add(path);
            }

            if (["addRecovery", "deleteRecovery"].includes(action))
                this._dirtyControlPaths.add("system.uses.recovery");

            if (action === "deleteCraft")
                this._dirtyControlPaths.add("system.craft");

            if (action === "changeMode") {
                event.preventDefault();
                event.stopImmediatePropagation();

                const operation = this.session.editing
                    ? this.applyEditing()
                    : this.beginEditing();

                void operation.catch(error => {
                    console.error(
                        `${MODULE_ID} | Item override mode change failed`,
                        error
                    );
                    ui.notifications.error(error.message);
                });
                return;
            }

            if (
                this.session.editing &&
                target.closest("prose-mirror")
            ) {
                return;
            }

            if (
                action &&
                !this._actionIsAllowed(
                    action,
                    target,
                    this.session.editing
                )
            ) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        }, true);
    }


    async _onViewSwitchClick(event, target) {
        const view = target.closest(
            "[data-cc-override-view]"
        )?.dataset.ccOverrideView;

        if (view) {
            event.preventDefault();
            await this.show(view);
        }
    }


    onRender(app) {
        if (this.disposed)
            return;

        if (app === this.originalSheet) {
            const restoreModified =
                this.view === "modified" &&
                !this.switching;

            this.view = "original";

            if (restoreModified) {
                Promise.resolve().then(() =>
                    this.show("modified")
                ).catch(error => {
                    console.error(
                        `${MODULE_ID} | Modified view restore failed`,
                        error
                    );
                    ui.notifications.error(error.message);
                });
                return;
            }

            if (this._openModifiedOnFirstRender) {
                this._openModifiedOnFirstRender = false;

                Promise.resolve().then(() =>
                    this.show("modified")
                ).catch(error => {
                    console.error(
                        `${MODULE_ID} | Initial modified view failed`,
                        error
                    );
                    ui.notifications.error(error.message);
                });
                return;
            }
        }
        else if (app === this.syntheticSheet) {
            this.view = "modified";
        }

        this._injectViewSwitch(app);
        this._configureControls(app);
        this._injectFieldResets(app);
        this._prepareEventGuards(app);
        restoreViewState(app, this._viewState);
    }


    onAuxiliaryRender(app) {
        if (
            this.disposed ||
            !this.session.editing ||
            !SAFE_AUXILIARY_SHEET_CLASS_NAMES.has(
                app?.constructor?.name
            ) ||
            app.document !== this.syntheticDocument
        ) {
            return false;
        }

        if (app.constructor.name === "SourceConfig") {
            app._processSubmitData = async (
                _event,
                _form,
                submitData,
                options = {}
            ) => {
                await this._applySyntheticUpdate(
                    submitData,
                    { ...options, render: false }
                );
                return { updated: this.syntheticDocument };
            };
        }

        app._ccOverrideController = this;
        setApplicationEditable(app, true);
        return true;
    }


    onClose(app) {
        if (this.switching || this.disposed)
            return;

        if (SAFE_AUXILIARY_SHEET_CLASS_NAMES.has(
            app?.constructor?.name
        )) {
            clearApplicationEditable(app);
            delete app._ccOverrideController;
            return;
        }

        if (
            app !== this.originalSheet &&
            app !== this.syntheticSheet
        ) {
            return;
        }

        this.dispose();
    }


    dispose() {
        if (this.disposed)
            return;

        this.disposed = true;
        controllers.delete(this.originalSheet);
        controllers.delete(this.syntheticSheet);
        clearApplicationEditable(this.originalSheet);
        clearApplicationEditable(this.syntheticSheet);

        delete this.originalSheet?._ccOverrideController;
        delete this.syntheticSheet?._ccOverrideController;
        delete this.syntheticDocument?._ccOverrideController;

        this.session.dispose();
    }
}


function eligibleItemSheet(app) {
    return ITEM_SHEET_CLASS_NAMES.has(
        app?.constructor?.name
    ) &&
        app.document?.documentName === "Item" &&
        Boolean(app.document.pack) &&
        game.user.can("SETTINGS_MODIFY");
}


export function registerItemSheetOverridePrototype() {
    Hooks.on("renderApplicationV2", app => {
        let controller =
            app._ccOverrideController ??
            controllers.get(app) ??
            app.document?._ccOverrideController;

        if (controller?.onAuxiliaryRender(app))
            return;

        if (!controller && eligibleItemSheet(app))
            controller = new ItemSheetOverrideController(app);

        controller?.onRender(app);
    });

    Hooks.on("closeApplicationV2", app => {
        const controller =
            app._ccOverrideController ??
            controllers.get(app);

        controller?.onClose(app);
    });
}


export {
    coerceControlValue,
    controlValue,
    ItemSheetOverrideController,
    pathIsSafe,
    replaceSyntheticDocumentSource,
    safeStoredPatch,
    safeUpdateData
};
