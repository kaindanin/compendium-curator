import { MODULE_ID } from "../settings.js";

const STOCK_ITEM_LIMIT = 100;
const INVENTORY_ACTOR_TYPES = new Set([
    "character",
    "npc",
    "vehicle"
]);

function normalizeStockItems(items) {
    return Array.from(items ?? [])
        .slice(0, STOCK_ITEM_LIMIT)
        .map(entry => ({
            uuid: String(entry?.uuid ?? "").trim(),
            quantity: Math.min(
                100,
                Math.max(
                    1,
                    Number.parseInt(
                        entry?.quantity,
                        10
                    ) || 1
                )
            )
        }))
        .filter(entry => entry.uuid);
}

function getStockFlags(message) {
    const flags = message?.flags?.[MODULE_ID];
    const items = normalizeStockItems(
        flags?.stockItems
    );

    if (!flags?.stockTableDraw || !items.length)
        return null;

    return {
        items,
        stockKey:
            String(
                flags.tableUuid ??
                message.uuid ??
                ""
            ).trim(),
        priceMultiplier: Math.min(
            10,
            Math.max(
                0.01,
                Number(flags.priceMultiplier) || 1
            )
        )
    };
}

function getTransferActors() {
    return game.actors
        .filter(actor =>
            INVENTORY_ACTOR_TYPES.has(actor.type) &&
            actor.isOwner
        )
        .map(actor => ({
            actor,
            merchant:
                game.itempiles?.API
                    ?.isItemPileMerchant?.(actor) === true
        }))
        .sort((left, right) => {
            if (left.merchant !== right.merchant)
                return left.merchant ? -1 : 1;

            return left.actor.name.localeCompare(
                right.actor.name,
                game.i18n.lang,
                { sensitivity: "base" }
            );
        });
}

function getDefaultActorId(actors) {
    const controlledActors = [
        ...new Set(
            (globalThis.canvas
                ?.tokens?.controlled ?? [])
                .map(token => token.actor)
                .filter(Boolean)
        )
    ];
    const controlled = controlledActors.find(actor =>
        actors.some(entry =>
            entry.actor.id === actor.id
        )
    );

    return controlled?.id ??
        actors.find(entry => entry.merchant)
            ?.actor.id ??
        actors[0]?.actor.id ??
        "";
}

function getAdjustedPrice(document, multiplier) {
    const value = Number(
        document?.system?.price?.value
    );

    if (!Number.isFinite(value) || value < 0)
        return null;

    return value * multiplier;
}

async function prepareTransferItems(
    stockItems,
    priceMultiplier,
    applyAdjustedPrices,
    stockKey
) {
    const prepared = [];

    for (const stockItem of stockItems) {
        let document = null;

        try {
            document = await fromUuid(
                stockItem.uuid
            );
        }
        catch (error) {
            console.warn(
                "Compendium Curator | No se pudo resolver un objeto para transferirlo.",
                stockItem.uuid,
                error
            );
        }

        if (document?.documentName !== "Item")
            continue;

        const item = document.toObject();

        delete item._id;
        foundry.utils.setProperty(
            item,
            "flags.core.sourceId",
            document.uuid
        );
        foundry.utils.setProperty(
            item,
            "system.quantity",
            stockItem.quantity
        );
        foundry.utils.setProperty(
            item,
            `flags.${MODULE_ID}.stockTransfer`,
            {
                managed: true,
                stockKey,
                sourceUuid: document.uuid
            }
        );

        if (applyAdjustedPrices) {
            const adjustedPrice =
                getAdjustedPrice(
                    document,
                    priceMultiplier
                );

            if (adjustedPrice !== null) {
                foundry.utils.setProperty(
                    item,
                    "system.price.value",
                    adjustedPrice
                );
            }
        }

        prepared.push({
            item,
            quantity: stockItem.quantity,
            sourceUuid: document.uuid,
            applyAdjustedPrices
        });
    }

    return prepared;
}

function getExistingSourceUuid(item) {
    return String(
        item?.flags?.core?.sourceId ??
        item?._stats?.compendiumSource ??
        ""
    ).trim();
}

