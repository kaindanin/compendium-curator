import {
    existsSync,
    readFileSync,
    readdirSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(
    dirname(fileURLToPath(import.meta.url)),
    ".."
);
const checkerPath = fileURLToPath(import.meta.url);

function filesBelow(directory) {
    return readdirSync(directory, {
        withFileTypes: true
    }).flatMap(entry => {
        if (
            entry.isDirectory() &&
            [".git", "node_modules"].includes(
                entry.name
            )
        ) {
            return [];
        }

        const path = resolve(directory, entry.name);
        return entry.isDirectory()
            ? filesBelow(path)
            : [path];
    });
}

const projectFiles = filesBelow(root);
const javascriptFiles = projectFiles.filter(path =>
    [".js", ".mjs"].includes(extname(path))
);

for (const path of javascriptFiles) {
    const result = spawnSync(
        process.execPath,
        ["--check", path],
        { encoding: "utf8" }
    );

    if (result.status !== 0) {
        process.stderr.write(
            result.stderr || result.stdout
        );
        process.exit(result.status || 1);
    }
}

for (
    const path
    of projectFiles.filter(path =>
        extname(path) === ".json"
    )
) {
    JSON.parse(readFileSync(path, "utf8"));
}

const missingImports = [];
const missingTemplates = [];
const forbiddenManagerPatches = [];
const usedTranslations = new Set();

for (const path of javascriptFiles) {
    const source = readFileSync(path, "utf8");

    for (const pattern of path === checkerPath
        ? []
        : [
            "TableManagerApplication.prototype",
            "TableManagerApplication.DEFAULT_OPTIONS?.actions",
            "registerTableProfileRelations();"
        ]) {
        if (source.includes(pattern)) {
            forbiddenManagerPatches.push(
                `${path}: ${pattern}`
            );
        }
    }

    for (
        const match
        of source.matchAll(
            /(?:from\s+|import\s*\()(["'])(\.{1,2}\/[^"']+)\1/g
        )
    ) {
        const target = resolve(
            dirname(path),
            match[2]
        );

        if (!existsSync(target))
            missingImports.push(target);
    }

    for (
        const match
        of source.matchAll(
            /["'`](?:modules\/compendium-curator\/)?(templates\/[^"'`]+\.hbs)["'`]/g
        )
    ) {
        const target = resolve(root, match[1]);

        if (!existsSync(target))
            missingTemplates.push(target);
    }
}

for (
    const path
    of projectFiles.filter(path =>
        [".js", ".hbs"].includes(extname(path))
    )
) {
    const source = readFileSync(path, "utf8");

    for (
        const match
        of source.matchAll(
            /COMPENDIUM_CURATOR\.([A-Za-z0-9_]+)/g
        )
    ) {
        usedTranslations.add(match[1]);
    }
}

const languages = ["es", "en"].map(language => ({
    language,
    entries: JSON.parse(
        readFileSync(
            resolve(root, `lang/${language}.json`),
            "utf8"
        )
    ).COMPENDIUM_CURATOR
}));
const missingTranslations = languages.flatMap(({
    language,
    entries
}) => [...usedTranslations]
    .filter(key => entries?.[key] === undefined)
    .map(key => `${language}: ${key}`)
);

const failures = [
    ...missingImports.map(path =>
        `Missing import: ${path}`
    ),
    ...missingTemplates.map(path =>
        `Missing template: ${path}`
    ),
    ...forbiddenManagerPatches.map(value =>
        `Forbidden Table Manager patch: ${value}`
    ),
    ...missingTranslations.map(value =>
        `Missing translation: ${value}`
    )
];

if (failures.length) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exit(1);
}

process.stdout.write(
    `Checked ${javascriptFiles.length} JavaScript files, ` +
    `${usedTranslations.size} translations and all JSON files.\n`
);
