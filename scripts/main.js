import { debug } from "./debug.js";
import { registerSettings } from "./settings.js";
import {
    TableDefaultsApplication
} from "./applications/table-defaults-application.js";
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
import {
    registerTableManagerRecursivePreview
} from "./services/table-manager-recursive-preview-service.js";
import {
    registerTableManagerDirectContentMode
} from "./services/table-manager-direct-content-mode-service.js";
import {
    registerTableManagerDirectContentEditor
} from "./services/table-manager-direct-content-editor-service.js";
import {
    registerTableManagerStructuralContent
} from "./services/table-manager-structural-content-service.js";
import {
    registerTableManagerLinkedTableExpandedPreview
} from "./services/table-manager-linked-table-expanded-preview-service.js";
import {
    registerTableManagerFolders
} from "./services/table-manager-folder-service.js";
import {
    registerTableManagerFilterGroupFolders
} from "./services/table-manager-filter-group-folder-service.js";
import {
    registerTableManagerBulkActions
} from "./services/table-manager-bulk-actions-service.js";
import {
    registerItemSheetOverridePrototype
} from "./hooks/item-sheet-overrides.js";

Hooks.once("init", () => {

    debug("INIT");

    registerSettings({
        tableDefaultsMenuType: TableDefaultsApplication
    });
    registerCompendiumBrowserHooks();
    registerItemPilesIntegration();
    registerTableManagerSynchronization();
    registerTableManagerConfigurationControls();
    registerTableManagerRecursiveNesting();
    registerTableManagerUnifiedTabs();
    registerTableManagerRecursivePreview();
    registerTableManagerDirectContentMode();
    registerTableManagerDirectContentEditor();
    registerTableManagerStructuralContent();
    registerTableManagerLinkedTableExpandedPreview();
    registerTableManagerFolders();
    registerTableManagerFilterGroupFolders();
    registerTableManagerBulkActions();
    registerItemSheetOverridePrototype();

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
