import { StorageService } from "./storage-service.js";
import { CuratorState } from "../state/curator-state.js";
import {
    getCategoryManualIncludeUuids
} from "./table-category-content-service.js";

function serializeValue(value) {

    if (value instanceof Set) {

        return [...value]
            .map(entry =>
                serializeValue(entry)
            );

    }

    if (value instanceof Map) {

        return Object.fromEntries(
            [...value.entries()]
                .map(([key, entry]) => [
                    key,
                    serializeValue(entry)
                ])
        );

    }

    if (Array.isArray(value)) {

        return value.map(entry =>
            serializeValue(entry)
        );

    }

    if (
        value &&
        typeof value === "object"
    ) {

        return Object.fromEntries(
            Object.entries(value)
                .map(([key, entry]) => [
                    key,
                    serializeValue(entry)
                ])
        );

    }

    return value;

}

function hasRangeValue(value) {

    return (
        value !== undefined &&
        value !== null &&
        value !== ""
    );

}

function candidateDocumentName(candidate) {
    const directName = String(
        candidate?.documentName ??
        candidate?.constructor?.documentName ??
        ""
    ).trim();

    if (directName)
        return directName;

    const uuid = String(
        candidate?.uuid ?? ""
    ).trim();
    const parts = uuid.split(".");

    if (
        parts[0] === "Compendium" &&
        parts.length >= 4
    ) {
        return String(
            game.packs.get(
                `${parts[1]}.${parts[2]}`
            )?.documentName ?? ""
        ).trim();
    }

    return String(parts[0] ?? "").trim();
}

function candidatePassesItemRules(
    candidate,
    itemRules
) {
    if (
        itemRules?.excludeZeroPrice !== true ||
        candidateDocumentName(candidate) !== "Item"
    ) {
        return true;
    }

    return Number(
        candidate?.system?.price?.value
    ) > 0 && Boolean(
        String(
            candidate?.system?.price
                ?.denomination ?? ""
        ).trim()
    );
}


function compactBrowserFilters(filters) {

    const compact =
        foundry.utils.deepClone(
            filters ?? {}
        );

    const additional =
        compact.additional ?? {};

    const compactAdditional = {};

    for (
        const [key, value]
        of Object.entries(additional)
    ) {

        /*
         * Filtro booleano.
         *
         *  1 = incluir
         * -1 = excluir
         *  0 / ausente = neutral
         */
        if (
            value === 1 ||
            value === -1
        ) {

            compactAdditional[key] =
                value;

            continue;

        }

        if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value)
        ) {
            continue;
        }

        /*
         * Filtro de rango.
         *
         * Un cero aquí puede ser un valor
         * real, por lo que NO lo eliminamos.
         */
        if (
            "min" in value ||
            "max" in value
        ) {

            const range = {};

            if (
                hasRangeValue(
                    value.min
                )
            ) {
                range.min =
                    value.min;
            }

            if (
                hasRangeValue(
                    value.max
                )
            ) {
                range.max =
                    value.max;
            }

            if (
                Object.keys(range)
                    .length
            ) {

                compactAdditional[key] =
                    range;

            }

            continue;

        }

        /*
         * Filtro de conjunto.
         *
         * Solo almacenamos estados activos.
         */
        const states = {};

        for (
            const [choice, state]
            of Object.entries(value)
        ) {

            if (
                state !== 1 &&
                state !== -1
            ) {
                continue;
            }

            states[choice] =
                state;

        }

        if (
            Object.keys(states)
                .length
        ) {

            compactAdditional[key] =
                states;

        }

    }

    if (
        Object.keys(
            compactAdditional
        ).length
    ) {

        compact.additional =
            compactAdditional;

    } else {

        delete compact.additional;

    }

    return compact;

}

function captureEffectiveBrowserFilters(
    app
) {

    if (!app?.currentFilters)
        return {};


    /*
     * Partimos del estado general para
     * conservar documentClass, arbitrary,
     * etc.
     */
    const filters =
        serializeValue(
            app.currentFilters
        );


    /*
     * TIPOS
     *
     * No usamos currentFilters.types porque
     * D&D5e puede conservar pseudo-tipos como
     * "physical" o tipos anteriores.
     *
     * Solo guardamos los checkboxes reales
     * que están seleccionados ahora.
     */
    filters.types =
        Array.from(
            app.element
                ?.querySelectorAll(
                    `
                    [data-application-part="types"]
                    dnd5e-checkbox[data-action="setType"][value]
                    `
                ) ??
            []
        )
            .filter(
                control =>
                    control.checked
            )
            .map(
                control =>
                    control.defaultValue ??
                    control.getAttribute(
                        "value"
                    )
            )
            .filter(Boolean);


    /*
     * ADDITIONAL
     *
     * Eliminamos completamente lo que
     * arrastra currentFilters y lo
     * reconstruimos usando únicamente
     * los controles que existen AHORA
     * en el Browser.
     */
    delete filters.additional;


    const controls =
        app.element
            ?.querySelectorAll(
                '[name^="additional."]'
            ) ??
        [];


    for (
        const control
        of controls
    ) {

        const name =
            control.getAttribute(
                "name"
            );

        if (!name)
            continue;


        let value;


        /*
         * Filtros ternarios:
         * -1 / 0 / 1
         */
        if (
            control.tagName ===
            "FILTER-STATE"
        ) {

            value =
                Number(
                    control.value ?? 0
                );


            if (
                value !== 1 &&
                value !== -1
            ) {
                continue;
            }

        } else {

            /*
             * Rangos y demás inputs.
             */
            value =
                control.value;


            if (
                value === undefined ||
                value === null ||
                value === ""
            ) {
                continue;
            }

        }


        foundry.utils.setProperty(
            filters,
            name,
            value
        );

    }


    /*
     * Búsqueda por nombre.
     *
     * Usamos también el input real para no
     * depender del debounce interno de D&D5e.
     */
    const searchInput =
        app.element
            ?.querySelector(
                'search > input[name="name"]'
            );


    if (searchInput) {

        const name =
            String(
                searchInput.value ?? ""
            );


        if (name) {

            filters.name =
                name;

        } else {

            delete filters.name;

        }

    }


    return compactBrowserFilters(
        filters
    );

}

