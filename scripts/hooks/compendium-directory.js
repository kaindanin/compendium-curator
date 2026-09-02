const MODULE_ID = "compendium-curator";
const controllers = new Set();
const controllersByApp = new WeakMap();


function localize(key) {
    return game.i18n.localize(
        `COMPENDIUM_CURATOR.${key}`
    );
}


function format(key, data) {
    return game.i18n.format(
        `COMPENDIUM_CURATOR.${key}`,
        data
    );
}


function normalizeFolderId(folder) {
    if (!folder)
        return null;

    if (typeof folder === "string")
        return folder || null;

    return folder.id ?? folder._id ?? null;
}


function synchronizeIndexFolder(pack, document, folder) {
    pack.indexDocument(document);

    const indexEntry = pack.index.get(document.id);

    if (indexEntry)
        indexEntry.folder = folder;
}


function collectFolderOptions(tree, depth = 0, output = []) {
    for (const child of tree?.children ?? []) {
        output.push({
            id: child.folder.id,
            name: child.folder.name,
            depth
        });
        collectFolderOptions(
            child,
            depth + 1,
            output
        );
    }

    return output;
}


function eligibleDirectory(app) {
    const collection = app?.collection;

    return Boolean(
        app?.element?.classList?.contains(
            "compendium-directory"
        ) &&
        collection?.collection &&
        game.packs.get(collection.collection) === collection
    );
}


class CompendiumDirectoryController {
    constructor(app) {
        this.app = app;
        this.pack = app.collection;
        this.selectionMode = false;
        this.selectedIds = new Set();
        this.disposed = false;
        this.busy = false;
        this.refreshTimer = null;
        this.suppressHookRefresh = false;
        this.originalDropHandler = null;
        this.boundElement = null;

        this._onClick = this._onClick.bind(this);
        this._onChange = this._onChange.bind(this);

        controllers.add(this);
        controllersByApp.set(app, this);
        app._ccCompendiumDirectoryController = this;

        this._patchDropHandler();
        this._bindElement(app.element);
    }


    _bindElement(element) {
        if (!element || this.boundElement === element)
            return;

        this.boundElement?.removeEventListener(
            "click",
            this._onClick
        );
        this.boundElement?.removeEventListener(
            "change",
            this._onChange
        );

        this.boundElement = element;
        element.addEventListener("click", this._onClick);
        element.addEventListener("change", this._onChange);
    }


    _patchDropHandler() {
        if (typeof this.app._handleDroppedEntry !== "function")
            return;

        this.originalDropHandler =
            this.app._handleDroppedEntry.bind(this.app);

        this.app._handleDroppedEntry = async (
            target,
            data
        ) => {
            const entry = await this.app
                ._getDroppedEntryFromData(data);

            if (
                !entry ||
                entry.collection !== this.pack ||
                this.pack.locked
            ) {
                return this.originalDropHandler(
                    target,
                    data
                );
            }

            const destination = this
                ._destinationFolderId(target);
            const current = normalizeFolderId(
                entry.folder
            );

            if (destination === current) {
                return this.originalDropHandler(
                    target,
                    data
                );
            }

            await this._runMutation(async () => {
                const updated = await entry.update(
                    { folder: destination },
                    { render: false }
                );
                synchronizeIndexFolder(
                    this.pack,
                    updated ?? entry,
                    destination
                );
            });

            return entry;
        };
    }


    _destinationFolderId(target) {
        return target
            ?.closest(".directory-item.folder")
            ?.dataset.folderId ?? null;
    }


    _escape(value) {
        return foundry.utils.escapeHTML(
            String(value ?? "")
        );
    }


    _folderOptionsHtml() {
        const options = collectFolderOptions(
            this.pack.tree
        );

        return [
            `<option value="">${this._escape(
                localize("CompendiumBulkRoot")
            )}</option>`,
            ...options.map(folder => {
                const prefix = "— ".repeat(
                    folder.depth
                );

                return `<option value="${this._escape(folder.id)}">${
                    this._escape(`${prefix}${folder.name}`)
                }</option>`;
            })
        ].join("");
    }


    _selectionToolbarHtml() {
        return `
            <div class="cc-compendium-bulk-toolbar"
                 data-cc-compendium-bulk-toolbar>
                <div class="cc-compendium-bulk-summary">
                    <span data-cc-compendium-bulk-count></span>
                    <button type="button" class="inline-control"
                        data-cc-compendium-bulk-select-visible>
                        ${localize("CompendiumBulkSelectVisible")}
                    </button>
                    <button type="button" class="inline-control"
                        data-cc-compendium-bulk-clear>
                        ${localize("CompendiumBulkClear")}
                    </button>
                </div>
                <div class="cc-compendium-bulk-actions">
                    <select data-cc-compendium-bulk-folder
                        aria-label="${localize("CompendiumBulkDestination")}">
                        ${this._folderOptionsHtml()}
                    </select>
                    <button type="button"
                        data-cc-compendium-bulk-move>
                        <i class="fa-solid fa-folder-tree" inert></i>
                        ${localize("CompendiumBulkMove")}
                    </button>
                    <button type="button"
                        data-cc-compendium-bulk-delete>
                        <i class="fa-solid fa-trash" inert></i>
                        ${localize("CompendiumBulkDelete")}
                    </button>
                </div>
            </div>
        `;
    }


