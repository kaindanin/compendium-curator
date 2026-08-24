import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";
import {
    TableGenerationFolderService
} from "./table-generation-folder-service.js";

function visibleProfiles(application) {
    return [...application.element.querySelectorAll(
        ".cc-table-manager-profile[data-profile-id]"
    )].filter(element => !element.hidden);
}

function updateSelectionUi(application) {
    const selected = application._ccSelectedProfileIds ?? new Set();

    for (const element of application.element.querySelectorAll(
        ".cc-table-manager-profile[data-profile-id]"
    )) {
        const checked = selected.has(element.dataset.profileId);
        element.classList.toggle("cc-table-manager-profile-selected", checked);
        const input = element.querySelector(
            ":scope > summary [data-cc-profile-select], :scope > [data-cc-profile-select]"
        );
        if (input) input.checked = checked;
    }

    const count = application.element.querySelector(
        "[data-cc-selection-count]"
    );
    if (count) {
        count.textContent = game.i18n.format(
            "COMPENDIUM_CURATOR.SelectedTableCount",
            { count: selected.size }
        );
    }

    for (const button of application.element.querySelectorAll(
        "[data-cc-bulk-requires-selection]"
    )) button.disabled = selected.size === 0;
}

function createButton(action, icon, label, requiresSelection = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.ccBulkAction = action;
    if (requiresSelection)
        button.dataset.ccBulkRequiresSelection = "true";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<i class="${icon}"></i>`;
    return button;
}

function folderPath(folderId, folders) {
    const names = [];
    const visited = new Set();

    while (folderId && folders[folderId] && !visited.has(folderId)) {
        visited.add(folderId);
        names.unshift(folders[folderId].name);
        folderId = folders[folderId].parentId;
    }

    return names.join(" / ");
}

async function chooseFolder() {
    const folders = TableProfileStorageService.getFolders();
    const field = document.createElement("div");
    field.className = "form-group";
    const label = document.createElement("label");
    label.textContent = game.i18n.localize(
        "COMPENDIUM_CURATOR.MoveSelectedTables"
    );
    const select = document.createElement("select");
    select.name = "folderId";
    const root = document.createElement("option");
    root.value = "";
    root.textContent = game.i18n.localize(
        "COMPENDIUM_CURATOR.TablesWithoutFolder"
    );
    select.append(root);

    for (const folder of Object.values(folders).sort((a, b) =>
        folderPath(a.id, folders).localeCompare(
            folderPath(b.id, folders),
            game.i18n.lang,
            { sensitivity: "base" }
        )
    )) {
        const option = document.createElement("option");
        option.value = folder.id;
        option.textContent = folderPath(folder.id, folders);
        select.append(option);
    }

    field.append(label, select);
    const result = await foundry.applications.api.DialogV2.input({
        window: {
            title: game.i18n.localize(
                "COMPENDIUM_CURATOR.MoveSelectedTables"
            )
        },
        content: field.outerHTML,
        ok: {
            label: game.i18n.localize("COMPENDIUM_CURATOR.Move")
        },
        rejectClose: false,
        modal: true
    });

    return result ? String(result.folderId ?? "") || null : undefined;
}

async function runAction(application, action, target) {
    const selected = application._ccSelectedProfileIds;

    if (action === "selectVisible") {
        for (const element of visibleProfiles(application))
            selected.add(element.dataset.profileId);
        updateSelectionUi(application);
        return;
    }

    if (action === "selectPending") {
        for (const element of visibleProfiles(application)) {
            if (element.dataset.ccGenerationPending === "true")
                selected.add(element.dataset.profileId);
        }
        updateSelectionUi(application);
        return;
    }

    if (action === "clearSelection") {
        selected.clear();
        updateSelectionUi(application);
        return;
    }

    const profileIds = [...selected];
    if (!profileIds.length)
        return;

    target.disabled = true;

    if (action === "generateSelected") {
        const result = await application.generateProfileBatch(profileIds);
        const summary = game.i18n.format(
            "COMPENDIUM_CURATOR.VisibleTablesGenerationSummary",
            result
        );
        if (result.failed) ui.notifications.warn(summary);
        else ui.notifications.info(summary);
        await application.render({ force: true });
    }
    else if (action === "moveSelected") {
        const folderId = await chooseFolder();
        if (folderId === undefined) {
            target.disabled = false;
            return;
        }
        const moved = await TableProfileStorageService
            .moveProfilesToFolder(profileIds, folderId);

        for (const profileId of moved) {
            try {
                await TableGenerationFolderService.syncProfile(profileId);
            }
            catch (error) {
                console.error(
                    "Compendium Curator | Error sincronizando una tabla movida.",
                    { profileId, error }
                );
            }
        }
        await application.render({ force: true });
    }
    else if (action === "deleteSelected") {
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: {
                title: game.i18n.localize(
                    "COMPENDIUM_CURATOR.DeleteSelectedTables"
                )
            },
            content: `<p>${game.i18n.format(
                "COMPENDIUM_CURATOR.DeleteSelectedTablesConfirm",
                { count: profileIds.length }
            )}</p>`,
            rejectClose: false,
            modal: true
        });
        if (!confirmed) {
            target.disabled = false;
            return;
        }
        const result = await application.deleteProfileBatch(profileIds);
        selected.clear();
        ui.notifications.info(game.i18n.format(
            "COMPENDIUM_CURATOR.DeletedSelectedTablesSummary",
            result
        ));
        await application.render({ force: true });
    }
}

function installSelection(application, element) {
    if (application._activeTab === "filters")
        return;

    application._ccSelectedProfileIds ??= new Set();
    const validIds = new Set(
        Object.keys(TableProfileStorageService.getProfiles())
    );
    application._ccSelectedProfileIds = new Set(
        [...application._ccSelectedProfileIds].filter(id => validIds.has(id))
    );

    for (const profileElement of element.querySelectorAll(
        ".cc-table-manager-profile[data-profile-id]"
    )) {
        const header = profileElement.matches("details")
            ? profileElement.querySelector(":scope > summary")
            : profileElement;
        if (!header || header.querySelector("[data-cc-profile-select]"))
            continue;

        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "cc-table-manager-profile-select";
        input.dataset.ccProfileSelect = "true";
        input.title = game.i18n.localize(
            "COMPENDIUM_CURATOR.SelectTable"
        );
        input.setAttribute("aria-label", input.title);
        input.checked = application._ccSelectedProfileIds.has(
            profileElement.dataset.profileId
        );
        input.addEventListener("click", event => event.stopPropagation());
        input.addEventListener("change", () => {
            if (input.checked) application._ccSelectedProfileIds
                .add(profileElement.dataset.profileId);
            else application._ccSelectedProfileIds
                .delete(profileElement.dataset.profileId);
            updateSelectionUi(application);
        });
        header.prepend(input);
    }

    const list = element.querySelector(".cc-table-manager-profiles");
    if (!list || element.querySelector("[data-cc-bulk-toolbar]"))
        return;

    const toolbar = document.createElement("div");
    toolbar.className = "cc-table-manager-bulk-toolbar";
    toolbar.dataset.ccBulkToolbar = "true";
    const count = document.createElement("strong");
    count.dataset.ccSelectionCount = "true";
    toolbar.append(
        count,
        createButton("selectVisible", "fas fa-check-double",
            game.i18n.localize("COMPENDIUM_CURATOR.SelectVisibleTables")),
        createButton("selectPending", "fas fa-clock-rotate-left",
            game.i18n.localize("COMPENDIUM_CURATOR.SelectPendingTables")),
        createButton("clearSelection", "fas fa-xmark",
            game.i18n.localize("COMPENDIUM_CURATOR.ClearSelection")),
        createButton("generateSelected", "fas fa-wand-magic-sparkles",
            game.i18n.localize("COMPENDIUM_CURATOR.GenerateSelectedTables"), true),
        createButton("moveSelected", "fas fa-folder-tree",
            game.i18n.localize("COMPENDIUM_CURATOR.MoveSelectedTables"), true),
        createButton("deleteSelected", "fas fa-trash",
            game.i18n.localize("COMPENDIUM_CURATOR.DeleteSelectedTables"), true)
    );
    toolbar.addEventListener("click", async event => {
        const target = event.target.closest("[data-cc-bulk-action]");
        if (!target) return;
        event.preventDefault();
        try {
            await runAction(application, target.dataset.ccBulkAction, target);
        }
        catch (error) {
            console.error("Compendium Curator | Error en acción múltiple.", error);
            ui.notifications.error(game.i18n.localize(
                "COMPENDIUM_CURATOR.BulkTableOperationFailed"
            ));
            if (target.isConnected) target.disabled = false;
        }
    });
    list.before(toolbar);
    updateSelectionUi(application);
}

export function registerTableManagerBulkActions() {
    Hooks.on("renderTableManagerApplication", (application, element) => {
        if (!game.user.can("SETTINGS_MODIFY"))
            return;
        installSelection(application, element);
    });
}
