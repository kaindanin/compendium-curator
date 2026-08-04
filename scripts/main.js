import { debug } from "./debug.js";
import { registerSettings } from "./settings.js";
import { registerCompendiumBrowserHooks } from "./hooks/compendium-browser.js";

Hooks.once("init", () => {

    debug("INIT");

    registerSettings();
    registerCompendiumBrowserHooks();

    debug("Settings registradas");

});

Hooks.once("ready", () => {

    debug("READY");

});