    _renderSelectionUi() {
        const root = this.app.element;

        root.querySelector(
            "[data-cc-compendium-bulk-toggle]"
        )?.remove();
        root.querySelector(
            "[data-cc-compendium-bulk-toolbar]"
        )?.remove();

        for (
            const checkbox
            of root.querySelectorAll(
                "[data-cc-compendium-bulk-select]"
            )
        ) {
            checkbox.remove();
        }

        if (this.pack.locked || !game.user.isGM) {
            this.selectionMode = false;
            this.selectedIds.clear();
            return;
        }

        const headerActions = root.querySelector(
            ".directory-header .header-actions"
        );

        headerActions?.insertAdjacentHTML(
            "beforeend",
            `
                <button type="button"
                    class="cc-compendium-bulk-toggle ${
                        this.selectionMode ? "active" : ""
                    }"
                    data-cc-compendium-bulk-toggle
                    aria-pressed="${this.selectionMode}">
                    <i class="fa-solid fa-list-check" inert></i>
                    <span>${localize(
                        this.selectionMode
                            ? "CompendiumBulkFinish"
                            : "CompendiumBulkSelect"
                    )}</span>
                </button>
            `
        );

        if (!this.selectionMode)
            return;

        const search = root.querySelector(
            ".directory-header search"
        );

        search?.insertAdjacentHTML(
            "afterend",
            this._selectionToolbarHtml()
        );

        for (
            const entry
            of root.querySelectorAll(
                ".directory-item.entry[data-entry-id]"
            )
        ) {
            const { entryId } = entry.dataset;
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className =
                "cc-compendium-bulk-checkbox";
            checkbox.dataset.ccCompendiumBulkSelect =
                entryId;
            checkbox.checked = this.selectedIds.has(
                entryId
            );
            checkbox.setAttribute(
                "aria-label",
                format("CompendiumBulkSelectEntry", {
                    name: entry.querySelector(
                        ".entry-name"
                    )?.textContent?.trim() ?? entryId
                })
            );
            entry.prepend(checkbox);
        }

        this._updateToolbarState();
    }


    _updateToolbarState() {
        const root = this.app.element;
        const count = this.selectedIds.size;
        const countElement = root.querySelector(
            "[data-cc-compendium-bulk-count]"
        );

        if (countElement) {
            countElement.textContent = format(
                "CompendiumBulkSelected",
                { count }
            );
        }

        for (
            const control
            of root.querySelectorAll(
                "[data-cc-compendium-bulk-move], " +
                "[data-cc-compendium-bulk-delete], " +
                "[data-cc-compendium-bulk-clear]"
            )
        ) {
            control.disabled = this.busy || count === 0;
        }

        const selectVisible = root.querySelector(
            "[data-cc-compendium-bulk-select-visible]"
        );

        if (selectVisible)
            selectVisible.disabled = this.busy;

        for (
            const checkbox
            of root.querySelectorAll(
                "[data-cc-compendium-bulk-select]"
            )
        ) {
            checkbox.disabled = this.busy;
            checkbox.checked = this.selectedIds.has(
                checkbox.dataset.ccCompendiumBulkSelect
            );
        }
    }


    _selectVisible() {
        for (
            const entry
            of this.app.element.querySelectorAll(
                ".directory-item.entry[data-entry-id]"
            )
        ) {
            if (entry.getClientRects().length)
                this.selectedIds.add(entry.dataset.entryId);
        }

        this._updateToolbarState();
    }


    async _runMutation(callback) {
        if (this.busy)
            return;

        this.busy = true;
        this.suppressHookRefresh = true;
        this._updateToolbarState();

        try {
            await callback();
            this.pack.initializeTree();
            this.selectedIds.clear();
            await this.refresh();
        }
        catch (error) {
            console.error(
                `${MODULE_ID} | Compendium bulk action failed`,
                error
            );
            ui.notifications.error(error.message);
        }
        finally {
            this.busy = false;
            this.suppressHookRefresh = false;
            this._updateToolbarState();
        }
    }


    async _moveSelected() {
        if (!this.selectedIds.size)
            return;

        const folderValue = this.app.element
            .querySelector(
                "[data-cc-compendium-bulk-folder]"
            )?.value ?? "";
        const folder = folderValue || null;
        const ids = Array.from(this.selectedIds);

        await this._runMutation(async () => {
            const documents = (await Promise.all(
                ids.map(id => this.pack.getDocument(id))
            )).filter(Boolean);

            if (documents.length !== ids.length) {
                throw new Error(format(
                    "CompendiumBulkMissingEntries",
                    {
                        count: ids.length - documents.length
                    }
                ));
            }

            for (const document of documents) {
                const updated = await document.update(
                    { folder },
                    { render: false }
                );
                synchronizeIndexFolder(
                    this.pack,
                    updated ?? document,
                    folder
                );
            }

            const failed = documents.filter(document =>
                normalizeFolderId(document.folder) !== folder
            );

            if (failed.length) {
                throw new Error(format(
                    "CompendiumBulkMoveFailed",
                    { count: failed.length }
                ));
            }

            ui.notifications.info(
                format("CompendiumBulkMoved", {
                    count: documents.length
                })
            );
        });
    }


