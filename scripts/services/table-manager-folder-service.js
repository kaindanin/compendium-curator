import {
    TableManagerApplication
} from "../applications/table-manager-application.js";
import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";
import {
    TableGenerationFolderService
} from "./table-generation-folder-service.js";

const PATCH_FLAG = Symbol.for(
    "compendium-curator.table-manager-folders"
);
const PROFILE_DRAG_TYPE =
    "application/x-compendium-curator-profile";
const FOLDER_DRAG_TYPE =
    "application/x-compendium-curator-folder";

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
        TABLE_FOLDER_NAME_REQUIRED:
            "TableFolderNameRequired",
        TABLE_FOLDER_NAME_TAKEN:
            "TableFolderNameTaken",
        TABLE_FOLDER_CYCLE:
            "TableFolderCycle",
        TABLE_FOLDER_NOT_FOUND:
            "TableFolderNotFound"
    }[error?.message];

    if (key) {
        ui.notifications.warn(
            game.i18n.localize(
                `COMPENDIUM_CURATOR.${key}`
            )
        );
        return;
    }

    console.error(
        "Compendium Curator | Error gestionando carpetas de tablas.",
        error
    );
    ui.notifications.error(
        game.i18n.localize(
            "COMPENDIUM_CURATOR.TableFolderOperationFailed"
        )
    );
}

async function syncGeneratedLocations(
    profileId = null
) {
    try {
        if (profileId) {
            await TableGenerationFolderService
                .syncProfile(profileId);
        }
        else {
            await TableGenerationFolderService
                .syncAllProfiles();
        }
    }
    catch (error) {
        console.error(
            "Compendium Curator | Error sincronizando carpetas generadas.",
            error
        );
        ui.notifications.warn(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.GeneratedFolderSyncFailed"
            )
        );
    }
}

