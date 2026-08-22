import { MODULE_ID } from "../settings.js";

function getResultWeight(result) {
    const weight = Number(result?.weight);

    if (Number.isFinite(weight) && weight > 0)
        return weight;

    const start = Number(result?.range?.[0]);
    const end = Number(result?.range?.[1]);

    return (
        Number.isFinite(start) &&
        Number.isFinite(end) &&
        end >= start
    )
        ? end - start + 1
        : 1;
}

function isWorldRollTableUuid(uuid) {
    return /^RollTable\.[^.]+$/.test(
        String(uuid ?? "")
    );
}

async function collectLeafEntries(
    table,
    multiplier,
    leaves,
    activeTableUuids
) {
    const tableUuid = String(table?.uuid ?? "");

    if (
        !tableUuid ||
        activeTableUuids.has(tableUuid)
    ) {
        return;
    }

    const results = Array.from(
        table.results ?? []
    ).filter(result =>
        Boolean(result?.documentUuid)
    );
    const totalWeight = results.reduce(
        (sum, result) =>
            sum + getResultWeight(result),
        0
    );

    if (!(totalWeight > 0))
        return;

    const nextActive = new Set(
        activeTableUuids
    );
    nextActive.add(tableUuid);

    for (const result of results) {
        const documentUuid = String(
            result.documentUuid ?? ""
        );
        const probability =
            multiplier *
            getResultWeight(result) /
            totalWeight;

        if (isWorldRollTableUuid(documentUuid)) {
            const childTable =
                await fromUuid(documentUuid);

            if (childTable?.documentName === "RollTable") {
                await collectLeafEntries(
                    childTable,
                    probability,
                    leaves,
                    nextActive
                );
                continue;
            }
        }

        const existing = leaves.get(documentUuid);

        if (existing) {
            existing.weight += probability;
            continue;
        }

        leaves.set(documentUuid, {
            uuid: documentUuid,
            name:
                String(result.name ?? "").trim() ||
                documentUuid,
            img:
                String(result.img ?? "").trim() ||
                "icons/svg/item-bag.svg",
            weight: probability
        });
    }
}

function sampleWithoutReplacement(entries, count) {
    const pool = entries.map(entry => ({
        ...entry
    }));
    const selected = [];

    while (
        selected.length < count &&
        pool.length
    ) {
        const totalWeight = pool.reduce(
            (sum, entry) =>
                sum + Math.max(0, entry.weight),
            0
        );

        if (!(totalWeight > 0))
            break;

        let roll = Math.random() * totalWeight;
        let selectedIndex = pool.length - 1;

        for (let index = 0; index < pool.length; index++) {
            roll -= Math.max(
                0,
                pool[index].weight
            );

            if (roll <= 0) {
                selectedIndex = index;
                break;
            }
        }

        selected.push(
            pool.splice(selectedIndex, 1)[0]
        );
    }

    return selected;
}

function sampleWithReplacement(entries, count) {
    const totalWeight = entries.reduce(
        (sum, entry) =>
            sum + Math.max(0, entry.weight),
        0
    );

    if (!(totalWeight > 0))
        return [];

    const selected = [];

    while (selected.length < count) {
        let roll = Math.random() * totalWeight;
        let selectedEntry = entries.at(-1);

        for (const entry of entries) {
            roll -= Math.max(0, entry.weight);

            if (roll <= 0) {
                selectedEntry = entry;
                break;
            }
        }

        selected.push({ ...selectedEntry });
    }

    return selected;
}

function aggregateSelectedEntries(entries) {
    const aggregated = new Map();

    for (const entry of entries) {
        const existing = aggregated.get(entry.uuid);

        if (existing) {
            existing.quantity++;
            continue;
        }

        aggregated.set(entry.uuid, {
            ...entry,
            quantity: 1
        });
    }

    return [...aggregated.values()];
}

