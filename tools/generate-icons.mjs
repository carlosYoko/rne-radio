// Rasteriza el logo local con Chromium. No instala dependencias ni descarga recursos.
// Solo se necesita para regenerar: los PNG ya se incluyen en la extensión.
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { STATIONS } from "../build/domain/stations.js";

const candidates = [process.env.CHROME_PATH, ...(
  process.platform === "win32" ? [
    `${process.env.PROGRAMFILES}/Google/Chrome/Application/chrome.exe`,
    `${process.env.PROGRAMFILES}/BraveSoftware/Brave-Browser/Application/brave.exe`,
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`
  ] : process.platform === "darwin" ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ] : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]
)].filter(Boolean);
let browser;
for (const candidate of candidates) {
  try { await access(candidate); browser = candidate; break; } catch { /* siguiente */ }
}
if (!browser) throw new Error("Indica la ruta al ejecutable Chromium en CHROME_PATH para regenerar los iconos.");

const logos = await Promise.all(STATIONS.map(async (station) => ({
  id: station.id,
  svg: Buffer.from(await readFile(new URL(`../${station.logo}`, import.meta.url), "utf8")).toString("base64")
})));
const temp = await mkdtemp(join(tmpdir(), "rne-icons-"));
try {
  const page = join(temp, "render.html");
  await writeFile(page, `<!doctype html><meta charset="utf-8"><pre id="result"></pre><script>
(async () => {
  const output = {};
  for (const logo of ${JSON.stringify(logos)}) {
    const image = new Image();
    image.src = 'data:image/svg+xml;base64,' + logo.svg;
    await image.decode();
    for (const size of [16, 32, 48, 128]) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.scale(size / 128, size / 128);
    ctx.fillStyle = '#bc3525';
    ctx.beginPath();
    ctx.roundRect(0, 0, 128, 128, 24);
    ctx.fill();
    ctx.drawImage(image, 8, 15, 112, 91.23);
      output[logo.id + '-' + size] = canvas.toDataURL('image/png').split(',')[1];
    }
  }
  document.getElementById('result').textContent = JSON.stringify(output);
})().catch(error => { document.getElementById('result').textContent = error.message; });
</script>`);
  const html = execFileSync(browser, [
    "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${join(temp, "profile")}`, "--dump-dom", "--virtual-time-budget=3000",
    pathToFileURL(page).href
  ], { encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const match = html.match(/<pre id="result">(\{[^<]+\})<\/pre>/);
  if (!match) throw new Error("Chromium no ha devuelto las imágenes rasterizadas.");
  const icons = JSON.parse(match[1]);
  const output = new URL("../icons/", import.meta.url);
  await mkdir(output, { recursive: true });
  for (const [name, base64] of Object.entries(icons)) {
    await writeFile(new URL(`${name}.png`, output), Buffer.from(base64, "base64"));
  }
  console.log("Iconos de las seis emisoras generados en icons/ (16, 32, 48 y 128 px).");
} finally {
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
