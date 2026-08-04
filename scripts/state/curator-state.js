export class CuratorState {

    static getSelection(app) {

        app._ccSelection ??= new Set();

        return app._ccSelection;

    }

}