import {
    CuratorOverrideSession
} from "../overrides/curator-override-session.js";


const PLAY_MODE = 1;
const EDIT_MODE = 2;
const MODULE_ID = "compendium-curator";
const controllers = new WeakMap();
const preparedRoots = new WeakSet();

const BLOCKED_PATH_PREFIXES = [
    "effects",
    "items",
    "system.activities",
    "system.advancement",
    "system.contents",
    "system.container",
    "system.properties",
    "system.damage.parts",
    "system.uses.recovery"
];

const BLOCKED_SYNTHETIC_METHODS = [
    "createActivity",
    "updateActivity",
    "deleteActivity",
    "createAdvancement",
    "updateAdvancement",
    "deleteAdvancement"
];

const SAFE_ACTIONS = new Set([
    "changeMode",
    "close",
    "tab",
    "toggleCollapsed",
    "toggleControls"
]);

const SAFE_EDIT_ACTIONS = new Set([
    ...SAFE_ACTIONS,
    "editDescription",
    "showConfiguration"
]);


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


function isPrimitive(value) {
    return value === null ||
        ["string", "number", "boolean"].includes(
            typeof value
        );
}


function pathIsBlocked(path) {
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

    if (!normalized.startsWith("system."))
        return false;

    return isPrimitive(value);
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
            this.originalDocument
        );
        this.view = "original";
        this.switching = false;
        this.disposed = false;
        this.syntheticDocument = null;
        this.syntheticSheet = null;
        this._viewState = null;
        this._suppressLocalRender = false;

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


            async createEmbeddedDocuments() {
                return controller._blockedOperation();
            }


            async updateEmbeddedDocuments() {
                return controller._blockedOperation();
            }


            async deleteEmbeddedDocuments() {
                return controller._blockedOperation();
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
                submitData,
                { ...options, render: false }
            );
            return { updated: this.syntheticDocument };
        };
        controllers.set(this.syntheticSheet, this);
        setApplicationEditable(this.syntheticSheet, true);

        return this.syntheticDocument;
    }


    _hardenEmbeddedDocuments() {
        for (const effect of this.syntheticDocument?.effects ?? []) {
            for (const method of ["update", "delete"]) {
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


    async _applySyntheticUpdate(data, options = {}) {
        if (this.disposed)
            return this.syntheticDocument;

        const safe = safeUpdateData(data);

        if (!Object.keys(safe).length)
            return this.syntheticDocument;

        this.syntheticDocument.updateSource(safe);
        this._hardenEmbeddedDocuments();
        this.session.captureWorkingSource(
            this.syntheticDocument.toObject()
        );

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
        this.syntheticDocument.updateSource(
            structuredClone(source),
            { recursive: false }
        );
        this._hardenEmbeddedDocuments();
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
        const state = captureViewState(this.syntheticSheet);
        this.syntheticSheet._mode = EDIT_MODE;

        await this.syntheticSheet.render({
            force: true,
            mode: EDIT_MODE
        });
        restoreViewState(this.syntheticSheet, state);
    }


    async applyEditing() {
        if (!this.session.editing)
            return;

        this._suppressLocalRender = true;

        try {
            await this.syntheticSheet.submit();
        }
        finally {
            this._suppressLocalRender = false;
        }

        this.session.captureWorkingSource(
            this.syntheticDocument.toObject()
        );
        this.session.apply();
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

        this.session.cancel();
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
        if (!this.session.editing || !path)
            return;

        this.session.resetField(path);
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

        this.session.resetAll();

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
                "section[data-tab='activities'], " +
                "section[data-tab='effects'], " +
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
                "input[name], select[name], textarea[name]"
            )
        ) {
            const safe = editing && pathIsSafe(
                control.name,
                control.value
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

        const allowedActions = editing
            ? SAFE_EDIT_ACTIONS
            : SAFE_ACTIONS;

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

            const allowed = allowedActions.has(
                control.dataset.action
            );

            blockControl(control, !allowed);
        }

        for (
            const image
            of app.element.querySelectorAll(
                "[data-edit='img'], [data-action='editImage']"
            )
        ) {
            blockControl(image);
        }

        this._markBlockedStructures(app);
    }


    _injectFieldResets(app) {
        if (!this.session.editing)
            return;

        for (
            const control
            of app.element.querySelectorAll(
                "input[name], select[name], textarea[name]"
            )
        ) {
            const path = control.name;

            if (
                !pathIsSafe(path, control.value) ||
                !this.session.hasDifference(path) ||
                control.nextElementSibling
                    ?.matches("[data-cc-override-reset-field]")
            ) {
                continue;
            }

            const button = document.createElement("button");
            button.type = "button";
            button.className =
                "unbutton cc-override-reset-field";
            button.dataset.ccOverrideResetField = path;
            button.dataset.tooltip =
                localize("ObjectOverrideResetField");
            button.setAttribute(
                "aria-label",
                localize("ObjectOverrideResetField")
            );
            button.innerHTML =
                '<i class="fa-solid fa-rotate-left" inert></i>';
            button.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                void this.resetField(path);
            });
            control.insertAdjacentElement("afterend", button);
        }
    }


    _prepareEventGuards(app) {
        const root = app.element;

        if (preparedRoots.has(root))
            return;

        preparedRoots.add(root);

        root.addEventListener("drop", event => {
            if (this.view === "original")
                return;

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
                "[data-cc-override-reset-field]"
            );

            if (reset) {
                event.preventDefault();
                event.stopImmediatePropagation();
                void this.resetField(
                    reset.dataset.ccOverrideResetField
                );
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

            const allowed = this.session.editing
                ? SAFE_EDIT_ACTIONS
                : SAFE_ACTIONS;

            if (action && !allowed.has(action)) {
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

        if (app === this.originalSheet)
            this.view = "original";
        else if (app === this.syntheticSheet)
            this.view = "modified";

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
            app?.constructor?.name !== "SourceConfig" ||
            app.document !== this.syntheticDocument
        ) {
            return false;
        }

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
        setApplicationEditable(app, true);
        return true;
    }


    onClose(app) {
        if (this.switching || this.disposed)
            return;

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
    return app?.constructor?.name === "ItemSheet5e" &&
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
    ItemSheetOverrideController,
    pathIsSafe,
    safeUpdateData
};
