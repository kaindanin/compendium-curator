import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";

const GROUP_DRAG_TYPE =
    "application/x-compendium-curator-filter-group";
const FOLDER_DRAG_TYPE =
    "application/x-compendium-curator-filter-group-folder";

function sortByName(entries) {
    return [...entries].sort((a, b) =>
        String(a?.name ?? "").localeCompare(
            String(b?.name ?? ""),
            game.i18n.lang,
            { sensitivity: "base" }
        )
    );
}

function normalizeSearchText(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase();
}

function folderError(error) {
    const key = {
        TABLE_FOLDER_NAME_REQUIRED: "TableFolderNameRequired",
        TABLE_FOLDER_NAME_TAKEN: "TableFolderNameTaken",
        TABLE_FOLDER_CYCLE: "TableFolderCycle",
        TABLE_FOLDER_NOT_FOUND: "TableFolderNotFound"
    }[error?.message];

    if (key) {
        ui.notifications.warn(
            game.i18n.localize(`COMPENDIUM_CURATOR.${key}`)
        );
        return;
    }

    console.error(
        "Compendium Curator | Error gestionando carpetas de grupos.",
        error
    );
    ui.notifications.error(
        game.i18n.localize(
            "COMPENDIUM_CURATOR.TableFolderOperationFailed"
        )
    );
}

async function requestFolderName({ title, value = "", okLabel }) {
    const field = document.createElement("div");
    field.className = "form-group";
    field.innerHTML = `<label>${foundry.utils.escapeHTML(
        game.i18n.localize("COMPENDIUM_CURATOR.TableFolderName")
    )}</label>`;

    const input = document.createElement("input");
    input.type = "text";
    input.name = "folderName";
    input.autocomplete = "off";
    input.autofocus = true;
    input.value = value;
    input.setAttribute("value", value);
    field.append(input);

    const result =
        await foundry.applications.api.DialogV2.input({
            window: { title },
            content: field.outerHTML,
            ok: { label: okLabel },
            rejectClose: false,
            modal: true
        });

    return String(result?.folderName ?? "").trim();
}

