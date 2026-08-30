function normalizeUuid(value) {
    return String(value ?? "").trim();
}

export class TableDirectInclusionSelection {
    constructor(uuids = []) {
        this._uuids = new Set(
            Array.from(uuids ?? [])
                .map(normalizeUuid)
                .filter(Boolean)
        );
    }

    get size() {
        return this._uuids.size;
    }

    has(uuid) {
        return this._uuids.has(normalizeUuid(uuid));
    }

    select(uuid) {
        const normalized = normalizeUuid(uuid);

        if (normalized)
            this._uuids.add(normalized);
    }

    deselect(uuid) {
        this._uuids.delete(normalizeUuid(uuid));
    }

    selectAll(values) {
        for (const value of values ?? []) {
            this.select(
                typeof value === "string"
                    ? value
                    : value?.uuid
            );
        }
    }

    clear() {
        this._uuids.clear();
    }

    values() {
        return [...this._uuids].sort();
    }

    available(values) {
        const seen = new Set();
        const available = [];

        for (const value of values ?? []) {
            const uuid = normalizeUuid(
                typeof value === "string"
                    ? value
                    : value?.uuid
            );

            if (
                !uuid ||
                seen.has(uuid) ||
                this._uuids.has(uuid)
            ) {
                continue;
            }

            seen.add(uuid);
            available.push(value);
        }

        return available;
    }
}
