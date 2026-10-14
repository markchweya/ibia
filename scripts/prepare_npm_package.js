// Stages the npm package for GitHub Packages in ./npm-package.
//
// The repository's package.json is shaped for electron-builder, which
// requires electron as a devDependency. The npm package needs the opposite:
// electron as a real dependency so `ibia` can launch it, a scoped name for
// the GitHub registry, and an explicit file list so nothing else ships.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "npm-package");
const source = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));

const files = [
  "bin/ibia.js",
  "main.js",
  "preload.js",
  "renderer.js",
  "index.html",
  "style.css",
  "scripts/extract_assets.py",
  "build/icon.png",
  "build/icon.ico",
  "README.md",
  "LICENSE"
];

fs.rmSync(outDir, { recursive: true, force: true });
for (const file of files) {
  const from = path.join(root, file);
  if (!fs.existsSync(from)) throw new Error(`Missing file for npm package: ${file}`);
  const to = path.join(outDir, file);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

const pkg = {
  name: "@markchweya/ibia",
  version: source.version,
  description: source.description,
  author: source.author,
  license: "Apache-2.0",
  main: "main.js",
  bin: { ibia: "bin/ibia.js" },
  files,
  engines: { node: ">=18" },
  dependencies: { electron: source.devDependencies.electron },
  repository: { type: "git", url: "git+https://github.com/markchweya/ibia.git" },
  homepage: "https://github.com/markchweya/ibia#readme",
  bugs: { url: "https://github.com/markchweya/ibia/issues" },
  keywords: ["ai", "assistant", "desktop", "electron", "ollama", "local-first"],
  publishConfig: { registry: "https://npm.pkg.github.com" }
};

fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
console.log(`Staged ${pkg.name}@${pkg.version} in ${path.relative(root, outDir)}/`);