function localizeBrowserLabel(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return game.i18n.localize(
        String(value)
    );

}

function resolveFilterChoiceLabel(
    app,
    filterKey,
    choiceKey,
    configuredLabel = null
) {

    /*
     * 1. Etiqueta proporcionada directamente
     * por la definición del filtro.
     */
    if (
        configuredLabel !== null &&
        configuredLabel !== undefined
    ) {

        const localized =
            localizeBrowserLabel(
                configuredLabel
            );

        if (
            localized &&
            localized !== choiceKey
        ) {
            return localized;
        }

    }


    /*
     * 2. Intentamos obtener exactamente
     * la etiqueta que está mostrando
     * actualmente el Compendium Browser.
     *
     * Esto permite respetar modificaciones
     * realizadas por módulos/Babele.
     */
    const fieldName =
        `additional.${filterKey}.${choiceKey}`;

    const controls =
        app?.element
            ?.querySelectorAll(
                "[name]"
            ) ??
        [];

    const control =
        Array.from(controls)
            .find(
                element =>
                    element.getAttribute(
                        "name"
                    ) === fieldName
            );

    if (control) {

        let label = null;

        if (control.id) {

            label =
                app.element.querySelector(
                    `label[for="${
                        CSS.escape(
                            control.id
                        )
                    }"]`
                );

        }

        label ??=
            control
                .closest(
                    ".filter-choice"
                )
                ?.querySelector(
                    "label"
                );

        const text =
            label
                ?.textContent
                ?.trim();

        if (text)
            return text;

    }


    /*
     * 3. Buscar la clave en CONFIG.DND5E.
     *
     * Por ejemplo:
     * siege  -> DND5E.WeaponSiege
     * improv -> DND5E.WeaponImprov
     *
     * Muchas de estas configuraciones ya
     * están localizadas por D&D5e.
     */
    for (
        const config
        of Object.values(
            CONFIG.DND5E ?? {}
        )
    ) {

        if (
            !config ||
            typeof config !== "object" ||
            Array.isArray(config) ||
            !(choiceKey in config)
        ) {
            continue;
        }

        const value =
            config[choiceKey];

        let candidate =
            value;

        if (
            value &&
            typeof value === "object"
        ) {

            candidate =
                value.label ??
                value.name ??
                null;

        }

        if (!candidate)
            continue;

        const localized =
            localizeBrowserLabel(
                candidate
            );

        if (
            localized &&
            localized !== choiceKey
        ) {
            return localized;
        }

    }


    /*
     * Último recurso:
     * mantenemos la clave en vez de
     * ocultar un filtro válido.
     */
    return choiceKey;

}

function isBrowserFilterLoadActive(
    app,
    controller
) {

    return (
        app?._ccFilterLoadController ===
            controller &&
        !controller.signal.aborted
    );

}

function getBrowserActionHandler(
    app,
    action
) {

    const entry =
        app?.options
            ?.actions
            ?.[action];

    if (
        typeof entry ===
        "function"
    ) {
        return entry;
    }

    if (
        typeof entry?.handler ===
        "function"
    ) {
        return entry.handler;
    }

    return null;

}

function getBrowserTabTypes(
    app,
    tabId
) {

    const tab =
        app.constructor
            ?.TABS
            ?.find(
                entry =>
                    entry.tab === tabId
            );

    return tab?.types ?? [];

}

function normalizeBrowserTypesForTab(
    tab,
    types
) {

    const normalized =
        new Set(
            types ?? []
        );


    /*
     * "physical" es un pseudo-tipo que
     * D&D5e utiliza para construir la
     * pestaña Física del modo Básico.
     *
     * No representa una selección real
     * del usuario y no debe restaurarse
     * como tipo seleccionado.
     */
    if (tab === "physical") {

        normalized.delete(
            "physical"
        );

    }


    return normalized;

}

function waitForBrowserRender(
    app,
    signal,
    timeout = 4000
) {

    return new Promise(resolve => {

        if (signal?.aborted) {

            resolve(false);

            return;

        }

        let finished = false;
        let hookId = null;
        let timer = null;

        let onAbort = null;


        const finish =
            result => {

                if (finished)
                    return;

                finished = true;

                if (hookId !== null) {

                    Hooks.off(
                        "renderApplicationV2",
                        hookId
                    );

                }

                if (timer !== null)
                    clearTimeout(timer);

                if (
                    signal &&
                    onAbort
                ) {

                    signal.removeEventListener(
                        "abort",
                        onAbort
                    );

                }

                resolve(result);

            };


        onAbort =
            () => {

                finish(false);

            };


        hookId =
            Hooks.on(
                "renderApplicationV2",
                renderedApp => {

                    if (
                        renderedApp !== app
                    ) {
                        return;
                    }

                    finish(true);

                }
            );


        signal?.addEventListener(
            "abort",
            onAbort,
            {
                once: true
            }
        );


        timer =
            setTimeout(
                () => {

                    finish(false);

                },
                timeout
            );

    });

}


async function renderBrowserForLoad(
    app,
    options,
    controller
) {

    if (
        !isBrowserFilterLoadActive(
            app,
            controller
        )
    ) {
        return false;
    }


    const rendered =
        waitForBrowserRender(
            app,
            controller.signal
        );


    app.render(
        options
    );


    const completed =
        await rendered;


    return (
        completed &&
        isBrowserFilterLoadActive(
            app,
            controller
        )
    );

}


/*
 * Ejecuta cambios que normalmente provocarían
 * muchos app.render(), pero los acumula para
 * permitir un único render posterior.
 */
function withSuppressedBrowserRender(
    app,
    callback
) {

    const hadOwnRender =
        Object.prototype
            .hasOwnProperty
            .call(
                app,
                "render"
            );

    const ownRender =
        hadOwnRender
            ? app.render
            : null;


    app.render =
        () => app;


    try {

        return callback();

    } finally {

        if (hadOwnRender) {

            app.render =
                ownRender;

        } else {

            delete app.render;

        }

    }

}

