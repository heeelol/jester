// capture.mjs — renders hero.html in headless Chrome (SwiftShader WebGL) and
// screenshots it to assets/cover.png. Dev-only (puppeteer is not a project dep).
// To regenerate the cover:
//   npm i -D puppeteer && npx puppeteer browsers install chrome
//   PORT=3013 npm start &   # then:
//   node scripts/capture.mjs
import puppeteer from "puppeteer";
import { mkdirSync } from "node:fs";

const URL = process.env.HERO_URL || "http://localhost:3013/hero.html";
mkdirSync("assets", { recursive: true });

const browser = await puppeteer.launch({
  headless: "new",
  args: [
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox", "--disable-dev-shm-usage",
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1.5 });
await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
await page.waitForFunction("window.__coverReady === true", { timeout: 30000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500)); // let bloom + rotation settle
await page.screenshot({ path: "assets/cover.png" });
await browser.close();
console.log("cover written → assets/cover.png");
