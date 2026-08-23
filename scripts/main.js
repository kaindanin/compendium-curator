import { debug } from "./debug.js";
import { registerSettings } from "./settings.js";
import { registerCompendiumBrowserHooks } from "./hooks/compendium-browser.js";
import { StorageService } from "./services/storage-service.js";
import { ensureDnd5eDistributionIndexes } from "./ui/dnd5e-document-list.js";
import {
    registerItemPilesIntegration
} from "./integrations/item-piles.js";
import {
    registerTableManagerSynchronization
} from "./services/table-manager-sync-service.js";
import {
    registerTableManagerConfigurationControls
} from "./services/table-manager-configuration-service.js";
import {
    registerTableManagerRecursiveNesting
} from "./services/table-manager-recursive-nesting-service.js";
import {
    registerTableManagerUnifiedTabs
} from "./services/table-manager-unified-tabs-service.js";

Hooks.once("init", () => {

    debug("INIT");

    registerSettings();
    registerCompendiumBrowserHooks();
    registerItemPilesIntegration();
    registerTableManagerSynchronization();
    registerTableManagerConfigurationControls();
    registerTableManagerRecursiveNesting();
    registerTableManagerUnifiedTabs();

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
     * CR). Iniciamos su carga aquí y reutilizamos la misma
     * promesa cuando se abre el Gestor de tablas.
     */
    await ensureDnd5eDistributionIndexes();

    const normalized =
        await StorageService.initialize();

    if (normalized)
        debug("Almacenamiento normalizado");

});