function syncBrowserTypesBatch(
    app,
    desiredTypes,
    controller
) {

    const desired =
        new Set(
            desiredTypes ?? []
        );


    const setType =
        getBrowserActionHandler(
            app,
            "setType"
        );


    if (!setType) {

        console.warn(
            "Compendium Curator | No se encontró el handler setType de D&D5e."
        );

        return {
            changed: false,
            aborted: false,
            failed: true
        };

    }


    const controls =
        Array.from(
            app.element
                ?.querySelectorAll(
                    `
                    [data-application-part="types"]
                    dnd5e-checkbox[data-action="setType"][value]
                    `
                ) ??
            []
        );


    const controlsByType =
        new Map(
            controls
                .map(
                    control => [
                        control.defaultValue ??
                            control.getAttribute(
                                "value"
                            ),

                        control
                    ]
                )
                .filter(
                    ([type]) =>
                        Boolean(type)
                )
        );


    const sidebar =
        app.element
            ?.querySelector(
                ".sidebar"
            );


    if (!sidebar) {

        return {
            changed: false,
            aborted: false,
            failed: true
        };

    }


    let changed = false;


    withSuppressedBrowserRender(
        app,
        () => {

            /*
             * Incluimos también tipos internos
             * que no tengan un checkbox visible.
             *
             * Esto es necesario especialmente
             * para eliminar el pseudo-tipo
             * "physical" que añade D&D5e.
             */
            const currentTypes =
                new Set(
                    app.currentFilters
                        ?.types ??
                    []
                );


            const allTypes =
                new Set([
                    ...currentTypes,
                    ...desired,
                    ...controlsByType.keys()
                ]);


            for (
                const type
                of allTypes
            ) {

                if (
                    !isBrowserFilterLoadActive(
                        app,
                        controller
                    )
                ) {
                    return;
                }


                const current =
                    new Set(
                        app.currentFilters
                            ?.types ??
                        []
                    );


                const currentState =
                    current.has(type);

                const desiredState =
                    desired.has(type);


                if (
                    currentState ===
                    desiredState
                ) {
                    continue;
                }


                const control =
                    controlsByType.get(
                        type
                    );


                if (control) {

                    /*
                     * Tipo visible.
                     */
                    control.checked =
                        desiredState;

                    control.indeterminate =
                        false;


                    setType.call(
                        app,
                        new Event(
                            "change"
                        ),
                        control
                    );

                } else {

                    /*
                     * Tipo interno sin checkbox
                     * visible.
                     *
                     * El caso importante aquí
                     * es "physical".
                     */
                    const syntheticTarget = {

                        defaultValue:
                            type,

                        checked:
                            desiredState,

                        closest:
                            selector =>
                                selector ===
                                    ".sidebar"
                                    ? sidebar
                                    : null

                    };


                    setType.call(
                        app,
                        new Event(
                            "change"
                        ),
                        syntheticTarget
                    );

                }


                changed = true;

            }

        }
    );


    const current =
        new Set(
            app.currentFilters
                ?.types ??
            []
        );


    const correct =
        current.size ===
            desired.size &&
        [...desired]
            .every(
                type =>
                    current.has(type)
            );


    if (!correct) {

        console.warn(
            "Compendium Curator | Los tipos no quedaron correctamente restaurados.",
            {
                expected:
                    [...desired],

                current:
                    [...current]
            }
        );

    }


    return {
        changed,

        aborted:
            !isBrowserFilterLoadActive(
                app,
                controller
            ),

        failed:
            !correct
    };

}

function buildPendingAdditionalFields(
    filters
) {

    const pending = [];


    for (
        const [key, value]
        of Object.entries(
            filters.additional ?? {}
        )
    ) {

        /*
         * Booleano.
         */
        if (
            value === 1 ||
            value === -1
        ) {

            pending.push({
                name:
                    `additional.${key}`,

                value
            });

            continue;

        }


        if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value)
        ) {
            continue;
        }


        /*
         * Rango.
         */
        if (
            "min" in value ||
            "max" in value
        ) {

            if (
                hasRangeValue(
                    value.min
                )
            ) {

                pending.push({
                    name:
                        `additional.${key}.min`,

                    value:
                        value.min
                });

            }

            if (
                hasRangeValue(
                    value.max
                )
            ) {

                pending.push({
                    name:
                        `additional.${key}.max`,

                    value:
                        value.max
                });

            }

            continue;

        }


        /*
         * Set ternario.
         */
        for (
            const [choice, state]
            of Object.entries(value)
        ) {

            if (
                state !== 1 &&
                state !== -1
            ) {
                continue;
            }

            pending.push({
                name:
                    `additional.${key}.${choice}`,

                value:
                    state
            });

        }

    }


    /*
     * Fuente al final.
     */
    pending.sort(
        (a, b) => {

            const aSource =
                a.name.startsWith(
                    "additional.source."
                );

            const bSource =
                b.name.startsWith(
                    "additional.source."
                );

            return (
                Number(aSource) -
                Number(bSource)
            );

        }
    );


    return pending;

}


