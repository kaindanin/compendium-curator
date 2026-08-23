import {
    TableManagerApplication
} from "../applications/table-manager-application.js";
import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";

const PATCH_FLAG =
    Symbol.for(
        "compendium-curator.table-manager-unified-tabs"
    );

function text(es, en) {
    return game.i18n.lang.startsWith("es")
        ? es
        : en;
}

function sortByName(entries) {
    return [...entries].sort((a, b) =>
        String(a?.name ?? "").localeCompare(
            String(b?.name ?? ""),
            game.i18n.lang,
            { sensitivity: "base" }
        )
    );
}

function patchPrepareContext() {
    const prototype =
        TableManagerApplication.prototype;

    if (prototype[PATCH_FLAG])
        return;

    const original =
        prototype._prepareContext;

    if (typeof original !== "function")
        return;

    prototype._prepareContext =
        async function unifiedPrepareContext(options) {
            const requestedTab =
                this._activeTab === "filters"
                    ? "filters"
                    : "content";

            this._activeTab = requestedTab;

            const context =
                await original.call(this, options);

            if (requestedTab === "filters")
                return context;

            let nestedContext;

            try {
                this._activeTab = "nested";
                nestedContext =
                    await original.call(this, options);
            }
            finally {
                this._activeTab = "content";
            }

            const profiles =
                sortByName([
                    ...(context.profiles ?? []),
                    ...(nestedContext?.profiles ?? [])
                ]);

            context.profiles = profiles;
            context.hasProfiles =
                profiles.length > 0;
            context.contentProfileCount =
                profiles.length;

            /*
             * Conservamos "content" como pestaña interna durante
             * la transición para que el editor actual cree siempre
             * una tabla básica y las acciones existentes sigan
             * funcionando sin una migración de datos prematura.
             */
            context.isContentTab = true;
            context.isNestedTab = false;
            context.isFilterGroupsTab = false;
            context.contentTabClass = "active";
            context.nestedTabClass = "";
            context.filterGroupsTabClass = "";

            return context;
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

function replaceTabContents(
    tab,
    label,
    count
) {
    if (!tab)
        return;

    const counter =
        document.createElement("span");

    counter.textContent = `(${count})`;

    tab.replaceChildren(
        document.createTextNode(label),
        document.createTextNode(" "),
        counter
    );
}

function simplifyProfileTypeLabels(
    element,
    profiles
) {
    for (
        const row
        of element.querySelectorAll(
            "[data-profile-id]"
        )
    ) {
        const profileId =
            row.dataset.profileId;
        const profile =
            profiles?.[profileId];

        if (!profile)
            continue;

        const line = row.querySelector(
            ".cc-table-manager-profile-info > span"
        );

        if (!line)
            continue;

        const raw = String(
            line.textContent ?? ""
        ).trim();
        const separatorIndex =
            raw.indexOf("·");
        const summary =
            separatorIndex >= 0
                ? raw
                    .slice(separatorIndex + 1)
                    .trim()
                : "";

        const icon =
            document.createElement("i");

        icon.className =
            profile.type === "nested"
                ? "fas fa-diagram-project"
                : "fas fa-table-list";
        icon.setAttribute(
            "aria-hidden",
            "true"
        );

        line.replaceChildren(
            icon,
            document.createTextNode(
                summary
                    ? ` ${text("Tabla", "Table")} · ${summary}`
                    : ` ${text("Tabla", "Table")}`
            )
        );
    }
}

function simplifyManagerChrome(
    application,
    element
) {
    const profiles =
        TableProfileStorageService.getProfiles();
    const filterGroups =
        TableProfileStorageService.getFilterGroups();

    const heading = element.querySelector(
        ".cc-table-manager-header h2"
    );
    const hint = element.querySelector(
        ".cc-table-manager-header p.hint"
    );

    if (heading) {
        heading.textContent =
            text("Tablas", "Tables");
    }

    if (hint) {
        hint.textContent = text(
            "Crea, organiza y administra todas tus tablas desde un único lugar.",
            "Create, organize, and manage all your tables from one place."
        );
    }

    const tablesTab = element.querySelector(
        '.tabs [data-tab="content"]'
    );
    const nestedTab = element.querySelector(
        '.tabs [data-tab="nested"]'
    );
    const groupsTab = element.querySelector(
        '.tabs [data-tab="filters"]'
    );

    nestedTab?.remove();

    replaceTabContents(
        tablesTab,
        text("Tablas", "Tables"),
        Object.keys(profiles).length
    );
    replaceTabContents(
        groupsTab,
        text("Grupos", "Groups"),
        Object.keys(filterGroups).length
    );

    if (application._activeTab !== "filters") {
        tablesTab?.classList.add("active");
        groupsTab?.classList.remove("active");
    }

    const createButton = element.querySelector(
        '[data-action="createProfile"]'
    );

    if (
        createButton &&
        application._activeTab !== "filters"
    ) {
        const label =
            text("Crear tabla", "Create table");

        createButton.title = label;
        createButton.setAttribute(
            "aria-label",
            label
        );
    }

    const rollTableButton = element.querySelector(
        '[data-action="importRollTable"]'
    );

    if (rollTableButton) {
        const label = text(
            "Crear tabla desde RollTable",
            "Create table from RollTable"
        );

        rollTableButton.title = label;
        rollTableButton.setAttribute(
            "aria-label",
            label
        );
    }

    const empty = element.querySelector(
        ".cc-table-manager-empty"
    );

    if (
        empty &&
        application._activeTab !== "filters"
    ) {
        empty.textContent = text(
            "Todavía no hay tablas.",
            "There are no tables yet."
        );
    }

    simplifyProfileTypeLabels(
        element,
        profiles
    );
}

function simplifyTableEditor(
    application,
    element
) {
    if (application.profileType !== "content")
        return;

    const title = element.querySelector(
        ".window-title"
    );
    const heading = element.querySelector(
        ".cc-table-profile-editor-header h2"
    );
    const nameLabel = element.querySelector(
        'label[for="cc-table-profile-name"]'
    );

    if (title) {
        title.textContent =
            text("Nueva tabla", "New table");
    }

    if (heading) {
        heading.textContent =
            text("Tabla", "Table");
    }

    if (nameLabel) {
        nameLabel.textContent =
            text(
                "Nombre de la tabla",
                "Table name"
            );
    }
}

export function registerTableManagerUnifiedTabs() {
    patchPrepareContext();

    Hooks.on(
        "renderTableManagerApplication",
        (application, element) => {
            if (!game.user.can("SETTINGS_MODIFY"))
                return;

            simplifyManagerChrome(
                application,
                element
            );
        }
    );

    Hooks.on(
        "renderTableProfileEditorApplication",
        (application, element) => {
            simplifyTableEditor(
                application,
                element
            );
        }
    );
}
