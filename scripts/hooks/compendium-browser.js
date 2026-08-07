import { debug } from "../debug.js";
import { CuratorState } from "../state/curator-state.js";
import { StorageService } from "../services/storage-service.js";
import { STORAGE_CHANGED_HOOK } from "../settings.js";

const openCompendiumBrowsers = new Set();

function canCurate() {

    return game.user.can("SETTINGS_MODIFY");

}

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

export function registerCompendiumBrowserHooks() {

    Hooks.on("renderApplicationV2", app => {

        if (app.constructor.name !== "CompendiumBrowser")
            return;

        openCompendiumBrowsers.add(app);

        debug("Compendium Browser renderizado");

        onRenderCompendiumBrowser(app);

    });

    Hooks.on("closeApplicationV2", app => {

        if (app.constructor.name !== "CompendiumBrowser")
            return;

        app._ccResultsObserver?.disconnect();
        app._ccResultsObserver = null;

        openCompendiumBrowsers.delete(app);

        debug("Compendium Browser cerrado");

    });

    Hooks.on(STORAGE_CHANGED_HOOK, () => {

        refreshOpenCompendiumBrowsers();

    });

}

function refreshOpenCompendiumBrowsers() {

    for (const app of openCompendiumBrowsers) {

        if (!app.element?.isConnected) {

            openCompendiumBrowsers.delete(app);

            continue;

        }

        refreshCompendiumBrowser(app);

    }

}

function refreshCompendiumBrowser(app) {

    /*
     * Los usuarios sin permisos nunca pueden conservar
     * estados que revelen contenido oculto.
     */
    if (!canCurate()) {

        app._ccShowHidden = false;
        app._ccCuratorMode = false;

        app.element
            .querySelector(".cc-toolbar-container")
            ?.remove();

    }

    clearSelection(app);

    if (canCurate())
        createModeToolbar(app);

    updateCuratorMode(app);

    if (canCurate())
        refreshToolbar(app);

}

function onRenderCompendiumBrowser(app) {

    app._ccShowHidden ??= false;
    app._ccCuratorMode ??= false;
    app._ccResultsFullyLoaded = false;
    app._ccLoadingAllResults ??= false;
    app._ccLoadAllPromise ??= null;

    /*
     * Un usuario sin permisos nunca puede revelar ocultos
     * ni entrar en modo Curador.
     */
    if (!canCurate()) {

        app._ccShowHidden = false;
        app._ccCuratorMode = false;

        app.element
            .querySelector(".cc-toolbar-container")
            ?.remove();

    }

    clearSelection(app);

    observeCompendiumResults(app);

    if (canCurate())
        createModeToolbar(app);

    updateCuratorMode(app);

    if (canCurate())
        refreshToolbar(app);

}

function observeCompendiumResults(app) {

    /*
     * Evita crear varios observadores sobre la misma aplicación.
     */
    app._ccResultsObserver?.disconnect();

    const observer = new MutationObserver(mutations => {

        let itemsChanged = false;

        for (const mutation of mutations) {

            for (const node of mutation.addedNodes) {

                if (!(node instanceof Element))
                    continue;

                /*
                 * Se ha añadido directamente una entrada.
                 */
                if (node.matches(
                    ".item-list > .item[data-uuid]"
                )) {

                    updateItem(app, node);
                    itemsChanged = true;

                }

                /*
                 * Se ha añadido un contenedor con varias entradas.
                 */
                const items = node.querySelectorAll(
                    ".item-list > .item[data-uuid]"
                );

                if (items.length > 0)
                    itemsChanged = true;

                for (const item of items)
                    updateItem(app, item);

            }

            /*
             * Si desaparecen entradas al filtrar o cambiar
             * de categoría, actualizamos el checkbox maestro.
             */
            for (const node of mutation.removedNodes) {

                if (!(node instanceof Element))
                    continue;

                if (
                    node.matches(
                        ".item-list > .item[data-uuid]"
                    ) ||
                    node.querySelector(
                        ".item-list > .item[data-uuid]"
                    )
                ) {
                    itemsChanged = true;
                }

            }

        }

        if (
            itemsChanged &&
            !app._ccLoadingAllResults
        ) {
            app._ccResultsFullyLoaded = false;
        }

        /*
         * No reaccionamos a los cambios provocados por nuestros
         * propios checkboxes, botones o barras.
         */
        if (!itemsChanged)
            return;

        createMasterCheckbox(app);
        refreshMasterCheckbox(app);

    });

    observer.observe(app.element, {
        childList: true,
        subtree: true
    });

    app._ccResultsObserver = observer;

}