function applyBrowserFieldsBatch(
    app,
    pendingFields,
    searchName,
    controller
) {

    const setFilter =
        getBrowserActionHandler(
            app,
            "setFilter"
        );


    if (!setFilter) {

        console.warn(
            "Compendium Curator | No se encontró el handler setFilter de D&D5e."
        );

        return {
            changed: false,
            unavailable: [],
            aborted: false,
            failed: true
        };

    }


    const controls =
        new Map(
            Array.from(
                app.element
                    ?.querySelectorAll(
                        '[name^="additional."]'
                    ) ??
                []
            )
                .map(
                    control => [
                        control.getAttribute(
                            "name"
                        ),
                        control
                    ]
                )
        );


    const unavailable = [];

    let changed = false;


    withSuppressedBrowserRender(
        app,
        () => {

            for (
                const field
                of pendingFields
            ) {

                if (
                    !isBrowserFilterLoadActive(
                        app,
                        controller
                    )
                ) {
                    return;
                }


                const control =
                    controls.get(
                        field.name
                    );


                if (!control) {

                    unavailable.push(
                        field.name
                    );

                    continue;

                }


                const isFilterState =
                    control.tagName ===
                    "FILTER-STATE";


                const desired =
                    isFilterState
                        ? Number(
                            field.value
                        )
                        : String(
                            field.value ?? ""
                        );


                const current =
                    isFilterState
                        ? Number(
                            control.value ?? 0
                        )
                        : String(
                            control.value ?? ""
                        );


                if (
                    current === desired
                ) {
                    continue;
                }


                control.value =
                    desired;


                /*
                 * Handler REAL de D&D5e.
                 *
                 * Modifica directamente
                 * #filters.
                 */
                setFilter.call(
                    app,
                    new Event(
                        "change"
                    ),
                    control
                );


                changed = true;

            }


            /*
             * Nombre.
             */
            const input =
                app.element
                    ?.querySelector(
                        'search > input[name="name"]'
                    );


            if (
                input &&
                isBrowserFilterLoadActive(
                    app,
                    controller
                )
            ) {

                const desiredName =
                    String(
                        searchName ?? ""
                    );

                const currentName =
                    String(
                        app.currentFilters
                            ?.name ??
                        ""
                    );


                if (
                    currentName !==
                    desiredName
                ) {

                    input.value =
                        desiredName;


                    app._onSearchName({
                        target:
                            input
                    });


                    changed = true;

                }

            }

        }
    );


    return {
        changed,

        unavailable,

        aborted:
            !isBrowserFilterLoadActive(
                app,
                controller
            ),

        failed: false
    };

}

export class TableProfileService {

    static compactBrowserFilters(
        filters
    ) {

        return compactBrowserFilters(
            filters
        );

    }


    static getFilterDisplayGroups(
        app,
        storedFilters
    ) {

        if (!app)
            return [];

        const currentFilters =
            foundry.utils.deepClone(
                storedFilters ?? {}
            );

        currentFilters.documentClass ??=
            "Item";

        const storedTypes =
            currentFilters.types;

        currentFilters.types =
            storedTypes instanceof Set
                ? storedTypes
                : new Set(
                    storedTypes ?? []
                );

        const config =
            CONFIG[
                currentFilters
                    .documentClass
            ];

        if (!config)
            return [];

        const browserClass =
            app.constructor;

        let dataModels =
            Object.entries(
                config.dataModels ?? {}
            );

        if (
            currentFilters.types
                ?.size
        ) {

            dataModels =
                dataModels.filter(
                    ([type]) =>
                        currentFilters
                            .types
                            .has(type)
                );

        }

        let definitions =
            dataModels
                .map(
                    ([, dataModel]) =>
                        dataModel
                            .compendiumBrowserFilters ??
                        new Map()
                )
                .reduce(
                    (final, current) =>
                        browserClass
                            .intersectFilters(
                                current,
                                final,
                                currentFilters
                            ),
                    null
                ) ??
            new Map();

        /*
        * Fuente es añadida por el propio
        * Compendium Browser aparte de los
        * DataModels.
        */
        const sourceStates =
            currentFilters
                .additional
                ?.source ??
            {};

        const sourceBooks =
            CONFIG.DND5E
                .sourceBooks ??
            {};

        const sourceChoices =
            Object.fromEntries(
                Object.keys(
                    sourceStates
                ).map(key => {

                    const matchingSource =
                        Object.entries(
                            sourceBooks
                        ).find(
                            ([source]) =>
                                source.slugify({
                                    strict: true
                                }) === key
                        );

                    return [
                        key,
                        matchingSource
                            ?.[1] ??
                            key
                    ];

                })
            );

        definitions.set(
            "source",
            {
                label:
                    "DND5E.SOURCE.FIELDS.source.label",

                type:
                    "set",

                config: {
                    choices:
                        sourceChoices,

                    keyPath:
                        "system.source.slug"
                }
            }
        );

        const typeOrder = {
            general: 0,
            boolean: 1,
            range: 2,
            set: 3
        };

        const groups = [];

        const search = String(
            currentFilters.name ?? ""
        ).trim();

        if (search) {
            groups.push({
                key: "name",
                label: game.i18n.localize(
                    "COMPENDIUM_CURATOR.BrowserSearch"
                ),
                sort: typeOrder.general,
                index: -2,
                single: true,
                filterState: false,
                value: search,
                entries: []
            });
        }

        if (currentFilters.types.size) {
            const typeLabels = [
                ...currentFilters.types
            ].map(type =>
                localizeBrowserLabel(
                    config.typeLabels?.[type] ??
                    type
                )
            );

            groups.push({
                key: "types",
                label: game.i18n.localize(
                    "COMPENDIUM_CURATOR.ObjectTypes"
                ),
                sort: typeOrder.general,
                index: -1,
                single: true,
                filterState: false,
                value: typeLabels.join(", "),
                entries: []
            });
        }

        let definitionIndex = 0;

        for (
            const [key, definition]
            of definitions
        ) {

            const index =
                definitionIndex++;

            const value =
                currentFilters
                    .additional
                    ?.[key];

            const label =
                localizeBrowserLabel(
                    definition.label ??
                        key
                );

            /*
            * BOOLEAN
            */
            if (
                definition.type ===
                    "boolean"
            ) {

                if (
                    value !== 1 &&
                    value !== -1
                ) {
                    continue;
                }

                groups.push({
                    key,
                    label,

                    sort:
                        typeOrder.boolean,

                    index,

                    single:
                        true,

                    filterState:
                        true,

                    value:
                        String(value),

                    entries: []
                });

                continue;

            }

            /*
            * RANGE
            */
            if (
                definition.type ===
                    "range"
            ) {

                const hasMin =
                    hasRangeValue(
                        value?.min
                    );

                const hasMax =
                    hasRangeValue(
                        value?.max
                    );

                if (
                    !hasMin &&
                    !hasMax
                ) {
                    continue;
                }

                let displayValue;

                if (
                    hasMin &&
                    hasMax
                ) {

                    displayValue =
                        `${value.min}–${value.max}`;

                } else if (hasMin) {

                    displayValue =
                        `≥ ${value.min}`;

                } else {

                    displayValue =
                        `≤ ${value.max}`;

                }

                groups.push({
                    key,
                    label,

                    sort:
                        typeOrder.range,

                    index,

                    single:
                        true,

                    value:
                        displayValue,

                    entries: []
                });

                continue;

            }

            /*
            * SET
            */
            if (
                definition.type !==
                    "set" ||
                !value ||
                typeof value !==
                    "object"
            ) {
                continue;
            }

            let choices =
                definition
                    .config
                    ?.choices ??
                {};

            if (
                typeof choices ===
                    "function"
            ) {

                choices =
                    choices(
                        currentFilters
                    );

            }

            const entries = [];

            const usedChoices =
                new Set();

            /*
            * Valor vacío especial,
            * como rareza mundana.
            */
            if (
                definition
                    .config
                    ?.blank &&
                (
                    value._blank === 1 ||
                    value._blank === -1
                )
            ) {

                entries.push({
                    label:
                        localizeBrowserLabel(
                            definition
                                .config
                                .blank
                        ),

                    filterState:
                        true,

                    value:
                        String(
                            value._blank
                        )
                });

                usedChoices.add(
                    "_blank"
                );

            }

            /*
            * Respetamos exactamente el orden
            * de choices definido por D&D5e.
            */
            for (
                const [choiceKey, choice]
                of Object.entries(choices)
            ) {

                const state =
                    value[choiceKey];

                if (
                    state !== 1 &&
                    state !== -1
                ) {
                    continue;
                }

                let choiceLabel =
                    choice;

                if (
                    choice &&
                    typeof choice ===
                        "object"
                ) {

                    choiceLabel =
                        choice.label ??
                        choiceKey;

                }

                entries.push({
                    label:
                        resolveFilterChoiceLabel(
                            app,
                            key,
                            choiceKey,
                            choiceLabel
                        ),

                    filterState:
                        true,

                    value:
                        String(state)
                });

                usedChoices.add(
                    choiceKey
                );

            }

            /*
            * Compatibilidad con filtros
            * proporcionados por módulos que
            * ya no estén en choices.
            */
            for (
                const [choiceKey, state]
                of Object.entries(value)
            ) {

                if (
                    usedChoices.has(
                        choiceKey
                    ) ||
                    (
                        state !== 1 &&
                        state !== -1
                    )
                ) {
                    continue;
                }

                entries.push({
                    label:
                        resolveFilterChoiceLabel(
                            app,
                            key,
                            choiceKey
                        ),

                    filterState:
                        true,

                    value:
                        String(state)
                });

            }

            if (!entries.length)
                continue;

            groups.push({
                key,
                label,

                sort:
                    typeOrder.set,

                index,

                single:
                    false,

                value:
                    null,

                entries
            });

        }

        /*
        * Igual que el navegador de D&D5e:
        * booleanos -> rangos -> conjuntos.
        *
        * Dentro de cada tipo conservamos
        * el orden definido por D&D5e.
        */
        groups.sort(
            (a, b) =>
                (
                    a.sort -
                    b.sort
                ) ||
                (
                    a.index -
                    b.index
                )
        );

        return groups;

    }

