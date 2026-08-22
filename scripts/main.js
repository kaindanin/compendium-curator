import { debug } from "./debug.js";
import { registerSettings } from "./settings.js";
import { registerCompendiumBrowserHooks } from "./hooks/compendium-browser.js";
import { StorageService } from "./services/storage-service.js";
import { ensureDnd5eDistributionIndexes } from "./ui/dnd5e-document-list.js";
import {
    registerItemPilesIntegration
} from "./integrations/item-piles.js";

Hooks.once("init", () => {

    debug("INIT");

    registerSettings();
    registerCompendiumBrowserHooks();
    registerItemPilesIntegration();

    debug("Settings registradas");

});

Hooks.on("renderApplicationV2", app => {

    if (
        app.constructor.name !==
            "TableManagerApplication" ||
        !app.browserApp
    ) {
        return;
    }

    /*
     * El Gestor de tablas y el modo Curador pueden convivir.
     * El bloqueo existía durante las primeras fases del gestor,
     * cuando ambas interfaces compartían estado de selección.
     *
     * El gestor actual mantiene su propio estado y puede reaccionar
     * a los cambios del Navegador de Compendios, por lo que ya no es
     * necesario impedir la curación mientras permanece abierto.
     */
    app.browserApp._ccTableManagerLocked = false;
    app.browserApp._ccRefreshToolbar?.();

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
     * CR). Iniciamos su carga aquí y reutilizamos la misma
     * promesa cuando se abre el Gestor de tablas.
     */
    await ensureDnd5eDistributionIndexes();

    const normalized =
        await StorageService.initialize();

    if (normalized)
        debug("Almacenamiento normalizado");

});
