import { cpSync, mkdirSync, existsSync } from "fs";
import path from "path";

console.log("Copying web assets and databases to dist/...");

mkdirSync("dist/public", { recursive: true });
mkdirSync("dist/db", { recursive: true });
mkdirSync("dist/obs-plugin", { recursive: true });

cpSync("public", "dist/public", { recursive: true });
cpSync("db", "dist/db", { recursive: true });

if (existsSync("obs-plugin")) {
    cpSync("obs-plugin", "dist/obs-plugin", { recursive: true });
}

if (existsSync("assets/icon.ico")) {
    cpSync("assets/icon.ico", "dist/icon.ico");
}
if (existsSync("assets/icon.png")) {
    cpSync("assets/icon.png", "dist/icon.png");
}

console.log("[Success] Assets copied to dist/public and dist/db.");
