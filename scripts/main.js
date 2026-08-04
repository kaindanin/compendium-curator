import { debug } from "./debug.js";
import { registerSettings } from "./settings.js";
import { registerCompendiumBrowserHooks } from "./hooks/compendium-browser.js";
import { StorageService } from "./services/storage-service.js";

Hooks.once("init", () => {

    debug("INIT");

    registerSettings();
    registerCompendiumBrowserHooks();

    debug("Settings registradas");

});

Hooks.once("ready", async () => {

    /*
     * Solo los usuarios autorizados pueden modificar
     * el almacenamiento mundial.
     */
    if (!game.user.can("SETTINGS_MODIFY"))
        return;

    const normalized =
        await StorageService.initialize();

    if (normalized)
        debug("Almacenamiento normalizado");

});