async function addItemsNatively(actor, items) {
    const creates = [];
    const updates = [];

    for (const entry of items) {
        const existing = actor.items.find(item =>
            getExistingSourceUuid(item) ===
                entry.sourceUuid ||
            (
                item.name === entry.item.name &&
                item.type === entry.item.type
            )
        );

        if (!existing) {
            creates.push(entry.item);
            continue;
        }

        const currentQuantity = Math.max(
            0,
            Number(existing.system?.quantity) || 0
        );
        const update = {
            _id: existing.id,
            "system.quantity":
                currentQuantity + entry.quantity
        };
        const transferredPrice =
            foundry.utils.getProperty(
                entry.item,
                "system.price"
            );

        if (
            entry.applyAdjustedPrices &&
            transferredPrice
        ) {
            update["system.price"] =
                transferredPrice;
        }

        updates.push(update);
    }

    if (updates.length) {
        await actor.updateEmbeddedDocuments(
            "Item",
            updates
        );
    }

    if (creates.length) {
        await actor.createEmbeddedDocuments(
            "Item",
            creates
        );
    }

    return items.length;
}

function isManagedStockItem(item, stockKey) {
    const transfer =
        item?.flags?.[MODULE_ID]
            ?.stockTransfer;

    return (
        transfer?.managed === true &&
        transfer.stockKey === stockKey
    );
}

async function replaceManagedStock(
    actor,
    items,
    stockKey
) {
    const previous = actor.items
        .filter(item =>
            isManagedStockItem(
                item,
                stockKey
            )
        )
        .map(item => item.toObject());
    const previousIds = previous
        .map(item => item._id)
        .filter(Boolean);

    if (previousIds.length) {
        await actor.deleteEmbeddedDocuments(
            "Item",
            previousIds
        );
    }

    try {
        await actor.createEmbeddedDocuments(
            "Item",
            items.map(entry => entry.item)
        );
    }
    catch (error) {
        const partialIds = actor.items
            .filter(item =>
                isManagedStockItem(
                    item,
                    stockKey
                )
            )
            .map(item => item.id);

        if (partialIds.length) {
            await actor.deleteEmbeddedDocuments(
                "Item",
                partialIds
            );
        }

        if (previous.length) {
            await actor.createEmbeddedDocuments(
                "Item",
                previous.map(item => {
                    const restored =
                        foundry.utils.deepClone(
                            item
                        );

                    delete restored._id;
                    return restored;
                })
            );
        }

        throw error;
    }

    return items.length;
}

async function addItemsToActor(
    actor,
    items,
    {
        replacePreviousStock = false,
        stockKey = ""
    } = {}
) {
    if (replacePreviousStock) {
        return replaceManagedStock(
            actor,
            items,
            stockKey
        );
    }

    const itemPilesApi = game.itempiles?.API;

    if (typeof itemPilesApi?.addItems === "function") {
        await itemPilesApi.addItems(
            actor,
            items.map(entry => ({
                item: entry.item,
                quantity: entry.quantity
            }))
        );
        return items.length;
    }

    return addItemsNatively(actor, items);
}

function getRootElement(html) {
    if (html instanceof HTMLElement)
        return html;

    if (html?.[0] instanceof HTMLElement)
        return html[0];

    return null;
}

function isTruthyDialogValue(value) {
    return value === true ||
        value === "true" ||
        value === "on" ||
        value === 1 ||
        value === "1";
}

