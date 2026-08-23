import {
    MODULE_ID,
    TABLE_DEFAULTS_SETTING
} from "../settings.js";
import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";

const TABLE_MANAGER_CONFIGURATION_TYPE =
    "compendium-curator-table-manager-configuration";
const TABLE_MANAGER_CONFIGURATION_VERSION = 1;

export class TableManagerConfigurationService {

    static createExportBundle() {
        const tableProfiles =
            foundry.utils.deepClone(
                TableProfileStorageService.getStorage()
            );

        for (
            const profile
            of Object.values(
                tableProfiles.profiles ?? {}
            )
        ) {
            if (
                !profile ||
                typeof profile !== "object" ||
                Array.isArray(profile)
            ) {
                continue;
            }

            profile.generation = {};
        }

        const tableDefaults =
            foundry.utils.deepClone(
                game.settings.get(
                    MODULE_ID,
                    TABLE_DEFAULTS_SETTING
                ) ?? {}
            );

        return {
            type: TABLE_MANAGER_CONFIGURATION_TYPE,
            version:
                TABLE_MANAGER_CONFIGURATION_VERSION,
            moduleVersion:
                game.modules.get(MODULE_ID)?.version ??
                null,
            systemId: game.system?.id ?? null,
            systemVersion:
                game.system?.version ?? null,
            exportedAt: new Date().toISOString(),
            data: {
                tableDefaults,
                tableProfiles
            }
        };
    }

}
