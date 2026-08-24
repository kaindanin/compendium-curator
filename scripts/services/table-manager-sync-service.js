import {
    STORAGE_CHANGED_HOOK
} from "../settings.js";
import {
    TableProfileStorageService
} from "./table-profile-storage-service.js";
import {
    TableProfileService
} from "./table-profile-service.js";

const managers = new Set();
const syncTimers = new WeakMap();

function isTableManager(app) {
    return (
        app?.constructor?.name ===
            "TableManagerApplication" &&
        app?.browserApp
    );
}

function normalizeMatches(uuids) {
    return [
        ...new Set(
            Array.from(uuids ?? [])
                .map(uuid =>
                    String(uuid ?? "").trim()
                )
                .filter(Boolean)
        )
    ].sort();
}

function matchesEqual(left, right) {
    if (left.length !== right.length)
        return false;

    return left.every(
        (uuid, index) =>
            uuid === right[index]
    );
}

async function synchronizeFilterGroups(manager) {
    if (
        !manager?.rendered ||
        !manager.browserApp?.element?.isConnected
    ) {
        return false;
    }

    if (manager._ccFilterGroupSyncPromise) {
        return manager._ccFilterGroupSyncPromise;
    }

    manager._ccFilterGroupSyncPromise =
        (async () => {
            let changed = false;

            const groups = Object.values(
                TableProfileStorageService
                    .getFilterGroups()
            );

            for (const group of groups) {
                const filters =
                    group?.browser?.filters;

                if (!filters)
                    continue;

                const candidates =
                    await TableProfileService
                        .getBrowserCandidates(
                            manager.browserApp,
                            filters
                        );

                const matches = normalizeMatches(
                    candidates.map(
                        candidate => candidate.uuid
                    )
                );
                const previous = normalizeMatches(
                    group.matches
                );

                if (matchesEqual(matches, previous))
                    continue;

                await TableProfileStorageService
                    .updateFilterGroupMatches(
                        null,
                        group.id,
                        matches,
                        filters
                    );

                changed = true;
            }

            return changed;
        })()
            .catch(error => {
                console.error(
                    "Compendium Curator | Error actualizando automáticamente los grupos de filtros.",
                    error
                );

                return false;
            })
            .finally(() => {
                manager._ccFilterGroupSyncPromise =
                    null;
            });

    return manager._ccFilterGroupSyncPromise;
}

function scheduleManagerRefresh(
    manager,
    {
        delay = 0,
        synchronize = true
    } = {}
) {
    if (!manager?.rendered)
        return;

    const previous = syncTimers.get(manager);

    if (previous)
        clearTimeout(previous);

    const timer = setTimeout(
        async () => {
            syncTimers.delete(manager);

            if (!manager.rendered)
                return;

            if (synchronize) {
                await synchronizeFilterGroups(
                    manager
                );
            }

            if (manager.rendered) {
                manager.render({ force: true });
            }
        },
        delay
    );

    syncTimers.set(manager, timer);
}

function refreshOpenManagers(options = {}) {
    for (const manager of [...managers]) {
        if (!manager?.rendered) {
            managers.delete(manager);
            continue;
        }

        scheduleManagerRefresh(
            manager,
            options
        );
    }
}

export function registerTableManagerSynchronization() {
    Hooks.on(
        "renderApplicationV2",
        app => {
            if (!isTableManager(app))
                return;

            managers.add(app);

            /*
             * Curador y Gestor pueden convivir.
             */
            app.browserApp._ccTableManagerLocked =
                false;
            app.browserApp._ccRefreshToolbar?.();

            if (
                app._ccFilterGroupsInitialSync ===
                true
            ) {
                return;
            }

            app._ccFilterGroupsInitialSync = true;

            scheduleManagerRefresh(
                app,
                {
                    delay: 0,
                    synchronize: true
                }
            );
        }
    );

    /*
     * Ocultar/restaurar objetos o cambiar el
     * perfil Curador afecta al contenido efectivo
     * de las tablas y a las coincidencias vivas.
     */
    Hooks.on(
        STORAGE_CHANGED_HOOK,
        () => {
            refreshOpenManagers({
                delay: 0,
                synchronize: true
            });
        }
    );

    /*
     * Los filtros representan criterios vivos.
     * Si cambian documentos mientras el gestor
     * permanece abierto, se vuelven a evaluar.
     */
    for (const hook of [
        "createItem",
        "updateItem",
        "deleteItem",
        "createActor",
        "updateActor",
        "deleteActor"
    ]) {
        Hooks.on(
            hook,
            () => {
                refreshOpenManagers({
                    delay: 200,
                    synchronize: true
                });
            }
        );
    }

}
