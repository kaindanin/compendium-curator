import {
    MODULE_ID,
    TABLE_PROFILES_SETTING
} from "../settings.js";
import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";

const DIRECT_MODE = "direct";
let ensurePromise = null;

function text(es, en) {
    return game.i18n.lang.startsWith("es")
        ? es
        : en;
}

function isObject(value) {
    return value &&
        typeof value === "object" &&
        !Array.isArray(value);
}

async function ensureStructuralContentMode() {
    if (ensurePromise)
        return ensurePromise;

    ensurePromise = (async () => {
        const storage = foundry.utils.deepClone(
            TableProfileStorageService.getStorage()
        );
        let changed = false;

        for (
            const profile
            of Object.values(storage.profiles ?? {})
        ) {
            if (
                profile?.version !== 2 ||
                profile.type !== "content"
            ) {
                continue;
            }

            const current = isObject(
                profile.contentLayout
            )
                ? profile.contentLayout
                : {};
            const sources = isObject(current.sources)
                ? current.sources
                : {};

            if (
                current.mode === DIRECT_MODE &&
                current.sources === sources
            ) {
                continue;
            }

            profile.contentLayout = {
                ...current,
                mode: DIRECT_MODE,
                sources
            };
            profile.revision =
                Number(profile.revision ?? 1) + 1;
            changed = true;
        }

        if (!changed)
            return false;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return true;
    })();

    try {
        return await ensurePromise;
    }
    finally {
        ensurePromise = null;
    }
}

function movePercentageAfterWeight(
    summary,
    weightInput,
    labelText = null
) {
    const label = weightInput?.previousElementSibling;
    const percent = label?.previousElementSibling;

    if (
        !summary ||
        !label ||
        !percent ||
        label.tagName !== "LABEL"
    ) {
        return;
    }

    if (labelText)
        label.textContent = labelText;

    summary.insertBefore(label, percent);
    summary.insertBefore(weightInput, percent);
}

function refineEditableSource(source) {
    source.querySelector(
        ":scope > div > .cc-table-filter-detail-choices"
    )?.remove();

    const summary = source.querySelector(
        ":scope > summary"
    );
    const branchWeight = summary?.querySelector(
        "[data-cc-direct-branch-weight]"
    );

    if (branchWeight) {
        movePercentageAfterWeight(
            summary,
            branchWeight
        );
    }

    for (
        const groupWeight
        of source.querySelectorAll(
            "[data-cc-direct-group-weight]"
        )
    ) {
        const groupSummary = groupWeight.closest(
            "summary"
        );

        if (!groupSummary)
            continue;

        movePercentageAfterWeight(
            groupSummary,
            groupWeight,
            text("Peso", "Weight")
        );

        const groupDetails =
            groupSummary.parentElement;
        const itemWeightHeader =
            groupDetails?.querySelector(
                ":scope > div .items-header .item-controls"
            );

        if (itemWeightHeader) {
            itemWeightHeader.textContent = text(
                "Peso interno / % raíz",
                "Internal weight / root %"
            );
        }
    }
}

function refineTableSource(source) {
    const summary = source.querySelector(
        ":scope > summary"
    );
    const tableWeight = summary?.querySelector(
        "[data-cc-direct-table-weight]"
    );

    if (tableWeight) {
        movePercentageAfterWeight(
            summary,
            tableWeight
        );
    }

    const tableActions = source.querySelector(
        ":scope > div > [data-cc-linked-table-actions]"
    );
    const legacyModeSummary =
        tableActions?.nextElementSibling;

    legacyModeSummary?.remove();
}

function refineRow(row) {
    const distribution = row.querySelector(
        "[data-cc-distribution-mode]"
    )?.closest(
        ".cc-table-filter-detail-block"
    );

    distribution?.remove();

    const editor = row.querySelector(
        "[data-cc-direct-content-editor]"
    );

    if (!editor)
        return;

    for (
        const source
        of editor.querySelectorAll(
            ":scope > [data-cc-direct-source]"
        )
    ) {
        if (
            source.querySelector(
                ":scope > summary [data-cc-direct-table-weight]"
            )
        ) {
            refineTableSource(source);
        }
        else {
            refineEditableSource(source);
        }
    }
}

function refineManager(element) {
    for (
        const row
        of element.querySelectorAll(
            ".cc-table-manager-profile[data-profile-id]"
        )
    ) {
        refineRow(row);
    }
}

export function registerTableManagerStructuralContent() {
    Hooks.on(
        "renderTableManagerApplication",
        async (application, element) => {
            if (!game.user.can("SETTINGS_MODIFY"))
                return;

            try {
                const changed =
                    await ensureStructuralContentMode();

                if (changed) {
                    await application.render({
                        force: true
                    });
                    return;
                }
            }
            catch (error) {
                console.error(
                    "Compendium Curator | Error activando la estructura de contenido directo.",
                    error
                );
                ui.notifications.error(text(
                    "No se pudo actualizar la estructura de las tablas.",
                    "The table structure could not be updated."
                ));
                return;
            }

            refineManager(element);
        }
    );
}
