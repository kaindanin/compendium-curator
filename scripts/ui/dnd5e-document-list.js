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

    return entries
        .map(
            (uuid, index) => {

                const document =
                    documents[index];

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

                const documentClass =
                    document.documentName;

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
                        document.name,

                    img:
                        document.img,

                    subtitle,

                    source:
                        document.system
                            ?.source
                            ?.value ??
                        "",

                    available:
                        true
                };

            }
        )
        .sort(
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