function formatCurrencyAmount(
    value,
    denomination
) {
    const currency =
        CONFIG.DND5E?.currencies?.[
            denomination
        ];
    const rawLabel =
        currency?.abbreviation ??
        currency?.label ??
        denomination;
    const label = game.i18n.has(rawLabel)
        ? game.i18n.localize(rawLabel)
        : String(rawLabel);
    const formattedValue =
        new Intl.NumberFormat(
            game.i18n.lang,
            {
                maximumFractionDigits: 3
            }
        ).format(value);

    return `${formattedValue} ${label}`;
}

function getItemPrice(
    document,
    quantity,
    priceMultiplier
) {
    const price = document?.system?.price;
    const value = Number(price?.value);
    const denomination = String(
        price?.denomination ?? ""
    ).trim();

    if (
        !Number.isFinite(value) ||
        value <= 0 ||
        !denomination
    ) {
        return {
            unit: "",
            subtotal: "",
            unitValue: null,
            subtotalValue: null,
            denomination: ""
        };
    }

    const adjustedUnitValue =
        value * priceMultiplier;
    const adjustedSubtotalValue =
        adjustedUnitValue * quantity;

    return {
        unit:
            formatCurrencyAmount(
                adjustedUnitValue,
                denomination
            ),
        subtotal:
            quantity > 1
                ? formatCurrencyAmount(
                    adjustedSubtotalValue,
                    denomination
                )
                : "",
        unitValue: adjustedUnitValue,
        subtotalValue:
            adjustedSubtotalValue,
        denomination
    };
}

async function hydrateSelectedEntries(
    entries,
    priceMultiplier
) {
    return Promise.all(
        entries.map(async entry => {
            let document = null;

            try {
                document = await fromUuid(
                    entry.uuid
                );
            }
            catch (error) {
                console.warn(
                    "Compendium Curator | No se pudo cargar un objeto del stock.",
                    entry.uuid,
                    error
                );
            }

            const quantity = Math.max(
                1,
                Number.parseInt(
                    entry.quantity,
                    10
                ) || 1
            );
            const price = getItemPrice(
                document,
                quantity,
                priceMultiplier
            );

            return {
                ...entry,
                quantity,
                name:
                    document?.name ?? entry.name,
                img:
                    document?.img ?? entry.img,
                price: price.unit,
                unitPrice: price.unit,
                subtotalPrice: price.subtotal,
                priceValue: price.unitValue,
                subtotalValue:
                    price.subtotalValue,
                priceDenomination:
                    price.denomination
            };
        })
    );
}

function buildPriceSummary(entries) {
    const totals = new Map();

    for (const entry of entries) {
        const value = Number(
            entry.subtotalValue
        );
        const denomination = String(
            entry.priceDenomination ?? ""
        ).trim();

        if (
            !Number.isFinite(value) ||
            value <= 0 ||
            !denomination
        ) {
            continue;
        }

        totals.set(
            denomination,
            (
                totals.get(denomination) ?? 0
            ) + value
        );
    }

    if (!totals.size) {
        return {
            total: "",
            breakdown: ""
        };
    }

    const currencies =
        CONFIG.DND5E?.currencies ?? {};
    const orderedTotals = [...totals.entries()]
        .sort(([left], [right]) => {
            const leftConversion = Number(
                currencies[left]?.conversion
            );
            const rightConversion = Number(
                currencies[right]?.conversion
            );

            return (
                Number.isFinite(leftConversion)
                    ? leftConversion
                    : Number.MAX_SAFE_INTEGER
            ) - (
                Number.isFinite(rightConversion)
                    ? rightConversion
                    : Number.MAX_SAFE_INTEGER
            );
        });
    const breakdown = orderedTotals
        .map(([denomination, value]) =>
            formatCurrencyAmount(
                value,
                denomination
            )
        )
        .join(" + ");

    if (orderedTotals.length === 1) {
        return {
            total: breakdown,
            breakdown: ""
        };
    }

    const baseCurrency =
        Object.entries(currencies)
            .find(([, currency]) =>
                Number(currency?.conversion) === 1
            );
    let normalizedTotal = 0;
    let canNormalize = Boolean(baseCurrency);

    for (
        const [denomination, value]
        of orderedTotals
    ) {
        const conversion = Number(
            currencies[denomination]
                ?.conversion
        );

        if (
            !Number.isFinite(conversion) ||
            conversion <= 0
        ) {
            canNormalize = false;
            break;
        }

        normalizedTotal += value / conversion;
    }

    return {
        total:
            canNormalize
                ? formatCurrencyAmount(
                    normalizedTotal,
                    baseCurrency[0]
                )
                : breakdown,
        breakdown:
            canNormalize ? breakdown : ""
    };
}

