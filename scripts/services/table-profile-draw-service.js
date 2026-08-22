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

function formatItemPrice(document) {
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
        return "";
    }

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

async function hydrateSelectedEntries(entries) {
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

            return {
                ...entry,
                name:
                    document?.name ?? entry.name,
                img:
                    document?.img ?? entry.img,
                price:
                    formatItemPrice(document)
            };
        })
    );
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

async function createUniqueDrawMessage(
    table,
    entries,
    requestedCount
) {
    const escape = foundry.utils.escapeHTML;
    const priceLabel = escape(
        game.i18n.localize(
            "COMPENDIUM_CURATOR.ItemPrice"
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
                <span>@UUID[${entry.uuid}]{${escape(entry.name)}}</span>
                ${entry.price
                    ? `<small class="hint"><strong>${priceLabel}:</strong> ${escape(entry.price)}</small>`
                    : ""}
            </span>
        </li>
    `).join("");
    const content = await enrichChatContent(`
        <section class="dnd5e chat-card cc-unique-table-draw">
            <header class="card-header flexrow">
                <img src="${escape(table.img)}" alt="" width="36" height="36">
                <h3>${escape(table.name)}</h3>
            </header>
            <p>${escape(game.i18n.format(
                "COMPENDIUM_CURATOR.UniqueDrawSummary",
                {
                    count: entries.length,
                    requested: requestedCount
                }
            ))}</p>
            <ol style="margin:0.5rem 0;padding-left:1.25rem;">
                ${rows}
            </ol>
        </section>
    `);

    return ChatMessage.create({
        speaker: ChatMessage.getSpeaker(),
        content,
        flags: {
            [MODULE_ID]: {
                uniqueTableDraw: true,
                tableUuid: table.uuid
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

    static async drawUnique(
        table,
        count,
        {
            displayChat = true
        } = {}
    ) {
        const requestedCount = Math.min(
            100,
            Math.max(
                1,
                Number.parseInt(count, 10) || 1
            )
        );
        const pool = await this.getUniquePool(table);
        const selected = sampleWithoutReplacement(
            pool,
            Math.min(requestedCount, pool.length)
        );
        const hydrated =
            await hydrateSelectedEntries(selected);
        const message =
            displayChat && hydrated.length
                ? await createUniqueDrawMessage(
                    table,
                    hydrated,
                    requestedCount
                )
                : null;

        return {
            results: hydrated,
            requestedCount,
            availableCount: pool.length,
            truncated:
                hydrated.length < requestedCount,
            message
        };
    }
}