    static async resolveLocalContentSources(
        app,
        profile,
        {
            applyManualIncludes = true,
            applyManualExcludes = true
        } = {}
    ) {
        const filterGroups =
            Array.isArray(
                profile?.filterGroups
            )
                ? profile.filterGroups
                : [];

        const hiddenUuids = new Set(
            StorageService.getHiddenUuids()
        );
        const manualExcludes = new Set(
            profile?.manualExcludes ?? []
        );
        const sources = [];
        const rawCandidatesByUuid = new Map();
        let manualIncludedCount = 0;

        const includeCandidate = (
            map,
            candidate
        ) => {
            const uuid = String(
                candidate?.uuid ?? ""
            ).trim();

            if (!uuid || hiddenUuids.has(uuid))
                return false;

            map.set(uuid, candidate);
            rawCandidatesByUuid.set(uuid, candidate);
            return true;
        };

        for (const filterGroup of filterGroups) {

            const categoryGroups = Array.isArray(
                filterGroup?.groups
            )
                ? filterGroup.groups
                : [filterGroup];
            const groupCandidates = new Map();
            const manualIncludeUuids = new Set(
                applyManualIncludes
                    ? getCategoryManualIncludeUuids(
                        filterGroup
                    )
                    : []
            );
            /*
             * AND se resuelve dentro de cada conjunto de
             * criterios mediante CompendiumBrowser.fetch.
             * Los grupos hermanos se unen aquí con OR y la
             * categoría se deduplica siempre por UUID.
             */
            for (const categoryGroup of categoryGroups) {
                const filters = categoryGroup
                    ?.browser?.filters;
                let candidates = [];

                if (
                    filters &&
                    typeof filters === "object" &&
                    !Array.isArray(filters)
                ) {
                    candidates = await this
                        .getBrowserCandidates(
                            app,
                            filters
                        );
                }
                else {
                    /*
                     * Solo para datos antiguos sin criterios
                     * recuperables: conservamos su referencia
                     * exacta en vez de inventar filtros.
                     */
                    const documents = await Promise.all(
                        (categoryGroup?.matches ?? [])
                            .map(uuid => fromUuid(uuid))
                    );

                    candidates = documents.filter(
                        document =>
                            document?.uuid &&
                            !hiddenUuids.has(document.uuid)
                    );
                }

                for (const candidate of candidates)
                    includeCandidate(groupCandidates, candidate);

                if (!applyManualIncludes)
                    continue;

                for (
                    const uuid
                    of categoryGroup?.manualIncludes ?? []
                ) {
                    if (groupCandidates.has(uuid))
                        continue;

                    const document = await fromUuid(uuid);

                    if (
                        !document?.uuid ||
                        hiddenUuids.has(document.uuid)
                    ) {
                        continue;
                    }

                    if (
                        includeCandidate(
                            groupCandidates,
                            document
                        )
                    ) {
                        manualIncludedCount++;
                    }
                }
            }

            if (applyManualIncludes) {
                for (
                    const uuid
                    of filterGroup?.manualIncludes ?? []
                ) {
                    if (groupCandidates.has(uuid))
                        continue;

                    const document = await fromUuid(uuid);

                    if (
                        includeCandidate(
                            groupCandidates,
                            document
                        )
                    ) {
                        manualIncludedCount++;
                    }
                }
            }

            for (
                const [uuid, candidate]
                of groupCandidates
            ) {
                if (
                    !manualIncludeUuids.has(uuid) &&
                    !candidatePassesItemRules(
                        candidate,
                        filterGroup?.itemRules
                    )
                ) {
                    groupCandidates.delete(uuid);
                }
            }

            sources.push({
                id: filterGroup.id,
                key: `filter:${filterGroup.id}`,
                kind: "category",
                name: filterGroup.name,
                candidates: groupCandidates,
                manualUuids: manualIncludeUuids
            });
        }

        const directCandidates = new Map();

        for (const uuid of profile?.directUuids ?? []) {
            const document = await fromUuid(uuid);
            includeCandidate(directCandidates, document);
        }

        if ((profile?.directUuids ?? []).length) {
            sources.push({
                id: "direct",
                key: "direct",
                kind: "manual",
                name: game.i18n.localize(
                    "COMPENDIUM_CURATOR.ManualInclusions"
                ),
                candidates: directCandidates,
                manualUuids: new Set(
                    profile?.directUuids ?? []
                )
            });
        }

        const manuallyExcludedUuids = new Set();
        const candidatesByUuid = new Map();
        const occurrencesByUuid = new Map();
        const groups = [];
        let totalMatches = 0;

        for (const source of sources) {
            for (const [uuid] of source.candidates) {
                if (
                    applyManualExcludes &&
                    manualExcludes.has(uuid)
                ) {
                    source.candidates.delete(uuid);
                    manuallyExcludedUuids.add(uuid);
                }
            }

            const candidates = [
                ...source.candidates.values()
            ];

            totalMatches += candidates.length;
            groups.push({
                id: source.id,
                key: source.key,
                kind: source.kind,
                name: source.name,
                count: candidates.length
            });

            for (const candidate of candidates) {
                const uuid = candidate.uuid;
                occurrencesByUuid.set(
                    uuid,
                    (occurrencesByUuid.get(uuid) ?? 0) + 1
                );
                candidatesByUuid.set(uuid, candidate);
            }
        }

        const candidates = [
            ...candidatesByUuid.values()
        ];

        const duplicateEntriesRemoved =
            Math.max(
                0,
                totalMatches -
                    candidates.length
            );

        const overlappingObjects =
            [
                ...occurrencesByUuid.values()
            ].filter(
                count => count > 1
            ).length;

        candidates.sort(
            (a, b) => String(a.name ?? "")
                .localeCompare(
                    String(b.name ?? ""),
                    game.i18n.lang,
                    { sensitivity: "base" }
                )
        );

        return {
            sources: sources.map(source => ({
                id: source.id,
                key: source.key,
                kind: source.kind,
                name: source.name,
                candidates: [
                    ...source.candidates.values()
                ],
                manualUuids: [
                    ...(source.manualUuids ?? [])
                ].filter(uuid =>
                    source.candidates.has(uuid)
                )
            })),
            groups,
            candidates,
            totalMatches,
            duplicateEntriesRemoved,
            overlappingObjects,
            manualIncludedCount,
            manualExcludedCount:
                manuallyExcludedUuids.size,
            restrictionExcludedCount:
                0,
            hasRestrictions: false,
            restrictionMatchCount: 0,
            rawUniqueCount:
                rawCandidatesByUuid.size,
            uniqueCount:
                candidates.length
        };
    }

