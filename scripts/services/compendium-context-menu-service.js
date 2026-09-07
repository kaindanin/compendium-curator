const BROWSER_ENTRY_SELECTOR = ".item-list > .item[data-uuid]";


function findPackEntry(uuid, packs) {

    if (typeof uuid !== "string" || !uuid.startsWith("Compendium."))
        return null;

    for (const pack of packs ?? []) {

        const prefix = `Compendium.${pack.collection}.`;

        if (!uuid.startsWith(prefix))
            continue;

        const indexed = pack.index?.find?.(
            entry => entry.uuid === uuid
        );
        const remainder = uuid.slice(prefix.length);
        const entryId = indexed?._id ??
            remainder.split(".").filter(Boolean).at(-1);

        return entryId
            ? { pack, entryId }
            : null;

    }

    return null;

}


function createCompendiumApplication(pack) {

    const ApplicationClass = pack?.applicationClass ??
        foundry.applications.sidebar.apps.Compendium;

    return new ApplicationClass({ collection: pack });

}


function createOfficialContextMenu(application, pack) {

    const container = document.createElement("div");
    const menuItems = application._getEntryContextOptions();
    const hookName = `get${pack.documentName}ContextOptions`;

    Hooks.callAll(hookName, application, menuItems);

    const ContextMenuClass =
        foundry.applications.ux.ContextMenu.implementation;

    return new ContextMenuClass(
        container,
        BROWSER_ENTRY_SELECTOR,
        menuItems,
        {
            fixed: true,
            jQuery: false,
            relative: "cursor"
        }
    );

}


export class CompendiumBrowserContextMenuController {
    constructor(app, { packs = game.packs } = {}) {

        this.app = app;
        this.packs = packs;
        this.element = null;
        this.applications = new Map();
        this._onContextMenu = this._onContextMenu.bind(this);

    }


    bind(element) {

        if (!element || this.element === element)
            return;

        this.element?.removeEventListener(
            "contextmenu",
            this._onContextMenu
        );

        this.element = element;
        this.element.addEventListener(
            "contextmenu",
            this._onContextMenu
        );

    }


    dispose() {

        this.element?.removeEventListener(
            "contextmenu",
            this._onContextMenu
        );
        this.element = null;
        this.applications.clear();

    }


    _applicationFor(pack) {

        let application = this.applications.get(pack.collection);

        if (!application) {
            application = createCompendiumApplication(pack);
            this.applications.set(pack.collection, application);
        }

        return application;

    }


    async _onContextMenu(event) {

        const entry = event.target.closest?.(
            BROWSER_ENTRY_SELECTOR
        );

        if (!entry || !this.element?.contains(entry))
            return;

        const resolved = findPackEntry(
            entry.dataset.uuid,
            this.packs
        );

        if (!resolved)
            return;

        event.preventDefault();
        event.stopPropagation();

        entry.dataset.entryId = resolved.entryId;

        const application = this._applicationFor(resolved.pack);
        const menu = createOfficialContextMenu(
            application,
            resolved.pack
        );

        await menu?._onActivate(event);

    }
}


export {
    BROWSER_ENTRY_SELECTOR,
    createCompendiumApplication,
    createOfficialContextMenu,
    findPackEntry
};
