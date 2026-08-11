import { debug } from "../debug.js";
import { CuratorState } from "../state/curator-state.js";
import { StorageService } from "../services/storage-service.js";
import { MODULE_ID, DUPLICATE_PRIORITY_SETTING, STORAGE_CHANGED_HOOK } from "../settings.js";

const openCompendiumBrowsers = new Set();
const duplicateIdentityCache = new Map();
const duplicateTranslationCache = new Map();

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

    if (
        canCurate() &&
        app._ccDuplicatesOnly
    ) {
        scheduleDuplicateRefresh(app);
    }

}

function waitForPaint() {

    return new Promise(resolve => {

        requestAnimationFrame(() => {
            requestAnimationFrame(resolve);
        });

    });

}

function onRenderCompendiumBrowser(app) {

    app._ccShowHidden ??= false;
    app._ccCuratorMode ??= false;

    app._ccDuplicatesOnly ??= false;
    app._ccDuplicatesReady ??= false;
    app._ccDuplicateUuids ??= new Set();
    app._ccDuplicateGeneration ??= 0;
    app._ccDuplicateRefreshTimer ??= null;
    app._ccCalculatingDuplicates ??= false;
    app._ccSelectingAll ??= false;
    app._ccDuplicateOriginalOrder = new Map();

    /*
    * Un render completo puede haber cambiado los resultados
    * del navegador. Si el filtro de duplicados sigue activo,
    * invalidamos inmediatamente el cálculo anterior.
    */
    if (app._ccDuplicatesOnly) {

        app._ccDuplicateGeneration++;

        app._ccDuplicatesReady = false;
        app._ccDuplicateUuids = new Set();
        app._ccCalculatingDuplicates = true;

    }

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

    if (
        canCurate() &&
        app._ccDuplicatesOnly
    ) {

        refreshDuplicatesCheckbox(app);
        refreshMasterCheckbox(app);
        refreshLoadingIndicator(app);

        scheduleDuplicateRefresh(app);

    }

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

            if (app._ccDuplicatesOnly)
                scheduleDuplicateRefresh(app);

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

    item.classList.toggle(
        "cc-hidden-entry",
        hidden
    );

    const hiddenByProfile =
        hidden && !app._ccShowHidden;

    const hiddenByDuplicates =
        app._ccDuplicatesOnly &&
        app._ccDuplicatesReady &&
        !app._ccDuplicateUuids.has(uuid);

    item.hidden =
        hiddenByProfile ||
        hiddenByDuplicates;

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

function normalizeDuplicateName(name) {

    return String(name ?? "")
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("en");

}

async function getDuplicateIdentity(uuid) {

    if (
        duplicateIdentityCache.has(uuid) &&
        duplicateTranslationCache.has(uuid)
    ) {
        return duplicateIdentityCache.get(uuid);
    }

    const document = await fromUuid(uuid);

    if (!document) {

        duplicateIdentityCache.set(uuid, null);

        return null;

    }

    if (!document) {

        duplicateIdentityCache.set(uuid, null);
        duplicateTranslationCache.set(uuid, false);

        return null;

    }

    const originalName =
        document.flags?.babele?.originalName ??
        document.name;

    const hasTranslation =
        Boolean(document.flags?.babele?.originalName) &&
        normalizeDuplicateName(document.name) !==
            normalizeDuplicateName(originalName);

    duplicateTranslationCache.set(
        uuid,
        hasTranslation
    );

    const normalizedName =
        normalizeDuplicateName(originalName);

    if (!normalizedName) {

        duplicateIdentityCache.set(uuid, null);

        return null;

    }

    /*
     * El tipo evita considerar duplicados documentos
     * distintos que casualmente tengan el mismo nombre.
     */
    const identity = [
        document.documentName,
        document.type ?? "",
        normalizedName
    ].join("|");

    duplicateIdentityCache.set(uuid, identity);

    return identity;

}

async function calculateDuplicateUuids(app) {

    const items = Array.from(
        app.element.querySelectorAll(
            ".item-list > .item[data-uuid]"
        )
    );

    /*
     * Solo participan en el cálculo las entradas que el
     * usuario podría ver según el estado de "Mostrar ocultos".
     */
    const candidates = items.filter(item => {

        if (app._ccShowHidden)
            return true;

        return !StorageService.isHidden(
            item.dataset.uuid
        );

    });

    const groups = new Map();

    /*
     * Procesamos por bloques para no lanzar cientos o miles
     * de lecturas de compendio simultáneamente.
     */
    const batchSize = 50;

    for (
        let index = 0;
        index < candidates.length;
        index += batchSize
    ) {

        const batch =
            candidates.slice(
                index,
                index + batchSize
            );

        const identities =
            await Promise.all(
                batch.map(async item => ({
                    uuid: item.dataset.uuid,
                    identity:
                        await getDuplicateIdentity(
                            item.dataset.uuid
                        )
                }))
            );

        for (const { uuid, identity } of identities) {

            if (!identity)
                continue;

            let group = groups.get(identity);

            if (!group) {

                group = [];
                groups.set(identity, group);

            }

            group.push(uuid);

        }

    }

    const duplicateUuids = new Set();

    for (const group of groups.values()) {

        if (group.length < 2)
            continue;

        for (const uuid of group)
            duplicateUuids.add(uuid);

    }

    return duplicateUuids;

}

function rememberDuplicateItemOrder(app) {

    const order =
        app._ccDuplicateOriginalOrder ??= new Map();

    const lists =
        app.element.querySelectorAll(".item-list");

    for (const list of lists) {

        const items = Array.from(
            list.querySelectorAll(
                ":scope > .item[data-uuid]"
            )
        );

        for (
            let index = 0;
            index < items.length;
            index++
        ) {

            const uuid = items[index].dataset.uuid;

            if (!order.has(uuid))
                order.set(uuid, index);

        }

    }

}

function restoreDuplicateItemOrder(
    app,
    clear = false
) {

    const order =
        app._ccDuplicateOriginalOrder;

    if (!order?.size) {

        if (clear)
            app._ccDuplicateOriginalOrder = new Map();

        return;

    }

    app._ccResultsObserver?.disconnect();

    try {

        const lists =
            app.element.querySelectorAll(".item-list");

        for (const list of lists) {

            const items = Array.from(
                list.querySelectorAll(
                    ":scope > .item[data-uuid]"
                )
            );

            items.sort((a, b) => {

                const aOrder =
                    order.get(a.dataset.uuid);

                const bOrder =
                    order.get(b.dataset.uuid);

                if (
                    aOrder === undefined &&
                    bOrder === undefined
                ) {
                    return 0;
                }

                if (aOrder === undefined)
                    return 1;

                if (bOrder === undefined)
                    return -1;

                return aOrder - bOrder;

            });

            for (const item of items)
                list.appendChild(item);

        }

    }
    finally {

        if (clear)
            app._ccDuplicateOriginalOrder = new Map();

        observeCompendiumResults(app);

    }

}

function groupDuplicateItems(app) {

    if (
        !app._ccDuplicatesOnly ||
        !app._ccDuplicatesReady
    ) {
        return;
    }

    rememberDuplicateItemOrder(app);

    const lists =
        app.element.querySelectorAll(".item-list");

    app._ccResultsObserver?.disconnect();

    try {

        for (const list of lists) {

            /*
             * En este punto la lista está todavía en el
             * orden alfabético original de Foundry.
             */
            const items = Array.from(
                list.querySelectorAll(
                    ":scope > .item[data-uuid]"
                )
            );

            const groups = new Map();

            for (const item of items) {

                const uuid = item.dataset.uuid;

                if (!app._ccDuplicateUuids.has(uuid))
                    continue;

                const identity =
                    duplicateIdentityCache.get(uuid);

                if (!identity)
                    continue;

                let group = groups.get(identity);

                if (!group) {

                    group = [];
                    groups.set(identity, group);

                }

                group.push(item);

            }

            /*
             * Relaciona cada entrada duplicada con
             * el grupo al que pertenece.
             */
            const itemGroups = new Map();
            const groupData = new Map();

            for (
                const [identity, group]
                of groups
            ) {

                if (group.length < 2)
                    continue;

                /*
                 * Las traducciones van primero.
                 * Dentro de cada bloque conservamos
                 * el orden alfabético de Foundry.
                 */
                const translated =
                    group.filter(item =>
                        duplicateTranslationCache.get(
                            item.dataset.uuid
                        ) === true
                    );

                const untranslated =
                    group.filter(item =>
                        duplicateTranslationCache.get(
                            item.dataset.uuid
                        ) !== true
                    );

                const orderedGroup = [
                    ...translated,
                    ...untranslated
                ];

                /*
                 * Si existe alguna traducción, la primera
                 * traducción en el orden alfabético normal
                 * determina dónde aparecerá todo el grupo.
                 *
                 * Si no existe ninguna, usamos la primera
                 * copia original.
                 */
                const anchor =
                    translated[0] ??
                    group[0];

                groupData.set(identity, {
                    anchor,
                    items: orderedGroup
                });

                for (const item of group)
                    itemGroups.set(item, identity);

            }

            const finalOrder = [];
            const emittedGroups = new Set();

            /*
             * Reconstruimos el orden general.
             *
             * Las copias que aparecían antes que la
             * traducción se omiten temporalmente.
             * Cuando alcanzamos la traducción principal,
             * insertamos todo el grupo junto.
             */
            for (const item of items) {

                const identity =
                    itemGroups.get(item);

                if (!identity) {

                    finalOrder.push(item);

                    continue;

                }

                if (emittedGroups.has(identity))
                    continue;

                const data =
                    groupData.get(identity);

                if (!data)
                    continue;

                if (item !== data.anchor)
                    continue;

                finalOrder.push(
                    ...data.items
                );

                emittedGroups.add(identity);

            }

            for (const item of finalOrder)
                list.appendChild(item);

        }

    }
    finally {

        observeCompendiumResults(app);

    }

}

async function refreshDuplicateFilter(app) {

    if (!app._ccDuplicatesOnly)
        return false;

    restoreDuplicateItemOrder(app);

    const generation =
        (app._ccDuplicateGeneration ?? 0) + 1;

    app._ccDuplicateGeneration = generation;
    app._ccCalculatingDuplicates = true;
    app._ccDuplicatesReady = false;
    app._ccDuplicateUuids = new Set();

    updateCuratorMode(app);
    refreshDuplicatesCheckbox(app);
    refreshMasterCheckbox(app);
    refreshLoadingIndicator(app);

    await waitForPaint();

    const loaded =
        await ensureAllResultsLoaded(app);

    if (
        !loaded ||
        !app._ccDuplicatesOnly ||
        app._ccDuplicateGeneration !== generation
    ) {
        return false;
    }

    const duplicateUuids =
        await calculateDuplicateUuids(app);

    if (
        !app._ccDuplicatesOnly ||
        app._ccDuplicateGeneration !== generation
    ) {
        return false;
    }

    app._ccDuplicateUuids = duplicateUuids;
    app._ccDuplicatesReady = true;
    app._ccCalculatingDuplicates = false;

    clearSelection(app);

    updateCuratorMode(app);
    groupDuplicateItems(app);
    refreshDuplicatesCheckbox(app);
    refreshDuplicateActions(app);
    refreshToolbar(app);
    refreshLoadingIndicator(app);

    return true;

}

function scheduleDuplicateRefresh(app) {

    clearTimeout(
        app._ccDuplicateRefreshTimer
    );

    if (!app._ccDuplicatesOnly)
        return;

    app._ccDuplicateRefreshTimer =
        setTimeout(() => {

            void refreshDuplicateFilter(app);

        }, 100);

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
        refreshDuplicatesCheckbox(app);
        refreshLoadingIndicator(app);

        /*
        * Permitimos que el navegador pinte el estado
        * de carga antes de empezar a cargar lotes.
        */
        await new Promise(resolve =>
            requestAnimationFrame(resolve)
        );

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
            refreshDuplicatesCheckbox(app);
            refreshLoadingIndicator(app);

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

        app._ccSelectingAll = true;

        refreshMasterCheckbox(app);
        refreshDuplicatesCheckbox(app);
        refreshLoadingIndicator(app);

        /*
        * Garantiza que el usuario vea el spinner y los
        * controles deshabilitados antes del trabajo pesado.
        */
        await waitForPaint();

        try {

            if (selectAll) {

                const loaded =
                    await ensureAllResultsLoaded(app);

                if (!loaded) {

                    checkbox.checked = false;

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

        }
        finally {

            app._ccSelectingAll = false;

            refreshMasterCheckbox(app);
            refreshDuplicatesCheckbox(app);
            refreshLoadingIndicator(app);

        }

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

    const busy =
        app._ccLoadingAllResults ||
        app._ccCalculatingDuplicates ||
        app._ccSelectingAll;

    checkbox.indeterminate = false;

    if (busy) {

        checkbox.disabled = true;

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

function getDuplicateSourceInfo(uuid) {

    const parts =
        String(uuid ?? "").split(".");

    if (
        parts[0] !== "Compendium" ||
        parts.length < 4
    ) {
        return null;
    }

    const packageId = parts[1];
    const packId = `${parts[1]}.${parts[2]}`;

    const pack =
        game.packs.get(packId);

    let title;

    /*
     * Los compendios incluidos directamente en
     * D&D5e corresponden principalmente al contenido SRD.
     */
    if (packageId === game.system.id) {

        const packName = parts[2];

        const systemPack =
            (game.system.toObject().packs ?? [])
                .find(pack =>
                    pack.name === packName
                );

        const sourceBook =
            systemPack?.flags?.dnd5e?.sourceBook;

        if (sourceBook === "SRD 5.1") {

            return {
                id: `${game.system.id}:srd51`,
                title: "SRD 5.1"
            };

        }

        if (sourceBook === "SRD 5.2") {

            return {
                id: `${game.system.id}:srd52`,
                title: "SRD 5.2"
            };

        }

        title = game.system.title;

    }
    else {

        title =
            game.modules.get(packageId)?.title ??
            pack?.title ??
            packageId;

    }

    return {
        id: packageId,
        title
    };

}

function getDuplicatePrioritySources() {

    const sources = new Map();

    /*
     * Sistema actual.
     * En D&D5e representa los compendios incluidos
     * directamente con el sistema.
     */
    const systemPacks =
        game.system.toObject().packs ?? [];

    const srdVersions = new Set(
        systemPacks
            .map(pack =>
                pack.flags?.dnd5e?.sourceBook
            )
            .filter(Boolean)
    );

    if (srdVersions.has("SRD 5.1")) {

        sources.set(
            `${game.system.id}:srd51`,
            {
                id: `${game.system.id}:srd51`,
                title: "SRD 5.1"
            }
        );

    }

    if (srdVersions.has("SRD 5.2")) {

        sources.set(
            `${game.system.id}:srd52`,
            {
                id: `${game.system.id}:srd52`,
                title: "SRD 5.2"
            }
        );

    }

    /*
     * Todos los módulos instalados/disponibles que
     * declaran al menos un compendio.
     *
     * No depende de qué categoría o filtro esté
     * abierto actualmente en el navegador.
     */
    for (const module of game.modules.values()) {

        const moduleData =
            module.toObject();

        const packs =
            moduleData.packs ?? [];

        if (packs.length === 0)
            continue;

        sources.set(
            module.id,
            {
                id: module.id,
                title: module.title
            }
        );

    }

    const setting =
        game.settings.get(
            MODULE_ID,
            DUPLICATE_PRIORITY_SETTING
        );

    const savedPriority =
        Array.isArray(setting?.sources)
            ? setting.sources
            : [];

    const ordered = [];

    /*
     * Primero respetamos la prioridad ya guardada.
     */
    for (const sourceId of savedPriority) {

        const source =
            sources.get(sourceId);

        if (!source)
            continue;

        ordered.push(source);
        sources.delete(sourceId);

    }

    /*
     * Los módulos nuevos que todavía no estén
     * guardados se añaden al final alfabéticamente.
     */
    const remaining =
        Array.from(sources.values())
            .sort((a, b) =>
                a.title.localeCompare(
                    b.title,
                    game.i18n.lang,
                    {
                        sensitivity: "base"
                    }
                )
            );

    return [
        ...ordered,
        ...remaining
    ];

}

async function openDuplicatePriorityDialog(app) {

    if (
        !app._ccDuplicatesOnly ||
        !app._ccDuplicatesReady
    ) {
        return;
    }

    const sources =
        getDuplicatePrioritySources();

    if (sources.length === 0)
        return;

    const content =
    document.createElement("div");

    const wrapper =
        document.createElement("div");

    wrapper.className =
        "cc-duplicate-priority-dialog";

    const hint =
        document.createElement("p");

    hint.textContent =
        localize("DuplicatePriorityHint");

    wrapper.appendChild(hint);

    const list =
        document.createElement("div");

    list.className =
        "cc-duplicate-priority-list";

    for (const source of sources) {

        const row =
            document.createElement("div");

        row.className =
            "cc-duplicate-priority-source";

        row.dataset.sourceId =
            source.id;

        const position =
            document.createElement("span");

        position.className =
            "cc-duplicate-priority-position";

        const name =
            document.createElement("span");

        name.className =
            "cc-duplicate-priority-name";

        name.textContent =
            source.title;

        const controls =
            document.createElement("span");

        controls.className =
            "cc-duplicate-priority-controls";

        const up =
            document.createElement("button");

        up.type = "button";
        up.className =
            "cc-duplicate-priority-up";

        up.title =
            localize("MoveUp");

        up.innerHTML =
            '<i class="fa-solid fa-arrow-up"></i>';

        const down =
            document.createElement("button");

        down.type = "button";
        down.className =
            "cc-duplicate-priority-down";

        down.title =
            localize("MoveDown");

        down.innerHTML =
            '<i class="fa-solid fa-arrow-down"></i>';

        controls.append(
            up,
            down
        );

        row.append(
            position,
            name,
            controls
        );

        list.appendChild(row);

    }

    wrapper.appendChild(list);
    content.appendChild(wrapper);

    const result =
        await foundry.applications.api.DialogV2.wait({

            window: {
                title:
                    localize(
                        "DuplicatePriorityTitle"
                    )
            },

            content,

            buttons: [
                {
                    action: "save",
                    label: localize("Save"),
                    icon:
                        "fa-solid fa-floppy-disk",
                    default: true,

                    callback: (
                        _event,
                        _button,
                        dialog
                    ) => {

                        return Array.from(
                            dialog.window.content
                                .querySelectorAll(
                                    ".cc-duplicate-priority-source"
                                )
                        ).map(row =>
                            row.dataset.sourceId
                        );

                    }
                },
                {
                    action: "cancel",
                    label: localize("Cancel"),
                    icon: "fa-solid fa-xmark"
                }
            ],

            render: (_event, dialog) => {

                const dialogList =
                    dialog.window.content
                        .querySelector(
                            ".cc-duplicate-priority-list"
                        );

                if (!dialogList)
                    return;

                const refreshRows = () => {

                    const rows =
                        Array.from(
                            dialogList.children
                        );

                    for (
                        let index = 0;
                        index < rows.length;
                        index++
                    ) {

                        const row = rows[index];

                        row.querySelector(
                            ".cc-duplicate-priority-position"
                        ).textContent =
                            `${index + 1}.`;

                        row.querySelector(
                            ".cc-duplicate-priority-up"
                        ).disabled =
                            index === 0;

                        row.querySelector(
                            ".cc-duplicate-priority-down"
                        ).disabled =
                            index ===
                            rows.length - 1;

                    }

                };

                dialogList.addEventListener(
                    "click",
                    event => {

                        const button =
                            event.target.closest(
                                "button"
                            );

                        if (!button)
                            return;

                        const row =
                            button.closest(
                                ".cc-duplicate-priority-source"
                            );

                        if (!row)
                            return;

                        if (
                            button.classList.contains(
                                "cc-duplicate-priority-up"
                            )
                        ) {

                            const previous =
                                row.previousElementSibling;

                            if (previous)
                                dialogList.insertBefore(
                                    row,
                                    previous
                                );

                        }
                        else if (
                            button.classList.contains(
                                "cc-duplicate-priority-down"
                            )
                        ) {

                            const next =
                                row.nextElementSibling;

                            if (next)
                                dialogList.insertBefore(
                                    next,
                                    row
                                );

                        }

                        refreshRows();

                    }
                );

                refreshRows();

            },

            rejectClose: false,
            modal: true

        });

    if (!Array.isArray(result))
        return;

    await game.settings.set(
        MODULE_ID,
        DUPLICATE_PRIORITY_SETTING,
        {
            sources: result
        }
    );

    debug(
        "Prioridad de duplicados guardada:",
        result
    );

}

async function applyDuplicatePriority(app) {

    if (
        !app._ccDuplicatesOnly ||
        !app._ccDuplicatesReady
    ) {
        return;
    }

    app._ccSelectingAll = true;

    refreshMasterCheckbox(app);
    refreshDuplicatesCheckbox(app);
    refreshDuplicateActions(app);
    refreshLoadingIndicator(app);

    await waitForPaint();

    try {

        const priority =
            getDuplicatePrioritySources();

        const priorityIndex =
            new Map(
                priority.map(
                    (source, index) => [
                        source.id,
                        index
                    ]
                )
            );

        const items = Array.from(
            app.element.querySelectorAll(
                ".item-list > .item[data-uuid]"
            )
        ).filter(item =>
            app._ccDuplicateUuids.has(
                item.dataset.uuid
            )
        );

        const groups = new Map();

        for (const item of items) {

            const uuid =
                item.dataset.uuid;

            const identity =
                duplicateIdentityCache.get(uuid);

            if (!identity)
                continue;

            let group =
                groups.get(identity);

            if (!group) {

                group = [];
                groups.set(identity, group);

            }

            group.push(item);

        }

        const selection =
            CuratorState.getSelection(app);

        /*
         * Aplicar prioridad sustituye la selección
         * actual. Después el usuario puede corregirla
         * manualmente.
         */
        selection.clear();

        for (const group of groups.values()) {

            if (group.length < 2)
                continue;

            let keepItem = null;
            let keepPriority = Infinity;

            for (const item of group) {

                const source =
                    getDuplicateSourceInfo(
                        item.dataset.uuid
                    );

                const sourcePriority =
                    priorityIndex.get(
                        source?.id
                    ) ?? Infinity;

                /*
                 * En caso de empate conservamos la
                 * primera entrada del grupo.
                 */
                if (
                    keepItem === null ||
                    sourcePriority < keepPriority
                ) {

                    keepItem = item;
                    keepPriority =
                        sourcePriority;

                }

            }

            for (const item of group) {

                if (item === keepItem)
                    continue;

                selection.add(
                    item.dataset.uuid
                );

            }

        }

        /*
         * Necesitamos mostrar los checkboxes para
         * que el usuario pueda revisar el resultado.
         */
        if (!app._ccCuratorMode)
            app._ccCuratorMode = true;

        const curatorButton =
            app.element.querySelector(
                ".cc-curator-button"
            );

        if (curatorButton)
            refreshCuratorButton(
                curatorButton,
                app
            );

        updateCuratorMode(app);
        refreshToolbar(app);

        debug(
            "Prioridad aplicada. Seleccionados:",
            [...selection]
        );

    }
    finally {

        app._ccSelectingAll = false;

        refreshMasterCheckbox(app);
        refreshDuplicatesCheckbox(app);
        refreshDuplicateActions(app);
        refreshLoadingIndicator(app);

    }

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
        refreshDuplicatesCheckbox(app);
        refreshDuplicateActions(app);

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

        <label class="cc-duplicates-filter">
            <input
                type="checkbox"
                class="cc-duplicates-checkbox"
            >
            <span>${localize("DuplicatesOnly")}</span>
        </label>

        <button
            type="button"
            class="cc-duplicate-priority"
            hidden
        >
            <i class="fa-solid fa-arrow-down-wide-short"></i>
            ${localize("DuplicatePriority")}
        </button>

        <button
            type="button"
            class="cc-duplicate-apply-priority"
            hidden
        >
            <i class="fa-solid fa-check-double"></i>
            ${localize("ApplyDuplicatePriority")}
        </button>

        <span class="cc-loading-indicator" hidden>
            <i class="fa-solid fa-spinner fa-spin"></i>
            <span class="cc-loading-text"></span>
        </span>
    `;

    const curatorButton = toolbar.querySelector(".cc-curator-button");
    const hiddenButton = toolbar.querySelector(".cc-hidden-button");
    const duplicatesCheckbox = toolbar.querySelector(".cc-duplicates-checkbox");
    const duplicatePriorityButton = toolbar.querySelector(".cc-duplicate-priority");
    const duplicateApplyPriorityButton = toolbar.querySelector(".cc-duplicate-apply-priority");
    const publicProfileButton = toolbar.querySelector(".cc-profile-public");

    duplicatePriorityButton.addEventListener(
        "click",
        () => {
            void openDuplicatePriorityDialog(app);
        }
    );

    duplicateApplyPriorityButton.addEventListener(
        "click",
        () => {
            void applyDuplicatePriority(app);
        }
    );

    curatorButton.addEventListener("click", () => {

        app._ccCuratorMode = !app._ccCuratorMode;

        debug("Modo Curador:", app._ccCuratorMode);

        clearSelection(app);

        refreshCuratorButton(curatorButton, app);
        updateCuratorMode(app);
        refreshToolbar(app);

    });

    hiddenButton.addEventListener("click", async () => {

        app._ccShowHidden = !app._ccShowHidden;

        /*
        * Al cambiar la visibilidad, limpiamos la selección
        * para evitar mantener entradas seleccionadas que ya
        * no aparecen en pantalla.
        */
        clearSelection(app);

        refreshHiddenButton(hiddenButton, app);

        if (app._ccDuplicatesOnly) {

            await refreshDuplicateFilter(app);

        }
        else {

            updateCuratorMode(app);
            refreshToolbar(app);

        }

    });

    duplicatesCheckbox.addEventListener(
        "change",
        async () => {

            app._ccDuplicatesOnly =
                duplicatesCheckbox.checked;

            clearSelection(app);

            if (!app._ccDuplicatesOnly) {

                /*
                * Invalida cualquier cálculo que pudiera
                * seguir ejecutándose.
                */
                app._ccDuplicateGeneration++;

                app._ccDuplicatesReady = false;
                app._ccDuplicateUuids = new Set();
                app._ccCalculatingDuplicates = false;

                restoreDuplicateItemOrder(app, true);
                updateCuratorMode(app);
                refreshDuplicatesCheckbox(app);
                refreshDuplicateActions(app);
                refreshToolbar(app);
                refreshLoadingIndicator(app);

                return;

            }

            await refreshDuplicateFilter(app);

        }
    );

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
    refreshDuplicatesCheckbox(app);
    refreshDuplicateActions(app);

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

function refreshDuplicatesCheckbox(app) {

    const checkbox =
        app.element.querySelector(
            ".cc-duplicates-checkbox"
        );

    if (!checkbox)
        return;

    checkbox.checked =
        app._ccDuplicatesOnly;

    const busy =
        app._ccLoadingAllResults ||
        app._ccCalculatingDuplicates ||
        app._ccSelectingAll;

    checkbox.indeterminate = false;
    checkbox.disabled = busy;

    checkbox
        .closest(".cc-duplicates-filter")
        ?.classList.toggle(
            "disabled",
            busy
        );

}

function refreshDuplicateActions(app) {

    const priorityButton =
        app.element.querySelector(
            ".cc-duplicate-priority"
        );

    const applyButton =
        app.element.querySelector(
            ".cc-duplicate-apply-priority"
        );

    if (!priorityButton || !applyButton)
        return;

    const visible =
        app._ccDuplicatesOnly;

    priorityButton.hidden = !visible;
    applyButton.hidden = !visible;

    const busy =
        app._ccLoadingAllResults ||
        app._ccCalculatingDuplicates ||
        app._ccSelectingAll;

    priorityButton.disabled =
        busy || !app._ccDuplicatesReady;

    applyButton.disabled =
        busy || !app._ccDuplicatesReady;

}

function refreshLoadingIndicator(app) {

    const indicator =
        app.element.querySelector(
            ".cc-loading-indicator"
        );

    if (!indicator)
        return;

    const text =
        indicator.querySelector(
            ".cc-loading-text"
        );

    let key = null;

    if (app._ccLoadingAllResults)
        key = "LoadingResults";
    else if (app._ccCalculatingDuplicates)
        key = "CalculatingDuplicates";
    else if (app._ccSelectingAll)
        key = "UpdatingSelection";

    indicator.hidden = !key;

    if (key)
        text.textContent = localize(key);

}