    async _deleteSelected() {
        if (!this.selectedIds.size)
            return;

        const ids = Array.from(this.selectedIds);
        const confirmed = await foundry.applications.api
            .DialogV2.confirm({
                window: {
                    title: localize(
                        "CompendiumBulkDeleteTitle"
                    ),
                    icon: "fa-solid fa-trash"
                },
                content: `<p>${format(
                    "CompendiumBulkDeleteConfirm",
                    { count: ids.length }
                )}</p>`,
                yes: {
                    label: localize(
                        "CompendiumBulkDelete"
                    ),
                    icon: "fa-solid fa-trash",
                    default: true
                },
                no: {
                    label: localize("Cancel"),
                    icon: "fa-solid fa-xmark"
                }
            });

        if (!confirmed)
            return;

        await this._runMutation(async () => {
            const documents = (await Promise.all(
                ids.map(id => this.pack.getDocument(id))
            )).filter(Boolean);

            if (documents.length !== ids.length) {
                throw new Error(format(
                    "CompendiumBulkMissingEntries",
                    {
                        count: ids.length - documents.length
                    }
                ));
            }

            for (const document of documents) {
                await document.delete({ render: false });
            }

            ui.notifications.info(
                format("CompendiumBulkDeleted", {
                    count: documents.length
                })
            );
        });
    }


    _onChange(event) {
        const checkbox = event.target.closest(
            "[data-cc-compendium-bulk-select]"
        );

        if (!checkbox)
            return;

        const id = checkbox.dataset
            .ccCompendiumBulkSelect;

        if (checkbox.checked)
            this.selectedIds.add(id);
        else
            this.selectedIds.delete(id);

        this._updateToolbarState();
    }


    _onClick(event) {
        const target = event.target;

        if (target.closest(
            "[data-cc-compendium-bulk-select]"
        )) {
            event.stopPropagation();
            return;
        }

        if (target.closest(
            "[data-cc-compendium-bulk-toggle]"
        )) {
            event.preventDefault();
            event.stopPropagation();
            this.selectionMode = !this.selectionMode;

            if (!this.selectionMode)
                this.selectedIds.clear();

            this._renderSelectionUi();
            return;
        }

        if (target.closest(
            "[data-cc-compendium-bulk-select-visible]"
        )) {
            event.preventDefault();
            this._selectVisible();
            return;
        }

        if (target.closest(
            "[data-cc-compendium-bulk-clear]"
        )) {
            event.preventDefault();
            this.selectedIds.clear();
            this._updateToolbarState();
            return;
        }

        if (target.closest(
            "[data-cc-compendium-bulk-move]"
        )) {
            event.preventDefault();
            void this._moveSelected();
            return;
        }

        if (target.closest(
            "[data-cc-compendium-bulk-delete]"
        )) {
            event.preventDefault();
            void this._deleteSelected();
        }
    }


    onRender() {
        this._bindElement(this.app.element);
        this.selectedIds = new Set(
            Array.from(this.selectedIds).filter(id =>
                this.pack.index.has(id)
            )
        );
        this._renderSelectionUi();
    }


    scheduleRefresh() {
        if (
            this.disposed ||
            this.suppressHookRefresh
        ) {
            return;
        }

        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(
            () => void this.refresh(),
            25
        );
    }


    async refresh() {
        if (this.disposed || !this.app.rendered)
            return;

        clearTimeout(this.refreshTimer);
        this.refreshTimer = null;
        await this.app.render({
            force: true
        });
    }


    dispose() {
        if (this.disposed)
            return;

        this.disposed = true;
        clearTimeout(this.refreshTimer);
        this.boundElement?.removeEventListener(
            "click",
            this._onClick
        );
        this.boundElement?.removeEventListener(
            "change",
            this._onChange
        );
        this.boundElement = null;

        if (this.originalDropHandler) {
            this.app._handleDroppedEntry =
                this.originalDropHandler;
        }

        controllers.delete(this);
        controllersByApp.delete(this.app);
        delete this.app._ccCompendiumDirectoryController;
    }
}


export function registerCompendiumDirectoryEnhancements() {
    Hooks.on("renderApplicationV2", app => {
        if (!eligibleDirectory(app))
            return;

        let controller = controllersByApp.get(app);

        if (!controller)
            controller = new CompendiumDirectoryController(app);

        controller.onRender();
    });

    Hooks.on("closeApplicationV2", app => {
        controllersByApp.get(app)?.dispose();
    });

    Hooks.on("updateCompendium", pack => {
        for (const controller of controllers) {
            if (controller.pack === pack)
                controller.scheduleRefresh();
        }
    });
}


export {
    CompendiumDirectoryController,
    collectFolderOptions,
    normalizeFolderId,
    synchronizeIndexFolder
};
