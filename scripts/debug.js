import { MODULE_ID } from "./settings.js";

const DEBUG_ENABLED = false;

export function debug(...args) {

    if (!DEBUG_ENABLED)
        return;

    console.log(
        `%c[${MODULE_ID}]`,
        "color:#4CAF50;font-weight:bold",
        ...args
    );

}