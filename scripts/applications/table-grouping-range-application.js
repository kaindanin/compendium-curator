import { TableProfileStorageService } from "../services/table-profile-storage-service.js";

const {
    ApplicationV2,
    HandlebarsApplicationMixin
} = foundry.applications.api;

function getCriterionLabel(criterion) {
    let key = "GroupBy";

    if (criterion === "cr")
        key = "GroupByChallengeRating";
    else if (criterion === "spellLevel")
        key = "GroupBySpellLevel";

    return game.i18n.localize(
        `COMPENDIUM_CURATOR.${key}`
    );
}

function formatRangeValue(value) {
    const number = Number(value);

    if (!Number.isFinite(number))
        return "—";

    return new Intl.NumberFormat(
        game.i18n.lang,
        {
            maximumFractionDigits: 3
        }
    ).format(number);
}

function getRangeLabel(
    criterion,
    range
) {
    const criterionLabel =
        getCriterionLabel(criterion);
    const min = Number(range?.min);

    if (!Number.isFinite(min))
        return criterionLabel;

    const rawMax = range?.max;

    if (
        rawMax === null ||
        rawMax === undefined ||
        rawMax === ""
    ) {
        return `${criterionLabel} ${formatRangeValue(min)}+`;
    }

    const max = Number(rawMax);

    if (!Number.isFinite(max))
        return criterionLabel;

    if (min === max) {
        return `${criterionLabel} ${formatRangeValue(min)}`;
    }

    return `${criterionLabel} ${formatRangeValue(min)}–${formatRangeValue(max)}`;
}

export class TableGroupingRangeApplication
    extends HandlebarsApplicationMixin(
        ApplicationV2
    ) {

    constructor(
        manager,
        profileId,
        criterion,
        options = {}
    ) {
        super(options);

        this.manager = manager;
        this.profileId = profileId;
        this.criterion =
            String(criterion ?? "").trim();
        this._draftRanges = null;
    }

    static DEFAULT_OPTIONS = {
        id:
            "compendium-curator-table-grouping-ranges",
        classes: [
            "dnd5e2",
            "compendium-curator",
            "cc-table-grouping-range-app"
        ],
        actions: {
            addRange:
                this.#onAddRange,
            removeRange:
                this.#onRemoveRange,
            save:
                this.#onSave,
            cancel:
                this.#onCancel
        },
        window: {
            title:
                "COMPENDIUM_CURATOR.EditGroupingRanges",
            resizable: true
        },
        position: {
            width: 520
        }
    };

    static PARTS = {
        body: {
            template:
                "modules/compendium-curator/templates/table-grouping-range.hbs"
        }
    };

    get profile() {
        return TableProfileStorageService
            .getProfiles()?.[
                this.profileId
            ] ?? null;
    }

    _getStoredRanges(profile = this.profile) {
        if (!profile)
            return [];

        const grouped =
            profile.distribution?.grouped;
        const activeCriterion =
            String(
                grouped?.grouping?.criterion ?? ""
            );

        const ranges =
            activeCriterion === this.criterion
                ? grouped?.grouping?.ranges
                : grouped?.configurations?.[
                    this.criterion
                ]?.ranges;

        return foundry.utils.deepClone(
            Array.isArray(ranges)
                ? ranges
                : []
        );
    }

    _captureDraftFromForm() {
        if (!this.element)
            return;

        const rows = [
            ...this.element.querySelectorAll(
                "[data-cc-range-row]"
            )
        ];

        this._draftRanges =
            rows.map(row => {
                const minInput =
                    row.querySelector(
                        "[data-cc-range-min]"
                    );
                const maxInput =
                    row.querySelector(
                        "[data-cc-range-max]"
                    );
                const minValue =
                    String(
                        minInput?.value ?? ""
                    ).trim();
                const maxValue =
                    String(
                        maxInput?.value ?? ""
                    ).trim();

                return {
                    key:
                        String(
                            row.dataset
                                ?.rangeKey ?? ""
                        ).trim(),
                    min:
                        minValue
                            ? minValue
                            : undefined,
                    max:
                        maxValue
                            ? maxValue
                            : null
                };
            });
    }

    async _prepareContext(options) {
        const context =
            await super._prepareContext(options);
        const profile = this.profile;

        if (!profile) {
            return {
                ...context,
                missingProfile: true,
                ranges: []
            };
        }

        if (!Array.isArray(this._draftRanges)) {
            this._draftRanges =
                this._getStoredRanges(profile);
        }

        const canRemove =
            this._draftRanges.length > 1;

        context.profileName = profile.name;
        context.criterionLabel =
            getCriterionLabel(
                this.criterion
            );
        context.ranges =
            this._draftRanges.map(range => ({
                ...range,
                minValue:
                    range.min ?? "",
                maxValue:
                    range.max ?? "",
                label:
                    getRangeLabel(
                        this.criterion,
                        range
                    ),
                canRemove
            }));
        context.hasRanges =
            context.ranges.length > 0;

        return context;
    }

    static #onAddRange(event) {
        event.preventDefault();

        this._captureDraftFromForm();
        this._draftRanges ??= [];

        this._draftRanges.push({
            key:
                `range:${foundry.utils.randomID()}`,
            min: undefined,
            max: null
        });

        this.render({
            force: true
        });
    }

    static #onRemoveRange(
        event,
        target
    ) {
        event.preventDefault();

        this._captureDraftFromForm();

        if (
            !Array.isArray(this._draftRanges) ||
            this._draftRanges.length <= 1
        ) {
            ui.notifications.warn(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.GroupingRangesNeedOne"
                )
            );
            return;
        }

        const key =
            String(
                target
                    .closest("[data-cc-range-row]")
                    ?.dataset?.rangeKey ?? ""
            ).trim();

        this._draftRanges =
            this._draftRanges.filter(
                range => range.key !== key
            );

        this.render({
            force: true
        });
    }

    static async #onSave(
        event,
        target
    ) {
        event.preventDefault();

        this._captureDraftFromForm();

        target.disabled = true;

        try {
            const updatedProfile =
                await TableProfileStorageService
                    .setDistributionGroupingRanges(
                        this.profileId,
                        this.criterion,
                        this._draftRanges
                    );

            this._draftRanges =
                this._getStoredRanges(
                    updatedProfile
                );

            ui.notifications.info(
                game.i18n.localize(
                    "COMPENDIUM_CURATOR.GroupingRangesSaved"
                )
            );

            this.manager?.render({
                force: true
            });

            await this.close();
        }
        catch (error) {
            if (
                error?.message ===
                    "INVALID_TABLE_GROUPING_RANGES"
            ) {
                ui.notifications.warn(
                    game.i18n.localize(
                        "COMPENDIUM_CURATOR.InvalidGroupingRanges"
                    )
                );
                return;
            }

            console.error(
                "Compendium Curator | Error guardando los rangos de agrupación.",
                error
            );
            throw error;
        }
        finally {
            if (target.isConnected) {
                target.disabled = false;
            }
        }
    }

    static #onCancel(event) {
        event.preventDefault();
        this.close();
    }
}