    static async getProfilePreview(
        app,
        profile,
        options = {}
    ) {
        const resolved = await this
            .resolveLocalContentSources(
                app,
                profile,
                options
            );
        const candidates = resolved.candidates;

        const rarityCounts =
            new Map();

        for (const candidate of candidates) {

            const rarity =
                String(
                    candidate
                        .system
                        ?.rarity ??
                    ""
                ).trim();

            const key =
                rarity ||
                "mundane";

            rarityCounts.set(
                key,
                (
                    rarityCounts.get(
                        key
                    ) ?? 0
                ) + 1
            );

        }

        const rarityOrder = [
            "mundane",
            "common",
            "uncommon",
            "rare",
            "veryRare",
            "legendary",
            "artifact"
        ];

        const rarityGroups =
            rarityOrder
                .filter(key =>
                    rarityCounts.has(key)
                )
                .map(key => ({
                    key,

                    count:
                        rarityCounts.get(
                            key
                        )
                }));

        /*
        * Por si algún módulo utiliza una
        * rareza no estándar.
        */
        for (
            const [key, count]
            of rarityCounts
        ) {

            if (
                rarityOrder.includes(key)
            ) {
                continue;
            }

            rarityGroups.push({
                key,
                count
            });

        }

        return {
            ...resolved,
            rarityGroups,
            candidates
        };

    }

    static captureBrowserState(app) {

        if (!app?.currentFilters)
            return null;

        const advancedMode =
            app.constructor?.MODES?.ADVANCED;

        const selection =
            CuratorState.getSelection(app);

        const candidateUuids =
            Array.from(
                app.element.querySelectorAll(
                    ".item-list > .item[data-uuid]"
                )
            )
                .filter(item =>
                    !item.hidden
                )
                .map(item =>
                    item.dataset.uuid
                )
                .filter(Boolean);

        const selectedUuids =
            candidateUuids.filter(uuid =>
                selection.has(uuid)
            );

        const exclusions =
            candidateUuids.filter(uuid =>
                !selection.has(uuid)
            );

        return {

            version: 1,

            browser: {

                tab:
                    app.element
                        .querySelector(
                            '[data-application-part="tabs"] [data-tab].active'
                        )
                        ?.dataset.tab ??
                    null,

                advanced:
                    advancedMode !== undefined &&
                    app._mode === advancedMode,

                filters:
                    serializeValue(
                        app.currentFilters
                    )

            },

            curator: {

                profileId:
                    StorageService
                        .getVisibleProfileId(),

                showHidden:
                    app._ccShowHidden === true,

                duplicatesOnly:
                    app._ccDuplicatesOnly === true,

                translationConflictsOnly:
                    app
                        ._ccTranslationConflictsOnly
                        === true

            },

            selection: {

                candidateCount:
                    candidateUuids.length,

                selectedCount:
                    selectedUuids.length,

                exclusions

            }

        };

    }

