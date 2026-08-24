import {
    TableManagerApplication
} from "../applications/table-manager-application.js";
import {
    TableManagerContentApplication
} from "../applications/table-manager-content-application.js";
import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";
import {
    getActiveTableChildren
} from "./table-profile-relations-service.js";
import {
    profileHasPendingTableDependencies
} from "./table-profile-recursive-generation-service.js";

const MANAGE_CONTENT_ACTION =
    "manageContent";

function text(es, en) {
    return game.i18n.lang.startsWith("es")
        ? es
        : en;
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

function updateRecursiveGenerationState(
    profileRow,
    profile,
    profiles
) {
    const activeChildren =
        getActiveTableChildren(
            profile,
            profiles
        );

    if (!activeChildren.length)
        return;

    const generateButton =
        profileRow.querySelector(
            '[data-action="generateProfile"]'
        );

    if (generateButton) {
        generateButton.disabled = false;
        generateButton.removeAttribute("title");
    }

    if (
        profile.generation?.rootUuid &&
        profileHasPendingTableDependencies(
            profile,
            profiles
        )
    ) {
        const status = profileRow.querySelector(
            ".cc-table-manager-profile-status"
        );

        if (status) {
            status.textContent =
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.TableProfilePendingChanges"
                );
        }
    }
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

function onManageContent(event, target) {
    event.preventDefault();
    event.stopPropagation();

    const profileId = String(
        target
            .closest("[data-profile-id]")
            ?.dataset?.profileId ??
        ""
    ).trim();

    if (!profileId)
        return;

    void openContentManager(
        this,
        profileId
    );
}

function registerManageContentAction() {
    const actions =
        TableManagerApplication
            .DEFAULT_OPTIONS
            ?.actions;

    if (!actions)
        return;

    actions[MANAGE_CONTENT_ACTION] =
        onManageContent;
}

function configureManageContentButton(
    profileRow
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

    button.dataset.action =
        MANAGE_CONTENT_ACTION;
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
}

function augmentUnifiedTableRelations(
    application,
    element
) {
    const profiles =
        TableProfileStorageService.getProfiles();

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
         * La antigua UI separada ya no forma parte
         * del Gestor unificado. Todo el contenido se
         * administra desde "Gestionar contenido".
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
            profileRow
        );

        updateProfileSummary(
            profileRow,
            profile,
            profiles
        );

        updateRecursiveGenerationState(
            profileRow,
            profile,
            profiles
        );

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

    application._applyManagerSearch?.();
}

export function registerTableManagerRecursiveNesting() {
    registerManageContentAction();

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
