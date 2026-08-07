import { MODULE_ID, STORAGE_SETTING } from "../settings.js";

const RESERVED_PROFILE_NAMES = new Set([
    "__proto__",
    "prototype",
    "constructor"
]);

function isValidProfileName(name) {

    return Boolean(name) &&
        !RESERVED_PROFILE_NAMES.has(name.toLowerCase());

}

export class StorageService {

    // ==========================
    // Métodos privados
    // ==========================

    static _getData() {

        const storage = game.settings.get(
            MODULE_ID,
            STORAGE_SETTING
        );

        return this._normalizeData(storage);

    }

    static async _saveData(data) {
        await game.settings.set(MODULE_ID, STORAGE_SETTING, data);
    }

    static _profileNameExists(data, name, excludeProfileId = null) {

        const normalizedName =
            name.toLocaleLowerCase();

        return Object.entries(data.profiles).some(
            ([profileId, profile]) =>
                profileId !== excludeProfileId &&
                profile.name?.toLocaleLowerCase() === normalizedName
        );

    }

    static _normalizeData(storage) {

        const data = structuredClone(storage ?? {});

        data.version = 3;

        if (
            !data.profiles ||
            typeof data.profiles !== "object" ||
            Array.isArray(data.profiles)
        ) {
            data.profiles = {};
        }

        /*
        * Elimina posibles nombres reservados procedentes
        * de versiones anteriores o datos manipulados.
        */
        for (const profileId of Object.keys(data.profiles)) {

            if (
                RESERVED_PROFILE_NAMES.has(
                    profileId.toLowerCase()
                )
            ) {
                delete data.profiles[profileId];
            }

        }

        for (
            const [profileId, profile]
            of Object.entries(data.profiles)
        ) {

            if (
                !profile ||
                typeof profile !== "object" ||
                Array.isArray(profile)
            ) {

                data.profiles[profileId] = {
                    name: profileId,
                    rules: [],
                    filters: {}
                };

                continue;

            }

            if (
                typeof profile.name !== "string" ||
                !profile.name.trim()
            ) {
                profile.name = profileId;
            }
            else {
                profile.name = profile.name.trim();
            }

            if (!Array.isArray(profile.rules))
                profile.rules = [];

            if (
                !profile.filters ||
                typeof profile.filters !== "object" ||
                Array.isArray(profile.filters)
            ) {
                profile.filters = {};
            }

        }

        if (Object.keys(data.profiles).length === 0) {

            data.profiles.default = {
                name: "default",
                rules: [],
                filters: {}
            };

        }

        if (
            !data.publicProfile ||
            !data.profiles[data.publicProfile]
        ) {
            data.publicProfile = data.activeProfile;
        }

        return data;

    }

    static async initialize() {

        const current = game.settings.get(
            MODULE_ID,
            STORAGE_SETTING
        );

        const normalized =
            this._normalizeData(current);

        /*
        * Solo guardamos si realmente se ha corregido algo.
        */
        if (
            JSON.stringify(current) ===
            JSON.stringify(normalized)
        ) {
            return false;
        }

        await this._saveData(normalized);

        return true;

    }

    // ==========================
    // API pública
    // ==========================

    static getProfile() {

        const storage = this._getData();
        const profileId = this.getVisibleProfileId();

        return storage.profiles[profileId];

    }

    static getProfileRules() {

        return this.getProfile().rules;

    }

    static getProfiles() {

        return this._getData().profiles;

    }

    static getProfileName(profileId) {

        const profile =
            this._getData().profiles[profileId];

        return profile?.name ?? profileId;

    }

    static getActiveProfileId() {

        return this._getData().activeProfile;

    }

    static getPublicProfileId() {

        return this._getData().publicProfile;

    }

    static getVisibleProfileId() {

        const data = this._getData();

        /*
        * Los usuarios autorizados trabajan con el perfil activo.
        * Los jugadores siempre consultan el perfil público.
        */
        return game.user.can("SETTINGS_MODIFY")
            ? data.activeProfile
            : data.publicProfile;

    }