    static async loadBrowserFilters(
        app,
        browserState
    ) {

        if (
            !app?.element?.isConnected ||
            !browserState?.filters
        ) {
            return false;
        }


        /*
        * Una nueva carga cancela
        * inmediatamente la anterior.
        */
        app._ccFilterLoadController
            ?.abort();

        const controller =
            new AbortController();

        app._ccFilterLoadController =
            controller;

        try {

            const filters =
                this.compactBrowserFilters(
                    browserState.filters
                );


            if (
                Array.isArray(
                    filters.arbitrary
                ) &&
                filters.arbitrary.length
            ) {
                return false;
            }


            const advancedMode =
                app.constructor
                    ?.MODES
                    ?.ADVANCED;


            /*
            * 1. Modo Básico / Avanzado.
            */
            if (
                advancedMode !== undefined
            ) {

                const desiredAdvanced =
                    browserState.advanced ===
                        true;

                const currentAdvanced =
                    app._mode ===
                        advancedMode;


                if (
                    desiredAdvanced !==
                    currentAdvanced
                ) {

                    const toggle =
                        app.element
                            .querySelector(
                                `
                                .mode-toggle
                                [data-action="toggleMode"]
                                `
                            );


                    if (!toggle)
                        return false;


                    const rendered =
                        waitForBrowserRender(
                            app,
                            controller.signal
                        );


                    toggle.click();


                    if (
                        !(await rendered)
                    ) {

                        return controller
                            .signal
                            .aborted
                                ? null
                                : false;

                    }

                }

            }


            if (
                !isBrowserFilterLoadActive(
                    app,
                    controller
                )
            ) {
                return null;
            }


            /*
            * 2. Pestaña.
            *
            * Incluso siendo la misma:
            * changeTab() limpia los filtros
            * adicionales anteriores.
            */
            const tab =
                browserState.tab;


            if (!tab)
                return false;

            const tabTypes =
                getBrowserTabTypes(
                    app,
                    tab
                );

            const desiredTypes =
                normalizeBrowserTypesForTab(
                    tab,
                    filters.types
                );


            /*
            * También normalizamos la copia temporal
            * utilizada en la verificación final.
            *
            * El perfil almacenado no se modifica.
            */
            filters.types =
                [...desiredTypes];

            {

                const rendered =
                    waitForBrowserRender(
                        app,
                        controller.signal
                    );


                app.changeTab(
                    tab,
                    "primary"
                );


                if (
                    !(await rendered)
                ) {

                    return controller
                        .signal
                        .aborted
                            ? null
                            : false;

                }

            }


            if (
                !isBrowserFilterLoadActive(
                    app,
                    controller
                )
            ) {
                return null;
            }


            /*
            * 3. Tipos.
            *
            * Todos se cambian SIN render
            * intermedio.
            */
            const typeResult =
                syncBrowserTypesBatch(
                    app,
                    desiredTypes,
                    controller
                );


            if (typeResult.aborted)
                return null;


            if (typeResult.failed)
                return false;


            /*
            * Los tipos cambian qué filtros
            * adicionales existen.
            *
            * Un único render actualiza todo.
            */
            if (typeResult.changed) {

                const rendered =
                    await renderBrowserForLoad(
                        app,
                        {
                            parts: [
                                "types",
                                "filters",
                                "results"
                            ],

                            dnd5e: {
                                browser: {
                                    types:
                                        tabTypes
                                }
                            },

                            changedTab:
                                true
                        },
                        controller
                    );


                if (!rendered) {

                    return controller
                        .signal
                        .aborted
                            ? null
                            : false;

                }

            }


            /*
            * 4. Additional + búsqueda.
            *
            * TODOS en lote.
            */
            const pendingFields =
                buildPendingAdditionalFields(
                    filters
                );

            const fieldResult =
                applyBrowserFieldsBatch(
                    app,
                    pendingFields,
                    filters.name ?? "",
                    controller
                );

            if (fieldResult.aborted)
                return null;

            if (fieldResult.failed)
                return false;

            /*
            * Un solo render para todos
            * los filtros adicionales.
            */
            if (fieldResult.changed) {

                const rendered =
                    await renderBrowserForLoad(
                        app,
                        {
                            parts: [
                                "filters",
                                "results"
                            ],

                            dnd5e: {
                                browser: {
                                    types:
                                        tabTypes
                                }
                            }
                        },
                        controller
                    );


                if (!rendered) {

                    return controller
                        .signal
                        .aborted
                            ? null
                            : false;

                }

            }


            if (
                !isBrowserFilterLoadActive(
                    app,
                    controller
                )
            ) {
                return null;
            }


            /*
            * 5. Verificación final.
            */
            const current =
                this.compactBrowserFilters(
                    serializeValue(
                        app.currentFilters
                    )
                );


            let expected =
                this.compactBrowserFilters(
                    filters
                );


            /*
            * No exigimos filtros que el
            * Browser actual no puede mostrar.
            *
            * Solo se retiran de esta
            * comparación, nunca del perfil.
            */
            for (
                const name
                of fieldResult.unavailable
            ) {

                foundry.utils
                    .unsetProperty(
                        expected,
                        name
                    );

            }


            expected =
                this.compactBrowserFilters(
                    expected
                );


            const currentComparable = {
                documentClass:
                    current.documentClass ??
                    null,

                types:
                    [
                        ...new Set(
                            current.types ?? []
                        )
                    ].sort(),

                additional:
                    current.additional ??
                    {},

                name:
                    current.name ??
                    ""
            };


            const expectedComparable = {
                documentClass:
                    expected.documentClass ??
                    null,

                types:
                    [
                        ...new Set(
                            expected.types ?? []
                        )
                    ].sort(),

                additional:
                    expected.additional ??
                    {},

                name:
                    expected.name ??
                    ""
            };


            if (
                !foundry.utils.equals(
                    currentComparable,
                    expectedComparable
                )
            ) {

                console.warn(
                    "Compendium Curator | Los filtros cargados no coinciden con los guardados.",
                    {
                        expected:
                            expectedComparable,

                        current:
                            currentComparable
                    }
                );

                return false;

            }


            return true;

        } catch (error) {

            if (
                controller.signal.aborted
            ) {
                return null;
            }


            console.error(
                "Compendium Curator | Error cargando filtros guardados.",
                error
            );

            return false;

        } finally {

            /*
            * Una operación antigua NO puede
            * desbloquear el Browser mientras
            * una carga nueva sigue activa.
            */
            if (
                app
                    ._ccFilterLoadController ===
                controller
            ) {

                app._ccFilterLoadController =
                    null;

            }

        }

    }

