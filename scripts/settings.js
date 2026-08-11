export const MODULE_ID = "compendium-curator";
export const STORAGE_SETTING = "storage";
export const DUPLICATE_PRIORITY_SETTING = "duplicatePriority";
export const STORAGE_CHANGED_HOOK = `${MODULE_ID}.storageChanged`;

export function registerSettings() {

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

}