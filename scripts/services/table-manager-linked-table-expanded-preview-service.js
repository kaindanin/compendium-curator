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
    for (const control of [...root.querySelectorAll(
        "input, select, textarea"
    )]) {
        const value = control.matches("select")
            ? control.selectedOptions?.[0]?.textContent?.trim()
            : control.type === "checkbox"
                ? text(
                    control.checked ? "Incluido" : "Excluido",
                    control.checked ? "Included" : "Excluded"
                )
                : control.value;
        const replacement = document.createElement(
            control.type === "checkbox" ? "span" : "strong"
        );

        replacement.className = "hint";
        replacement.textContent = String(value ?? "").trim();
        replacement.dataset.ccLinkedReadOnlyValue = "";
        control.replaceWith(replacement);
    }

    for (const button of root.querySelectorAll([
        "[data-cc-direct-reset-item-weight]",
        "[data-cc-direct-save-ranges]",
        "[data-cc-open-original-table]"
    ].join(","))) {
        button.remove();
    }

    for (const actions of root.querySelectorAll(
        "[data-cc-linked-table-actions]"
    )) {
        actions.remove();
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

function removeDuplicateGroups(root) {
    for (
        const source
        of root.querySelectorAll(
            ":scope > [data-cc-direct-source]"
        )
    ) {
        if (
            source.querySelector(
                ":scope > summary [data-cc-direct-table-weight]"
            )
        ) {
            continue;
        }

        source.querySelector(
            ":scope > div > .cc-table-filter-detail-choices"
        )?.remove();
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

    removeDuplicateGroups(clone);
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

    makeReadOnly(clone);

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

function disclosureSegment(details) {
    if (details.dataset.ccDirectSource !== undefined) {
        return `source:${details.dataset.ccDirectSource}`;
    }

    if (details.dataset.ccDirectGroupDetails !== undefined) {
        return [
            "group",
            details.dataset.sourceKey ?? "",
            details.dataset.groupKey ?? ""
        ].join(":");
    }

    if (details.dataset.ccDirectRangeEditor !== undefined) {
        return `ranges:${details.dataset.sourceKey ?? ""}`;
    }

    const parent = details.parentElement;
    const siblings = parent
        ? [...parent.children].filter(element =>
            element.tagName === "DETAILS"
        )
        : [];

    return `details:${Math.max(0, siblings.indexOf(details))}`;
}

function disclosureKey(details) {
    const row = details.closest(
        ".cc-table-manager-profile[data-profile-id]"
    );

    if (!row || details === row)
        return null;

    const segments = [];
    let current = details;

    while (current && current !== row) {
        if (current.tagName === "DETAILS") {
            segments.push(
                disclosureSegment(current)
            );
        }

        current = current.parentElement?.closest(
            "details"
        );
    }

    return `${row.dataset.profileId}/${segments.reverse().join("/")}`;
}

function preserveManagerView(application, element) {
    application._ccOpenManagerDetails ??= new Set();
    const openDetails =
        application._ccOpenManagerDetails;

    for (const details of element.querySelectorAll("details")) {
        const key = disclosureKey(details);

        if (!key)
            continue;

        details.open = openDetails.has(key);
        details.addEventListener(
            "toggle",
            () => {
                if (details.open)
                    openDetails.add(key);
                else
                    openDetails.delete(key);
            }
        );
    }

    const scroller = element.querySelector(
        ".cc-table-manager-profiles"
    );

    if (!scroller)
        return;

    scroller.scrollTop = Number(
        application._ccManagerScrollTop ?? 0
    );
    scroller.addEventListener(
        "scroll",
        () => {
            application._ccManagerScrollTop =
                scroller.scrollTop;
        },
        { passive: true }
    );
}

export function registerTableManagerLinkedTableExpandedPreview() {
    Hooks.on(
        "renderTableManagerApplication",
        (application, element) => {
            if (!game.user.can("SETTINGS_MODIFY"))
                return;

            enhanceManager(element);
            preserveManagerView(
                application,
                element
            );
        }
    );
}