function updateCuratorMode(app) {

    const items = app.element.querySelectorAll(
        ".item-list > .item"
    );

    for (const item of items)
        updateItem(app, item);

    createMasterCheckbox(app);
    refreshMasterCheckbox(app);

}

function restrictItemTooltip(item) {

    const itemName = item.querySelector(".item-name");

    if (!itemName)
        return;

    const tooltipSources = [
        item,
        item.querySelector(".item-row")
    ].filter(Boolean);

    for (const source of tooltipSources) {

        for (const attribute of [...source.attributes]) {

            if (!attribute.name.startsWith("data-tooltip"))
                continue;

            itemName.setAttribute(
                attribute.name,
                attribute.value
            );

            source.removeAttribute(attribute.name);

        }

    }

    /*
     * Cancela cualquier tooltip pendiente al entrar
     * en la columna de controles.
     */
    const controls = item.querySelector(".item-controls");

    if (
        controls &&
        !controls.dataset.ccTooltipGuard
    ) {

        controls.dataset.ccTooltipGuard = "true";

        controls.addEventListener("pointerenter", () => {

            game.tooltip.clearPending();
            game.tooltip.deactivate();

        });

    }

}

function updateItem(app, item) {

    restrictItemTooltip(item);

    item.querySelector(".cc-checkbox")?.remove();

    const uuid = item.dataset.uuid;
    const hidden = StorageService.isHidden(uuid);

    item.classList.toggle("cc-hidden-entry", hidden);
    item.hidden = hidden && !app._ccShowHidden;

    if (!canCurate() || !app._ccCuratorMode)
        return;

    const checkbox = document.createElement("input");

    checkbox.type = "checkbox";
    checkbox.className = "cc-checkbox";

    checkbox.checked = CuratorState.getSelection(app).has(uuid);

    checkbox.addEventListener("change", () => {

        const selection =
            CuratorState.getSelection(app);

        if (checkbox.checked)
            selection.add(uuid);
        else
            selection.delete(uuid);

        refreshToolbar(app);
        refreshMasterCheckbox(app);

        debug(selection);

    });

    const controls = item.querySelector(".item-controls");

    controls?.appendChild(checkbox);

}

function clearSelection(app) {

    CuratorState.getSelection(app).clear();

    app.element
        .querySelectorAll(".cc-checkbox")
        .forEach(checkbox => {
            checkbox.checked = false;
        });

    const toolbar =
        app.element.querySelector(".cc-toolbar");

    if (toolbar)
        refreshToolbar(app);

    refreshMasterCheckbox(app);

}

function getToolbarContainer(app) {

    let container = app.element.querySelector(
        ".cc-toolbar-container"
    );

    if (container)
        return container;

    const scrollContainer = app.element.querySelector(
        ".items-list.browser-results"
    );

    if (!scrollContainer)
        return null;

    container = document.createElement("div");
    container.className = "cc-toolbar-container";

    /*
     * Se inserta fuera del contenedor que tiene el scroll,
     * pero dentro del panel de resultados.
     */
    scrollContainer.insertAdjacentElement(
        "beforebegin",
        container
    );

    return container;

}

function waitForNextResultsBatch(
    itemList,
    previousCount,
    timeout = 1000
) {

    return new Promise(resolve => {

        let timer;

        const finish = loaded => {

            observer.disconnect();
            clearTimeout(timer);

            resolve(loaded);

        };

        const observer = new MutationObserver(() => {

            const currentCount =
                itemList.querySelectorAll(
                    ":scope > .item[data-uuid]"
                ).length;

            if (currentCount > previousCount)
                finish(true);

        });

        observer.observe(itemList, {
            childList: true
        });

        timer = setTimeout(
            () => finish(false),
            timeout
        );

    });

}

