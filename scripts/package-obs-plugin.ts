import { existsSync, mkdirSync, cpSync, rmSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";

console.log("Building and packaging Presenter OBS Plugin for all platforms...");

const rootDir = process.cwd();
const distDir = path.resolve("dist");
const stageDir = path.resolve("dist/Presenter-OBS-Plugin");
const distObsDir = path.resolve("dist/obs-plugin");

// Ensure clean staging directories
mkdirSync(distDir, { recursive: true });
if (existsSync(stageDir)) {
    rmSync(stageDir, { recursive: true, force: true });
}
mkdirSync(stageDir, { recursive: true });

// Copy plugin files into staging folder
const filesToCopy = [
    "presenter_obs.py",
    "README.md",
    "install.bat",
    "install.sh",
];

for (const file of filesToCopy) {
    const srcPath = path.join("obs-plugin", file);
    if (existsSync(srcPath)) {
        cpSync(srcPath, path.join(stageDir, file));
    } else {
        console.warn(`[Warning] ${srcPath} not found!`);
    }
}

// Also keep dist/obs-plugin synchronized for other installer scripts
mkdirSync(distObsDir, { recursive: true });
cpSync("obs-plugin", distObsDir, { recursive: true });

// 1. Create ZIP archive
console.log("Creating dist/Presenter-OBS-Plugin.zip...");
const zipCheck = spawnSync("which", ["zip"], { stdio: "ignore" });

if (zipCheck.status === 0) {
    spawnSync("zip", ["-r", "../Presenter-OBS-Plugin.zip", "."], {
        cwd: stageDir,
        stdio: "inherit",
    });
} else if (process.platform === "win32") {
    // Windows PowerShell Compress-Archive
    spawnSync("powershell", [
        "-Command",
        `Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${distDir}\\Presenter-OBS-Plugin.zip' -Force`,
    ], { stdio: "inherit" });
} else {
    // Fallback using Python's zipfile module
    spawnSync("python3", [
        "-c",
        `import shutil; shutil.make_archive('${distDir}/Presenter-OBS-Plugin', 'zip', '${stageDir}')`,
    ], { stdio: "inherit" });
}

// 2. Create TAR.GZ archive
console.log("Creating dist/Presenter-OBS-Plugin.tar.gz...");
const tarCheck = spawnSync("which", ["tar"], { stdio: "ignore" });

if (tarCheck.status === 0 || process.platform === "win32") {
    spawnSync("tar", ["-czf", path.join(distDir, "Presenter-OBS-Plugin.tar.gz"), "-C", distDir, "Presenter-OBS-Plugin"], {
        stdio: "inherit",
    });
} else {
    spawnSync("python3", [
        "-c",
        `import shutil; shutil.make_archive('${distDir}/Presenter-OBS-Plugin', 'gztar', '${stageDir}')`,
    ], { stdio: "inherit" });
}

console.log("[Success] Presenter OBS Plugin packaged successfully for all platforms!");
console.log(`  -> ${path.join(distDir, "Presenter-OBS-Plugin.zip")}`);
console.log(`  -> ${path.join(distDir, "Presenter-OBS-Plugin.tar.gz")}`);
