import {
    MODULE_ID,
    TABLE_PROFILES_SETTING
} from "../settings.js";

import {
    TableProfileService
} from "../services/table-profile-service.js";

import {
    TableProfileStorageService
} from "../services/table-profile-storage-service.js";

const MANAGER_ID =
    "compendium-curator-table-manager";

const PROFILE_EDITOR_ID =
    "compendium-curator-table-profile-editor";

const VALID_TABS =
    new Set([
        "content",
        "nested",
        "groups"
    ]);

let pendingProfileType = null;


function normalizeSearchText(value) {

    return String(value ?? "")
        .trim()
        .normalize("NFD")
        .replace(
            /[\u0300-\u036f]/g,
            ""
        )
        .toLocaleLowerCase();

}


function getProfileType(profile) {

    return profile?.type === "nested"
        ? "nested"
        : "content";

}


function getTabLabel(tab) {

    if (tab === "nested") {

        return game.i18n.localize(
            "COMPENDIUM_CURATOR.TableProfileTypeNested"
        );

    }

    if (tab === "groups") {

        return game.i18n.localize(
            "COMPENDIUM_CURATOR.FilterGroups"
        );

    }

    return game.i18n.localize(
        "COMPENDIUM_CURATOR.TableProfileTypeContent"
    );

}


function getProfiles() {

    return Object.values(
        TableProfileStorageService
            .getProfiles()
    );

}


function getFilterGroups() {

    return Object.values(
        TableProfileStorageService
            .getFilterGroups()
    );

}


function buildUsageMap(profiles) {

    const usage =
        new Map();

    for (const profile of profiles) {

        for (
            const filterGroupId
            of profile.filterGroupIds ?? []
        ) {

            if (
                !usage.has(
                    filterGroupId
                )
            ) {
                usage.set(
                    filterGroupId,
                    []
                );
            }

            usage.get(
                filterGroupId
            ).push(profile);

        }

    }

    return usage;

}


function createTabButton(
    tab,
    count
) {

    const button =
        document.createElement(
            "button"
        );

    button.type = "button";
    button.className =
        "cc-table-manager-tab";

    button.dataset.ccManagerTab =
        tab;

    button.setAttribute(
        "role",
        "tab"
    );

    const label =
        document.createElement(
            "span"
        );

    label.textContent =
        getTabLabel(tab);

    const badge =
        document.createElement(
            "span"
        );

    badge.className =
        "cc-table-manager-tab-count";

    badge.textContent =
        String(count);

    button.append(
        label,
        badge
    );

    return button;

}


function createToolbar(
    app,
    profiles,
    filterGroups
) {

    const toolbar =
        document.createElement(
            "div"
        );

    toolbar.className =
        "cc-table-manager-workspace-toolbar";


    const tabs =
        document.createElement(
            "nav"
        );

    tabs.className =
        "cc-table-manager-tabs";

    tabs.setAttribute(
        "role",
        "tablist"
    );


    const counts = {
        content:
            profiles.filter(
                profile =>
                    getProfileType(
                        profile
                    ) === "content"
            ).length,

        nested:
            profiles.filter(
                profile =>
                    getProfileType(
                        profile
                    ) === "nested"
            ).length,

        groups:
            filterGroups.length
    };


    for (
        const tab
        of [
            "content",
            "nested",
            "groups"
        ]
    ) {

        const button =
            createTabButton(
                tab,
                counts[tab]
            );

        button.addEventListener(
            "click",
            () => {

                app._ccManagerTab =
                    tab;

                applyManagerView(
                    app
                );

            }
        );

        tabs.append(button);

    }


    const search =
        document.createElement(
            "div"
        );

    search.className =
        "cc-table-manager-search";


    const icon =
        document.createElement("i");

    icon.className =
        "fas fa-magnifying-glass";


    const input =
        document.createElement(
            "input"
        );

    input.type = "search";
    input.autocomplete = "off";
    input.placeholder =
        game.i18n.localize(
            "Search"
        );

    input.value =
        app._ccManagerSearch ?? "";

    input.addEventListener(
        "input",
        () => {

            app._ccManagerSearch =
                input.value;

            applyManagerView(
                app
            );

        }
    );


    search.append(
        icon,
        input
    );


    toolbar.append(
        tabs,
        search
    );


    return toolbar;

}