async function ensureAllResultsLoaded(app) {

    if (app._ccResultsFullyLoaded)
        return true;

    if (app._ccLoadAllPromise)
        return app._ccLoadAllPromise;

    const promise = (async () => {

        const results =
            app.element.querySelector(
                '[data-application-part="results"]'
            );

        const itemList =
            results?.querySelector(".item-list");

        if (!results || !itemList)
            return false;

        const originalScrollTop =
            results.scrollTop;

        app._ccLoadingAllResults = true;

        refreshMasterCheckbox(app);

        try {

            while (
                results.isConnected &&
                itemList.isConnected
            ) {

                const previousCount =
                    itemList.querySelectorAll(
                        ":scope > .item[data-uuid]"
                    ).length;

                const batchPromise =
                    waitForNextResultsBatch(
                        itemList,
                        previousCount
                    );

                /*
                 * D&D5e carga el siguiente lote al alcanzar
                 * el final del contenedor de resultados.
                 */
                results.scrollTop =
                    results.scrollHeight;

                results.dispatchEvent(
                    new Event("scroll")
                );

                /*
                 * Restauramos inmediatamente la posición
                 * para que el usuario no sea enviado al final.
                 */
                results.scrollTop =
                    originalScrollTop;

                const loadedBatch =
                    await batchPromise;

                if (!loadedBatch) {

                    app._ccResultsFullyLoaded = true;

                    debug(
                        "Todos los resultados cargados:",
                        previousCount
                    );

                    return true;

                }

            }

            return false;

        }
        finally {

            if (results.isConnected)
                results.scrollTop = originalScrollTop;

            app._ccLoadingAllResults = false;

            refreshMasterCheckbox(app);

        }

    })();

    app._ccLoadAllPromise = promise;

    try {

        return await promise;

    }
    finally {

        if (app._ccLoadAllPromise === promise)
            app._ccLoadAllPromise = null;

    }

}

function getVisibleItems(app) {

    return Array.from(
        app.element.querySelectorAll(
            ".item-list > .item[data-uuid]"
        )
    ).filter(item =>
        !item.hidden &&
        item.querySelector(".cc-checkbox")
    );

}

function createMasterCheckbox(app) {

    if (!canCurate())
        return null;

    let checkbox = app.element.querySelector(
        ".cc-master-checkbox"
    );

    /*
     * Fuera del modo Curador no debe aparecer.
     */
    if (!app._ccCuratorMode) {

        checkbox?.remove();

        return null;

    }

    if (checkbox) {

        refreshMasterCheckbox(app);

        return checkbox;

    }

    const headerControls = app.element.querySelector(
        ".items-header .item-controls"
    );

    if (!headerControls)
        return null;

    checkbox = document.createElement("input");

    checkbox.type = "checkbox";
    checkbox.className =
        "cc-checkbox cc-master-checkbox";

    checkbox.title = localize("SelectAllVisible");
    checkbox.checked = false;

    checkbox.addEventListener("change", async () => {

        const selectAll = checkbox.checked;

        if (selectAll) {

            const loaded =
                await ensureAllResultsLoaded(app);

            if (!loaded) {

                checkbox.checked = false;
                checkbox.indeterminate = false;

                return;

            }

        }

        const selection =
            CuratorState.getSelection(app);

        const items = getVisibleItems(app);

        for (const item of items) {

            const uuid = item.dataset.uuid;

            const itemCheckbox =
                item.querySelector(".cc-checkbox");

            itemCheckbox.checked = selectAll;

            if (selectAll)
                selection.add(uuid);
            else
                selection.delete(uuid);

        }

        refreshToolbar(app);
        refreshMasterCheckbox(app);

    });

    headerControls.appendChild(checkbox);

    refreshMasterCheckbox(app);

    return checkbox;

}

function refreshMasterCheckbox(app) {

    const checkbox = app.element.querySelector(
        ".cc-master-checkbox"
    );

    if (!checkbox)
        return;

    if (app._ccLoadingAllResults) {

        checkbox.disabled = true;
        checkbox.checked = false;
        checkbox.indeterminate = true;

        return;

    }

    const items = getVisibleItems(app);

    checkbox.disabled = items.length === 0;

    checkbox.checked =
        items.length > 0 &&
        items.every(item =>
            item.querySelector(".cc-checkbox")?.checked
        );

}