async function requestFolderName({
    title,
    value = "",
    okLabel
}) {
    const field = document.createElement("div");
    field.className = "form-group";

    const label = document.createElement("label");
    label.textContent = game.i18n.localize(
        "COMPENDIUM_CURATOR.TableFolderName"
    );

    const input = document.createElement("input");
    input.type = "text";
    input.name = "folderName";
    input.autocomplete = "off";
    input.autofocus = true;
    input.value = value;
    input.setAttribute("value", value);

    field.append(label, input);

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

function profileFolderPath(
    profile,
    folders
) {
    const names = [];
    const visited = new Set();
    let folderId = profile?.folderId ?? null;

    while (
        folderId &&
        folders[folderId] &&
        !visited.has(folderId)
    ) {
        visited.add(folderId);
        names.unshift(folders[folderId].name);
        folderId = folders[folderId].parentId;
    }

    return names;
}

function createIconButton({
    action,
    icon,
    label
}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
        "cc-table-manager-folder-action";
    button.dataset.ccFolderAction = action;
    button.title = label;
    button.setAttribute("aria-label", label);

    const iconElement = document.createElement("i");
    iconElement.className = icon;
    button.append(iconElement);

    return button;
}

function getFolderDescendantProfileCount(
    folderId,
    folders,
    profiles
) {
    const descendantIds = new Set([folderId]);
    let changed = true;

    while (changed) {
        changed = false;

        for (const folder of Object.values(folders)) {
            if (
                folder?.parentId &&
                descendantIds.has(folder.parentId) &&
                !descendantIds.has(folder.id)
            ) {
                descendantIds.add(folder.id);
                changed = true;
            }
        }
    }

    return Object.values(profiles).filter(profile =>
        descendantIds.has(profile?.folderId)
    ).length;
}

function configureDropZone(
    application,
    element,
    folderId
) {
    element.dataset.ccFolderDrop = folderId ?? "";

    element.addEventListener("dragover", event => {
        if (
            !event.dataTransfer?.types?.includes(
                PROFILE_DRAG_TYPE
            ) &&
            !event.dataTransfer?.types?.includes(
                FOLDER_DRAG_TYPE
            )
        ) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        element.classList.add("cc-table-folder-drag-over");
    });

    element.addEventListener("dragleave", event => {
        if (!element.contains(event.relatedTarget)) {
            element.classList.remove(
                "cc-table-folder-drag-over"
            );
        }
    });

    element.addEventListener("drop", async event => {
        const profileId = event.dataTransfer?.getData(
            PROFILE_DRAG_TYPE
        );
        const draggedFolderId =
            event.dataTransfer?.getData(
                FOLDER_DRAG_TYPE
            );

        if (!profileId && !draggedFolderId)
            return;

        event.preventDefault();
        event.stopPropagation();
        element.classList.remove(
            "cc-table-folder-drag-over"
        );

        try {
            if (profileId) {
                await TableProfileStorageService
                    .moveProfileToFolder(
                        profileId,
                        folderId
                    );
                await syncGeneratedLocations(
                    profileId
                );
            }
            else {
                await TableProfileStorageService
                    .moveFolder(
                        draggedFolderId,
                        folderId
                    );
                await syncGeneratedLocations();
            }

            await application.render({ force: true });
        }
        catch (error) {
            folderError(error);
        }
    });
}

function addProfileDragHandle(
    profileElement,
    profileId
) {
    const header = profileElement.matches("details")
        ? profileElement.querySelector(
            ":scope > summary"
        )
        : profileElement;

    if (!header)
        return;

    const handle = document.createElement("span");
    handle.className =
        "cc-table-manager-folder-drag-handle";
    handle.draggable = true;
    handle.title = game.i18n.localize(
        "COMPENDIUM_CURATOR.MoveTableToFolderHint"
    );
    handle.setAttribute("role", "button");
    handle.setAttribute("aria-label", handle.title);

    const icon = document.createElement("i");
    icon.className = "fas fa-grip-vertical";
    handle.append(icon);

    handle.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
    });
    handle.addEventListener("dragstart", event => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
            PROFILE_DRAG_TYPE,
            profileId
        );
        event.dataTransfer.setData(
            "text/plain",
            profileId
        );
        profileElement.classList.add(
            "cc-table-folder-dragging"
        );
    });
    handle.addEventListener("dragend", () => {
        profileElement.classList.remove(
            "cc-table-folder-dragging"
        );
    });

    const info = header.querySelector(
        ":scope > .cc-table-manager-profile-info"
    );
    header.insertBefore(handle, info ?? header.firstChild);
}

