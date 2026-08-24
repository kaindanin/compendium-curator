import {
    activateDnd5eDocumentEntries
} from "../ui/dnd5e-document-list.js";

function text(es, en) {
    return game.i18n.lang.startsWith("es")
        ? es
        : en;
}

function parsePercentage(value) {
    const raw = String(value ?? "")
        .trim()
        .replace("%", "")
        .replace(",", ".");
    const parsed = Number(raw);

    return Number.isFinite(parsed)
        ? parsed / 100
        : null;
}

function formatPercentage(value) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed <= 0)
        return "0%";

    const percent = parsed * 100;

    if (percent < 0.01)
        return "<0,01%";

    return `${new Intl.NumberFormat(
        game.i18n.lang,
        {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }
    ).format(percent)}%`;
}

function isEffectivePercentage(element) {
    const title = String(
        element?.getAttribute?.("title") ?? ""
    ).toLocaleLowerCase(game.i18n.lang);

    return title.includes("porcentaje efectivo") ||
        title.includes("effective percentage");
}

function percentageElements(root) {
    return [...root.querySelectorAll("[title]")]
        .filter(isEffectivePercentage);
}

function scalePercentages(root, scale) {
    for (const element of percentageElements(root)) {
        const local = parsePercentage(
            element.textContent
        );

        if (local === null)
            continue;

        element.textContent = formatPercentage(
            local * scale
        );
    }
}

function sourcePercentage(source) {
    const element = [...source.querySelectorAll(
        ":scope > summary [title]"
    )].find(isEffectivePercentage);

    return parsePercentage(
        element?.textContent
    );
}

function makeReadOnly(root) {
    for (const control of root.querySelectorAll(
        "input, select, textarea"
    )) {
        control.disabled = true;
        control.setAttribute("aria-disabled", "true");
    }

    for (const button of root.querySelectorAll([
        "[data-cc-direct-reset-item-weight]",
        "[data-cc-direct-save-ranges]",
        "[data-cc-open-original-table]"
    ].join(","))) {
        button.remove();
    }

    for (const editor of root.querySelectorAll(
        "[data-cc-direct-range-editor]"
    )) {
        editor.remove();
    }

    for (const notification of root.querySelectorAll(
        ".notification"
    )) {
        notification.remove();
    }
}

function removeFlatPreview(tableSource) {
    const body = tableSource.querySelector(
        ":scope > div"
    );

    if (!body)
        return null;

    body.querySelector(
        ":scope > [data-cc-linked-expanded-preview]"
    )?.remove();

    for (const candidate of [...body.children]) {
        if (candidate.classList?.contains("notification"))
            continue;

        if (
            candidate.querySelector?.(
                ":scope > .cc-table-filter-detail-choice"
            )
        ) {
            candidate.remove();
        }
    }

    return body;
}

function originalEditor(managerElement, profileId) {
    const row = managerElement.querySelector(
        `[data-profile-id="${CSS.escape(profileId)}"]`
    );

    return row?.querySelector(
        "[data-cc-direct-content-editor]"
    ) ?? null;
}

function cloneProfileStructure(
    managerElement,
    profileId,
    rootScale,
    activePath = new Set()
) {
    if (
        !profileId ||
        activePath.has(profileId)
    ) {
        return null;
    }

    const sourceEditor = originalEditor(
        managerElement,
        profileId
    );

    if (!sourceEditor)
        return null;

    const nextPath = new Set(activePath);
    nextPath.add(profileId);
    const clone = sourceEditor.cloneNode(true);

    clone.removeAttribute(
        "data-cc-direct-content-editor"
    );
    clone.dataset.ccLinkedExpandedPreview = "";
    clone.querySelector(":scope > p.hint")?.remove();

    makeReadOnly(clone);
    scalePercentages(clone, rootScale);

    for (
        const tableSource
        of clone.querySelectorAll(
            ":scope > [data-cc-direct-source]"
        )
    ) {
        const weight = tableSource.querySelector(
            ":scope > summary [data-cc-direct-table-weight]"
        );

        if (!weight)
            continue;

        const childId = String(
            weight.dataset.childProfileId ?? ""
        ).trim();
        const childScale = sourcePercentage(
            tableSource
        );

        if (!childId || childScale === null)
            continue;

        expandTableSource(
            managerElement,
            tableSource,
            childId,
            childScale,
            nextPath
        );
    }

    return clone;
}

function expandTableSource(
    managerElement,
    tableSource,
    childId,
    rootScale,
    activePath = new Set()
) {
    const body = removeFlatPreview(
        tableSource
    );

    if (!body)
        return;

    const clone = cloneProfileStructure(
        managerElement,
        childId,
        rootScale,
        activePath
    );

    if (!clone) {
        const fallback = document.createElement("p");
        fallback.className = "hint";
        fallback.dataset.ccLinkedExpandedPreview = "";
        fallback.textContent = text(
            "La tabla original no está disponible en esta vista.",
            "The original table is not available in this view."
        );
        body.append(fallback);
        return;
    }

    body.append(clone);
    activateDnd5eDocumentEntries(clone);
}

function enhanceManager(element) {
    for (
        const tableSource
        of element.querySelectorAll(
            "[data-cc-direct-content-editor] > [data-cc-direct-source]"
        )
    ) {
        const weight = tableSource.querySelector(
            ":scope > summary [data-cc-direct-table-weight]"
        );

        if (!weight)
            continue;

        const childId = String(
            weight.dataset.childProfileId ?? ""
        ).trim();
        const rootScale = sourcePercentage(
            tableSource
        );

        if (!childId || rootScale === null)
            continue;

        expandTableSource(
            element,
            tableSource,
            childId,
            rootScale,
            new Set()
        );
    }
}

export function registerTableManagerLinkedTableExpandedPreview() {
    Hooks.on(
        "renderTableManagerApplication",
        (application, element) => {
            if (!game.user.can("SETTINGS_MODIFY"))
                return;

            enhanceManager(element);
        }
    );
}