function createModeToolbar(app) {

    if (!canCurate())
        return null;

    let toolbar = app.element.querySelector(".cc-mode-toolbar");

    if (toolbar) {

        refreshProfileSelect(
            toolbar.querySelector(".cc-profile-select")
        );

        refreshProfileButtons(toolbar);
        refreshPublicProfileButton(toolbar);

        return toolbar;

    }

    const container = getToolbarContainer(app);

    if (!container)
        return null;

    toolbar = document.createElement("div");
    toolbar.className = "cc-mode-toolbar";

    toolbar.innerHTML = `
        <div class="cc-profile-control">

            <span>${localize("Profile")}</span>

            <select class="cc-profile-select"></select>

            <button
                type="button"
                class="cc-profile-create"
                title="${localize("CreateProfile")}"
            >
                <i class="fa-solid fa-plus"></i>
            </button>

            <button
                type="button"
                class="cc-profile-rename"
                title="${localize("RenameProfile")}"
            >
                <i class="fa-solid fa-pen"></i>
            </button>

            <button
                type="button"
                class="cc-profile-duplicate"
                title="${localize("DuplicateProfile")}"
            >
                <i class="fa-solid fa-copy"></i>
            </button>

            <button
                type="button"
                class="cc-profile-export"
                title="${localize("ExportProfile")}"
            >
                <i class="fa-solid fa-file-export"></i>
            </button>

            <button
                type="button"
                class="cc-profile-import"
                title="${localize("ImportProfile")}"
            >
                <i class="fa-solid fa-file-import"></i>
            </button>

            <button
                type="button"
                class="cc-profile-public"
                title="${localize("MarkPublic")}"
            >
                <i class="fa-solid fa-globe"></i>
            </button>

            <button
                type="button"
                class="cc-profile-delete"
                title="${localize("DeleteProfile")}"
            >
                <i class="fa-solid fa-trash"></i>
            </button>

        </div>

        <button type="button" class="cc-curator-button">
            <i class="fa-solid fa-eye-slash"></i>
            ${localize("Curator")}
        </button>

        <button type="button" class="cc-hidden-button">
            <i class="fa-solid fa-eye-slash"></i>
            ${localize("Hidden")}
        </button>
    `;

    const curatorButton = toolbar.querySelector(".cc-curator-button");
    const hiddenButton = toolbar.querySelector(".cc-hidden-button");
    const publicProfileButton = toolbar.querySelector(".cc-profile-public");

    curatorButton.addEventListener("click", () => {

        app._ccCuratorMode = !app._ccCuratorMode;

        debug("Modo Curador:", app._ccCuratorMode);

        clearSelection(app);

        refreshCuratorButton(curatorButton, app);
        updateCuratorMode(app);
        refreshToolbar(app);

    });

    hiddenButton.addEventListener("click", () => {

        app._ccShowHidden = !app._ccShowHidden;

        /*
        * Al cambiar la visibilidad, limpiamos la selección
        * para evitar mantener entradas seleccionadas que ya
        * no aparecen en pantalla.
        */
        clearSelection(app);

        refreshHiddenButton(hiddenButton, app);
        updateCuratorMode(app);
        refreshToolbar(app);

    });

    const profileSelect = toolbar.querySelector(
        ".cc-profile-select"
    );

    const createProfileButton = toolbar.querySelector(
        ".cc-profile-create"
    );

    const renameProfileButton = toolbar.querySelector(
        ".cc-profile-rename"
    );

    const duplicateProfileButton = toolbar.querySelector(
        ".cc-profile-duplicate"
    );

    const exportProfileButton = toolbar.querySelector(
        ".cc-profile-export"
    );

    const importProfileButton = toolbar.querySelector(
        ".cc-profile-import"
    );

    const deleteProfileButton = toolbar.querySelector(
        ".cc-profile-delete"
    );

    refreshProfileSelect(profileSelect);
    refreshProfileButtons(toolbar);
    refreshPublicProfileButton(toolbar);

    createProfileButton.addEventListener("click", async () => {

        const result =
            await foundry.applications.api.DialogV2.input({
                window: {
                    title: localize("CreateProfile")
                },

                content: `
                    <div class="form-group">
                        <label>${localize("ProfileName")}</label>

                        <input
                            type="text"
                            name="profileName"
                            autocomplete="off"
                            autofocus
                        >
                    </div>
                `,

                ok: {
                    label: localize("Create")
                },

                rejectClose: false,
                modal: true
            });

        if (!result)
            return;

        const profileName =
            String(result.profileName ?? "").trim();

        if (!profileName) {

            ui.notifications.warn(
                localize("ProfileNameRequired")
            );

            return;

        }

        const created =
            await StorageService.createProfile(profileName);

        if (!created) {

            ui.notifications.warn(
                localize("ProfileNameInvalid")
            );

            return;

        }

        clearSelection(app);

        debug("Perfil creado:", profileName);

    });

    renameProfileButton.addEventListener("click", async () => {

        const activeProfile =
            StorageService.getActiveProfileId();

        const activeProfileName =
            StorageService.getProfileName(activeProfile);

        const field = document.createElement("div");
        field.className = "form-group";

        const label = document.createElement("label");
        label.textContent = localize("ProfileName");

        const input = document.createElement("input");
        input.type = "text";
        input.name = "profileName";
        input.autocomplete = "off";
        input.autofocus = true;
        input.value = activeProfileName;

        field.append(label, input);

        const result =
            await foundry.applications.api.DialogV2.input({
                window: {
                    title: localize("RenameProfile")
                },

                content: field.outerHTML,

                ok: {
                    label: localize("Rename")
                },

                rejectClose: false,
                modal: true
            });

        if (!result)
            return;

        const profileName =
            String(result.profileName ?? "").trim();

        if (!profileName) {

            ui.notifications.warn(
                localize("ProfileNameRequired")
            );

            return;

        }

        if (profileName === activeProfileName)
            return;

        const renamed =
            await StorageService.renameProfile(
                activeProfile,
                profileName
            );

        if (!renamed) {

            ui.notifications.warn(
                localize("ProfileNameInvalid")
            );

            return;

        }

        clearSelection(app);

        debug(
            "Perfil renombrado:",
            activeProfile,
            profileName
        );

    });

    duplicateProfileButton.addEventListener("click", async () => {

        const activeProfile =
            StorageService.getActiveProfileId();

        const activeProfileName =
            StorageService.getProfileName(activeProfile);

        const suggestedName = format(
            "ProfileCopyName",
            { profile: activeProfileName }
        );

        const field = document.createElement("div");
        field.className = "form-group";

        const label = document.createElement("label");
        label.textContent = localize("ProfileName");

        const input = document.createElement("input");
        input.type = "text";
        input.name = "profileName";
        input.autocomplete = "off";
        input.autofocus = true;
        input.value = suggestedName;

        field.append(label, input);

        const result =
            await foundry.applications.api.DialogV2.input({
                window: {
                    title: localize("DuplicateProfile")
                },

                content: field.outerHTML,

                ok: {
                    label: localize("Duplicate")
                },

                rejectClose: false,
                modal: true
            });

        if (!result)
            return;

        const profileName =
            String(result.profileName ?? "").trim();

        if (!profileName) {

            ui.notifications.warn(
                localize("ProfileNameRequired")
            );

            return;

        }

        const duplicated =
            await StorageService.duplicateProfile(
                activeProfile,
                profileName
            );

        if (!duplicated) {

            ui.notifications.warn(
                localize("ProfileNameInvalid")
            );

            return;

        }

        clearSelection(app);

        debug(
            "Perfil duplicado:",
            activeProfile,
            profileName
        );

    });

    exportProfileButton.addEventListener("click", () => {

        const activeProfile =
            StorageService.getActiveProfileId();

        const profileName =
            StorageService.getProfileName(activeProfile);

        const exportData =
            StorageService.getProfileExportData(activeProfile);

        if (!exportData)
            return;

        const safeName = profileName
            .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
            .trim() || "profile";

        foundry.utils.saveDataToFile(
            JSON.stringify(exportData, null, 2),
            "application/json",
            `compendium-curator-${safeName}.json`
        );

        debug(
            "Perfil exportado:",
            activeProfile,
            profileName
        );

    });

    importProfileButton.addEventListener("click", async () => {

        const fileInput =
            document.createElement("input");

        fileInput.type = "file";
        fileInput.accept = ".json,application/json";

        fileInput.addEventListener("change", async () => {

            const file = fileInput.files?.[0];

            if (!file)
                return;

            let importData;

            try {

                const text = await file.text();
                importData = JSON.parse(text);

            }
            catch {

                ui.notifications.error(
                    localize("ProfileImportInvalid")
                );

                return;

            }

            if (
                !importData ||
                importData.type !== "compendium-curator-profile" ||
                importData.version !== 1 ||
                !importData.profile ||
                typeof importData.profile.name !== "string"
            ) {

                ui.notifications.error(
                    localize("ProfileImportInvalid")
                );

                return;

            }

            const field =
                document.createElement("div");

            field.className = "form-group";

            const label =
                document.createElement("label");

            label.textContent =
                localize("ProfileName");

            const input =
                document.createElement("input");

            input.type = "text";
            input.name = "profileName";
            input.autocomplete = "off";
            input.autofocus = true;
            input.value = importData.profile.name;

            field.append(label, input);

            const result =
                await foundry.applications.api.DialogV2.input({
                    window: {
                        title: localize("ImportProfile")
                    },

                    content: field.outerHTML,

                    ok: {
                        label: localize("Import")
                    },

                    rejectClose: false,
                    modal: true
                });

            if (!result)
                return;

            const profileName =
                String(result.profileName ?? "").trim();

            if (!profileName) {

                ui.notifications.warn(
                    localize("ProfileNameRequired")
                );

                return;

            }

            const imported =
                await StorageService.importProfile(
                    importData,
                    profileName
                );

            if (!imported) {

                ui.notifications.warn(
                    localize("ProfileNameInvalid")
                );

                return;

            }

            clearSelection(app);

            debug(
                "Perfil importado:",
                profileName
            );

        });

        fileInput.click();

    });

    deleteProfileButton.addEventListener("click", async () => {

        const activeProfile = StorageService.getActiveProfileId();
        const activeProfileName = StorageService.getProfileName(activeProfile);
        const content = document.createElement("div");
        const paragraph = document.createElement("p");
        const profileName = document.createElement("strong");

        profileName.textContent = activeProfileName;

        paragraph.append(
            "¿Eliminar el perfil ",
            profileName,
            "? Todas sus reglas se perderán."
        );

        content.appendChild(paragraph);

        const confirmed =
            await foundry.applications.api.DialogV2.confirm({
                window: {
                    title: localize("DeleteProfile")
                },

                content: `<p>${format(
                    "ProfileDeleteConfirm",
                    { profile: activeProfileName }
                )}</p>`,

                yes: {
                    label: localize("Delete")
                },

                no: {
                    label: localize("Cancel")
                },

                rejectClose: false,
                modal: true
            });

        if (!confirmed)
            return;

        const deleted =
            await StorageService.deleteProfile(activeProfile);

        if (!deleted) {

            ui.notifications.warn(
                localize("ProfileDeleteForbidden")
            );

            return;

        }

        clearSelection(app);

        debug("Perfil eliminado:", activeProfile);

    });

    publicProfileButton.addEventListener("click", async () => {

        const activeProfile =
            StorageService.getActiveProfileId();

        const changed =
            await StorageService.setPublicProfile(
                activeProfile
            );

        if (!changed)
            return;

        debug(
            "Perfil público:",
            activeProfile
        );

    });

    profileSelect.addEventListener("change", async () => {

        const changed = await StorageService.setActiveProfile(
            profileSelect.value
        );

        if (!changed) {

            refreshProfileSelect(profileSelect);
            refreshProfileButtons(toolbar);
            refreshPublicProfileButton(toolbar);

            return;

        }

        clearSelection(app);

        debug(
            "Perfil activo:",
            StorageService.getActiveProfileId()
        );

    });

    refreshCuratorButton(curatorButton, app);
    refreshHiddenButton(hiddenButton, app);

    container.appendChild(toolbar);

    return toolbar;

}

