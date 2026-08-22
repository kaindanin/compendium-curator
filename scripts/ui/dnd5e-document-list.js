const DISTRIBUTION_INDEX_FIELDS = {
    Item: [
        "system.rarity",
        "system.source",
        "system.level",
        "system.school"
    ],
    Actor: [
        "system.details.cr",
        "system.details.type.value",
        "system.details.type.custom",
        "system.traits.size",
        "system.source"
    ]
};

let distributionIndexPromise = null;
let distributionIndexesReady = false;

/*
 * Curator mantiene su propia copia de los índices que necesita
 * para distribuir contenido. El Compendium Browser de D&D5e
 * puede reconstruir pack.index con distintos campos al cambiar
 * de pestaña o filtro, así que esa colección compartida no es
 * una fuente estable para rareza, fuente o CR.
 */
const distributionIndexCache = new Map();


function getDistributionSourceBook(pack) {

    const packBook =
        pack?.metadata?.flags
            ?.dnd5e?.sourceBook;

    if (packBook)
        return packBook;

    const packageType =
        pack?.metadata?.packageType;
    const packageName =
        pack?.metadata?.packageName;

    let pkg = null;

    if (packageType === "module")
        pkg = game.modules?.get(packageName);
    else if (packageType === "system")
        pkg = game.system;
    else if (packageType === "world")
        pkg = game.world;

    const sourceBooks =
        pkg?.flags?.dnd5e?.sourceBooks;
    const keys = Object.keys(
        sourceBooks ?? {}
    );

    return keys.length === 1
        ? keys[0]
        : "";

}


function prepareDistributionIndexEntry(
    pack,
    sourceEntry
) {

    const entry =
        foundry.utils.deepClone(sourceEntry);
    const source = entry?.system?.source;

    if (
        !source ||
        typeof source !== "object"
    ) {
        return entry;
    }

    /*
     * D&D5e guarda en el índice solo los datos persistidos de
     * system.source. book, value, label y slug son derivados por
     * SourceField.prepareData(), algo que el Compendium Browser hace
     * después de getIndex(). Reproducimos aquí esa preparación para
     * que Curator no dependa de que el navegador haya visitado antes
     * la pestaña correspondiente.
     */
    const book =
        String(source.book ?? "").trim() ||
        String(
            getDistributionSourceBook(pack) ??
            ""
        ).trim();

    if (book && !source.book)
        source.book = book;

    const packageType =
        pack?.metadata?.packageType;
    const packageName =
        pack?.metadata?.packageName;

    let packageTitle = "";

    if (packageType === "module") {
        packageTitle =
            game.modules?.get(packageName)
                ?.title ?? "";
    }
    else if (packageType === "system") {
        packageTitle = game.system?.title ?? "";
    }
    else if (packageType === "world") {
        packageTitle = game.world?.title ?? "";
    }

    source.value =
        book || packageTitle;

    if (!source.label) {
        source.label =
            String(source.custom ?? "").trim() ||
            book;
    }

    return entry;

}


function cloneIndex(pack, index) {

    const cached = new Map();

    /*
     * foundry.utils.Collection itera directamente sus valores,
     * a diferencia de Map. entries() conserva el par id/documento
     * que necesitamos para construir la caché.
     */
    for (
        const [id, entry]
        of index?.entries?.() ?? []
    ) {
        cached.set(
            id,
            prepareDistributionIndexEntry(
                pack,
                entry
            )
        );
    }

    return cached;

}


function mergeDistributionIndexIntoPack(
    pack,
    cachedIndex
) {

    if (!pack?.index || !cachedIndex)
        return;

    for (const [id, cachedEntry] of cachedIndex) {

        const current =
            pack.index.get(id) ?? {};

        pack.index.set(
            id,
            foundry.utils.mergeObject(
                foundry.utils.deepClone(current),
                foundry.utils.deepClone(cachedEntry),
                {
                    inplace: false,
                    overwrite: true
                }
            )
        );

    }

}


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

        /*
         * Persistimos estos campos entre futuras reconstrucciones
         * del índice que pueda hacer Foundry o D&D5e.
         */
        if (
            typeof pack.indexFields?.add ===
                "function"
        ) {
            for (const field of fields)
                pack.indexFields.add(field);
        }

        requests.push(
            pack.getIndex({ fields })
                .then(index => {

                    const cachedIndex =
                        cloneIndex(pack, index);

                    distributionIndexCache.set(
                        pack.collection,
                        {
                            documentName:
                                pack.documentName,
                            index:
                                cachedIndex
                        }
                    );

                    /*
                     * También fusionamos nuestra copia en pack.index
                     * para mantener compatibilidad con código existente.
                     * La fuente de verdad de Curator sigue siendo la caché
                     * privada anterior.
                     */
                    mergeDistributionIndexIntoPack(
                        pack,
                        cachedIndex
                    );

                    return {
                        ok: true,
                        pack
                    };

                })
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
                        "Compendium Curator | No se pudieron cargar algunos campos de distribución desde sus compendios.",
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
                 * Una carga terminada nunca debe bloquear un refresh
                 * posterior solicitado por el Gestor. La caché privada
                 * permanece disponible hasta que se reemplace.
                 */
                distributionIndexPromise = null;

            });

    return distributionIndexPromise;

}


export function getDnd5eDistributionIndexEntry(
    uuid
) {

    const value =
        String(uuid ?? "").trim();

    if (!value)
        return null;

    const parts = value.split(".");

    if (
        parts[0] === "Compendium" &&
        parts.length >= 4
    ) {

        const collection =
            `${parts[1]}.${parts[2]}`;

        const documentId =
            parts.at(-1);

        const cached =
            distributionIndexCache
                .get(collection)
                ?.index
                ?.get(documentId);

        if (cached)
            return cached;

    }

    if (
        typeof fromUuidSync === "function"
    ) {
        return fromUuidSync(value) ?? null;
    }

    return null;

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
 * Usa primero la caché de índices propia de Curator,
 * evitando depender del estado actual del Compendium Browser
 * y evitando fromUuid() para cientos o miles de resultados.
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

                    const cachedPack =
                        distributionIndexCache
                            .get(collection);

                    const cachedEntry =
                        cachedPack
                            ?.index
                            ?.get(documentId);

                    if (cachedEntry) {

                        return buildDocumentEntry(
                            uuid,
                            cachedEntry,
                            cachedPack.documentName
                        );

                    }

                    /*
                     * Compatibilidad para tipos de documento que
                     * Curator todavía no indexa específicamente.
                     */
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
        delete element.dataset.tooltip;
        delete element.dataset.tooltipClass;
        delete element.dataset.tooltipDirection;

        const openControl =
            element.querySelector(
                "[data-cc-open-document]"
            );

        if (!openControl)
            continue;

        openControl.dataset.tooltip = `
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

        openControl.dataset.tooltipClass =
            "dnd5e2 dnd5e-tooltip item-tooltip";

        openControl.dataset.tooltipDirection =
            "RIGHT";


        /*
         * Abrir el documento igual que lo hace
         * el Compendium Browser.
         */
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
