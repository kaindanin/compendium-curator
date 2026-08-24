import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";

function text(es, en) {
    return game.i18n.lang.startsWith("es")
        ? es
        : en;
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
                "Nombre",
                "Name"
            );
    }
}

export function registerTableManagerUnifiedTabs() {
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
