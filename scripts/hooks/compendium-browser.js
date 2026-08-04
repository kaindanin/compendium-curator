import { debug } from "../debug.js";
import { CuratorState } from "../state/curator-state.js";
import { StorageService } from "../services/storage-service.js";
import { STORAGE_CHANGED_HOOK } from "../settings.js";

const openCompendiumBrowsers = new Set();

function canCurate() {

    return game.user.can("SETTINGS_MODIFY");

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

    checkbox.title = "Seleccionar todas las entradas visibles";
    checkbox.checked = false;

    checkbox.addEventListener("change", () => {

        const selection =
            CuratorState.getSelection(app);

        const items = getVisibleItems(app);

        for (const item of items) {

            const uuid = item.dataset.uuid;

            const itemCheckbox =
                item.querySelector(".cc-checkbox");

            itemCheckbox.checked = checkbox.checked;

            if (checkbox.checked)
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

            <span>Perfil</span>

            <select class="cc-profile-select"></select>

            <button
                type="button"
                class="cc-profile-create"
                title="Crear perfil"
            >
                <i class="fa-solid fa-plus"></i>
            </button>

            <button
                type="button"
                class="cc-profile-public"
                title="Marcar este perfil como público"
            >
                <i class="fa-solid fa-globe"></i>
            </button>

            <button
                type="button"
                class="cc-profile-delete"
                title="Eliminar perfil"
            >
                <i class="fa-solid fa-trash"></i>
            </button>

        </div>

        <button type="button" class="cc-curator-button">
            <i class="fa-solid fa-eye-slash"></i>
            Curador
        </button>

        <button type="button" class="cc-hidden-button">
            <i class="fa-solid fa-eye-slash"></i>
            Ocultos
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
                    title: "Crear perfil"
                },

                content: `
                    <div class="form-group">
                        <label>Nombre del perfil</label>

                        <input
                            type="text"
                            name="profileName"
                            autocomplete="off"
                            autofocus
                        >
                    </div>
                `,

                ok: {
                    label: "Crear"
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
                "Debes introducir un nombre para el perfil."
            );

            return;

        }

        const created =
            await StorageService.createProfile(profileName);

        if (!created) {

            ui.notifications.warn(
                "El nombre no es válido o ya existe un perfil con ese nombre."
            );

            return;

        }

        clearSelection(app);

        debug("Perfil creado:", profileName);

    });

    deleteProfileButton.addEventListener("click", async () => {

        const activeProfile =
            StorageService.getActiveProfileId();

        const content = document.createElement("div");
        const paragraph = document.createElement("p");
        const profileName = document.createElement("strong");

        profileName.textContent = activeProfile;

        paragraph.append(
            "¿Eliminar el perfil ",
            profileName,
            "? Todas sus reglas se perderán."
        );

        content.appendChild(paragraph);

        const confirmed =
            await foundry.applications.api.DialogV2.confirm({
                window: {
                    title: "Eliminar perfil"
                },

                content,

                yes: {
                    label: "Eliminar"
                },

                no: {
                    label: "Cancelar"
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
                "No se puede eliminar el último perfil ni el perfil público."
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
        ? "Este es el perfil público"
        : "Marcar este perfil como público";

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
        ? "No se puede eliminar el perfil público"
        : "Eliminar perfil";

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

        option.value = profileId;
        option.textContent =
            profileId === StorageService.getPublicProfileId()
                ? `${profileId} — Público`
                : profileId;
        option.selected = profileId === activeProfile;

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
                0 seleccionados
            </span>

        </div>

        <div class="cc-toolbar-buttons">

            <button type="button" class="cc-hide">
                <i class="fa-solid fa-eye-slash"></i>
                Ocultar
            </button>

            <button type="button" class="cc-show">
                <i class="fa-solid fa-eye"></i>
                Mostrar
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
        `${count} seleccionado${count === 1 ? "" : "s"}`;

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

    button.setAttribute(
        "aria-pressed",
        String(app._ccCuratorMode)
    );

    button.innerHTML = app._ccCuratorMode
        ? `
            <i class="fa-solid fa-pen-to-square"></i>
            Curador activo
        `
        : `
            <i class="fa-solid fa-eye-slash"></i>
            Curador
        `;

}

function refreshHiddenButton(button, app) {

    button.classList.toggle(
        "active",
        app._ccShowHidden
    );

    button.setAttribute(
        "aria-pressed",
        String(app._ccShowHidden)
    );

    button.innerHTML = app._ccShowHidden
        ? `
            <i class="fa-solid fa-eye"></i>
            Ocultos visibles
        `
        : `
            <i class="fa-solid fa-eye-slash"></i>
            Ocultos
        `;

}