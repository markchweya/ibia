#!/usr/bin/env node
// `ibia` command for the npm package: launches the desktop app with the
// Electron runtime that npm installed alongside it.
const { spawn } = require("child_process");
const path = require("path");

const electron = require("electron");
const appDir = path.join(__dirname, "..");

const child = spawn(electron, [appDir, ...process.argv.slice(2)], {
  stdio: "inherit",
  windowsHide: false
});

child.on("close", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
