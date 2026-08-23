import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";
import {
    canUseTableChild,
    getActiveTableChildren,
    getTableChildren,
    registerTableProfileRelations,
    setTableChildEnabled,
    setTableChildWeight
} from "./table-profile-relations-service.js";

const OPEN_RELATION_INSPECTORS = new Set();

function text(es, en) {
    return game.i18n.lang.startsWith("es")
        ? es
        : en;
}

function getChildConfiguration(
    profile,
    childProfileId,
    profiles
) {
    return getTableChildren(
        profile,
        profiles
    ).find(child =>
        child.profileId === childProfileId
    ) ?? null;
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

function invalidChildMessage() {
    return text(
        "No se puede usar esa tabla porque crearía una referencia inválida o circular.",
        "That table cannot be used because it would create an invalid or circular reference."
    );
}

function createTableChoice(
    application,
    profile,
    childProfile,
    profiles
) {
    const configuration =
        getChildConfiguration(
            profile,
            childProfile.id,
            profiles
        );
    const enabled =
        configuration?.enabled === true;
    const weight =
        Number(configuration?.weight) > 0
            ? Number(configuration.weight)
            : 1;

    const row = document.createElement("div");
    row.className =
        "cc-table-filter-detail-choice";
    row.dataset.ccTableRelationChoice =
        childProfile.id;

    const checkbox =
        document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = enabled;
    checkbox.dataset.ccTableRelationEnabled = "";
    checkbox.dataset.childProfileId =
        childProfile.id;
    checkbox.setAttribute(
        "aria-label",
        `${text("Incluir tabla", "Include table")}: ${childProfile.name}`
    );
    checkbox.style.flex = "0 0 auto";
    checkbox.style.margin = "0";

    const name = document.createElement("span");
    name.style.display = "inline-flex";
    name.style.alignItems = "center";
    name.style.gap = "0.35rem";

    const icon = document.createElement("i");
    icon.className = "fas fa-table-list";
    icon.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.textContent = childProfile.name;

    name.append(icon, label);

    const weightLabel =
        document.createElement("span");
    weightLabel.className = "hint";
    weightLabel.textContent =
        text("Peso", "Weight");
    weightLabel.style.marginLeft = "auto";
    weightLabel.style.whiteSpace = "nowrap";

    const weightInput =
        document.createElement("input");
    weightInput.type = "number";
    weightInput.min = "0.000001";
    weightInput.step = "any";
    weightInput.value = String(weight);
    weightInput.disabled = !enabled;
    weightInput.dataset.ccTableRelationWeight = "";
    weightInput.dataset.childProfileId =
        childProfile.id;
    weightInput.setAttribute(
        "aria-label",
        `${text("Peso de la tabla", "Table weight")}: ${childProfile.name}`
    );
    weightInput.style.flex = "0 0 72px";
    weightInput.style.width = "72px";
    weightInput.style.height = "28px";
    weightInput.style.textAlign = "right";

    checkbox.addEventListener(
        "change",
        async event => {
            const requested =
                event.currentTarget.checked;

            event.currentTarget.disabled = true;
            weightInput.disabled = true;
            OPEN_RELATION_INSPECTORS.add(
                profile.id
            );

            try {
                await setTableChildEnabled(
                    profile.id,
                    childProfile.id,
                    requested
                );

                await application.render({
                    force: true
                });
            }
            catch (error) {
                console.error(
                    "Compendium Curator | Error actualizando una relación entre tablas.",
                    error
                );

                event.currentTarget.checked =
                    !requested;
                event.currentTarget.disabled = false;
                weightInput.disabled =
                    !event.currentTarget.checked;

                ui.notifications.error(
                    invalidChildMessage()
                );
            }
        }
    );

    weightInput.addEventListener(
        "change",
        async event => {
            const previous = weight;

            event.currentTarget.disabled = true;
            OPEN_RELATION_INSPECTORS.add(
                profile.id
            );

            try {
                await setTableChildWeight(
                    profile.id,
                    childProfile.id,
                    event.currentTarget.value
                );

                await application.render({
                    force: true
                });
            }
            catch (error) {
                console.error(
                    "Compendium Curator | Error actualizando el peso de una relación entre tablas.",
                    error
                );

                event.currentTarget.value =
                    String(previous);
                event.currentTarget.disabled = false;

                ui.notifications.error(
                    error?.message ===
                        "INVALID_TABLE_WEIGHT"
                        ? text(
                            "El peso debe ser mayor que cero.",
                            "Weight must be greater than zero."
                        )
                        : invalidChildMessage()
                );
            }
        }
    );

    row.append(
        checkbox,
        name,
        weightLabel,
        weightInput
    );

    return row;
}

function createRelationsInspector(
    application,
    profile,
    profiles
) {
    const activeCount =
        getActiveTableChildren(
            profile,
            profiles
        ).length;
    const configuredIds = new Set(
        getTableChildren(
            profile,
            profiles
        ).map(child => child.profileId)
    );
    const candidates = Object.values(profiles)
        .filter(candidate =>
            candidate?.version === 2 &&
            candidate.id !== profile.id &&
            (
                configuredIds.has(candidate.id) ||
                canUseTableChild(
                    profile.id,
                    candidate.id,
                    profiles
                )
            )
        )
        .sort((a, b) =>
            String(a.name ?? "").localeCompare(
                String(b.name ?? ""),
                game.i18n.lang,
                { sensitivity: "base" }
            )
        );

    const details =
        document.createElement("details");
    details.className =
        "cc-table-manager-content-inspector";
    details.dataset.ccTableRelations = "";
    details.style.gridColumn = "1 / -1";
    details.style.marginTop = "0.15rem";
    details.style.paddingTop = "0.65rem";
    details.style.borderTop =
        "1px solid rgb(255 255 255 / 7%)";

    if (OPEN_RELATION_INSPECTORS.has(profile.id))
        details.open = true;

    details.addEventListener(
        "toggle",
        () => {
            if (details.open) {
                OPEN_RELATION_INSPECTORS.add(
                    profile.id
                );
            }
            else {
                OPEN_RELATION_INSPECTORS.delete(
                    profile.id
                );
            }
        }
    );

    const summary =
        document.createElement("summary");
    summary.style.display = "flex";
    summary.style.alignItems = "center";
    summary.style.justifyContent =
        "space-between";
    summary.style.gap = "1rem";
    summary.style.minHeight = "34px";
    summary.style.padding = "0.4rem 0.55rem";
    summary.style.cursor = "pointer";
    summary.style.background =
        "rgb(0 0 0 / 16%)";
    summary.style.borderRadius = "5px";
    summary.style.listStyle = "none";

    const summaryLabel =
        document.createElement("span");
    const chevron =
        document.createElement("i");
    chevron.className =
        "fas fa-chevron-down";
    chevron.setAttribute(
        "aria-hidden",
        "true"
    );
    summaryLabel.append(
        chevron,
        document.createTextNode(
            ` ${text("Otras tablas", "Other tables")}`
        )
    );

    const count = document.createElement("strong");
    count.textContent = String(activeCount);
    summary.append(summaryLabel, count);

    const body = document.createElement("div");
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.gap = "0.65rem";
    body.style.padding = "0.75rem 0 0.15rem";

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.style.margin = "0";
    hint.textContent = text(
        "Incluye otras tablas como resultados de esta tabla. Las referencias circulares se bloquean automáticamente.",
        "Include other tables as results of this table. Circular references are blocked automatically."
    );
    body.append(hint);

    if (candidates.length) {
        const choices =
            document.createElement("div");
        choices.className =
            "cc-table-filter-detail-choices";

        for (const candidate of candidates) {
            choices.append(
                createTableChoice(
                    application,
                    profile,
                    candidate,
                    profiles
                )
            );
        }

        body.append(choices);
    }
    else {
        const empty = document.createElement("p");
        empty.className = "hint";
        empty.style.margin = "0";
        empty.textContent = text(
            "No hay otras tablas disponibles.",
            "There are no other tables available."
        );
        body.append(empty);
    }

    details.append(summary, body);
    return details;
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
    const relationSummary = text(
        `Relaciones: ${activeCount}`,
        `Relations: ${activeCount}`
    );

    if (profile.type === "nested") {
        line.textContent =
            `· ${relationSummary}`;
        return;
    }

    if (!activeCount)
        return;

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

        profileRow.querySelector(
            "details[data-cc-table-relations]"
        )?.remove();

        if (profile.type === "nested") {
            const legacyInspector =
                profileRow.querySelector(
                    "details[data-cc-content-inspector]"
                );

            if (legacyInspector?.open) {
                OPEN_RELATION_INSPECTORS.add(
                    profile.id
                );
            }

            legacyInspector?.remove();
        }

        profileRow.append(
            createRelationsInspector(
                application,
                profile,
                profiles
            )
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
