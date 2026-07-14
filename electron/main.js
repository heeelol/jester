// electron/main.js — the native shell. It runs the existing web app in a
// transparent, frameless window, starts the local server (OpenAI proxy + phone
// relay), and exposes OS control over IPC. Saying "enter the mainframe" flips the
// window to a click-through, always-on-top overlay floating over the live desktop.
//
// PC control lives HERE, in a local process — never on a public endpoint. That's
// what makes controlling your machine safe.

import { app, BrowserWindow, ipcMain, globalShortcut, screen } from "electron";
import { exec } from "node:child_process";
import path from "node:path";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}/`;

let win;

// Allowlisted apps only — no arbitrary command execution.
const APPS = {
  chrome: "start chrome", edge: "start msedge", firefox: "start firefox",
  spotify: "start spotify:", notepad: "start notepad", explorer: "start explorer",
  calculator: "start calc", calc: "start calc", code: "start code",
  terminal: "start wt", cmd: "start cmd", settings: "start ms-settings:",
  camera: "start microsoft.windows.camera:", mail: "start outlookmail:",
};

const ping = () => new Promise((resolve) => {
  const req = http.get(URL, (res) => { res.destroy(); resolve(true); });
  req.on("error", () => resolve(false));
  req.setTimeout(700, () => { req.destroy(); resolve(false); });
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Reuse a running server if there is one; otherwise start it in-process.
async function ensureServer() {
  if (await ping()) return;
  await import(pathToFileURL(path.join(ROOT, "server", "jester.js")).href);
  for (let i = 0; i < 40; i++) { if (await ping()) return; await delay(150); }
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height,
    frame: false,
    transparent: true,          // renderer paints an opaque bg in browser phase
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: false,
    },
  });
  win.loadURL(URL);
}

// Flip between the windowed "browser phase" and the desktop overlay.
function setMainframe(on) {
  if (!win) return;
  if (on) {
    const full = screen.getPrimaryDisplay().bounds; // cover the taskbar too
    win.setBounds(full);
    win.setAlwaysOnTop(true, "screen-saver");
    win.setIgnoreMouseEvents(true, { forward: true }); // clicks pass to the desktop
    win.setSkipTaskbar(true);
  } else {
    const { workArea } = screen.getPrimaryDisplay();
    win.setAlwaysOnTop(false);
    win.setIgnoreMouseEvents(false);
    win.setSkipTaskbar(false);
    win.setBounds(workArea);
    win.focus();
  }
}

ipcMain.handle("mainframe:set", (_e, on) => { setMainframe(!!on); return { ok: true }; });

ipcMain.handle("os:launch", (_e, name) => {
  const cmd = APPS[String(name || "").toLowerCase()];
  if (!cmd) return { ok: false, error: "not allowlisted" };
  exec(cmd, (err) => err && console.error("launch failed:", err.message));
  return { ok: true };
});

ipcMain.handle("os:command", (_e, command, arg) => {
  switch (command) {
    case "show_desktop":
      exec('powershell -NoProfile -Command "(New-Object -ComObject Shell.Application).MinimizeAll()"');
      return { ok: true };
    case "lock":
      exec("rundll32.exe user32.dll,LockWorkStation");
      return { ok: true };
    case "open_url": {
      const url = String(arg || "");
      if (/^https?:\/\//i.test(url)) exec(`start "" "${url}"`);
      return { ok: true };
    }
    default:
      return { ok: false, error: "unknown command" };
  }
});

app.whenReady().then(async () => {
  await ensureServer();
  createWindow();

  // Voice + exit work even when the overlay is click-through.
  globalShortcut.register("CommandOrControl+Shift+Space", () => win?.webContents.send("voice:listen"));
  globalShortcut.register("CommandOrControl+Shift+Return", () => { setMainframe(true); win?.webContents.send("mainframe:enter"); });
  globalShortcut.register("CommandOrControl+Shift+M", () => { setMainframe(false); win?.webContents.send("mainframe:exit"); });
  globalShortcut.register("CommandOrControl+Q", () => app.quit());

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
