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

    clearSelection(app);

    const header = app.element.querySelector(".window-header");

    if (!header)
        return;

    if (header.querySelector(".cc-test-button"))
        return;

    app._ccShowHidden ??= false;

    const button = document.createElement("button");

    button.className = "cc-test-button";
    button.type = "button";
    button.innerHTML = `<i class="fa-solid fa-eye-slash"></i> Curador`;

    button.addEventListener("click", () => {

        app._ccCuratorMode = !app._ccCuratorMode;

        debug("Modo Curador:", app._ccCuratorMode);

        clearSelection(app);

        updateCuratorMode(app);
        refreshToolbar(app);

    });

    const hiddenButton = document.createElement("button");

    hiddenButton.className = "cc-hidden-button";
    hiddenButton.type = "button";

    refreshHiddenButton(hiddenButton, app);

    hiddenButton.addEventListener("click", () => {

        app._ccShowHidden = !app._ccShowHidden;

        refreshHiddenButton(hiddenButton, app);

        updateCuratorMode(app);

    });

    const title = header.querySelector(".window-title");

    title?.insertAdjacentElement("afterend", button);

    button.insertAdjacentElement("afterend", hiddenButton);

    // Aplicar estado inicial
    updateCuratorMode(app);
    refreshToolbar(app);

}

function updateCuratorMode(app) {

    const items = app.element.querySelectorAll(".item-list > .item");

    debug(items);

    for (const item of items) {

        updateItem(app, item);
        
    }

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

    checkbox.addEventListener("change", () => {

        const selection = CuratorState.getSelection(app);

        if (checkbox.checked)
            selection.add(uuid);
        else
            selection.delete(uuid);

        refreshToolbar(app);

        debug(selection);

    });

    const controls = item.querySelector(".item-controls");

    controls.appendChild(checkbox);

}

function clearSelection(app) {

    CuratorState.getSelection(app).clear();

    app.element
        .querySelectorAll(".cc-checkbox")
        .forEach(cb => cb.checked = false);

    const toolbar = app.element.querySelector(".cc-toolbar");

    if (toolbar)
        refreshToolbar(app);

}

function createToolbar(app) {

    let toolbar = app.element.querySelector(".cc-toolbar");

    if (toolbar)
        return toolbar;

    toolbar = document.createElement("div");

    toolbar.className = "cc-toolbar";

    toolbar.innerHTML = `
        <span class="cc-selection-count">0 seleccionados</span>

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

    const section = app.element.querySelector(".items-section");

    section?.insertAdjacentElement("beforebegin", toolbar);

    return toolbar;

}

function refreshToolbar(app) {

    const toolbar = createToolbar(app);

    const count = CuratorState.getSelection(app).size;

    toolbar.querySelector(".cc-selection-count").textContent =
        `${count} seleccionados`;

    toolbar.hidden = !app._ccCuratorMode;

}

function refreshHiddenButton(button, app) {

    if (app._ccShowHidden) {

        button.innerHTML = `
            <i class="fa-solid fa-eye"></i>
            Ocultos
        `;

    } else {

        button.innerHTML = `
            <i class="fa-solid fa-eye-slash"></i>
            Ocultos
        `;

    }

}