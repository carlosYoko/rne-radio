import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, access } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("dominio y aplicación no dependen de infraestructura, Chrome ni DOM", async () => {
  for (const layer of ["domain", "application"]) {
    for (const file of await readdir(new URL(`src/${layer}/`, root))) {
      if (!file.endsWith(".ts")) continue;
      const source = await readFile(new URL(`src/${layer}/${file}`, root), "utf8");
      assert.doesNotMatch(source, /from\s+["'][^"']*(?:infrastructure|presentation|entries)\//, file);
      assert.doesNotMatch(source, /\b(?:chrome|document|window|navigator)\s*\.|new Audio\(/, file);
      if (layer === "domain") assert.doesNotMatch(source, /from\s+["'][^"']*application\//, file);
    }
  }
});

test("todos los entrypoints e imports del paquete compilado existen y son locales", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  const visited = new Set();
  async function visit(url) {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const source = await readFile(url, "utf8");
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      assert.ok(match[1].startsWith("."), `Import externo no permitido: ${match[1]}`);
      await visit(new URL(match[1], url));
    }
  }
  await visit(new URL(manifest.background.service_worker, root));
  for (const page of [manifest.action.default_popup, "offscreen.html"]) {
    const html = await readFile(new URL(page, root), "utf8");
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)];
    assert.equal(scripts.length, 1);
    await visit(new URL(scripts[0][1], root));
    for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
      if (!match[1].startsWith("https://")) await access(new URL(match[1], root));
    }
  }
  assert.ok(visited.size > 10);
});
