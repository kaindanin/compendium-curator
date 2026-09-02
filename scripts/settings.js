export const MODULE_ID = "compendium-curator";
export const STORAGE_SETTING = "storage";
export const DUPLICATE_PRIORITY_SETTING = "duplicatePriority";
export const STORAGE_CHANGED_HOOK = `${MODULE_ID}.storageChanged`;
export const TABLE_DEFAULTS_SETTING = "tableDefaults";
export const TABLE_PROFILES_SETTING = "tableProfiles";
export const OBJECT_OVERRIDES_SETTING = "objectOverrides";

export function registerSettings({ tableDefaultsMenuType } = {}) {

    if (tableDefaultsMenuType) {
        game.settings.registerMenu(
            MODULE_ID,
            "tableDefaultsMenu",
            {
                name: "COMPENDIUM_CURATOR.TableDefaultsTitle",
                label: "COMPENDIUM_CURATOR.TableDefaultsOpen",
                hint: "COMPENDIUM_CURATOR.TableDefaultsHint",
                icon: "fas fa-table-list",
                type: tableDefaultsMenuType,
                restricted: true
            }
        );
    }

    game.settings.register(
        MODULE_ID,
        STORAGE_SETTING,
        {
            scope: "world",
            config: false,
            type: Object,

            default: {
                version: 3,
                activeProfile: "default",
                publicProfile: "default",

                profiles: {
                    default: {
                        name: "default",
                        hiddenUuids: [],
                        filters: {}
                    }
                }
            },

            onChange: storage => {

                Hooks.callAll(
                    STORAGE_CHANGED_HOOK,
                    storage
                );

            }
        }
    );

    game.settings.register(
        MODULE_ID,
        DUPLICATE_PRIORITY_SETTING,
        {
            scope: "world",
            config: false,
            type: Object,

            default: {
                sources: []
            }
        }
    );

    game.settings.register(
        MODULE_ID,
        TABLE_DEFAULTS_SETTING,
        {
            scope: "world",
            config: false,
            type: Object,

            default: {
                version: 1,

                grouping: "rarity",

                rarityWeights: {
                    mundane: 1,
                    common: 1,
                    uncommon: 1,
                    rare: 1,
                    veryRare: 1,
                    legendary: 1,
                    artifact: 1
                }
            }
        }
    );

    game.settings.register(
        MODULE_ID,
        TABLE_PROFILES_SETTING,
        {
            scope: "world",
            config: false,
            type: Object,

            default: {
                version: 10,
                profiles: {},
                filterGroups: {},
                folders: {},
                filterGroupFolders: {}
            }
        }
    );

    game.settings.register(
        MODULE_ID,
        OBJECT_OVERRIDES_SETTING,
        {
            scope: "world",
            config: false,
            type: Object,

            default: {
                version: 1,
                overrides: {}
            }
        }
    );

}
