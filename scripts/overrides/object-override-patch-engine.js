function clone(value) {
    return value === undefined
        ? undefined
        : structuredClone(value);
}


function isPlainObject(value) {
    if (!value || typeof value !== "object")
        return false;

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}


function sameValue(left, right) {
    if (Object.is(left, right))
        return true;

    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right))
            return false;

        return left.length === right.length &&
            left.every((value, index) =>
                sameValue(value, right[index])
            );
    }

    if (!isPlainObject(left) || !isPlainObject(right))
        return false;

    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    return leftKeys.length === rightKeys.length &&
        leftKeys.every(key =>
            Object.hasOwn(right, key) &&
            sameValue(left[key], right[key])
        );
}


function encodeSegment(segment) {
    return String(segment)
        .replaceAll("~", "~0")
        .replaceAll("/", "~1");
}


function decodeSegment(segment) {
    return String(segment)
        .replaceAll("~1", "/")
        .replaceAll("~0", "~");
}


function toPointer(segments) {
    if (!segments.length)
        return "";

    return `/${segments.map(encodeSegment).join("/")}`;
}


function fromPointer(pointer) {
    if (Array.isArray(pointer))
        return pointer.map(String);

    const value = String(pointer ?? "");

    if (!value)
        return [];

    if (!value.startsWith("/"))
        return value.split(".").filter(Boolean);

    return value
        .slice(1)
        .split("/")
        .map(decodeSegment);
}


function assertSafeSegments(segments) {
    const forbidden = new Set([
        "__proto__",
        "constructor",
        "prototype"
    ]);

    if (segments.some(segment => forbidden.has(segment)))
        throw new Error("Unsafe Object Override patch path.");
}


function baseline(exists, value, includeBaseline) {
    if (!includeBaseline)
        return undefined;

    return exists
        ? { exists: true, value: clone(value) }
        : { exists: false };
}


function makeOperation(
    op,
    segments,
    value,
    baselineValue
) {
    const operation = {
        op,
        path: toPointer(segments)
    };

    if (op !== "remove")
        operation.value = clone(value);

    if (baselineValue !== undefined)
        operation.baseline = baselineValue;

    return operation;
}


function pathIsAtomic(pointer, atomicPaths) {
    return atomicPaths.has(pointer);
}


function diffValue(
    original,
    working,
    segments,
    operations,
    options
) {
    if (sameValue(original, working))
        return;

    const pointer = toPointer(segments);
    const originalObject = isPlainObject(original);
    const workingObject = isPlainObject(working);

    if (
        pathIsAtomic(pointer, options.atomicPaths) ||
        Array.isArray(original) ||
        Array.isArray(working) ||
        originalObject !== workingObject ||
        (!originalObject && !workingObject)
    ) {
        const complex =
            Array.isArray(original) ||
            Array.isArray(working) ||
            originalObject ||
            workingObject;

        operations.push(
            makeOperation(
                complex ? "replace" : "set",
                segments,
                working,
                baseline(true, original, options.includeBaseline)
            )
        );
        return;
    }

    const keys = new Set([
        ...Object.keys(original),
        ...Object.keys(working)
    ]);

    for (const key of Array.from(keys).sort()) {
        const childSegments = [...segments, key];
        const originalHas = Object.hasOwn(original, key);
        const workingHas = Object.hasOwn(working, key);

        if (!workingHas) {
            operations.push(
                makeOperation(
                    "remove",
                    childSegments,
                    undefined,
                    baseline(
                        true,
                        original[key],
                        options.includeBaseline
                    )
                )
            );
            continue;
        }

        if (!originalHas) {
            operations.push(
                makeOperation(
                    "set",
                    childSegments,
                    working[key],
                    baseline(
                        false,
                        undefined,
                        options.includeBaseline
                    )
                )
            );
            continue;
        }

        diffValue(
            original[key],
            working[key],
            childSegments,
            operations,
            options
        );
    }
}


function parentFor(root, segments, { create = false } = {}) {
    let current = root;

    for (const segment of segments.slice(0, -1)) {
        assertSafeSegments([segment]);

        if (!isPlainObject(current[segment])) {
            if (!create)
                return null;

            current[segment] = {};
        }

        current = current[segment];
    }

    return current;
}


export class ObjectOverridePatchEngine {
    static equals(left, right) {
        return sameValue(left, right);
    }


    static diff(
        original,
        working,
        {
            includeBaseline = true,
            atomicPaths = []
        } = {}
    ) {
        const operations = [];
        const options = {
            includeBaseline,
            atomicPaths: new Set(
                Array.from(atomicPaths, path =>
                    toPointer(fromPointer(path))
                )
            )
        };

        diffValue(
            original,
            working,
            [],
            operations,
            options
        );

        return operations;
    }


    static apply(source, operations) {
        let result = clone(source);

        for (const operation of operations ?? []) {
            const segments = fromPointer(operation?.path);
            assertSafeSegments(segments);

            if (!segments.length) {
                if (operation.op === "remove")
                    result = undefined;
                else if (["set", "replace"].includes(operation.op))
                    result = clone(operation.value);
                else
                    throw new Error(`Unknown patch operation: ${operation.op}`);

                continue;
            }

            const parent = parentFor(
                result,
                segments,
                { create: operation.op !== "remove" }
            );

            if (!parent)
                continue;

            const key = segments.at(-1);

            if (operation.op === "remove")
                delete parent[key];
            else if (["set", "replace"].includes(operation.op))
                parent[key] = clone(operation.value);
            else
                throw new Error(`Unknown patch operation: ${operation.op}`);
        }

        return result;
    }


    static get(source, path) {
        const segments = fromPointer(path);
        assertSafeSegments(segments);

        let current = source;

        for (const segment of segments) {
            if (
                !current ||
                typeof current !== "object" ||
                !Object.hasOwn(current, segment)
            ) {
                return { exists: false, value: undefined };
            }

            current = current[segment];
        }

        return {
            exists: true,
            value: clone(current)
        };
    }


    static set(source, path, value) {
        const segments = fromPointer(path);
        assertSafeSegments(segments);

        if (!segments.length)
            return clone(value);

        const result = clone(source);
        const parent = parentFor(
            result,
            segments,
            { create: true }
        );

        parent[segments.at(-1)] = clone(value);
        return result;
    }


    static remove(source, path) {
        const segments = fromPointer(path);
        assertSafeSegments(segments);

        if (!segments.length)
            return undefined;

        const result = clone(source);
        const parent = parentFor(result, segments);

        if (parent)
            delete parent[segments.at(-1)];

        return result;
    }


    static pointer(path) {
        return toPointer(fromPointer(path));
    }
}
