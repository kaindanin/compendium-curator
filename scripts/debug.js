import { MODULE_ID } from "./settings.js";

export function debug(...args) {
    console.log(`%c[${MODULE_ID}]`, "color:#4CAF50;font-weight:bold", ...args);
}