function createIconButton(action, icon, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cc-table-manager-folder-action";
    button.dataset.ccGroupFolderAction = action;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<i class="${icon}"></i>`;
    return button;
}

function descendants(folderId, folders) {
    const ids = new Set([folderId]);
    let changed = true;

    while (changed) {
        changed = false;

        for (const folder of Object.values(folders)) {
            if (folder?.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
                ids.add(folder.id);
                changed = true;
            }
        }
    }

    return ids;
}

function configureDropZone(application, element, folderId) {
    element.addEventListener("dragover", event => {
        if (
            !event.dataTransfer?.types?.includes(GROUP_DRAG_TYPE) &&
            !event.dataTransfer?.types?.includes(FOLDER_DRAG_TYPE)
        ) return;

        event.preventDefault();
        event.stopPropagation();
        element.classList.add("cc-table-folder-drag-over");
    });

    element.addEventListener("dragleave", event => {
        if (!element.contains(event.relatedTarget))
            element.classList.remove("cc-table-folder-drag-over");
    });

    element.addEventListener("drop", async event => {
        const groupId = event.dataTransfer?.getData(GROUP_DRAG_TYPE);
        const draggedFolderId =
            event.dataTransfer?.getData(FOLDER_DRAG_TYPE);

        if (!groupId && !draggedFolderId)
            return;

        event.preventDefault();
        event.stopPropagation();
        element.classList.remove("cc-table-folder-drag-over");

        try {
            if (groupId) {
                await TableProfileStorageService
                    .moveFilterGroupToFolder(groupId, folderId);
            }
            else {
                await TableProfileStorageService
                    .moveFilterGroupFolder(draggedFolderId, folderId);
            }

            await application.render({ force: true });
        }
        catch (error) {
            folderError(error);
        }
    });
}

function addGroupDragHandle(groupElement, groupId) {
    const summary = groupElement.querySelector(":scope > summary");
    if (!summary)
        return;

    const handle = document.createElement("span");
    handle.className = "cc-table-manager-folder-drag-handle";
    handle.draggable = true;
    handle.title = game.i18n.localize(
        "COMPENDIUM_CURATOR.MoveFilterGroupToFolderHint"
    );
    handle.setAttribute("role", "button");
    handle.setAttribute("aria-label", handle.title);
    handle.innerHTML = '<i class="fas fa-grip-vertical"></i>';
    handle.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
    });
    handle.addEventListener("dragstart", event => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(GROUP_DRAG_TYPE, groupId);
        groupElement.classList.add("cc-table-folder-dragging");
    });
    handle.addEventListener("dragend", () =>
        groupElement.classList.remove("cc-table-folder-dragging")
    );

    const info = summary.querySelector(
        ":scope > .cc-table-manager-profile-info"
    );
    summary.insertBefore(handle, info ?? summary.firstChild);
}

function createFolderElement(
    application,
    folder,
    folders,
    groups,
    groupElements,
    childrenByParent
) {
    const details = document.createElement("details");
    details.className = "cc-table-manager-folder";
    details.dataset.ccFilterGroupFolder = folder.id;
    details.open = !application._ccCollapsedFilterGroupFolders.has(folder.id);

    const summary = document.createElement("summary");
    summary.className = "cc-table-manager-folder-header";

    const dragHandle = document.createElement("span");
    dragHandle.className = "cc-table-manager-folder-drag-handle";
    dragHandle.draggable = true;
    dragHandle.title = game.i18n.localize("COMPENDIUM_CURATOR.MoveFolderHint");
    dragHandle.innerHTML = '<i class="fas fa-grip-vertical"></i>';
    dragHandle.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
    });
    dragHandle.addEventListener("dragstart", event => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(FOLDER_DRAG_TYPE, folder.id);
    });

    const childFolderIds = descendants(folder.id, folders);
    const count = Object.values(groups).filter(group =>
        childFolderIds.has(group?.folderId)
    ).length;
    const actions = document.createElement("span");
    actions.className = "cc-table-manager-folder-actions";
    actions.append(
        createIconButton(
            "createChild",
            "fas fa-folder-plus",
            game.i18n.localize("COMPENDIUM_CURATOR.CreateSubfolder")
        ),
        createIconButton(
            "rename",
            "fas fa-pen",
            game.i18n.localize("COMPENDIUM_CURATOR.RenameFolder")
        ),
        createIconButton(
            "delete",
            "fas fa-trash",
            game.i18n.localize("COMPENDIUM_CURATOR.DeleteFolder")
        )
    );

    summary.append(dragHandle);
    summary.insertAdjacentHTML(
        "beforeend",
        '<i class="fas fa-chevron-down cc-table-manager-folder-chevron"></i>' +
        '<i class="fas fa-folder"></i>'
    );
    const name = document.createElement("strong");
    name.textContent = folder.name;
    const countElement = document.createElement("span");
    countElement.className = "cc-table-manager-folder-count";
    countElement.textContent = game.i18n.format(
        "COMPENDIUM_CURATOR.FilterGroupFolderCount",
        { count }
    );
    summary.append(name, countElement, actions);
    configureDropZone(application, summary, folder.id);

    const body = document.createElement("div");
    body.className = "cc-table-manager-folder-body";
    configureDropZone(application, body, folder.id);
    const childFolders = document.createElement("div");
    childFolders.className = "cc-table-manager-folder-children";

    for (const child of sortByName(childrenByParent.get(folder.id) ?? [])) {
        childFolders.append(createFolderElement(
            application, child, folders, groups,
            groupElements, childrenByParent
        ));
    }

    const folderGroups = document.createElement("div");
    folderGroups.className = "cc-table-manager-folder-profiles";

    for (const group of sortByName(
        Object.values(groups).filter(candidate => candidate?.folderId === folder.id)
    )) {
        const element = groupElements.get(group.id);
        if (element)
            folderGroups.append(element);
    }

    body.append(childFolders, folderGroups);
    details.append(summary, body);
    details.addEventListener("toggle", () => {
        if (String(application._searchQuery ?? "").trim())
            return;

        if (details.open)
            application._ccCollapsedFilterGroupFolders.delete(folder.id);
        else
            application._ccCollapsedFilterGroupFolders.add(folder.id);
    });

    actions.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        const action = event.target.closest(
            "[data-cc-group-folder-action]"
        )?.dataset?.ccGroupFolderAction;

        if (!action)
            return;

        try {
            if (action === "createChild") {
                const newName = await requestFolderName({
                    title: game.i18n.localize("COMPENDIUM_CURATOR.CreateSubfolder"),
                    okLabel: game.i18n.localize("COMPENDIUM_CURATOR.Create")
                });
                if (!newName) return;
                await TableProfileStorageService
                    .createFilterGroupFolder(newName, folder.id);
            }
            else if (action === "rename") {
                const newName = await requestFolderName({
                    title: game.i18n.localize("COMPENDIUM_CURATOR.RenameFolder"),
                    value: folder.name,
                    okLabel: game.i18n.localize("COMPENDIUM_CURATOR.Rename")
                });
                if (!newName || newName === folder.name) return;
                await TableProfileStorageService
                    .renameFilterGroupFolder(folder.id, newName);
            }
            else if (action === "delete") {
                const confirmed = await foundry.applications.api.DialogV2.confirm({
                    window: { title: game.i18n.localize("COMPENDIUM_CURATOR.DeleteFolder") },
                    content: `<p>${game.i18n.format(
                        "COMPENDIUM_CURATOR.DeleteFilterGroupFolderConfirm",
                        { name: foundry.utils.escapeHTML(folder.name) }
                    )}</p>`,
                    rejectClose: false,
                    modal: true
                });
                if (!confirmed) return;
                await TableProfileStorageService
                    .removeFilterGroupFolder(folder.id);
                application._ccCollapsedFilterGroupFolders.delete(folder.id);
            }

            await application.render({ force: true });
        }
        catch (error) {
            folderError(error);
        }
    });

    return details;
}

function installToolbar(application, element) {
    if (application._activeTab !== "filters")
        return;

    const createGroup = element.querySelector('[data-action="createProfile"]');
    if (!createGroup || element.querySelector("[data-cc-create-filter-group-folder]"))
        return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cc-table-manager-filter-group-control";
    button.dataset.ccCreateFilterGroupFolder = "true";
    button.title = game.i18n.localize("COMPENDIUM_CURATOR.CreateFolder");
    button.setAttribute("aria-label", button.title);
    button.innerHTML = '<i class="fas fa-folder-plus"></i>';
    button.addEventListener("click", async event => {
        event.preventDefault();
        const name = await requestFolderName({
            title: game.i18n.localize("COMPENDIUM_CURATOR.CreateFolder"),
            okLabel: game.i18n.localize("COMPENDIUM_CURATOR.Create")
        });
        if (!name) return;

        try {
            await TableProfileStorageService.createFilterGroupFolder(name);
            await application.render({ force: true });
        }
        catch (error) {
            folderError(error);
        }
    });
    createGroup.before(button);
}

function installTree(application, element) {
    if (application._activeTab !== "filters")
        return;

    const list = element.querySelector(".cc-table-manager-filter-group-cards");
    if (!list)
        return;

    application._ccCollapsedFilterGroupFolders ??= new Set();
    const storage = TableProfileStorageService.getStorage();
    const folders = storage.filterGroupFolders ?? {};
    const groups = storage.filterGroups ?? {};
    const groupElements = new Map(
        [...list.children]
            .filter(child => child.matches("[data-filter-group-id]"))
            .map(child => [child.dataset.filterGroupId, child])
    );

    for (const [groupId, groupElement] of groupElements)
        addGroupDragHandle(groupElement, groupId);

    if (!Object.keys(folders).length) {
        configureDropZone(application, list, null);
        return;
    }

    const tree = document.createElement("div");
    tree.className = "cc-table-manager-folder-tree";
    tree.dataset.ccFilterGroupFolderTree = "true";
    const childrenByParent = new Map();

    for (const folder of Object.values(folders)) {
        const parentId = folder.parentId ?? null;
        const children = childrenByParent.get(parentId) ?? [];
        children.push(folder);
        childrenByParent.set(parentId, children);
    }

    for (const folder of sortByName(childrenByParent.get(null) ?? [])) {
        tree.append(createFolderElement(
            application, folder, folders, groups,
            groupElements, childrenByParent
        ));
    }

    const root = document.createElement("section");
    root.className = "cc-table-manager-folder-root";
    root.dataset.ccFilterGroupFolderRoot = "true";
    configureDropZone(application, root, null);
    const label = document.createElement("div");
    label.className = "cc-table-manager-folder-root-label";
    label.innerHTML = `<i class="fas fa-folder-open"></i><span>${
        foundry.utils.escapeHTML(
            game.i18n.localize("COMPENDIUM_CURATOR.FilterGroupsWithoutFolder")
        )
    }</span>`;
    const loose = document.createElement("div");
    loose.className = "cc-table-manager-folder-profiles";

    for (const group of sortByName(
        Object.values(groups).filter(candidate => !candidate?.folderId)
    )) {
        const groupElement = groupElements.get(group.id);
        if (groupElement) loose.append(groupElement);
    }

    root.append(label, loose);
    tree.append(root);
    list.replaceChildren(tree);
    application._applyManagerSearch();
}

function updateSearch(application) {
    const tree = application.element?.querySelector(
        "[data-cc-filter-group-folder-tree]"
    );
    if (!tree)
        return;

    const query = normalizeSearchText(application._searchQuery);
    const hasQuery = Boolean(query);
    const folders = [...tree.querySelectorAll(
        "[data-cc-filter-group-folder]"
    )].reverse();

    for (const folder of folders) {
        const visibleGroup = [...folder.querySelectorAll(
            "[data-filter-group-id]"
        )].some(group => !group.hidden);
        const nameMatches = normalizeSearchText(
            folder.querySelector(":scope > summary > strong")?.textContent
        ).includes(query);
        folder.hidden = hasQuery && !visibleGroup && !nameMatches;

        if (hasQuery && !folder.hidden) folder.open = true;
        else if (!hasQuery) {
            folder.open = !application._ccCollapsedFilterGroupFolders
                .has(folder.dataset.ccFilterGroupFolder);
        }
    }
}

export function registerTableManagerFilterGroupFolders() {
    Hooks.on("filterTableManagerApplication", application => {
        updateSearch(application);
    });
    Hooks.on("renderTableManagerApplication", (application, element) => {
        if (!game.user.can("SETTINGS_MODIFY"))
            return;
        installToolbar(application, element);
        installTree(application, element);
    });
}
