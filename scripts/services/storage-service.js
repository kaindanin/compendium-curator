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
                    hiddenUuids: [],
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

            const hiddenUuids = new Set();

            if (Array.isArray(profile.hiddenUuids)) {

                for (const uuid of profile.hiddenUuids) {

                    if (
                        typeof uuid === "string" &&
                        uuid
                    ) {
                        hiddenUuids.add(uuid);
                    }

                }

            }

            /*
            * Migra automáticamente el formato antiguo:
            *
            * { uuid: "...", hidden: true }
            *
            * a una lista simple de UUID.
            */
            if (Array.isArray(profile.rules)) {

                for (const rule of profile.rules) {

                    if (
                        rule &&
                        typeof rule === "object" &&
                        rule.hidden === true &&
                        typeof rule.uuid === "string" &&
                        rule.uuid
                    ) {
                        hiddenUuids.add(rule.uuid);
                    }

                }

            }

            profile.hiddenUuids = [...hiddenUuids];

            delete profile.rules;

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
                hiddenUuids: [],
                filters: {}
            };

        }

        const profileIds = Object.keys(data.profiles);

        if (
            !data.activeProfile ||
            !data.profiles[data.activeProfile]
        ) {
            data.activeProfile = profileIds[0];
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

    static getHiddenUuids() {

        return this.getProfile().hiddenUuids;

    }

    static getProfiles() {

        return this._getData().profiles;

    }

    static getProfileName(profileId) {

        const profile =
            this._getData().profiles[profileId];

        return profile?.name ?? profileId;

    }

    static getProfileHiddenCount(profileId) {

        const profile =
            this._getData().profiles[profileId];

        return profile?.hiddenUuids.length ?? 0;

    }

    static getProfileExportData(profileId) {

        const profile =
            this._getData().profiles[profileId];

        if (!profile)
            return null;

        return {
            type: "compendium-curator-profile",
            version: 1,

            profile: {
                name: profile.name,
                hiddenUuids: structuredClone(profile.hiddenUuids),
                filters: structuredClone(profile.filters)
            }
        };

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
            hiddenUuids: [],
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
            hiddenUuids: structuredClone(sourceProfile.hiddenUuids),
            filters: structuredClone(sourceProfile.filters)
        };

        data.activeProfile = newProfileId;

        await this._saveData(data);

        return true;

    }

    static async importProfile(importData, profileName) {

        if (
            !importData ||
            typeof importData !== "object" ||
            Array.isArray(importData) ||
            importData.type !== "compendium-curator-profile" ||
            importData.version !== 1
        ) {
            return false;
        }

        const importedProfile = importData.profile;

        if (
            !importedProfile ||
            typeof importedProfile !== "object" ||
            Array.isArray(importedProfile) ||
            !Array.isArray(importedProfile.hiddenUuids)
        ) {
            return false;
        }

        const name = String(profileName).trim();

        if (!isValidProfileName(name))
            return false;

        const data = this._getData();

        if (this._profileNameExists(data, name))
            return false;

        const hiddenUuids = [];

        for (const uuid of importedProfile.hiddenUuids) {

            if (
                typeof uuid !== "string" ||
                !uuid.trim()
            ) {
                return false;
            }

            hiddenUuids.push(uuid.trim());

        }

        const uniqueHiddenUuids =
            [...new Set(hiddenUuids)];

        let filters = {};

        if (
            importedProfile.filters &&
            typeof importedProfile.filters === "object" &&
            !Array.isArray(importedProfile.filters)
        ) {
            filters =
                structuredClone(importedProfile.filters);
        }

        let profileId;

        do {
            profileId = foundry.utils.randomID();
        }
        while (data.profiles[profileId]);

        data.profiles[profileId] = {
            name,
            hiddenUuids: uniqueHiddenUuids,
            filters
        };

        data.activeProfile = profileId;

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

    static async clearProfile(profileId) {

        const data = this._getData();
        const profile = data.profiles[profileId];

        if (!profile)
            return false;

        if (profile.hiddenUuids.length === 0)
            return false;

        profile.hiddenUuids = [];

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

        return this.getHiddenUuids().includes(uuid);

    }

    static async hideMany(uuids) {

        const data = this._getData();
        const profile =
            data.profiles[data.activeProfile];

        const existingUuids =
            new Set(profile.hiddenUuids);

        let changed = false;

        for (const uuid of uuids) {

            if (existingUuids.has(uuid))
                continue;

            profile.hiddenUuids.push(uuid);
            existingUuids.add(uuid);

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

        const selectedUuids =
            new Set(uuids);

        const previousLength =
            profile.hiddenUuids.length;

        profile.hiddenUuids =
            profile.hiddenUuids.filter(
                uuid => !selectedUuids.has(uuid)
            );

        if (
            profile.hiddenUuids.length ===
            previousLength
        ) {
            return false;
        }

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