import { debug } from "./debug.js";
import { registerSettings } from "./settings.js";
import { registerCompendiumBrowserHooks } from "./hooks/compendium-browser.js";
import { StorageService } from "./services/storage-service.js";

async function preloadDistributionIndexes() {

    const requests = [];

    for (const pack of game.packs) {
        if (pack.documentName === "Item") {
            requests.push(
                pack.getIndex({
                    fields: [
                        "system.rarity",
                        "system.source"
                    ]
                })
            );
            continue;
        }

        if (pack.documentName === "Actor") {
            requests.push(
                pack.getIndex({
                    fields: [
                        "system.details.cr",
                        "system.source"
                    ]
                })
            );
        }
    }

    if (!requests.length)
        return;

    const results =
        await Promise.allSettled(requests);

    const failed =
        results.filter(
            result =>
                result.status === "rejected"
        );

    if (failed.length) {
        console.warn(
            "Compendium Curator | No se pudieron cargar algunos campos de distribución en los índices.",
            failed.map(
                result => result.reason
            )
        );
    }

}

Hooks.once("init", () => {

    debug("INIT");

    registerSettings();
    registerCompendiumBrowserHooks();

    debug("Settings registradas");

});

Hooks.once("ready", async () => {

    /*
     * Solo los usuarios autorizados pueden modificar
     * el almacenamiento mundial y abrir las herramientas
     * de gestión de tablas.
     */
    if (!game.user.can("SETTINGS_MODIFY"))
        return;

    /*
     * Algunos índices básicos de D&D5e no incluyen todos
     * los campos que usa la distribución (rareza, fuente y
     * CR). Los enriquecemos aquí sin resolver documentos
     * completos para conservar el rendimiento del inspector.
     */
    await preloadDistributionIndexes();

    const normalized =
        await StorageService.initialize();

    if (normalized)
        debug("Almacenamiento normalizado");

});