function createGlobalGroupsContainer(
    profiles,
    filterGroups
) {

    const container =
        document.createElement(
            "div"
        );

    container.className =
        "cc-table-manager-global-groups";


    const usage =
        buildUsageMap(
            profiles
        );


    const orderedGroups =
        [...filterGroups]
            .sort((a, b) =>
                String(a.name ?? "")
                    .localeCompare(
                        String(
                            b.name ?? ""
                        ),
                        game.i18n.lang,
                        {
                            sensitivity:
                                "base"
                        }
                    )
            );


    for (
        const filterGroup
        of orderedGroups
    ) {

        const usedBy =
            usage.get(
                filterGroup.id
            ) ?? [];


        const card =
            document.createElement(
                "div"
            );

        card.className =
            "cc-table-manager-global-group";

        card.dataset.filterGroupId =
            filterGroup.id;

        card.dataset.ccSearchText =
            normalizeSearchText([
                filterGroup.name,
                ...usedBy.map(
                    profile =>
                        profile.name
                )
            ].join(" "));


        const info =
            document.createElement(
                "div"
            );

        info.className =
            "cc-table-manager-global-group-info";


        const title =
            document.createElement(
                "strong"
            );

        const titleIcon =
            document.createElement(
                "i"
            );

        titleIcon.className =
            "fas fa-filter";

        const titleText =
            document.createElement(
                "span"
            );

        titleText.textContent =
            filterGroup.name ?? "";

        title.append(
            titleIcon,
            titleText
        );


        const metadata =
            document.createElement(
                "span"
            );

        metadata.className =
            "cc-table-manager-global-group-meta";


        const matches =
            document.createElement(
                "span"
            );

        matches.innerHTML = `
            <i class="fas fa-list-check"></i>
            <span>${
                Array.isArray(
                    filterGroup.matches
                )
                    ? filterGroup.matches.length
                    : 0
            }</span>
        `;

        matches.title =
            game.i18n.localize(
                "COMPENDIUM_CURATOR.SavedMatches"
            );


        const references =
            document.createElement(
                "span"
            );

        references.innerHTML = `
            <i class="fas fa-link"></i>
            <span>${usedBy.length}</span>
        `;

        if (usedBy.length) {

            references.title =
                usedBy
                    .map(
                        profile =>
                            profile.name
                    )
                    .join(", ");

        }


        metadata.append(
            matches,
            references
        );


        info.append(
            title,
            metadata
        );


        card.append(info);

        container.append(card);

    }


    return container;

}


function updateCreateButton(app) {

    const root =
        app.element;

    const button =
        root?.querySelector(
            '[data-action="createProfile"]'
        );

    if (!button)
        return;


    const tab =
        app._ccManagerTab;

    const icon =
        button.querySelector("i");

    if (icon) {
        icon.className =
            "fas fa-plus";
    }


    const label =
        tab === "groups"
            ? game.i18n.localize(
                "COMPENDIUM_CURATOR.AddFilterGroupTitle"
            )
            : game.i18n.localize(
                "COMPENDIUM_CURATOR.CreateTableProfile"
            );


    for (
        const node
        of [...button.childNodes]
    ) {

        if (
            node.nodeType ===
            Node.TEXT_NODE
        ) {
            node.remove();
        }

    }


    button.append(
        document.createTextNode(
            ` ${label}`
        )
    );

}


function updateHeaderTitle(app) {

    const heading =
        app.element
            ?.querySelector(
                ".cc-table-manager-header h2"
            );

    if (!heading)
        return;

    heading.textContent =
        getTabLabel(
            app._ccManagerTab
        );

}


