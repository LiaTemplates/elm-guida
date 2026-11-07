// Builds dist/packages.zip: the Elm packages of the official guide, downloaded
// and compiled once with the Guida CLI in Node. The template unpacks it into
// the IndexedDB of the browser, so the usual programs compile without any
// package registry.
//
//   node scripts/packages.mjs

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import JSZip from "jszip"

const PACKAGES = {
  "elm/browser": "1.0.2",
  "elm/bytes": "1.0.8",
  "elm/core": "1.0.5",
  "elm/file": "1.0.5",
  "elm/html": "1.0.1",
  "elm/http": "2.0.0",
  "elm/json": "1.1.4",
  "elm/parser": "1.1.0",
  "elm/random": "1.0.0",
  "elm/svg": "1.0.1",
  "elm/time": "1.0.0",
  "elm/url": "1.0.0",
  "elm/virtual-dom": "1.0.5",
}

const work = mkdtempSync(join(tmpdir(), "elm-guida-"))
const home = join(work, "home")
const project = join(work, "project")
mkdirSync(join(project, "src"), { recursive: true })

writeFileSync(
  join(project, "elm.json"),
  JSON.stringify({
    type: "application",
    "source-directories": ["src"],
    "elm-version": "0.19.1",
    dependencies: { direct: PACKAGES, indirect: {} },
    "test-dependencies": { direct: {}, indirect: {} },
  })
)
writeFileSync(join(project, "src", "Main.elm"), 'module Main exposing (main)\nimport Html\nmain = Html.text "hi"\n')

execFileSync(
  process.execPath,
  [join(import.meta.dirname, "..", "node_modules", "guida", "bin", "index.js"), "make", "src/Main.elm", "--output=/dev/null"],
  {
    cwd: project,
    stdio: "inherit",
    // The official registry works from Node (no CORS needed there).
    env: { ...process.env, GUIDA_HOME: home, GUIDA_REGISTRY: process.env.GUIDA_REGISTRY || "https://package.elm-lang.org" },
  }
)

// <home>/<compiler version>/packages
const version = readdirSync(home)[0]
const packages = join(home, version, "packages")

const zip = new JSZip()
const keep = (rel) => rel === "registry.dat" || /^[^/]+\/[^/]+\/[^/]+\/(elm\.json|artifacts\.dat|LICENSE|src\/.*)$/.test(rel)

const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else {
      const rel = relative(packages, path)
      if (keep(rel)) zip.file(rel, readFileSync(path))
    }
  }
}
walk(packages)

zip.file("VERSION", version)

const out = join(import.meta.dirname, "..", "dist", "packages.zip")
mkdirSync(join(import.meta.dirname, "..", "dist"), { recursive: true })
writeFileSync(out, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }))
rmSync(work, { recursive: true, force: true })

console.log("written", out, statSync(out).size, "bytes, compiler", version)