function createFolderElement(
    application,
    folder,
    folders,
    profiles,
    profileElements,
    childrenByParent
) {
    const details = document.createElement("details");
    details.className = "cc-table-manager-folder";
    details.dataset.ccTableFolder = folder.id;
    details.open = !application
        ._ccCollapsedTableFolders
        .has(folder.id);

    const summary = document.createElement("summary");
    summary.className = "cc-table-manager-folder-header";

    const dragHandle = document.createElement("span");
    dragHandle.className =
        "cc-table-manager-folder-drag-handle";
    dragHandle.draggable = true;
    dragHandle.title = game.i18n.localize(
        "COMPENDIUM_CURATOR.MoveFolderHint"
    );
    dragHandle.setAttribute("role", "button");
    dragHandle.setAttribute("aria-label", dragHandle.title);

    const grip = document.createElement("i");
    grip.className = "fas fa-grip-vertical";
    dragHandle.append(grip);
    dragHandle.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
    });
    dragHandle.addEventListener("dragstart", event => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
            FOLDER_DRAG_TYPE,
            folder.id
        );
        event.dataTransfer.setData(
            "text/plain",
            folder.id
        );
        details.classList.add(
            "cc-table-folder-dragging"
        );
    });
    dragHandle.addEventListener("dragend", () => {
        details.classList.remove(
            "cc-table-folder-dragging"
        );
    });

    const chevron = document.createElement("i");
    chevron.className =
        "fas fa-chevron-down cc-table-manager-folder-chevron";

    const folderIcon = document.createElement("i");
    folderIcon.className = "fas fa-folder";

    const name = document.createElement("strong");
    name.textContent = folder.name;

    const count = document.createElement("span");
    count.className = "cc-table-manager-folder-count";
    count.textContent = game.i18n.format(
        "COMPENDIUM_CURATOR.TableFolderTableCount",
        {
            count: getFolderDescendantProfileCount(
                folder.id,
                folders,
                profiles
            )
        }
    );

    const actions = document.createElement("span");
    actions.className =
        "cc-table-manager-folder-actions";
    actions.append(
        createIconButton({
            action: "createChild",
            icon: "fas fa-folder-plus",
            label: game.i18n.localize(
                "COMPENDIUM_CURATOR.CreateSubfolder"
            )
        }),
        createIconButton({
            action: "rename",
            icon: "fas fa-pen",
            label: game.i18n.localize(
                "COMPENDIUM_CURATOR.RenameFolder"
            )
        }),
        createIconButton({
            action: "delete",
            icon: "fas fa-trash",
            label: game.i18n.localize(
                "COMPENDIUM_CURATOR.DeleteFolder"
            )
        })
    );

    summary.append(
        dragHandle,
        chevron,
        folderIcon,
        name,
        count,
        actions
    );
    configureDropZone(application, summary, folder.id);

    const body = document.createElement("div");
    body.className = "cc-table-manager-folder-body";
    configureDropZone(application, body, folder.id);

    const childFolders = document.createElement("div");
    childFolders.className =
        "cc-table-manager-folder-children";

    for (
        const child
        of sortByName(
            childrenByParent.get(folder.id) ?? []
        )
    ) {
        childFolders.append(
            createFolderElement(
                application,
                child,
                folders,
                profiles,
                profileElements,
                childrenByParent
            )
        );
    }

    const folderProfiles = document.createElement("div");
    folderProfiles.className =
        "cc-table-manager-folder-profiles";

    for (
        const profile
        of sortByName(
            Object.values(profiles).filter(
                candidate =>
                    candidate?.folderId === folder.id
            )
        )
    ) {
        const element = profileElements.get(profile.id);
        if (element)
            folderProfiles.append(element);
    }

    body.append(childFolders, folderProfiles);
    details.append(summary, body);

    details.addEventListener("toggle", () => {
        if (
            String(application._searchQuery ?? "").trim()
        ) {
            return;
        }

        if (details.open) {
            application._ccCollapsedTableFolders.delete(
                folder.id
            );
        }
        else {
            application._ccCollapsedTableFolders.add(
                folder.id
            );
        }
    });

    actions.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();

        const button = event.target.closest(
            "[data-cc-folder-action]"
        );
        const action = button?.dataset
            ?.ccFolderAction;

        if (!action)
            return;

        try {
            if (action === "createChild") {
                const newName = await requestFolderName({
                    title: game.i18n.localize(
                        "COMPENDIUM_CURATOR.CreateSubfolder"
                    ),
                    okLabel: game.i18n.localize(
                        "COMPENDIUM_CURATOR.Create"
                    )
                });

                if (!newName)
                    return;

                await TableProfileStorageService
                    .createFolder(newName, folder.id);
            }
            else if (action === "rename") {
                const newName = await requestFolderName({
                    title: game.i18n.localize(
                        "COMPENDIUM_CURATOR.RenameFolder"
                    ),
                    value: folder.name,
                    okLabel: game.i18n.localize(
                        "COMPENDIUM_CURATOR.Rename"
                    )
                });

                if (!newName || newName === folder.name)
                    return;

                await TableProfileStorageService
                    .renameFolder(folder.id, newName);
                await syncGeneratedLocations();
            }
            else if (action === "delete") {
                const confirmed =
                    await foundry.applications.api
                        .DialogV2.confirm({
                            window: {
                                title: game.i18n.localize(
                                    "COMPENDIUM_CURATOR.DeleteFolder"
                                )
                            },
                            content: `<p>${game.i18n.format(
                                "COMPENDIUM_CURATOR.DeleteFolderConfirm",
                                {
                                    name: foundry.utils.escapeHTML(
                                        folder.name
                                    )
                                }
                            )}</p>`,
                            rejectClose: false,
                            modal: true
                        });

                if (!confirmed)
                    return;

                await TableProfileStorageService
                    .removeFolder(folder.id);
                await syncGeneratedLocations();
                application._ccCollapsedTableFolders
                    .delete(folder.id);
            }

            await application.render({ force: true });
        }
        catch (error) {
            folderError(error);
        }
    });

    return details;
}

