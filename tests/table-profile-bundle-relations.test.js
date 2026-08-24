import assert from "node:assert/strict";
import test from "node:test";

globalThis.foundry = {
    utils: {
        deepClone: value => structuredClone(value)
    }
};
globalThis.game = {
    i18n: {
        lang: "es",
        format: (key, values) =>
            `${key}:${values.name}`
    },
    packs: new Map(),
    settings: {
        get: () => ({
            version: 5,
            folders: {},
            profiles: {},
            filterGroups: {}
        })
    }
};
globalThis.fromUuidSync = () => null;

const {
    TableProfileBundlePreflightService
} = await import(
    "../scripts/services/table-profile-bundle-preflight-service.js"
);

function profile(id, children = []) {
    return {
        id,
        version: 2,
        type: "content",
        name: id,
        filterGroupIds: [],
        children
    };
}

function bundle() {
    return {
        type:
            "compendium-curator-table-profile-bundle",
        version: 1,
        rootProfileId: "parent",
        profiles: {
            parent: profile("parent", [{
                profileId: "child",
                enabled: true,
                weight: 2
            }]),
            child: profile("child")
        },
        filterGroups: {}
    };
}

test(
    "profile preflight accepts linked content tables",
    () => {
        const analysis =
            TableProfileBundlePreflightService
                .analyze(bundle());

        assert.equal(analysis.profileCount, 2);
        assert.equal(analysis.rootType, "content");
    }
);

test(
    "profile preflight rejects cyclic linked tables",
    () => {
        const source = bundle();
        source.profiles.child.children = [{
            profileId: "parent",
            enabled: true,
            weight: 1
        }];

        assert.throws(
            () => TableProfileBundlePreflightService
                .analyze(source),
            /INVALID_TABLE_PROFILE_BUNDLE/
        );
    }
);