function updateEmptyState(
    app,
    visibleCount
) {

    const root =
        app.element;

    const currentEmpty =
        root?.querySelector(
            ".cc-table-manager-empty"
        );

    if (currentEmpty) {
        currentEmpty.hidden = true;
    }


    let empty =
        root?.querySelector(
            ".cc-table-manager-tab-empty"
        );

    if (!empty) {

        empty =
            document.createElement(
                "p"
            );

        empty.className =
            "cc-table-manager-tab-empty";

        root
            ?.querySelector(
                ".cc-table-profile-list"
            )
            ?.insertAdjacentElement(
                "afterend",
                empty
            );

    }


    empty.textContent =
        game.i18n.localize(
            "COMPENDIUM_CURATOR.NoTableProfiles"
        );

    empty.hidden =
        visibleCount > 0;

}


function applyManagerView(app) {

    const root =
        app.element;

    if (!root)
        return;


    const tab =
        VALID_TABS.has(
            app._ccManagerTab
        )
            ? app._ccManagerTab
            : "content";

    app._ccManagerTab =
        tab;


    const search =
        normalizeSearchText(
            app._ccManagerSearch
        );


    for (
        const button
        of root.querySelectorAll(
            "[data-cc-manager-tab]"
        )
    ) {

        const active =
            button.dataset
                .ccManagerTab ===
            tab;

        button.classList.toggle(
            "active",
            active
        );

        button.setAttribute(
            "aria-selected",
            String(active)
        );

    }


    const profiles =
        TableProfileStorageService
            .getProfiles();

    const profileList =
        root.querySelector(
            ".cc-table-profile-list"
        );

    const groupsContainer =
        root.querySelector(
            ".cc-table-manager-global-groups"
        );


    let visibleCount = 0;


    if (tab === "groups") {

        if (profileList) {
            profileList.hidden = true;
        }

        if (groupsContainer) {
            groupsContainer.hidden = false;
        }


        for (
            const card
            of groupsContainer
                ?.querySelectorAll(
                    ".cc-table-manager-global-group"
                ) ?? []
        ) {

            const matchesSearch =
                !search ||
                String(
                    card.dataset
                        .ccSearchText ?? ""
                ).includes(search);

            card.hidden =
                !matchesSearch;

            if (matchesSearch) {
                visibleCount++;
            }

        }

    } else {

        if (profileList) {
            profileList.hidden = false;
        }

        if (groupsContainer) {
            groupsContainer.hidden = true;
        }


        for (
            const card
            of root.querySelectorAll(
                ".cc-table-manager-profile"
            )
        ) {

            const profile =
                profiles[
                    card.dataset
                        .profileId
                ];

            const matchesType =
                getProfileType(
                    profile
                ) === tab;

            const matchesSearch =
                !search ||
                normalizeSearchText(
                    card.textContent
                ).includes(search);

            const visible =
                matchesType &&
                matchesSearch;

            card.hidden =
                !visible;

            if (visible) {
                visibleCount++;
            }

        }

    }


    updateCreateButton(app);
    updateHeaderTitle(app);

    updateEmptyState(
        app,
        visibleCount
    );

}