function updateFolderSearch(application) {
    const root = application.element?.querySelector(
        "[data-cc-table-folder-tree]"
    );

    if (!root)
        return;

    const query = normalizeSearchText(
        application._searchQuery
    );
    const hasQuery = Boolean(query);

    const folders = [
        ...root.querySelectorAll(
            "[data-cc-table-folder]"
        )
    ].reverse();

    for (const folder of folders) {
        const visibleProfile = [
            ...folder.querySelectorAll(
                "[data-profile-id]"
            )
        ].some(profile => !profile.hidden);
        const visibleChildFolder = [
            ...folder.querySelectorAll(
                ":scope > .cc-table-manager-folder-body > .cc-table-manager-folder-children > [data-cc-table-folder]"
            )
        ].some(child => !child.hidden);
        const nameMatches = normalizeSearchText(
            folder.querySelector(
                ":scope > .cc-table-manager-folder-header > strong"
            )?.textContent
        ).includes(query);

        folder.hidden =
            hasQuery &&
            !visibleProfile &&
            !visibleChildFolder &&
            !nameMatches;

        if (hasQuery && !folder.hidden)
            folder.open = true;
        else if (!hasQuery) {
            folder.open = !application
                ._ccCollapsedTableFolders
                .has(folder.dataset.ccTableFolder);
        }
    }

    const loose = root.querySelector(
        "[data-cc-loose-profiles]"
    );

    if (loose) {
        const hasVisibleLoose = [
            ...loose.querySelectorAll(
                ":scope > [data-profile-id]"
            )
        ].some(profile => !profile.hidden);

        loose.closest("[data-cc-folder-root-drop]")
            .hidden = hasQuery && !hasVisibleLoose;
    }
}

