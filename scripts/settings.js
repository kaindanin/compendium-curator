export const MODULE_ID = "compendium-curator";
export const STORAGE_SETTING = "storage";
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
                version: 2,
                activeProfile: "default",
                publicProfile: "default",

                profiles: {
                    default: {
                        rules: [],
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

}