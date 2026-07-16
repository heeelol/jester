// electron/main.js — the native shell. It runs the existing web app in a
// transparent, frameless window, starts the local server (OpenAI proxy + phone
// relay), and exposes OS control over IPC. Saying "enter the mainframe" flips the
// window to a click-through, always-on-top overlay floating over the live desktop.
//
// PC control lives HERE, in a local process — never on a public endpoint. That's
// what makes controlling your machine safe.

import { app, BrowserWindow, ipcMain, globalShortcut, screen, session } from "electron";
import { exec } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import os from "node:os";
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
  spotify: "start spotify:", discord: "start discord://",
  notepad: "start notepad", explorer: "start explorer", files: "start explorer",
  calculator: "start calc", calc: "start calc", code: "start code", vscode: "start code",
  terminal: "start wt", cmd: "start cmd", powershell: "start powershell",
  settings: "start ms-settings:", camera: "start microsoft.windows.camera:",
  mail: "start outlookmail:", whatsapp: "start whatsapp:", telegram: "start tg://",
  steam: "start steam://", slack: "start slack://",
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
  // JESTER_PUBLIC lets the phone reach us through a tunnel (the phone can't use
  // localhost). It's passed to the page so the pairing QR points at the tunnel.
  const pub = process.env.JESTER_PUBLIC;
  win.loadURL(pub ? `${URL}?pub=${encodeURIComponent(pub)}` : URL);
}

// Flip between the windowed "browser phase" and the desktop overlay. We keep the
// window at the work area (NOT covering the taskbar) so there's always a visible
// escape, and register Escape as an extra exit while the overlay is up.
function setMainframe(on) {
  if (!win) return;
  if (on) {
    win.setAlwaysOnTop(true, "screen-saver");
    win.setIgnoreMouseEvents(true, { forward: true }); // clicks pass to the desktop
    win.setSkipTaskbar(true);
    globalShortcut.register("Escape", exitMainframeAndNotify);
  } else {
    globalShortcut.unregister("Escape");
    win.setAlwaysOnTop(false);
    win.setIgnoreMouseEvents(false);
    win.setSkipTaskbar(false);
    win.focus();
  }
}
function enterMainframeAndNotify() { setMainframe(true); win?.webContents.send("mainframe:enter"); }
function exitMainframeAndNotify() { setMainframe(false); win?.webContents.send("mainframe:exit"); }

ipcMain.handle("mainframe:set", (_e, on) => { setMainframe(!!on); return { ok: true }; });

let lastApp = null; // the most recently launched app (for "hide from view")
ipcMain.handle("os:launch", (_e, name) => {
  const key = String(name || "").toLowerCase();
  const cmd = APPS[key];
  if (!cmd) return { ok: false, error: "not allowlisted" };
  lastApp = key;
  exec(cmd, (err) => err && console.error("launch failed:", err.message));
  return { ok: true };
});

// Close an allowlisted app by killing its process.
const EXES = {
  chrome: "chrome.exe", edge: "msedge.exe", firefox: "firefox.exe",
  spotify: "Spotify.exe", discord: "Discord.exe", notepad: "notepad.exe",
  explorer: "explorer.exe", files: "explorer.exe", calculator: "CalculatorApp.exe", calc: "CalculatorApp.exe",
  code: "Code.exe", vscode: "Code.exe", terminal: "WindowsTerminal.exe", cmd: "cmd.exe", powershell: "powershell.exe",
  camera: "WindowsCamera.exe", whatsapp: "WhatsApp.exe", telegram: "Telegram.exe", steam: "steam.exe", slack: "Slack.exe",
};
ipcMain.handle("os:close", (_e, name) => {
  const exe = EXES[String(name || "").toLowerCase()];
  if (!exe) return { ok: false, error: "not allowlisted" };
  exec(`taskkill /IM "${exe}" /F`, (err) => err && console.error("close failed:", err.message));
  return { ok: true };
});

// Minimize an app's window ("hide from view") — defaults to the last-opened app.
ipcMain.handle("os:hideApp", (_e, name) => {
  const app = String(name || "").toLowerCase() || lastApp;
  const exe = EXES[app];
  if (!exe) return { ok: false, error: "unknown app" };
  const proc = exe.replace(/\.exe$/i, "");
  runPS(`$s='[DllImport("user32.dll")]public static extern bool ShowWindow(System.IntPtr h,int c);';$t=Add-Type -MemberDefinition $s -Name Win -Namespace H -PassThru;Get-Process '${proc}' -ErrorAction SilentlyContinue | ?{$_.MainWindowHandle -ne 0} | %{$t::ShowWindow($_.MainWindowHandle,6)}`);
  return { ok: true };
});

