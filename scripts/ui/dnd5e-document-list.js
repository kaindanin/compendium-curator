const DISTRIBUTION_INDEX_FIELDS = {
    Item: [
        "system.rarity",
        "system.source"
    ],
    Actor: [
        "system.details.cr",
        "system.source"
    ]
};

let distributionIndexPromise = null;
let distributionIndexesReady = false;


export async function ensureDnd5eDistributionIndexes(
    { force = false } = {}
) {

    if (
        distributionIndexesReady &&
        !force
    ) {
        return true;
    }

    if (distributionIndexPromise)
        return distributionIndexPromise;

    const requests = [];

    for (const pack of game.packs) {

        const fields =
            DISTRIBUTION_INDEX_FIELDS[
                pack.documentName
            ];

        if (!fields)
            continue;

        requests.push(
            pack.getIndex({ fields })
                .then(() => ({
                    ok: true,
                    pack
                }))
                .catch(error => ({
                    ok: false,
                    pack,
                    error
                }))
        );

    }

    if (!requests.length) {
        distributionIndexesReady = true;
        return true;
    }

    distributionIndexPromise =
        Promise.all(requests)
            .then(results => {

                const failed =
                    results.filter(
                        result => !result.ok
                    );

                distributionIndexesReady =
                    failed.length === 0;

                if (failed.length) {
                    console.warn(
                        "Compendium Curator | No se pudieron cargar algunos campos de distribución en los índices.",
                        failed.map(result => ({
                            pack:
                                result.pack?.collection,
                            error:
                                result.error
                        }))
                    );
                }

                return distributionIndexesReady;

            })
            .finally(() => {

                /*
                 * Si algún compendio falló, permitimos que
                 * el siguiente intento vuelva a solicitarlo.
                 */
                if (!distributionIndexesReady)
                    distributionIndexPromise = null;

            });

    return distributionIndexPromise;

}


function getDocumentSource(source) {

    if (!source)
        return "";

    if (typeof source === "string")
        return source;

    return String(
        source.value ??
        source.book ??
        source.label ??
        ""
    );

}


function buildDocumentEntry(
    uuid,
    document,
    documentClass
) {

    if (!document) {

        return {
            uuid,
            name: uuid,
            img: null,
            subtitle: "",
            source: "",
            available: false
        };

    }

    const subtitle =
        CONFIG[
            documentClass
        ]
            ?.typeLabels
            ?.[document.type] ??
        "";

    return {
        uuid,

        name:
            document.name ??
            uuid,

        img:
            document.img ??
            null,

        subtitle,

        source:
            getDocumentSource(
                document.system
                    ?.source
            ),

        available:
            true
    };

}


function sortDocumentEntries(entries) {

    return entries.sort(
        (a, b) =>
            String(a.name)
                .localeCompare(
                    String(b.name),
                    game.i18n.lang,
                    {
                        sensitivity:
                            "base"
                    }
                )
    );

}


export async function prepareDnd5eDocumentEntries(
    uuids
) {

    const entries =
        Array.from(
            uuids ?? []
        );

    const documents =
        await Promise.all(
            entries.map(
                uuid =>
                    fromUuid(uuid)
            )
        );

    return sortDocumentEntries(
        entries.map(
            (uuid, index) => {

                const document =
                    documents[index];

                return buildDocumentEntry(
                    uuid,
                    document,
                    document?.documentName
                );

            }
        )
    );

}


/*
 * Variante ligera para vistas previas en vivo.
 *
 * Usa el índice que el Compendium Browser ya ha
 * cargado en memoria, evitando fromUuid() para
 * cientos o miles de resultados. Devuelve la
 * misma estructura visual que
 * prepareDnd5eDocumentEntries().
 */
export function prepareDnd5eIndexedEntries(
    uuids
) {

    const entries =
        Array.from(
            new Set(
                uuids ?? []
            )
        )
            .map(rawUuid => {

                const uuid =
                    String(
                        rawUuid ?? ""
                    );

                if (!uuid)
                    return null;

                const parts =
                    uuid.split(".");

                if (
                    parts[0] ===
                        "Compendium" &&
                    parts.length >= 4
                ) {

                    const collection =
                        `${parts[1]}.${parts[2]}`;

                    const documentId =
                        parts.at(-1);

                    const pack =
                        game.packs
                            ?.get(collection);

                    const indexEntry =
                        pack
                            ?.index
                            ?.get(documentId);

                    if (indexEntry) {

                        return buildDocumentEntry(
                            uuid,
                            indexEntry,
                            pack.documentName
                        );

                    }

                }

                if (
                    typeof fromUuidSync ===
                        "function"
                ) {

                    const document =
                        fromUuidSync(uuid);

                    if (document) {

                        return buildDocumentEntry(
                            uuid,
                            document,
                            document.documentName
                        );

                    }

                }

                return buildDocumentEntry(
                    uuid,
                    null,
                    null
                );

            })
            .filter(Boolean);

    return sortDocumentEntries(
        entries
    );

}


export function activateDnd5eDocumentEntries(
    root
) {

    if (!root)
        return;

    for (
        const element
        of root.querySelectorAll(
            ".cc-dnd5e-document-entry[data-uuid]"
        )
    ) {

        const uuid =
            element.dataset.uuid;

        if (!uuid)
            continue;

        /*
         * Mismo sistema de tooltip utilizado
         * por el Compendium Browser de D&D5e.
         */
        element.dataset.tooltip = `
            <section
                class="loading"
                data-uuid="${uuid}"
            >
                <i
                    class="fa-solid fa-spinner fa-spin-pulse"
                    inert
                ></i>
            </section>
        `;

        element.dataset.tooltipClass =
            "dnd5e2 dnd5e-tooltip item-tooltip";

        element.dataset.tooltipDirection =
            "RIGHT";


        /*
         * Abrir el documento igual que lo hace
         * el Compendium Browser.
         */
        const openControl =
            element.querySelector(
                "[data-cc-open-document]"
            );

        openControl
            ?.addEventListener(
                "click",
                async event => {

                    event.preventDefault();
                    event.stopPropagation();

                    const document =
                        await fromUuid(
                            uuid
                        );

                    document
                        ?.sheet
                        ?.render(true);

                }
            );

    }

}