async function enrichChatContent(content) {
    const editor =
        foundry.applications?.ux
            ?.TextEditor?.implementation ??
        globalThis.TextEditor;

    if (!editor?.enrichHTML)
        return content;

    return editor.enrichHTML(content, {
        async: true
    });
}

async function createDrawMessage(
    table,
    entries,
    {
        requestedCount,
        selectedCount,
        unique,
        priceMultiplier
    }
) {
    const escape = foundry.utils.escapeHTML;
    const priceLabel = escape(
        game.i18n.localize(
            "COMPENDIUM_CURATOR.ItemPrice"
        )
    );
    const unitPriceLabel = escape(
        game.i18n.localize(
            "COMPENDIUM_CURATOR.ItemUnitPrice"
        )
    );
    const subtotalLabel = escape(
        game.i18n.localize(
            "COMPENDIUM_CURATOR.ItemSubtotal"
        )
    );
    const priceAdjustment =
        new Intl.NumberFormat(
            game.i18n.lang,
            { maximumFractionDigits: 2 }
        ).format(priceMultiplier * 100);
    const priceSummary =
        buildPriceSummary(entries);
    const totalValueLabel = escape(
        game.i18n.localize(
            "COMPENDIUM_CURATOR.TotalStockValue"
        )
    );
    const breakdownLabel = escape(
        game.i18n.localize(
            "COMPENDIUM_CURATOR.StockValueBreakdown"
        )
    );
    const addToActorLabel = escape(
        game.i18n.localize(
            "COMPENDIUM_CURATOR.AddStockToActor"
        )
    );
    const rows = entries.map(entry => `
        <li style="display:flex;align-items:center;gap:0.5rem;margin:0.25rem 0;">
            <img
                src="${escape(entry.img)}"
                alt=""
                width="32"
                height="32"
                style="border:0;border-radius:3px;"
            >
            <span style="display:flex;flex-direction:column;min-width:0;">
                <span style="display:flex;align-items:center;gap:0.35rem;">
                    <span>@UUID[${entry.uuid}]{${escape(entry.name)}}</span>
                    ${entry.quantity > 1
                        ? `<strong style="white-space:nowrap;">×${entry.quantity}</strong>`
                        : ""}
                </span>
                ${entry.unitPrice
                    ? entry.quantity > 1
                        ? `<small class="hint"><strong>${unitPriceLabel}:</strong> ${escape(entry.unitPrice)} · <strong>${subtotalLabel}:</strong> ${escape(entry.subtotalPrice)}</small>`
                        : `<small class="hint"><strong>${priceLabel}:</strong> ${escape(entry.unitPrice)}</small>`
                    : ""}
            </span>
        </li>
    `).join("");
    const content = await enrichChatContent(`
        <section class="dnd5e chat-card cc-stock-table-draw cc-unique-table-draw">
            <header class="card-header flexrow">
                <img src="${escape(table.img)}" alt="" width="36" height="36">
                <h3>${escape(table.name)}</h3>
            </header>
            <p>${escape(
                unique
                    ? game.i18n.format(
                        "COMPENDIUM_CURATOR.UniqueDrawSummary",
                        {
                            count: selectedCount,
                            requested: requestedCount
                        }
                    )
                    : game.i18n.format(
                        "COMPENDIUM_CURATOR.DrawStockSummary",
                        {
                            count: selectedCount,
                            unique: entries.length,
                            requested: requestedCount
                        }
                    )
            )}</p>
            ${priceMultiplier !== 1
                ? `<p class="hint">${escape(
                    game.i18n.format(
                        "COMPENDIUM_CURATOR.PriceAdjustmentApplied",
                        { percent: priceAdjustment }
                    )
                )}</p>`
                : ""}
            ${priceSummary.total
                ? `<div style="display:flex;flex-direction:column;gap:0.15rem;margin:0.45rem 0;padding:0.45rem 0.55rem;background:rgb(0 0 0 / 10%);border-radius:4px;">
                    <strong>${totalValueLabel}: ${escape(priceSummary.total)}</strong>
                    ${priceSummary.breakdown
                        ? `<small class="hint">${breakdownLabel}: ${escape(priceSummary.breakdown)}</small>`
                        : ""}
                </div>`
                : ""}
            <ol style="margin:0.5rem 0;padding-left:1.25rem;">
                ${rows}
            </ol>
            <footer class="card-buttons">
                <button
                    type="button"
                    data-cc-stock-transfer
                >
                    <i class="fas fa-boxes-packing"></i>
                    ${addToActorLabel}
                </button>
            </footer>
        </section>
    `);

    return ChatMessage.create({
        speaker: ChatMessage.getSpeaker(),
        content,
        flags: {
            [MODULE_ID]: {
                uniqueTableDraw: unique,
                stockTableDraw: true,
                tableUuid: table.uuid,
                requestedCount,
                selectedCount,
                unique,
                priceMultiplier,
                stockItems:
                    entries.map(entry => ({
                        uuid: entry.uuid,
                        quantity: entry.quantity
                    }))
            }
        }
    });
}