    static async setPublicProfile(profileId) {

        const data = this._getData();

        if (!data.profiles[profileId])
            return false;

        if (data.publicProfile === profileId)
            return false;

        data.publicProfile = profileId;

        await this._saveData(data);

        return true;

    }

    static async setActiveProfile(profileId) {

        const data = this._getData();

        if (!data.profiles[profileId])
            return false;

        data.activeProfile = profileId;

        await this._saveData(data);

        return true;

    }

    static async createProfile(profileName) {

        const name = String(profileName).trim();

        if (!isValidProfileName(name))
            return false;

        const data = this._getData();

        if (this._profileNameExists(data, name))
            return false;

        let profileId;

        do {
            profileId = foundry.utils.randomID();
        }
        while (data.profiles[profileId]);

        data.profiles[profileId] = {
            name,
            rules: [],
            filters: {}
        };

        data.activeProfile = profileId;

        await this._saveData(data);

        return true;

    }

    static async duplicateProfile(profileId, profileName) {

        const name = String(profileName).trim();

        if (!isValidProfileName(name))
            return false;

        const data = this._getData();
        const sourceProfile = data.profiles[profileId];

        if (!sourceProfile)
            return false;

        if (this._profileNameExists(data, name))
            return false;

        let newProfileId;

        do {
            newProfileId = foundry.utils.randomID();
        }
        while (data.profiles[newProfileId]);

        data.profiles[newProfileId] = {
            name,
            rules: structuredClone(sourceProfile.rules),
            filters: structuredClone(sourceProfile.filters)
        };

        data.activeProfile = newProfileId;

        await this._saveData(data);

        return true;

    }

    static async renameProfile(profileId, profileName) {

        const name = String(profileName).trim();

        if (!isValidProfileName(name))
            return false;

        const data = this._getData();
        const profile = data.profiles[profileId];

        if (!profile)
            return false;

        if (
            this._profileNameExists(
                data,
                name,
                profileId
            )
        ) {
            return false;
        }

        if (profile.name === name)
            return false;

        profile.name = name;

        await this._saveData(data);

        return true;

    }

    static async deleteProfile(profileId) {

        const data = this._getData();
        const profileIds = Object.keys(data.profiles);

        /*
        * Siempre debe existir al menos un perfil.
        */
        if (profileIds.length <= 1)
            return false;

        if (!data.profiles[profileId])
            return false;

        if (data.publicProfile === profileId)
            return false;

        delete data.profiles[profileId];

        if (data.activeProfile === profileId)
            data.activeProfile = Object.keys(data.profiles)[0];

        await this._saveData(data);

        return true;

    }

    static isHidden(uuid) {

        return this.getProfileRules().some(rule =>
            rule.uuid === uuid && rule.hidden === true
        );

    }

    static async hideMany(uuids) {

        const data = this._getData();
        const rules =
            data.profiles[data.activeProfile].rules;

        let changed = false;

        for (const uuid of uuids) {

            const existingRule =
                rules.find(rule => rule.uuid === uuid);

            if (existingRule) {

                if (!existingRule.hidden) {
                    existingRule.hidden = true;
                    changed = true;
                }

                continue;

            }

            rules.push({
                uuid,
                hidden: true
            });

            changed = true;

        }

        if (!changed)
            return false;

        await this._saveData(data);

        return true;

    }

    static async showMany(uuids) {

        const data = this._getData();
        const profile =
            data.profiles[data.activeProfile];

        const selectedUuids = new Set(uuids);
        const previousLength = profile.rules.length;

        profile.rules = profile.rules.filter(
            rule => !selectedUuids.has(rule.uuid)
        );

        if (profile.rules.length === previousLength)
            return false;

        await this._saveData(data);

        return true;

    }

    static async hide(uuid) {

        return this.hideMany([uuid]);

    }

    static async show(uuid) {

        return this.showMany([uuid]);

    }

}