// Visibly type a string into the focused window's address/search bar via
// SendKeys (Ctrl+L focuses the browser omnibox), one character at a time so the
// user watches JESTER "type". SendKeys specials are brace-escaped.
let typeSeq = 0;
// Resolves when the typing (and Enter) has finished, so callers can sequence the
// UI after the search is actually submitted.
function typeSequence(text) {
  return new Promise((resolve) => {
    const esc = [...text].map((ch) => ("+^%~(){}[]".includes(ch) ? "{" + ch + "}" : ch));
    const arr = esc.map((s) => "'" + s.replace(/'/g, "''") + "'").join(",");
    const ps = [
      "$w=New-Object -ComObject WScript.Shell",
      "Start-Sleep -Milliseconds 200",
      "$w.SendKeys('^l')",           // focus the browser address bar
      "Start-Sleep -Milliseconds 400",
      `$a=@(${arr})`,
      "foreach($c in $a){$w.SendKeys($c);Start-Sleep -Milliseconds 45}",
      "Start-Sleep -Milliseconds 300",
      "$w.SendKeys('~')",            // Enter
    ].join("\n");
    const tmp = path.join(os.tmpdir(), `jester-type-${process.pid}-${typeSeq++}.ps1`);
    try {
      writeFileSync(tmp, ps, "utf8");
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`, () => { try { unlinkSync(tmp); } catch { /* ignore */ } resolve(); });
    } catch (e) { console.error("type failed:", e.message); resolve(); }
  });
}

// Search: open/focus the browser, visibly type the results URL and Enter, and
// resolve only once that's done (so the gallery can appear after the search).
ipcMain.handle("os:search", async (_e, query, engine) => {
  const q = String(query || "").trim();
  if (!q) return { ok: false };
  const enc = q.replace(/\s+/g, "+");
  const url = engine === "google" ? `https://www.google.com/search?q=${enc}`
    : engine === "web" ? `https://duckduckgo.com/?q=${enc}`
    : `https://www.youtube.com/results?search_query=${enc}`;
  // --guest opens a clean window and SKIPS the "who's using Chrome?" profile picker.
  exec('start "" chrome --guest', () => {});
  await new Promise((r) => setTimeout(r, 2200)); // let the guest window come up
  await typeSequence(url);                        // type + submit
  return { ok: true };
});

// Open a URL directly in a clean guest window (skips the profile picker) — used
// to play a chosen video.
ipcMain.handle("os:open", (_e, url) => {
  const u = String(url || "");
  if (!/^https?:\/\//.test(u)) return { ok: false };
  exec(`start "" chrome --guest "${u}"`, (err) => err && console.error("open failed:", err.message));
  return { ok: true };
});

// Media / window / volume control. Volume + play-pause use global media virtual
// keys (no focus needed); fullscreen/minimize send keys to the focused window.
function runPS(script) {
  const tmp = path.join(os.tmpdir(), `jester-ps-${process.pid}-${typeSeq++}.ps1`);
  try { writeFileSync(tmp, script, "utf8"); exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`, () => { try { unlinkSync(tmp); } catch { /* ignore */ } }); }
  catch (e) { console.error("ps failed:", e.message); }
}
const KBD = `$s='[DllImport("user32.dll")]public static extern void keybd_event(byte b,byte k,uint f,int e);';$t=Add-Type -MemberDefinition $s -Name Kbd -Namespace Win -PassThru;`;
const sendVK = (code, times = 1) => runPS(`${KBD}1..${times}|%{$t::keybd_event(${code},0,0,0);$t::keybd_event(${code},0,2,0)}`);
const sendKeys = (keys) => runPS(`$w=New-Object -ComObject WScript.Shell;$w.SendKeys('${keys}')`);

ipcMain.handle("os:media", (_e, action) => {
  switch (action) {
    case "volume_up":     sendVK(0xAF, 5); break;
    case "volume_down":   sendVK(0xAE, 5); break;
    case "mute":          sendVK(0xAD, 1); break;
    case "play_pause":    sendVK(0xB3, 1); break; // controls Spotify / active media
    case "next_track":    sendVK(0xB0, 1); break;
    case "previous_track":sendVK(0xB1, 1); break;
    case "fullscreen":    sendKeys("f"); break;   // YouTube video fullscreen
    // Escape first so a fullscreen video exits fullscreen, then minimize the window.
    case "minimize":      runPS(`$w=New-Object -ComObject WScript.Shell;$w.SendKeys('{ESC}');Start-Sleep -Milliseconds 250;$w.SendKeys('% n')`); break;
    case "maximize":      sendKeys("% x"); break; // Alt+Space, x
    default: return { ok: false };
  }
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
  // Allow mic/camera so Whisper voice + hand tracking work in the desktop app.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === "media"));
  await ensureServer();
  createWindow();

  // Voice + exit work even when the overlay is click-through.
  globalShortcut.register("CommandOrControl+Shift+Space", () => win?.webContents.send("voice:listen"));
  globalShortcut.register("CommandOrControl+Shift+Return", enterMainframeAndNotify);
  globalShortcut.register("CommandOrControl+Shift+M", exitMainframeAndNotify);
  globalShortcut.register("CommandOrControl+Q", () => app.quit());

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());
