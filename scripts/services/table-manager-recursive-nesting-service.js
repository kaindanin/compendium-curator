import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";

function text(es, en) {
    return game.i18n.lang.startsWith("es")
        ? es
        : en;
}

function normalizePositiveNumber(value, fallback = 1) {
    const parsed = Number(value);

    return (
        Number.isFinite(parsed) &&
        parsed > 0
    )
        ? parsed
        : fallback;
}

function getChildConfiguration(profile, childProfileId) {
    return (
        Array.isArray(profile?.children)
            ? profile.children
            : []
    ).find(child =>
        child?.profileId === childProfileId
    ) ?? null;
}

function hasActiveNestedChild(profile, profiles) {
    return (
        Array.isArray(profile?.children)
            ? profile.children
            : []
    ).some(child =>
        child?.enabled === true &&
        profiles?.[child.profileId]
            ?.type === "nested"
    );
}

function invalidNestedChildMessage() {
    return text(
        "No se puede usar esa Subtabla porque crearía una referencia inválida o circular.",
        "That subtable cannot be used because it would create an invalid or circular reference."
    );
}

function createNestedChoice(
    application,
    profile,
    childProfile
) {
    const configuration =
        getChildConfiguration(
            profile,
            childProfile.id
        );
    const enabled =
        configuration?.enabled === true;
    const weight =
        normalizePositiveNumber(
            configuration?.weight,
            1
        );

    const row = document.createElement("div");
    row.className =
        "cc-table-filter-detail-choice";
    row.dataset.ccRecursiveNestedChoice =
        childProfile.id;

    const checkbox =
        document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = enabled;
    checkbox.dataset.ccNestedChildEnabled = "";
    checkbox.dataset.childProfileId =
        childProfile.id;
    checkbox.setAttribute(
        "aria-label",
        `${game.i18n.localize(
            "COMPENDIUM_CURATOR.IncludeSubtable"
        )}: ${childProfile.name}`
    );
    checkbox.style.flex = "0 0 auto";
    checkbox.style.margin = "0";

    const name = document.createElement("span");
    name.style.display = "inline-flex";
    name.style.alignItems = "center";
    name.style.gap = "0.35rem";

    const icon = document.createElement("i");
    icon.className = "fas fa-diagram-project";
    icon.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.textContent = childProfile.name;

    name.append(icon, label);

    const weightInput =
        document.createElement("input");
    weightInput.type = "number";
    weightInput.min = "0.000001";
    weightInput.step = "any";
    weightInput.value = String(weight);
    weightInput.disabled = !enabled;
    weightInput.dataset.ccNestedChildWeight = "";
    weightInput.dataset.childProfileId =
        childProfile.id;
    weightInput.setAttribute(
        "aria-label",
        `${game.i18n.localize(
            "COMPENDIUM_CURATOR.ChildTableWeight"
        )}: ${childProfile.name}`
    );
    weightInput.style.flex = "0 0 72px";
    weightInput.style.width = "72px";
    weightInput.style.height = "28px";

    checkbox.addEventListener(
        "change",
        async event => {
            const requested =
                event.currentTarget.checked;

            weightInput.disabled = !requested;

            try {
                await TableProfileStorageService
                    .setNestedChildEnabled(
                        profile.id,
                        childProfile.id,
                        requested
                    );

                await application.render(true);
            }
            catch (error) {
                console.error(
                    "Compendium Curator | Error actualizando una Subtabla recursiva.",
                    error
                );

                event.currentTarget.checked =
                    !requested;
                weightInput.disabled = requested;

                ui.notifications.error(
                    invalidNestedChildMessage()
                );
            }
        }
    );

    weightInput.addEventListener(
        "change",
        async event => {
            const previous = weight;

            try {
                await TableProfileStorageService
                    .setNestedChildWeight(
                        profile.id,
                        childProfile.id,
                        event.currentTarget.value
                    );

                await application.render(true);
            }
            catch (error) {
                console.error(
                    "Compendium Curator | Error actualizando el peso de una Subtabla recursiva.",
                    error
                );

                event.currentTarget.value =
                    String(previous);

                ui.notifications.error(
                    error?.message ===
                        "INVALID_TABLE_WEIGHT"
                        ? game.i18n.localize(
                            "COMPENDIUM_CURATOR.InvalidTableWeight"
                        )
                        : invalidNestedChildMessage()
                );
            }
        }
    );

    row.append(
        checkbox,
        name,
        weightInput
    );

    return row;
}

function getNestedInspectorBody(profileRow) {
    const details = profileRow?.querySelector(
        "details[data-cc-content-inspector]"
    );

    if (!details)
        return null;

    return Array.from(details.children)
        .find(child =>
            child instanceof HTMLElement &&
            child.tagName === "DIV"
        ) ?? null;
}

function ensureChoicesContainer(inspectorBody) {
    let choices = inspectorBody?.querySelector(
        ":scope > .cc-table-filter-detail-choices"
    );

    if (choices)
        return choices;

    const emptyHint = Array.from(
        inspectorBody?.querySelectorAll(
            ":scope > p.hint"
        ) ?? []
    ).find((_, index) => index > 0);

    emptyHint?.remove();

    choices = document.createElement("div");
    choices.className =
        "cc-table-filter-detail-choices";
    inspectorBody?.append(choices);

    return choices;
}

function disableUnsupportedGeneration(
    profileRow,
    recursive
) {
    if (!recursive)
        return;

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
    }
}

function augmentNestedProfiles(
    application,
    element
) {
    const profiles =
        TableProfileStorageService.getProfiles();
    let recursiveVisible = false;

    for (
        const profile
        of Object.values(profiles)
    ) {
        if (profile?.type !== "nested")
            continue;

        const profileRow = element.querySelector(
            `[data-profile-id="${CSS.escape(
                profile.id
            )}"]`
        );

        if (!profileRow)
            continue;

        const recursive =
            hasActiveNestedChild(
                profile,
                profiles
            );

        recursiveVisible ||= recursive;
        disableUnsupportedGeneration(
            profileRow,
            recursive
        );

        const inspectorBody =
            getNestedInspectorBody(profileRow);

        if (!inspectorBody)
            continue;

        const candidates = Object.values(profiles)
            .filter(candidate =>
                candidate?.type === "nested" &&
                TableProfileStorageService
                    .canUseNestedChild(
                        profile.id,
                        candidate.id
                    )
            )
            .sort((a, b) =>
                String(a.name ?? "").localeCompare(
                    String(b.name ?? ""),
                    game.i18n.lang,
                    { sensitivity: "base" }
                )
            );

        if (!candidates.length)
            continue;

        const choices =
            ensureChoicesContainer(
                inspectorBody
            );

        for (const candidate of candidates) {
            if (
                choices.querySelector(
                    `[data-child-profile-id="${CSS.escape(
                        candidate.id
                    )}"]`
                )
            ) {
                continue;
            }

            choices.append(
                createNestedChoice(
                    application,
                    profile,
                    candidate
                )
            );
        }
    }

    if (recursiveVisible) {
        const batchButton = element.querySelector(
            '[data-action="generateVisibleProfiles"]'
        );

        if (batchButton)
            batchButton.disabled = true;
    }
}

export function registerTableManagerRecursiveNesting() {
    Hooks.on(
        "renderTableManagerApplication",
        (application, element) => {
            if (!game.user.can("SETTINGS_MODIFY"))
                return;

            augmentNestedProfiles(
                application,
                element
            );
        }
    );
}
