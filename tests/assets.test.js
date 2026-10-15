import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STATIONS, toolbarIconPaths } from "../build/domain/stations.js";

const root = new URL("../", import.meta.url);

test("cada emisora tiene un SVG local, sin contenido activo ni recursos externos", async () => {
  assert.equal(new Set(STATIONS.map((station) => station.logo)).size, STATIONS.length);
  for (const station of STATIONS) {
    assert.match(station.logo, /^assets\/logos\/[a-z0-9-]+\.svg$/);
    const svg = await readFile(new URL(station.logo, root), "utf8");
    assert.match(svg, /<svg\b/);
    assert.match(svg, /viewBox="0 0 124 101"/);
    assert.doesNotMatch(svg, /<script\b|<foreignObject\b|<image\b|\son\w+\s*=|(?:xlink:)?href\s*=|url\(/i);
  }
});

test("los iconos del manifest son PNG de las dimensiones declaradas", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.deepEqual(manifest.icons, toolbarIconPaths("rne1"));
  for (const [size, path] of Object.entries(manifest.icons)) {
    assert.equal(manifest.action.default_icon[size], path);
    const png = await readFile(new URL(path, root));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), Number(size));
    assert.equal(png.readUInt32BE(20), Number(size));
  }
});

test("las seis emisoras tienen todos los PNG para el icono dinámico", async () => {
  for (const station of STATIONS) {
    for (const [size, path] of Object.entries(toolbarIconPaths(station.id))) {
      const png = await readFile(new URL(path, root));
      assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(png.readUInt32BE(16), Number(size));
      assert.equal(png.readUInt32BE(20), Number(size));
    }
  }
});