async function promptStockTransfer(message) {
    const stock = getStockFlags(message);

    if (!stock)
        return;

    const actors = getTransferActors();

    if (!actors.length) {
        ui.notifications.warn(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.NoInventoryActors"
            )
        );
        return;
    }

    const escape = foundry.utils.escapeHTML;
    const defaultActorId =
        getDefaultActorId(actors);
    const defaultReplacePreviousStock =
        actors.find(entry =>
            entry.actor.id === defaultActorId
        )?.merchant === true;
    const actorOptions = actors
        .map(({ actor, merchant }) => {
            const label = merchant
                ? game.i18n.format(
                    "COMPENDIUM_CURATOR.MerchantActorOption",
                    { name: actor.name }
                )
                : actor.name;

            return `<option value="${escape(actor.id)}" ${actor.id === defaultActorId ? "selected" : ""}>${escape(label)}</option>`;
        })
        .join("");
    const showAdjustedPrice =
        stock.priceMultiplier !== 1;
    const content = `
        <div class="form-group">
            <label>${escape(game.i18n.localize(
                "COMPENDIUM_CURATOR.TargetInventory"
            ))}</label>
            <div class="form-fields">
                <select name="actorId">${actorOptions}</select>
            </div>
        </div>
        <p class="hint">${escape(game.i18n.format(
            "COMPENDIUM_CURATOR.TransferStockHint",
            { count: stock.items.length }
        ))}</p>
        <div class="form-group">
            <label>${escape(game.i18n.localize(
                "COMPENDIUM_CURATOR.ReplacePreviousStock"
            ))}</label>
            <div class="form-fields">
                <input
                    type="checkbox"
                    name="replacePreviousStock"
                    ${defaultReplacePreviousStock ? "checked" : ""}
                >
            </div>
            <p class="hint">${escape(game.i18n.localize(
                "COMPENDIUM_CURATOR.ReplacePreviousStockHint"
            ))}</p>
        </div>
        ${showAdjustedPrice
            ? `<div class="form-group">
                <label>${escape(game.i18n.localize(
                    "COMPENDIUM_CURATOR.ApplyAdjustedPrices"
                ))}</label>
                <div class="form-fields">
                    <input type="checkbox" name="applyAdjustedPrices" checked>
                </div>
            </div>`
            : ""}
    `;
    const result =
        await foundry.applications.api.DialogV2
            .input({
                window: {
                    title: game.i18n.localize(
                        "COMPENDIUM_CURATOR.AddStockToActor"
                    )
                },
                content,
                ok: {
                    label: game.i18n.localize(
                        "COMPENDIUM_CURATOR.AddToInventory"
                    )
                },
                rejectClose: false,
                modal: true
            });

    if (!result)
        return;

    const actor = game.actors.get(
        String(result.actorId ?? "")
    );

    if (!actor?.isOwner) {
        ui.notifications.error(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.InvalidInventoryActor"
            )
        );
        return;
    }

    const applyAdjustedPrices =
        showAdjustedPrice &&
        isTruthyDialogValue(
            result.applyAdjustedPrices
        );
    const replacePreviousStock =
        isTruthyDialogValue(
            result.replacePreviousStock
        );
    const items = await prepareTransferItems(
        stock.items,
        stock.priceMultiplier,
        applyAdjustedPrices,
        stock.stockKey
    );

    if (!items.length) {
        ui.notifications.warn(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.NoTransferableStock"
            )
        );
        return;
    }

    await addItemsToActor(
        actor,
        items,
        {
            replacePreviousStock,
            stockKey: stock.stockKey
        }
    );

    ui.notifications.info(
        game.i18n.format(
            replacePreviousStock
                ? "COMPENDIUM_CURATOR.StockReplaced"
                : "COMPENDIUM_CURATOR.StockTransferred",
            {
                count: items.length,
                actor: actor.name
            }
        )
    );
}

function activateStockTransfer(message, html) {
    const root = getRootElement(html);

    if (!root)
        return;

    const buttons = root.querySelectorAll(
        "[data-cc-stock-transfer]"
    );
    const canTransfer =
        game.user.can("SETTINGS_MODIFY") &&
        Boolean(getStockFlags(message));

    for (const button of buttons) {
        if (!canTransfer) {
            button.remove();
            continue;
        }

        if (button.dataset.ccStockTransferActive)
            continue;

        button.dataset.ccStockTransferActive = "true";
        button.addEventListener(
            "click",
            async event => {
                event.preventDefault();
                event.stopPropagation();
                button.disabled = true;

                try {
                    await promptStockTransfer(message);
                }
                catch (error) {
                    console.error(
                        "Compendium Curator | Error transfiriendo el stock.",
                        error
                    );
                    ui.notifications.error(
                        game.i18n.localize(
                            "COMPENDIUM_CURATOR.StockTransferFailed"
                        )
                    );
                }
                finally {
                    if (button.isConnected)
                        button.disabled = false;
                }
            }
        );
    }
}

let hooksRegistered = false;

export function registerTableStockTransferHooks() {
    if (hooksRegistered)
        return;

    hooksRegistered = true;
    Hooks.on(
        "renderChatMessageHTML",
        activateStockTransfer
    );
    Hooks.on(
        "renderChatMessage",
        activateStockTransfer
    );
}

export class TableStockTransferService {

    static async addStockToActor(
        actor,
        stockItems,
        {
            priceMultiplier = 1,
            applyAdjustedPrices = true,
            replacePreviousStock = false,
            stockKey = ""
        } = {}
    ) {
        const normalizedStockKey =
            String(stockKey ?? "").trim() ||
            "manual";
        const items = await prepareTransferItems(
            normalizeStockItems(stockItems),
            Math.min(
                10,
                Math.max(
                    0.01,
                    Number(priceMultiplier) || 1
                )
            ),
            applyAdjustedPrices,
            normalizedStockKey
        );

        if (!items.length)
            return 0;

        await addItemsToActor(
            actor,
            items,
            {
                replacePreviousStock,
                stockKey: normalizedStockKey
            }
        );
        return items.length;
    }

}
