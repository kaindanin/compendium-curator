import { debug } from "./debug.js";
import { registerSettings } from "./settings.js";
import { registerCompendiumBrowserHooks } from "./hooks/compendium-browser.js";
import { StorageService } from "./services/storage-service.js";

async function preloadItemRarityIndexes() {

    const itemPacks =
        game.packs.filter(
            pack =>
                pack.documentName === "Item"
        );

    if (!itemPacks.length)
        return;

    const results =
        await Promise.allSettled(
            itemPacks.map(pack =>
                pack.getIndex({
                    fields: [
                        "system.rarity"
                    ]
                })
            )
        );

    const failed =
        results.filter(
            result =>
                result.status === "rejected"
        );

    if (failed.length) {
        console.warn(
            "Compendium Curator | No se pudo cargar la rareza de algunos índices de objetos.",
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
     * El índice básico de algunos compendios de D&D5e no
     * incluye system.rarity. El inspector de tablas necesita
     * ese único campo para agrupar objetos por rareza, así que
     * enriquecemos el índice sin resolver documentos completos.
     */
    await preloadItemRarityIndexes();

    const normalized =
        await StorageService.initialize();

    if (normalized)
        debug("Almacenamiento normalizado");

});