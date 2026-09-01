function normalizeUuids(values) {
    return [
        ...new Set(
            Array.from(values ?? [])
                .map(value =>
                    String(value ?? "").trim()
                )
                .filter(Boolean)
        )
    ];
}

export function getCategoryManualIncludeUuids(
    category
) {
    return normalizeUuids([
        ...(category?.manualIncludes ?? []),
        ...Array.from(category?.groups ?? [])
            .flatMap(group =>
                group?.manualIncludes ?? []
            )
    ]);
}

export function getCategoryAutomaticMatchUuids(
    category
) {
    const manualUuids = new Set(
        getCategoryManualIncludeUuids(category)
    );
    const groups = Array.from(
        category?.groups ?? []
    );
    const matches = groups.length
        ? groups.flatMap(group =>
            group?.matches ?? []
        )
        : category?.matches ?? [];

    return normalizeUuids(matches)
        .filter(uuid =>
            !manualUuids.has(uuid)
        );
}

export function getCategoryAllUuids(category) {
    return normalizeUuids([
        ...getCategoryAutomaticMatchUuids(
            category
        ),
        ...getCategoryManualIncludeUuids(
            category
        )
    ]);
}