export class TableProfileDrawService {

    static async getUniquePool(table) {
        if (table?.documentName !== "RollTable") {
            throw new Error(
                "INVALID_ROLL_TABLE"
            );
        }

        const leaves = new Map();

        await collectLeafEntries(
            table,
            1,
            leaves,
            new Set()
        );

        return [...leaves.values()]
            .filter(entry =>
                entry.uuid &&
                entry.weight > 0
            );
    }

    static async drawItems(
        table,
        count,
        {
            unique = false,
            displayChat = true,
            priceMultiplier = 1
        } = {}
    ) {
        if (table?.documentName !== "RollTable") {
            throw new Error(
                "INVALID_ROLL_TABLE"
            );
        }

        const requestedCount = Math.min(
            100,
            Math.max(
                1,
                Number.parseInt(count, 10) || 1
            )
        );
        const normalizedPriceMultiplier =
            Math.min(
                10,
                Math.max(
                    0.01,
                    Number(priceMultiplier) || 1
                )
            );
        const pool = await this.getUniquePool(table);
        const selected = unique
            ? sampleWithoutReplacement(
                pool,
                Math.min(requestedCount, pool.length)
            )
            : sampleWithReplacement(
                pool,
                requestedCount
            );
        const aggregated =
            aggregateSelectedEntries(selected);
        const hydrated =
            await hydrateSelectedEntries(
                aggregated,
                normalizedPriceMultiplier
            );
        const message =
            displayChat && hydrated.length
                ? await createDrawMessage(
                    table,
                    hydrated,
                    {
                        requestedCount,
                        selectedCount:
                            selected.length,
                        unique,
                        priceMultiplier:
                            normalizedPriceMultiplier
                    }
                )
                : null;

        return {
            results: hydrated,
            requestedCount,
            selectedCount: selected.length,
            availableCount: pool.length,
            uniqueCount: hydrated.length,
            priceMultiplier:
                normalizedPriceMultiplier,
            truncated:
                selected.length < requestedCount,
            message
        };
    }

    static async drawUnique(
        table,
        count,
        options = {}
    ) {
        return this.drawItems(
            table,
            count,
            {
                ...options,
                unique: true
            }
        );
    }
}
