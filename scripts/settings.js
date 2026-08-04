export const MODULE_ID = "compendium-curator";
export const STORAGE_SETTING = "storage";

export function registerSettings() {

    game.settings.register(
        MODULE_ID,
        STORAGE_SETTING,
        {
            scope: "world",
            config: false,
            type: Object,
            default: {
                version: 1,
                activeProfile: "default",
                profiles: {
                    default: {
                        rules: [],
                        filters: {}
                    }
                }
            }
        }
    );

}