async function createStandaloneFilterGroup(
    app
) {

    const draft =
        await TableProfileService
            .createContentDraft(
                app.browserApp
            );


    if (
        (
            draft?.includedCount ?? 0
        ) === 0
    ) {

        ui.notifications.warn(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupNoObjects"
            )
        );

        return;

    }


    const content = `
        <div class="form-group">
            <label>
                ${
                    foundry.utils.escapeHTML(
                        game.i18n.localize(
                            "COMPENDIUM_CURATOR.FilterGroupName"
                        )
                    )
                }
            </label>

            <div class="form-fields">
                <input
                    type="text"
                    name="filterGroupName"
                    autocomplete="off"
                    autofocus
                >
            </div>
        </div>

        <p class="hint">
            ${
                foundry.utils.escapeHTML(
                    game.i18n.format(
                        "COMPENDIUM_CURATOR.CurrentFilterMatches",
                        {
                            count:
                                draft.includedCount
                        }
                    )
                )
            }
        </p>
    `;


    const result =
        await foundry
            .applications
            .api
            .DialogV2
            .input({

                window: {
                    title:
                        game.i18n.localize(
                            "COMPENDIUM_CURATOR.AddFilterGroupTitle"
                        )
                },

                content,

                ok: {
                    label:
                        game.i18n.localize(
                            "COMPENDIUM_CURATOR.AddFilterGroup"
                        )
                },

                rejectClose: false,
                modal: true

            });


    if (!result)
        return;


    const name =
        String(
            result.filterGroupName ?? ""
        ).trim();


    if (!name) {

        ui.notifications.warn(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupNameRequired"
            )
        );

        return;

    }


    if (
        TableProfileStorageService
            .isFilterGroupNameTaken(
                null,
                name
            )
    ) {

        ui.notifications.warn(
            game.i18n.localize(
                "COMPENDIUM_CURATOR.FilterGroupNameTaken"
            )
        );

        return;

    }


    const storage =
        foundry.utils.deepClone(
            TableProfileStorageService
                .getStorage()
        );

    storage.version = 3;
    storage.filterGroups ??= {};


    let id;

    do {

        id =
            foundry.utils.randomID();

    }
    while (
        storage.filterGroups[id]
    );


    const matches =
        [
            ...new Set(
                Array.from(
                    draft.matches ?? []
                )
                    .map(uuid =>
                        String(
                            uuid ?? ""
                        ).trim()
                    )
                    .filter(Boolean)
            )
        ];

    matches.sort();


    storage.filterGroups[id] = {
        id,
        name,
        revision: 1,

        browser:
            foundry.utils.deepClone(
                draft.browser ?? {}
            ),

        matches,
        refreshedAt: Date.now()
    };


    await game.settings.set(
        MODULE_ID,
        TABLE_PROFILES_SETTING,
        storage
    );


    ui.notifications.info(
        game.i18n.localize(
            "COMPENDIUM_CURATOR.FilterGroupSaved"
        )
    );


    app.render({
        force: true
    });

}


function bindContextualCreate(app) {

    const button =
        app.element
            ?.querySelector(
                '[data-action="createProfile"]'
            );

    if (!button)
        return;


    button.addEventListener(
        "click",
        event => {

            const tab =
                app._ccManagerTab;


            if (tab === "groups") {

                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();

                void createStandaloneFilterGroup(
                    app
                );

                return;

            }


            pendingProfileType =
                tab === "nested"
                    ? "nested"
                    : "content";

        },
        true
    );

}


function enhanceManager(app) {

    const root =
        app.element;

    if (!root)
        return;


    app._ccManagerTab ??=
        "content";

    app._ccManagerSearch ??=
        "";


    const profiles =
        getProfiles();

    const filterGroups =
        getFilterGroups();


    const header =
        root.querySelector(
            ".cc-table-manager-header"
        );

    const profileList =
        root.querySelector(
            ".cc-table-profile-list"
        );


    if (
        !header ||
        !profileList
    ) {
        return;
    }


    const toolbar =
        createToolbar(
            app,
            profiles,
            filterGroups
        );

    header.insertAdjacentElement(
        "afterend",
        toolbar
    );


    const groupsContainer =
        createGlobalGroupsContainer(
            profiles,
            filterGroups
        );

    profileList.insertAdjacentElement(
        "afterend",
        groupsContainer
    );


    bindContextualCreate(app);

    applyManagerView(app);

}


function applyPendingProfileType(app) {

    if (!pendingProfileType)
        return;


    const select =
        app.element
            ?.querySelector(
                '[name="profileType"]'
            );

    if (!select)
        return;


    select.value =
        pendingProfileType;

    select.dispatchEvent(
        new Event(
            "change",
            {
                bubbles: true
            }
        )
    );


    pendingProfileType =
        null;

}


export function registerTableManagerTabs() {

    Hooks.on(
        "renderApplicationV2",
        app => {

            if (app.id === MANAGER_ID) {

                enhanceManager(app);

                return;

            }

            if (
                app.id ===
                    PROFILE_EDITOR_ID
            ) {

                applyPendingProfileType(
                    app
                );

            }

        }
    );

}