function installFolderToolbar(application, element) {
    if (application._activeTab === "filters")
        return;

    const createProfile = element.querySelector(
        '[data-action="createProfile"]'
    );

    if (
        !createProfile ||
        element.querySelector(
            "[data-cc-create-table-folder]"
        )
    ) {
        return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className =
        "cc-table-manager-filter-group-control";
    button.dataset.ccCreateTableFolder = "true";
    button.title = game.i18n.localize(
        "COMPENDIUM_CURATOR.CreateFolder"
    );
    button.setAttribute("aria-label", button.title);

    const icon = document.createElement("i");
    icon.className = "fas fa-folder-plus";
    button.append(icon);

    button.addEventListener("click", async event => {
        event.preventDefault();

        const name = await requestFolderName({
            title: game.i18n.localize(
                "COMPENDIUM_CURATOR.CreateFolder"
            ),
            okLabel: game.i18n.localize(
                "COMPENDIUM_CURATOR.Create"
            )
        });

        if (!name)
            return;

        try {
            await TableProfileStorageService
                .createFolder(name);
            await application.render({ force: true });
        }
        catch (error) {
            folderError(error);
        }
    });

    createProfile.before(button);
}

function installFolderTree(application, element) {
    if (application._activeTab === "filters")
        return;

    const list = element.querySelector(
        ".cc-table-manager-profiles"
    );

    if (!list)
        return;

    application._ccCollapsedTableFolders ??= new Set();

    const storage =
        TableProfileStorageService.getStorage();
    const folders = storage.folders ?? {};
    const profiles = Object.fromEntries(
        Object.entries(storage.profiles ?? {})
            .filter(([, profile]) =>
                profile?.version === 2
            )
    );
    const profileElements = new Map(
        [...list.children]
            .filter(child =>
                child.matches("[data-profile-id]")
            )
            .map(child => [
                child.dataset.profileId,
                child
            ])
    );

    for (const [profileId, profileElement] of profileElements) {
        const profile = profiles[profileId];
        const baseSearchText =
            profileElement.dataset.ccBaseSearchText ??
            profileElement.dataset.ccSearchText ?? "";
        const path = profileFolderPath(
            profile,
            folders
        ).join(" ");

        profileElement.dataset.ccBaseSearchText =
            baseSearchText;
        profileElement.dataset.ccSearchText =
            `${baseSearchText} ${path}`.trim();
        addProfileDragHandle(
            profileElement,
            profileId
        );
    }

    if (!Object.keys(folders).length) {
        configureDropZone(application, list, null);
        return;
    }

    const tree = document.createElement("div");
    tree.className = "cc-table-manager-folder-tree";
    tree.dataset.ccTableFolderTree = "true";

    const childrenByParent = new Map();

    for (const folder of Object.values(folders)) {
        const parentId = folder.parentId ?? null;
        const children =
            childrenByParent.get(parentId) ?? [];
        children.push(folder);
        childrenByParent.set(parentId, children);
    }

    for (
        const folder
        of sortByName(childrenByParent.get(null) ?? [])
    ) {
        tree.append(
            createFolderElement(
                application,
                folder,
                folders,
                profiles,
                profileElements,
                childrenByParent
            )
        );
    }

    const rootDrop = document.createElement("section");
    rootDrop.className =
        "cc-table-manager-folder-root";
    rootDrop.dataset.ccFolderRootDrop = "true";
    configureDropZone(application, rootDrop, null);

    const rootLabel = document.createElement("div");
    rootLabel.className =
        "cc-table-manager-folder-root-label";

    const rootIcon = document.createElement("i");
    rootIcon.className = "fas fa-folder-open";
    const rootText = document.createElement("span");
    rootText.textContent = game.i18n.localize(
        "COMPENDIUM_CURATOR.TablesWithoutFolder"
    );
    rootLabel.append(rootIcon, rootText);

    const looseProfiles = document.createElement("div");
    looseProfiles.className =
        "cc-table-manager-folder-profiles";
    looseProfiles.dataset.ccLooseProfiles = "true";

    for (
        const profile
        of sortByName(
            Object.values(profiles).filter(
                candidate => !candidate?.folderId
            )
        )
    ) {
        const profileElement =
            profileElements.get(profile.id);
        if (profileElement)
            looseProfiles.append(profileElement);
    }

    rootDrop.append(rootLabel, looseProfiles);
    tree.append(rootDrop);
    list.replaceChildren(tree);

    application._applyManagerSearch();
    updateFolderSearch(application);
}

function patchSearch() {
    const prototype = TableManagerApplication.prototype;

    if (prototype[PATCH_FLAG])
        return;

    const original = prototype._applyManagerSearch;

    prototype._applyManagerSearch = function () {
        const result = original.call(this);
        updateFolderSearch(this);
        return result;
    };

    Object.defineProperty(
        prototype,
        PATCH_FLAG,
        {
            value: true,
            configurable: false
        }
    );
}

export function registerTableManagerFolders() {
    patchSearch();

    Hooks.on(
        "renderTableManagerApplication",
        (application, element) => {
            if (!game.user.can("SETTINGS_MODIFY"))
                return;

            installFolderToolbar(application, element);
            installFolderTree(application, element);
        }
    );
}