function refreshPublicProfileButton(toolbar) {

    if (!toolbar)
        return;

    const button = toolbar.querySelector(
        ".cc-profile-public"
    );

    if (!button)
        return;

    const activeProfile =
        StorageService.getActiveProfileId();

    const publicProfile =
        StorageService.getPublicProfileId();

    const isPublic =
        activeProfile === publicProfile;

    button.disabled = isPublic;
    button.classList.toggle("active", isPublic);

    button.title = isPublic
        ? localize("IsPublic")
        : localize("MarkPublic");

    button.innerHTML = isPublic
        ? `
            <i class="fa-solid fa-globe"></i>
            <i class="fa-solid fa-check"></i>
        `
        : `
            <i class="fa-solid fa-globe"></i>
        `;

}

function refreshProfileButtons(toolbar) {

    if (!toolbar)
        return;

    const profiles =
        StorageService.getProfiles();

    const activeProfile =
        StorageService.getActiveProfileId();

    const publicProfile =
        StorageService.getPublicProfileId();

    const deleteButton = toolbar.querySelector(
        ".cc-profile-delete"
    );

    if (!deleteButton)
        return;

    const isOnlyProfile =
        Object.keys(profiles).length <= 1;

    const isPublicProfile =
        activeProfile === publicProfile;

    deleteButton.disabled =
        isOnlyProfile || isPublicProfile;

    deleteButton.title = isPublicProfile
        ? localize("ProfileDeleteForbidden")
        : localize("DeleteProfile");

}

