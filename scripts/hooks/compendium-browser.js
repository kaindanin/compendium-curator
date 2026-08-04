import { debug } from "../debug.js";
import { CuratorState } from "../state/curator-state.js";
import { StorageService } from "../services/storage-service.js";

export function registerCompendiumBrowserHooks() {

    Hooks.on("renderApplicationV2", (app) => {

        if (app.constructor.name !== "CompendiumBrowser")
            return;

        debug("Compendium Browser renderizado");

        onRenderCompendiumBrowser(app);

    });

}

function onRenderCompendiumBrowser(app) {

    app._ccShowHidden ??= false;
    app._ccCuratorMode ??= false;

    clearSelection(app);

    observeCompendiumResults(app);

    createModeToolbar(app);

    updateCuratorMode(app);
    refreshToolbar(app);

}

function observeCompendiumResults(app) {

    /*
     * Evita crear varios observadores sobre la misma aplicación.
     */
    app._ccResultsObserver?.disconnect();

    const observer = new MutationObserver(mutations => {

        for (const mutation of mutations) {

            for (const node of mutation.addedNodes) {

                if (!(node instanceof Element))
                    continue;

                /*
                 * La entrada añadida puede ser directamente un <li>.
                 */
                if (node.matches(".item-list > .item[data-uuid]"))
                    updateItem(app, node);

                /*
                 * O puede haberse añadido una lista completa que contenga
                 * varias entradas.
                 */
                const items = node.querySelectorAll(
                    ".item-list > .item[data-uuid]"
                );

                for (const item of items)
                    updateItem(app, item);

            }

        }

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

function updateItem(app, item) {

    item.querySelector(".cc-checkbox")?.remove();

    const uuid = item.dataset.uuid;
    const hidden = StorageService.isHidden(uuid);

    item.classList.toggle("cc-hidden-entry", hidden);
    item.hidden = hidden && !app._ccShowHidden;

    if (!app._ccCuratorMode)
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

    let toolbar = app.element.querySelector(".cc-mode-toolbar");

    if (toolbar)
        return toolbar;

    const container = getToolbarContainer(app);

    if (!container)
        return null;

    toolbar = document.createElement("div");
    toolbar.className = "cc-mode-toolbar";

    toolbar.innerHTML = `
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

        refreshHiddenButton(hiddenButton, app);
        updateCuratorMode(app);

    });

    refreshCuratorButton(curatorButton, app);
    refreshHiddenButton(hiddenButton, app);

    container.appendChild(toolbar);

    return toolbar;

}

function createToolbar(app) {

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

        const selection = CuratorState.getSelection(app);

        for (const uuid of selection)
            await StorageService.hide(uuid);

        clearSelection(app);
        updateCuratorMode(app);

        debug(game.settings.get("compendium-curator", "storage"));

    });

    toolbar.querySelector(".cc-show").addEventListener("click", async () => {

        /*
        * Copiamos la selección porque después se vaciará.
        */
        const selection = [
            ...CuratorState.getSelection(app)
        ];

        for (const uuid of selection)
            await StorageService.show(uuid);

        clearSelection(app);
        updateCuratorMode(app);

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