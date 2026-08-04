export class CompendiumService {

    static getCompendiums() {

        return Array.from(game.packs).map(pack => {

            const module = game.modules.get(pack.metadata.packageName);

            let sourceName = "Desconocido";

            if (pack.metadata.packageType === "module") {
                sourceName = game.modules.get(pack.metadata.packageName)?.title;
            }
            else if (pack.metadata.packageType === "system") {
                sourceName = game.system.title;
            }
            else if (pack.metadata.packageType === "world") {
                sourceName = game.world.title;
            }

            return {
                id: pack.metadata.id,
                label: pack.metadata.label,
                type: pack.metadata.type,

                packageId: pack.metadata.packageName,
                sourceName,

                system: pack.metadata.system,
                locked: pack.locked
            };

        }).sort((a, b) => a.label.localeCompare(b.label));

    }

}