import { existsSync, mkdirSync, cpSync, writeFileSync, chmodSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";

console.log("Packaging Linux distribution archives...");

const rootDir = process.cwd();
const distDir = path.resolve("dist");
const pkgDir = path.resolve("dist/Presenter-Linux-x64");

mkdirSync(pkgDir, { recursive: true });

// Copy binary and assets
cpSync(path.join(distDir, "presenter-server-linux-x64"), path.join(pkgDir, "presenter-server-linux-x64"));
chmodSync(path.join(pkgDir, "presenter-server-linux-x64"), 0o755);

cpSync(path.join(distDir, "public"), path.join(pkgDir, "public"), { recursive: true });
cpSync(path.join(distDir, "db"), path.join(pkgDir, "db"), { recursive: true });
if (existsSync("obs-plugin")) {
    cpSync("obs-plugin", path.join(pkgDir, "obs-plugin"), { recursive: true });
}
cpSync("assets/icon.png", path.join(pkgDir, "icon.png"));
cpSync("README.md", path.join(pkgDir, "README.md"));
cpSync("LICENSE", path.join(pkgDir, "LICENSE"));

// Launcher script
const startSh = `#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
exec ./presenter-server-linux-x64 "$@"
`;
writeFileSync(path.join(pkgDir, "start.sh"), startSh);
chmodSync(path.join(pkgDir, "start.sh"), 0o755);

// Create tar.gz
console.log("Creating Presenter-Linux-x64.tar.gz...");
spawnSync("tar", ["-czf", "dist/Presenter-Linux-x64.tar.gz", "-C", "dist", "Presenter-Linux-x64"], { stdio: "inherit" });

// Assemble .deb package if dpkg-deb is available
const dpkgCheck = spawnSync("which", ["dpkg-deb"], { stdio: "ignore" });
if (dpkgCheck.status === 0) {
    console.log("Assembling Debian/Ubuntu .deb package...");
    const debRoot = path.resolve("dist/deb-build");
    mkdirSync(path.join(debRoot, "DEBIAN"), { recursive: true });
    mkdirSync(path.join(debRoot, "usr/bin"), { recursive: true });
    mkdirSync(path.join(debRoot, "usr/share/presenter"), { recursive: true });
    mkdirSync(path.join(debRoot, "usr/share/applications"), { recursive: true });
    mkdirSync(path.join(debRoot, "usr/share/icons/hicolor/256x256/apps"), { recursive: true });

    // Control file
    const controlContent = `Package: presenter
Version: 1.0.0
Section: video
Priority: optional
Architecture: amd64
Maintainer: Thruqe <danielpeter0039@gmail.com>
Homepage: https://github.com/Thruqe/Presenter
Description: Presenter — Modern Church Scripture & Song Presentation System
 High-performance, low-latency scripture and song lyrics presentation
 platform featuring real-time NDI 1080p RGBA transparent streaming
 for OBS Studio, vMix, and live church broadcast environments.
`;
    writeFileSync(path.join(debRoot, "DEBIAN/control"), controlContent);

    // Desktop entry
    const desktopEntry = `[Desktop Entry]
Name=Presenter
Comment=Modern Church Scripture & Song Presentation System (OBS & NDI)
Exec=/usr/bin/presenter
Icon=presenter
Terminal=true
Type=Application
Categories=AudioVideo;Presentation;Video;
Keywords=church;bible;scripture;songs;lyrics;obs;ndi;presentation;
`;
    writeFileSync(path.join(debRoot, "usr/share/applications/presenter.desktop"), desktopEntry);

    // Copy app files
    cpSync(pkgDir, path.join(debRoot, "usr/share/presenter"), { recursive: true });
    cpSync("assets/icon.png", path.join(debRoot, "usr/share/icons/hicolor/256x256/apps/presenter.png"));

    // Symlink /usr/bin/presenter
    const binScript = `#!/bin/sh
cd /usr/share/presenter && exec ./presenter-server-linux-x64 "$@"
`;
    writeFileSync(path.join(debRoot, "usr/bin/presenter"), binScript);
    chmodSync(path.join(debRoot, "usr/bin/presenter"), 0o755);

    spawnSync("dpkg-deb", ["--build", debRoot, "dist/Presenter-Linux-x64.deb"], { stdio: "inherit" });
    console.log("[Success] Created dist/Presenter-Linux-x64.deb");
} else {
    console.log("[Info] dpkg-deb not found on host; skipping .deb creation (will build in Ubuntu CI runner).");
}

console.log("[Success] Linux packaging completed!");
