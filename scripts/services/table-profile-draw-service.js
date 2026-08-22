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
    const rows = entries.map(entry => `
        <li style="display:flex;align-items:center;gap:0.5rem;margin:0.25rem 0;">
            <img
                src="${escape(entry.img)}"
                alt=""
                width="32"
                height="32"
                style="border:0;border-radius:3px;"
            >
            <span>@UUID[${entry.uuid}]{${escape(entry.name)}}</span>
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
        const message =
            displayChat && selected.length
                ? await createUniqueDrawMessage(
                    table,
                    selected,
                    requestedCount
                )
                : null;

        return {
            results: selected,
            requestedCount,
            availableCount: pool.length,
            truncated:
                selected.length < requestedCount,
            message
        };
    }
}
