import {
    MODULE_ID,
    TABLE_PROFILES_SETTING
} from "../settings.js";

export class TableProfileStorageService {

    static #normalizeStorage(
        rawStorage
    ) {

        const source =
            foundry.utils.deepClone(
                rawStorage ?? {
                    version: 1,
                    profiles: {}
                }
            );

        const storage = {
            ...source,

            version: 3,

            profiles: {},

            filterGroups:
                foundry.utils.deepClone(
                    source.filterGroups ?? {}
                )
        };


        /*
         * Normalizar grupos que ya estén
         * almacenados de forma independiente.
         */
        for (
            const [groupId, sourceGroup]
            of Object.entries(
                storage.filterGroups
            )
        ) {

            storage.filterGroups[
                groupId
            ] = {
                ...sourceGroup,

                id:
                    groupId,

                revision:
                    Number(
                        sourceGroup
                            ?.revision ?? 1
                    )
            };

        }


        const usedGroupIds =
            new Set(
                Object.keys(
                    storage.filterGroups
                )
            );


        for (
            const [profileId, sourceProfile]
            of Object.entries(
                source.profiles ?? {}
            )
        ) {

            if (
                !sourceProfile ||
                typeof sourceProfile !==
                    "object"
            ) {
                continue;
            }


            const profile =
                foundry.utils.deepClone(
                    sourceProfile
                );


            profile.id ??=
                profileId;


            let filterGroupIds = [];


            /*
             * Perfil ya migrado.
             */
            if (
                Array.isArray(
                    profile.filterGroupIds
                )
            ) {

                filterGroupIds =
                    profile.filterGroupIds
                        .map(id =>
                            String(
                                id ?? ""
                            ).trim()
                        )
                        .filter(id =>
                            Boolean(
                                storage
                                    .filterGroups
                                    ?.[id]
                            )
                        );

            }


            /*
             * Perfil antiguo:
             * extraemos los grupos embebidos
             * y los convertimos en recursos
             * independientes.
             */
            else if (
                Array.isArray(
                    profile.filterGroups
                )
            ) {

                for (
                    const sourceGroup
                    of profile.filterGroups
                ) {

                    if (
                        !sourceGroup ||
                        typeof sourceGroup !==
                            "object"
                    ) {
                        continue;
                    }


                    let groupId =
                        String(
                            sourceGroup.id ?? ""
                        ).trim();


                    /*
                     * Conservamos el ID antiguo
                     * siempre que sea posible.
                     *
                     * Una colisión significa que
                     * dos grupos antiguos distintos
                     * compartían accidentalmente ID.
                     */
                    if (
                        !groupId ||
                        usedGroupIds.has(
                            groupId
                        )
                    ) {

                        do {

                            groupId =
                                foundry.utils
                                    .randomID();

                        }
                        while (
                            usedGroupIds.has(
                                groupId
                            )
                        );

                    }


                    usedGroupIds.add(
                        groupId
                    );


                    storage.filterGroups[
                        groupId
                    ] = {
                        ...foundry.utils
                            .deepClone(
                                sourceGroup
                            ),

                        id:
                            groupId,

                        revision:
                            Number(
                                sourceGroup
                                    .revision ?? 1
                            )
                    };


                    filterGroupIds.push(
                        groupId
                    );

                }

            }


            profile.filterGroupIds =
                [
                    ...new Set(
                        filterGroupIds
                    )
                ];


            /*
             * Desde v3 los grupos ya no viven
             * dentro del perfil almacenado.
             */
            delete profile.filterGroups;


            storage.profiles[
                profileId
            ] = profile;

        }


        return storage;

    }


    static #hydrateProfile(
        profile,
        storage
    ) {

        if (!profile)
            return null;


        const hydrated =
            foundry.utils.deepClone(
                profile
            );


        hydrated.filterGroups =
            Array.from(
                profile.filterGroupIds ?? []
            )
                .map(
                    filterGroupId =>
                        storage
                            .filterGroups
                            ?.[filterGroupId]
                )
                .filter(Boolean)
                .map(
                    filterGroup =>
                        foundry.utils
                            .deepClone(
                                filterGroup
                            )
                );


        return hydrated;

    }


    static async migrateStorage() {

        const current =
            game.settings.get(
                MODULE_ID,
                TABLE_PROFILES_SETTING
            ) ?? {
                version: 1,
                profiles: {}
            };


        const migrated =
            this.#normalizeStorage(
                current
            );


        if (
            foundry.utils.equals(
                current,
                migrated
            )
        ) {
            return false;
        }


        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            migrated
        );


        console.info(
            "Compendium Curator | Perfiles de tabla migrados al formato v3."
        );


        return true;

    }

    static async updateFilterGroupMatches(
        profileId,
        filterGroupId,
        uuids,
        browserFilters = null
    ) {

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
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
            !Array.from(
                profile.filterGroupIds ?? []
            ).includes(
                filterGroupId
            )
        ) {
            throw new Error(
                "TABLE_FILTER_GROUP_NOT_FOUND"
            );
        }


        const filterGroup =
            storage.filterGroups
                ?.[filterGroupId];


        if (!filterGroup) {
            throw new Error(
                "TABLE_FILTER_GROUP_NOT_FOUND"
            );
        }


        const matches =
            [
                ...new Set(
                    Array.from(
                        uuids ?? []
                    )
                        .map(uuid =>
                            String(
                                uuid ?? ""
                            ).trim()
                        )
                        .filter(Boolean)
                )
            ];


        matches.sort();


        const previous =
            Array.from(
                filterGroup.matches ?? []
            )
                .map(String)
                .sort();


        const matchesChanged =
            previous.length !==
                matches.length ||
            previous.some(
                (uuid, index) =>
                    uuid !==
                        matches[index]
            );


        let filtersChanged = false;


        if (
            browserFilters !== null
        ) {

            const previousFilters =
                filterGroup
                    .browser
                    ?.filters ??
                {};


            filtersChanged =
                !foundry.utils.equals(
                    previousFilters,
                    browserFilters
                );


            filterGroup.browser ??= {};


            filterGroup.browser.filters =
                foundry.utils.deepClone(
                    browserFilters
                );

        }


        filterGroup.matches =
            matches;


        filterGroup.refreshedAt =
            Date.now();


        const changed =
            matchesChanged ||
            filtersChanged;


        if (changed) {

            filterGroup.revision =
                Number(
                    filterGroup.revision ?? 1
                ) + 1;


            /*
             * Mientras todavía usamos el
             * sistema actual de revision del
             * perfil, marcamos como modificadas
             * todas las tablas que utilizan
             * este grupo compartido.
             *
             * Más adelante la generación
             * almacenará revisiones de
             * dependencias directamente.
             */
            for (
                const usedProfile
                of Object.values(
                    storage.profiles ?? {}
                )
            ) {

                if (
                    !Array.from(
                        usedProfile
                            .filterGroupIds ??
                        []
                    ).includes(
                        filterGroupId
                    )
                ) {
                    continue;
                }


                usedProfile.revision =
                    Number(
                        usedProfile
                            .revision ?? 1
                    ) + 1;

            }

        }


        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );


        return {
            profile:
                this.#hydrateProfile(
                    storage.profiles[
                        profileId
                    ],
                    storage
                ),

            filterGroup:
                foundry.utils.deepClone(
                    filterGroup
                ),

            changed
        };

    }

    static isFilterGroupNameTaken(
        profileId,
        name,
        excludeId = null
    ) {

        /*
         * profileId se conserva temporalmente
         * en la firma para no romper las
         * aplicaciones existentes.
         *
         * Desde v3 los nombres se comprueban
         * globalmente.
         */
        void profileId;


        const normalizedName =
            String(name)
                .trim()
                .normalize("NFD")
                .replace(
                    /[\u0300-\u036f]/g,
                    ""
                )
                .toLocaleLowerCase();


        if (!normalizedName)
            return false;


        return Object.values(
            this.getFilterGroups()
        ).some(
            filterGroup => {

                if (
                    excludeId &&
                    filterGroup.id ===
                        excludeId
                ) {
                    return false;
                }


                const normalizedGroupName =
                    String(
                        filterGroup.name ?? ""
                    )
                        .trim()
                        .normalize("NFD")
                        .replace(
                            /[\u0300-\u036f]/g,
                            ""
                        )
                        .toLocaleLowerCase();


                return (
                    normalizedGroupName ===
                    normalizedName
                );

            }
        );

    }

    static async setManualExcludes( profileId, uuids ) {

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
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

        const normalized =
            [
                ...new Set(
                    Array.from(
                        uuids ?? []
                    )
                        .map(uuid =>
                            String(
                                uuid ?? ""
                            ).trim()
                        )
                        .filter(Boolean)
                )
            ];

        normalized.sort();

        const previous =
            Array.from(
                profile.manualExcludes ?? []
            )
                .map(uuid =>
                    String(uuid)
                )
                .sort();

        const changed =
            previous.length !==
                normalized.length ||
            previous.some(
                (uuid, index) =>
                    uuid !==
                    normalized[index]
            );

        if (!changed)
            return profile;

        profile.manualExcludes =
            normalized;

        profile.revision =
            Number(
                profile.revision ?? 1
            ) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return profile;

    }

    static async setManualIncludes( profileId, uuids ) {

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
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

        const normalized =
            [
                ...new Set(
                    Array.from(
                        uuids ?? []
                    )
                        .map(uuid =>
                            String(
                                uuid ?? ""
                            ).trim()
                        )
                        .filter(Boolean)
                )
            ];

        normalized.sort();

        const previous =
            Array.from(
                profile.manualIncludes ?? []
            )
                .map(uuid =>
                    String(uuid)
                )
                .sort();

        const changed =
            previous.length !==
                normalized.length ||
            previous.some(
                (uuid, index) =>
                    uuid !==
                    normalized[index]
            );

        if (!changed)
            return profile;

        profile.manualIncludes =
            normalized;

        profile.revision =
            Number(
                profile.revision ?? 1
            ) + 1;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return profile;

    }


    static async addFilterGroup(
        profileId,
        filterGroup
    ) {

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
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


        const name =
            String(
                filterGroup?.name ?? ""
            ).trim();


        if (!name) {
            throw new Error(
                "FILTER_GROUP_NAME_REQUIRED"
            );
        }


        if (
            this.isFilterGroupNameTaken(
                profileId,
                name
            )
        ) {
            throw new Error(
                "FILTER_GROUP_NAME_TAKEN"
            );
        }


        storage.filterGroups ??= {};


        let id;


        do {

            id =
                foundry.utils.randomID();

        }
        while (
            storage.filterGroups[id]
        );


        const matches =
            [
                ...new Set(
                    Array.from(
                        filterGroup.matches ??
                            []
                    )
                        .map(uuid =>
                            String(
                                uuid ?? ""
                            ).trim()
                        )
                        .filter(Boolean)
                )
            ];


        matches.sort();


        const storedGroup = {
            id,
            name,

            revision: 1,

            browser:
                foundry.utils.deepClone(
                    filterGroup.browser ?? {}
                ),

            matches,

            refreshedAt:
                Date.now()
        };


        storage.filterGroups[
            id
        ] = storedGroup;


        profile.filterGroupIds ??= [];


        if (
            !profile.filterGroupIds
                .includes(id)
        ) {

            profile.filterGroupIds.push(
                id
            );

        }


        profile.revision =
            Number(
                profile.revision ?? 1
            ) + 1;


        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );


        return foundry.utils.deepClone(
            storedGroup
        );

    }

    static getStorage() {

        const storage =
            game.settings.get(
                MODULE_ID,
                TABLE_PROFILES_SETTING
            ) ?? {
                version: 1,
                profiles: {}
            };


        /*
         * Esto también permite trabajar de
         * forma segura aunque una operación
         * acceda al almacenamiento antes de
         * que migrateStorage() lo haya
         * persistido.
         */
        return this.#normalizeStorage(
            storage
        );

    }


    static getProfiles() {

        const storage =
            this.getStorage();


        return Object.fromEntries(
            Object.entries(
                storage.profiles ?? {}
            ).map(
                ([profileId, profile]) => [
                    profileId,

                    this.#hydrateProfile(
                        profile,
                        storage
                    )
                ]
            )
        );

    }


    static getFilterGroups() {

        return this.getStorage()
            .filterGroups ?? {};

    }


    static getFilterGroup(
        filterGroupId
    ) {

        return this.getFilterGroups()
            ?.[filterGroupId] ??
            null;

    }

    static isNameTaken(name, excludeId = null) {

        const normalizedName =
            String(name)
                .trim()
                .normalize("NFD")
                .replace(
                    /[\u0300-\u036f]/g,
                    ""
                )
                .toLocaleLowerCase();

        if (!normalizedName)
            return false;

        return Object.values(
            this.getProfiles()
        ).some(profile => {

            if (
                excludeId &&
                profile.id === excludeId
            ) {
                return false;
            }

            const normalizedProfileName =
                String(
                    profile.name ?? ""
                )
                    .trim()
                    .normalize("NFD")
                    .replace(
                        /[\u0300-\u036f]/g,
                        ""
                    )
                    .toLocaleLowerCase();

            return (
                normalizedProfileName ===
                normalizedName
            );

        });

    }

    static async create(profile) {

        const name =
            String(
                profile?.name ?? ""
            ).trim();

        if (!name) {
            throw new Error(
                "TABLE_PROFILE_NAME_REQUIRED"
            );
        }

        profile.name = name;

        if (
            this.isNameTaken(
                profile?.name
            )
        ) {
            throw new Error(
                "TABLE_PROFILE_NAME_TAKEN"
            );
        }

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        storage.version = 3;
        storage.profiles ??= {};
        storage.filterGroups ??= {};

        const id =
            foundry.utils.randomID();

        storage.profiles[id] = {
            id,

            ...foundry.utils.deepClone(
                profile
            )
        };


        const normalizedStorage =
            this.#normalizeStorage(
                storage
            );


        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            normalizedStorage
        );


        return this.#hydrateProfile(
            normalizedStorage.profiles[id],
            normalizedStorage
        );

    }

    static async renameProfile(
        profileId,
        name
    ) {

        const normalizedName =
            String(
                name ?? ""
            ).trim();

        if (!normalizedName) {
            throw new Error(
                "TABLE_PROFILE_NAME_REQUIRED"
            );
        }

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
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
            this.isNameTaken(
                normalizedName,
                profileId
            )
        ) {
            throw new Error(
                "TABLE_PROFILE_NAME_TAKEN"
            );
        }

        if (
            profile.name ===
            normalizedName
        ) {
            return profile;
        }

        profile.name =
            normalizedName;

        /*
        * Renombrar no modifica el contenido
        * que generará el perfil, por lo que
        * no incrementamos revision.
        *
        * Más adelante, si existe una RollTable
        * enlazada, se sincronizará su nombre
        * conservando su UUID.
        */

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return profile;

    }

    static async duplicateProfile(
        profileId,
        name
    ) {

        const normalizedName =
            String(
                name ?? ""
            ).trim();

        if (!normalizedName) {
            throw new Error(
                "TABLE_PROFILE_NAME_REQUIRED"
            );
        }

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
            );

        const source =
            storage.profiles
                ?.[profileId];

        if (
            !source ||
            source.version !== 2
        ) {
            throw new Error(
                "TABLE_PROFILE_NOT_FOUND"
            );
        }

        if (
            this.isNameTaken(
                normalizedName
            )
        ) {
            throw new Error(
                "TABLE_PROFILE_NAME_TAKEN"
            );
        }

        const id =
            foundry.utils.randomID();

        const duplicate =
            foundry.utils.deepClone(
                source
            );

        duplicate.id =
            id;

        duplicate.name =
            normalizedName;

        /*
        * El duplicado comienza su propio
        * historial de modificaciones.
        */
        duplicate.revision = 1;

        /*
        * Desde v3 los grupos son recursos
        * compartidos.
        *
        * El duplicado conserva las mismas
        * referencias a grupos que el original.
        */
        duplicate.filterGroupIds =
            [
                ...new Set(
                    source.filterGroupIds ?? []
                )
            ];

        delete duplicate.filterGroups;

        /*
        * Nunca heredamos enlaces a RollTables.
        * El nuevo perfil todavía no ha generado
        * ningún documento.
        */
        duplicate.generation = {
            masterUuid: null,
            groupUuids: {},
            generatedRevision: 0
        };

        storage.profiles[id] =
            duplicate;

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return duplicate;

    }

    static async removeProfile(
        profileId
    ) {

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
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

        delete storage.profiles[
            profileId
        ];

        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );

        return profile;

    }

        static async removeFilterGroup(
        profileId,
        filterGroupId
    ) {

        const storage =
            foundry.utils.deepClone(
                this.getStorage()
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


        const filterGroupIds =
            Array.from(
                profile.filterGroupIds ?? []
            );


        const nextFilterGroupIds =
            filterGroupIds.filter(
                id =>
                    id !==
                        filterGroupId
            );


        if (
            nextFilterGroupIds.length ===
            filterGroupIds.length
        ) {

            return this.#hydrateProfile(
                profile,
                storage
            );

        }


        /*
         * Importante:
         *
         * quitamos la REFERENCIA de esta
         * tabla, pero NO eliminamos el grupo
         * global.
         *
         * Después podremos reutilizarlo desde
         * la pestaña Grupos de filtros.
         */
        profile.filterGroupIds =
            nextFilterGroupIds;


        profile.revision =
            Number(
                profile.revision ?? 1
            ) + 1;


        await game.settings.set(
            MODULE_ID,
            TABLE_PROFILES_SETTING,
            storage
        );


        return this.#hydrateProfile(
            profile,
            storage
        );

    }

}