function refreshProfileSelect(select) {

    if (!select)
        return;

    const profiles = StorageService.getProfiles();
    const activeProfile = StorageService.getActiveProfileId();
    const publicProfile = StorageService.getPublicProfileId();

    select.replaceChildren();

    for (const profileId of Object.keys(profiles)) {

        const option = document.createElement("option");

        const profileName =
            StorageService.getProfileName(profileId);

        option.value = profileId;

        option.textContent =
            profileId === publicProfile
                ? `${profileName} — ${localize("Public")}`
                : profileName;

        option.selected =
            profileId === activeProfile;

        select.appendChild(option);

    }

}

function createToolbar(app) {

    if (!canCurate())
        return null;

    let toolbar = app.element.querySelector(".cc-toolbar");

    if (toolbar)
        return toolbar;

    toolbar = document.createElement("div");

    toolbar.className = "cc-toolbar";

    toolbar.innerHTML = `
        <div class="cc-selection-tools">

            <span class="cc-selection-count">
                ${format("SelectedMany", { count: 0 })}
            </span>

        </div>

        <div class="cc-toolbar-buttons">

            <button type="button" class="cc-hide">
                <i class="fa-solid fa-eye-slash"></i>
                ${localize("Hide")}
            </button>

            <button type="button" class="cc-show">
                <i class="fa-solid fa-eye"></i>
                ${localize("Show")}
            </button>

        </div>
    `;

    toolbar.querySelector(".cc-hide").addEventListener("click", async () => {

        const selection = [
            ...CuratorState.getSelection(app)
        ];

        await StorageService.hideMany(selection);

        clearSelection(app);

        debug("Entradas ocultadas:", selection);

    });

    toolbar.querySelector(".cc-show").addEventListener("click", async () => {

        /*
        * Copiamos la selección porque después se vaciará.
        */
        const selection = [
            ...CuratorState.getSelection(app)
        ];

        await StorageService.showMany(selection);

        clearSelection(app);

        debug(
            "Entradas restauradas:",
            selection
        );

    });

    const container = getToolbarContainer(app);

    if (!container)
        return null;

    container.appendChild(toolbar);

    return toolbar;

}

