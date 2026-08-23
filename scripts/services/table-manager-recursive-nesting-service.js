import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";
import {
    getActiveTableChildren,
    registerTableProfileRelations
} from "./table-profile-relations-service.js";
import {
    TableManagerContentApplication
} from "../applications/table-manager-content-application.js";

function text(es, en) {
    return game.i18n.lang.startsWith("es")
        ? es
        : en;
}

function hasActiveChildren(profile, profiles) {
    return getActiveTableChildren(
        profile,
        profiles
    ).length > 0;
}

function unsupportedGeneration(
    profile,
    profiles
) {
    const activeChildren =
        getActiveTableChildren(
            profile,
            profiles
        );

    if (!activeChildren.length)
        return false;

    if (profile?.type === "content")
        return true;

    return activeChildren.some(child => {
        const childProfile =
            profiles?.[child.profileId];

        return (
            !childProfile ||
            childProfile.type !== "content" ||
            hasActiveChildren(
                childProfile,
                profiles
            )
        );
    });
}

function updateProfileSummary(
    profileRow,
    profile,
    profiles
) {
    const line = profileRow.querySelector(
        ".cc-table-manager-profile-info > span"
    );

    if (!line)
        return;

    const activeCount =
        getActiveTableChildren(
            profile,
            profiles
        ).length;

    if (!activeCount)
        return;

    const relationSummary = text(
        `Tablas: ${activeCount}`,
        `Tables: ${activeCount}`
    );
    const raw = String(
        line.textContent ?? ""
    ).trim();
    const separatorIndex = raw.indexOf("·");
    const existing =
        separatorIndex >= 0
            ? raw
                .slice(separatorIndex + 1)
                .trim()
            : "";

    line.textContent = existing
        ? `· ${existing} · ${relationSummary}`
        : `· ${relationSummary}`;
}

function disableUnsupportedGeneration(
    profileRow,
    profile,
    profiles
) {
    if (
        !unsupportedGeneration(
            profile,
            profiles
        )
    ) {
        return false;
    }

    const reason = text(
        "La generación con tablas relacionadas se activará en el siguiente paso de la migración.",
        "Generation with linked tables will be enabled in the next migration step."
    );

    for (
        const control
        of profileRow.querySelectorAll(
            [
                '[data-action="generateProfile"]',
                '[data-action="quickDrawGeneratedTable"]',
                '[data-action="drawGeneratedTable"]',
                '[data-action="openGeneratedTable"]'
            ].join(",")
        )
    ) {
        control.disabled = true;
        control.title = reason;
    }

    for (
        const dragHandle
        of profileRow.querySelectorAll(
            "[data-cc-rolltable-drag]"
        )
    ) {
        dragHandle.draggable = false;
        dragHandle.setAttribute(
            "aria-disabled",
            "true"
        );
        dragHandle.title = reason;
    }

    const status = profileRow.querySelector(
        ".cc-table-manager-profile-status"
    );

    if (status) {
        status.textContent = text(
            "Pendiente · contiene otras tablas",
            "Pending · contains other tables"
        );
    }

    return true;
}

async function openContentManager(
    application,
    profileId
) {
    const current =
        application._ccContentManager;

    if (current?.rendered) {
        if (current.profileId === profileId) {
            current.bringToFront();
            return;
        }

        await current.close();
    }

    application._closeProfileActionsPopover?.();

    const contentManager =
        new TableManagerContentApplication(
            application,
            profileId
        );

    application._ccContentManager =
        contentManager;

    contentManager.render({
        force: true
    });
}

function configureManageContentButton(
    application,
    profileRow,
    profile
) {
    const menu = profileRow.querySelector(
        ".cc-table-manager-profile-menu"
    );

    if (!menu)
        return;

    let button = menu.querySelector(
        '[data-action="addCurrentFilters"], ' +
        "[data-cc-manage-content]"
    );

    if (!button) {
        button = document.createElement("button");

        const renameButton = menu.querySelector(
            '[data-action="renameProfile"]'
        );

        menu.insertBefore(
            button,
            renameButton ?? null
        );

        const separator =
            document.createElement("div");
        separator.className =
            "cc-table-manager-profile-menu-separator";
        separator.dataset.ccManageContentSeparator =
            "";

        menu.insertBefore(
            separator,
            renameButton ?? null
        );
    }

    button.removeAttribute("data-action");
    button.dataset.ccManageContent = "";
    button.type = "button";

    const icon = document.createElement("i");
    icon.className = "fas fa-layer-group";
    icon.setAttribute(
        "aria-hidden",
        "true"
    );

    const label = text(
        "Gestionar contenido",
        "Manage content"
    );

    button.replaceChildren(
        icon,
        document.createTextNode(
            ` ${label}`
        )
    );
    button.title = label;

    button.addEventListener(
        "click",
        event => {
            event.preventDefault();
            event.stopPropagation();

            void openContentManager(
                application,
                profile.id
            );
        }
    );
}

function augmentUnifiedTableRelations(
    application,
    element
) {
    const profiles =
        TableProfileStorageService.getProfiles();
    let unsupportedVisible = false;

    for (
        const profile
        of Object.values(profiles)
    ) {
        if (profile?.version !== 2)
            continue;

        const profileRow = element.querySelector(
            `[data-profile-id="${CSS.escape(
                profile.id
            )}"]`
        );

        if (!profileRow)
            continue;

        /*
         * La antigua UI de subtablas ya no forma
         * parte del Gestor unificado. Las relaciones
         * se administran desde "Gestionar contenido".
         */
        if (profile.type === "nested") {
            profileRow.querySelector(
                "details[data-cc-content-inspector]"
            )?.remove();
        }

        profileRow.querySelector(
            "details[data-cc-table-relations]"
        )?.remove();

        configureManageContentButton(
            application,
            profileRow,
            profile
        );

        updateProfileSummary(
            profileRow,
            profile,
            profiles
        );

        const unsupported =
            disableUnsupportedGeneration(
                profileRow,
                profile,
                profiles
            );

        if (
            unsupported &&
            !profileRow.hidden
        ) {
            unsupportedVisible = true;
        }

        const linkedNames =
            getActiveTableChildren(
                profile,
                profiles
            )
                .map(child =>
                    profiles?.[child.profileId]
                        ?.name
                )
                .filter(Boolean);

        if (linkedNames.length) {
            profileRow.dataset.ccSearchText = [
                profileRow.dataset.ccSearchText ?? "",
                ...linkedNames
            ].join(" ");
        }
    }

    if (unsupportedVisible) {
        const batchButton = element.querySelector(
            '[data-action="generateVisibleProfiles"]'
        );

        if (batchButton) {
            batchButton.disabled = true;
            batchButton.title = text(
                "Hay tablas relacionadas cuya generación recursiva todavía no está activada.",
                "Some linked tables still require recursive generation support."
            );
        }
    }

    application._applyManagerSearch?.();
}

export function registerTableManagerRecursiveNesting() {
    registerTableProfileRelations();

    Hooks.on(
        "renderTableManagerApplication",
        (application, element) => {
            if (!game.user.can("SETTINGS_MODIFY"))
                return;

            augmentUnifiedTableRelations(
                application,
                element
            );
        }
    );
}