    static async getBrowserCandidates( app, filtersOverride = null ) {

        const sourceFilters =
            filtersOverride ??
            app?.currentFilters;

        if (!sourceFilters)
            return [];

        const currentFilters =
            foundry.utils.deepClone(
                sourceFilters
            );

        const storedTypes =
            currentFilters.types;

        currentFilters.types =
            storedTypes instanceof Set
                ? storedTypes
                : new Set(
                    storedTypes ?? []
                );

        const documentClassName =
            currentFilters.documentClass ??
            "Item";

        const config =
            CONFIG[documentClassName];

        const documentClass =
            config?.documentClass;

        if (!documentClass)
            return [];

        const browserClass =
            app.constructor;

        let dataModels =
            Object.entries(
                config.dataModels ?? {}
            );

        if (currentFilters.types?.size) {

            dataModels =
                dataModels.filter(
                    ([type]) =>
                        currentFilters.types.has(type)
                );

        }

        /*
        * Reproducimos las mismas definiciones
        * de filtros que utiliza D&D5e.
        */
        const filterDefinitions =
            dataModels
                .map(
                    ([, dataModel]) =>
                        dataModel
                            .compendiumBrowserFilters ??
                        new Map()
                )
                .reduce(
                    (final, current) =>
                        browserClass.intersectFilters(
                            current,
                            final,
                            currentFilters
                        ),
                    null
                ) ??
            new Map();

        /*
        * D&D5e añade el filtro de fuente
        * independientemente de los DataModels.
        *
        * Para aplicar la consulta solo necesitamos
        * registrar las fuentes que actualmente
        * forman parte del filtro.
        */
        const sourceChoices =
            Object.fromEntries(
                Object.keys(
                    currentFilters
                        .additional
                        ?.source ??
                    {}
                ).map(key => [
                    key,
                    key
                ])
            );

        filterDefinitions.set(
            "source",
            {
                type: "set",

                config: {
                    keyPath:
                        "system.source.slug",

                    choices:
                        sourceChoices
                }
            }
        );

        const filters =
            browserClass.applyFilters(
                filterDefinitions,
                currentFilters
            );

        if (currentFilters.name?.length) {

            filters.push({
                k: "name",
                o: "icontains",
                v: currentFilters.name
            });

        }

        if (
            currentFilters
                .arbitrary
                ?.length
        ) {

            filters.push(
                ...currentFilters.arbitrary
            );

        }

        const candidates =
            await browserClass.fetch(
                documentClass,
                {
                    filters,

                    types:
                        currentFilters.types ??
                        new Set(),

                    indexFields:
                        new Set([
                            "system.source",
                            "system.rarity"
                        ])
                }
            );

        const hiddenUuids =
            new Set(
                StorageService.getHiddenUuids()
            );

        return candidates.filter(
            candidate =>
                !hiddenUuids.has(candidate.uuid)
        );

    }

    static async createContentDraft(app) {

        const filters =
            captureEffectiveBrowserFilters(
                app
            );


        const candidates =
            await this.getBrowserCandidates(
                app,
                filters
            );

        const includedCandidates =
            candidates;

        const matches =
            [
                ...new Set(
                    includedCandidates
                        .map(candidate =>
                            candidate.uuid
                        )
                        .filter(Boolean)
                )
            ];

        const rarityCounts =
            new Map();

        for (const candidate of includedCandidates) {

            const rarity =
                String(
                    candidate.system?.rarity ?? ""
                ).trim();

            const key =
                rarity || "mundane";

            rarityCounts.set(
                key,
                (
                    rarityCounts.get(key) ?? 0
                ) + 1
            );

        }

        const rarityOrder = [
            "mundane",
            "common",
            "uncommon",
            "rare",
            "veryRare",
            "legendary",
            "artifact"
        ];

        const rarityGroups =
            [...rarityCounts.entries()]
                .map(([key, count]) => ({
                    key,
                    count
                }))
                .sort((a, b) => {

                    const aIndex =
                        rarityOrder.indexOf(
                            a.key
                        );

                    const bIndex =
                        rarityOrder.indexOf(
                            b.key
                        );

                    const aOrder =
                        aIndex === -1
                            ? Number.MAX_SAFE_INTEGER
                            : aIndex;

                    const bOrder =
                        bIndex === -1
                            ? Number.MAX_SAFE_INTEGER
                            : bIndex;

                    if (aOrder !== bOrder)
                        return aOrder - bOrder;

                    return a.key.localeCompare(
                        b.key
                    );

                });

        const advancedMode =
            app.constructor
                ?.MODES
                ?.ADVANCED;

        return {

            version: 2,
            type: "content",

            browser: {

                tab:
                    app.element
                        .querySelector(
                            '[data-application-part="tabs"] [data-tab].active'
                        )
                        ?.dataset.tab ??
                    null,

                advanced:
                    advancedMode !==
                        undefined &&
                    app._mode ===
                        advancedMode,

                filters

            },

            matches,

            includedCount:
                includedCandidates.length,

            preview: {
                rarityGroups
            }

        };

    }

}