function refreshToolbar(app) {

    const toolbar = createToolbar(app);

    if (!toolbar)
        return;

    const count = CuratorState.getSelection(app).size;

    toolbar.querySelector(".cc-selection-count").textContent =
        count === 1
            ? localize("SelectedOne")
            : format("SelectedMany", { count });

    toolbar.querySelector(".cc-hide").disabled =
        count === 0;

    toolbar.querySelector(".cc-show").disabled =
        count === 0;

    toolbar.hidden = !app._ccCuratorMode;

}

function refreshCuratorButton(button, app) {

    button.classList.toggle(
        "active",
        app._ccCuratorMode
    );

    button.innerHTML = app._ccCuratorMode
        ? `
            <i class="fa-solid fa-pen-to-square"></i>
            ${localize("CuratorActive")}
        `
        : `
            <i class="fa-solid fa-eye-slash"></i>
            ${localize("Curator")}
        `;

}

function refreshHiddenButton(button, app) {

    button.classList.toggle(
        "active",
        app._ccShowHidden
    );

    button.innerHTML = app._ccShowHidden
        ? `
            <i class="fa-solid fa-eye"></i>
            ${localize("HiddenVisible")}
        `
        : `
            <i class="fa-solid fa-eye-slash"></i>
            ${localize("Hidden")}
        `;

}