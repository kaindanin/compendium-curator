import {
    MODULE_ID,
    TABLE_PROFILES_SETTING
} from "../settings.js";

import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";


export class TableProfileFilterGroupLinkService {

    static async setProfileFilterGroups(
        profileId,
        filterGroupIds
    ) {

        const storage =
            foundry.utils.deepClone(
                TableProfileStorageService
                    .getStorage()
            );

        const profile =
            storage.profiles
                ?.[profileId];

        if (
            !profile ||
            profile.version !== 2
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        if (
            profile.type === "nested"
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_CONTENT"
            );
        }

        const availableGroups =
            storage.filterGroups ?? {};

        const nextIds =
            [
                ...new Set(
                    Array.from(
                        filterGroupIds ?? []
                    )
                        .map(id =>
                            String(
                                id ?? ""
                            ).trim()
                        )
                        .filter(id =>
                            Boolean(
                                availableGroups[id]
                            )
                        )
                )
            ];

        const previousIds =
            [
                ...new Set(
                    Array.from(
                        profile.filterGroupIds ?? []
                    )
                        .map(String)
                        .filter(id =>
                            Boolean(
                                availableGroups[id]
                            )
                        )
                )
            ];

        const previousSorted =
            [...previousIds].sort();

        const nextSorted =
            [...nextIds].sort();

        const changed =
            previousSorted.length !==
                nextSorted.length ||
            previousSorted.some(
                (id, index) =>
                    id !== nextSorted[index]
            );

        if (!changed) {
            return {
                changed: false,
                filterGroupIds:
                    previousIds
            };
        }

        profile.filterGroupIds =
            nextIds;

        profile.revision =
            Number(
                profile.revision ?? 1
            ) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return {
            changed: true,
            filterGroupIds:
                [...nextIds]
        };

    }

}
