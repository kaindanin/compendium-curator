import { MODULE_ID, STORAGE_SETTING } from "../settings.js";

export class StorageService {

    // ==========================
    // Métodos privados
    // ==========================

    static _getData() {
        return game.settings.get(MODULE_ID, STORAGE_SETTING);
    }

    static async _saveData(data) {
        await game.settings.set(MODULE_ID, STORAGE_SETTING, data);
    }

    // ==========================
    // API pública
    // ==========================

    static getProfile() {

        const storage = this._getData();

        return storage.profiles[storage.activeProfile];

    }

    static getProfileRules() {

        return this.getProfile().rules;

    }

    static isHidden(uuid) {

        return this.getProfileRules().some(rule =>
            rule.uuid === uuid && rule.hidden === true
        );

    }

    static async addRule(rule) {

        const data = this._getData();

        const rules = data.profiles[data.activeProfile].rules;

        if (rules.some(r => r.uuid === rule.uuid))
            return false;

        rules.push(rule);

        await this._saveData(data);

        return true;

    }

    static async removeRule(uuid) {

        const data = this._getData();

        data.profiles[data.activeProfile].rules =
            data.profiles[data.activeProfile].rules.filter(r => r.uuid !== uuid);

        await this._saveData(data);

    }

    static async hide(uuid) {

        return this.addRule({

            uuid,
            hidden: true

        });

    }

    static async show(uuid) {

        return this.removeRule(uuid);

    }

}