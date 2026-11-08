// Browser glue between LiaScript and the Guida compiler (an Elm 0.19.1
// compatible compiler written in Elm). Exposes `window.ElmGuida`.

const guida = require("./runner.js")
const JSZip = require("jszip")
const { createFs } = require("indexeddb-fs")

const fs = createFs({ databaseName: "lia-elm-guida" })

// Guida mocks the global XMLHttpRequest while it runs; keep the real one.
const RealXHR = window.XMLHttpRequest

// dist/packages.zip lies next to this bundle. LiaScript loads scripts from
// the same origin as blobs, then the resource timing still knows the URL.
const SCRIPT = (() => {
  const src = document.currentScript && document.currentScript.src
  if (src && !src.startsWith("blob:")) return src
  try {
    return performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .filter((n) => /\/dist\/index\.js(\?.*)?$/.test(n))
      .pop()
  } catch (e) {
    return undefined
  }
})()

let cwd = "root"

const config = {
  XMLHttpRequest: RealXHR,
  env: {},
  writeFile: fs.writeFile,
  readFile: fs.readFile,
  details: fs.details,
  createDirectory: fs.createDirectory,
  readDirectory: fs.readDirectory,
  getCurrentDirectory: async () => cwd,
  homedir: async () => "root",
}

// ---------------------------------------------------------------------------
// Default elm.json: the packages used in the official Elm guide. Only the
// packages a program imports end up in its elm.json, so the first compile
// downloads no more than needed.

const VERSIONS = {
  "elm/core": "1.0.5",
  "elm/html": "1.0.1",
  "elm/browser": "1.0.2",
  "elm/json": "1.1.4",
  "elm/http": "2.0.0",
  "elm/random": "1.0.0",
  "elm/time": "1.0.0",
  "elm/svg": "1.0.1",
  "elm/url": "1.0.0",
  "elm/file": "1.0.5",
  "elm/bytes": "1.0.8",
  "elm/virtual-dom": "1.0.5",
  "elm/parser": "1.1.0",
}

const DEPENDS = {
  "elm/core": [],
  "elm/html": ["elm/core", "elm/json", "elm/virtual-dom"],
  "elm/browser": ["elm/core", "elm/html", "elm/json", "elm/time", "elm/url", "elm/virtual-dom"],
  "elm/json": ["elm/core"],
  "elm/http": ["elm/bytes", "elm/core", "elm/file", "elm/json"],
  "elm/random": ["elm/core", "elm/time"],
  "elm/time": ["elm/core"],
  "elm/svg": ["elm/core", "elm/html", "elm/json", "elm/virtual-dom"],
  "elm/url": ["elm/core"],
  "elm/file": ["elm/bytes", "elm/core", "elm/json", "elm/time"],
  "elm/bytes": ["elm/core"],
  "elm/virtual-dom": ["elm/core", "elm/json"],
  "elm/parser": ["elm/core"],
}

// first segment of an imported module -> package
const MODULES = {
  Browser: "elm/browser",
  Html: "elm/html",
  Json: "elm/json",
  Http: "elm/http",
  Random: "elm/random",
  Time: "elm/time",
  Svg: "elm/svg",
  Url: "elm/url",
  File: "elm/file",
  Bytes: "elm/bytes",
  VirtualDom: "elm/virtual-dom",
  Parser: "elm/parser",
}

function defaultElmJson(sources) {
  const direct = new Set(["elm/core", "elm/html", "elm/browser"])
  for (const src of sources) {
    for (const m of src.matchAll(/^import\s+([A-Z]\w*)/gm)) {
      if (MODULES[m[1]]) direct.add(MODULES[m[1]])
    }
  }

  const all = new Set()
  const visit = (pkg) => {
    if (all.has(pkg)) return
    all.add(pkg)
    DEPENDS[pkg].forEach(visit)
  }
  direct.forEach(visit)

  const pick = (names) =>
    Object.fromEntries([...names].sort().map((n) => [n, VERSIONS[n]]))

  return JSON.stringify(
    {
      type: "application",
      "source-directories": ["src"],
      "elm-version": "0.19.1",
      dependencies: {
        direct: pick(direct),
        indirect: pick([...all].filter((n) => !direct.has(n))),
      },
      "test-dependencies": { direct: {}, indirect: {} },
    },
    null,
    4
  )
}

// ---------------------------------------------------------------------------
// Listings of a LiaScript code block -> project files

const MODULE_HEADER = /^(?:port\s+|effect\s+)?module\s+([A-Z][\w.]*)/m

function moduleName(src) {
  const m = src.match(MODULE_HEADER)
  return m ? m[1] : "Main"
}

// Like `elm make` and `elm reactor`, a listing without a module line is the
// module Main. Guida needs the line, so it is added in front; `offset` moves
// the line numbers of error reports back to the lines of the listing.
function withHeader(src) {
  if (MODULE_HEADER.test(src)) return { text: src, offset: 0 }
  const port = /^port\s+[a-z]/m.test(src) ? "port " : ""
  return { text: port + "module Main exposing (..)\n" + src, offset: 1 }
}

function classify(inputs) {
  const project = { modules: [], elmJson: null, html: null }

  inputs.forEach((text, index) => {
    const trimmed = text.trim()
    if (trimmed === "") return
    if (trimmed.startsWith("{")) project.elmJson = text
    else if (trimmed.startsWith("<")) project.html = text
    else project.modules.push({ index, name: moduleName(text), ...withHeader(text) })
  })

  return project
}

// move the line numbers of a compile error report by the offset of its file:
// the regions and the numbers in the code snippets ("12|")
function shiftLines(error, offsets) {
  if (!error || error.type !== "compile-errors") return error
  return {
    ...error,
    errors: error.errors.map((file) => {
      const offset = offsets[file.path] || 0
      if (!offset) return file
      const line = (n) => Math.max(1, n - offset)
      const swap = (s) =>
        s.replace(/(^|\n)(\s*)(\d+)\|/g, (all, nl, sp, n) => nl + sp + String(line(parseInt(n))).padStart(n.length) + "|")
      const region = (r) =>
        r && { ...r, start: { ...r.start, line: line(r.start.line) }, end: { ...r.end, line: line(r.end.line) } }
      return {
        ...file,
        problems: file.problems.map((p) => ({
          ...p,
          region: region(p.region),
          message: p.message.map((part) => (typeof part === "string" ? swap(part) : { ...part, string: swap(part.string) })),
        })),
      }
    }),
  }
}

// the listings of a code block, from `@'input(0)` … `@'input(9)` of a macro:
// LiaScript shows a missing listing N as "<first listing>(N)"
function listings(list) {
  const result = [list[0]]
  for (let i = 1; i < list.length; i++) {
    if (list[i] === list[0] + "(" + i + ")") break
    result.push(list[i])
  }
  return result
}

function hash(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

async function mkdirs(path) {
  const parts = path.split("/")
  for (let i = 1; i <= parts.length; i++) {
    const dir = parts.slice(0, i).join("/")
    if (!(await fs.exists(dir))) await fs.createDirectory(dir)
  }
}

// ---------------------------------------------------------------------------
// Running Guida: one compile at a time

let queue = Promise.resolve()

function exclusive(task) {
  const result = queue.then(task, task)
  queue = result.catch(() => {})
  return result
}

// Unpack the precompiled packages into the package cache of Guida once
// (<home>/.guida/<compiler version>/packages).

let preloaded = null

function preload(log) {
  if (!preloaded) {
    preloaded = (async () => {
      const url = window.ElmGuida.packages || (SCRIPT && new URL("packages.zip", SCRIPT).href)
      if (!url) return

      const marker = "root/.guida/preloaded-2-" + hash(url)
      if (await fs.exists(marker)) return true

      const response = await fetch(url)
      if (!response.ok) throw new Error(response.status + " " + url)
      log && log("Unpacking the Elm packages …")

      const zip = await JSZip.loadAsync(await response.arrayBuffer())
      const version = (await zip.file("VERSION").async("text")).trim()
      const base = "root/.guida/" + version + "/packages/"

      for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir || name === "VERSION") continue
        const path = base + name
        await mkdirs(path.split("/").slice(0, -1).join("/"))
        const data = name.endsWith(".dat")
          ? new Uint8Array(await entry.async("uint8array"))
          : await entry.async("text")
        await fs.writeFile(path, data)

        // Guida 1.0.0-beta.2 looks for a cached package outline only under
        // the name guida.json and goes online otherwise (it checks
        // guida.json twice instead of elm.json).
        if (/^[^/]+\/[^/]+\/[^/]+\/elm\.json$/.test(name)) {
          await fs.writeFile(path.replace(/elm\.json$/, "guida.json"), data)
        }
      }

      await fs.writeFile(marker, url)
      return true
    })().catch((e) => {
      // without the archive Guida downloads the packages from its registry
      console.warn("ElmGuida: could not preload the packages:", e)
      return false
    })
  }
  return preloaded
}

// true if every package of the elm.json is one of the preloaded packages
function onlyPreloaded(elmJson) {
  try {
    const json = JSON.parse(elmJson)
    const groups = [json.dependencies, json["test-dependencies"]]
    return groups.every((g) =>
      ["direct", "indirect"].every((k) =>
        Object.entries((g && g[k]) || {}).every(([name, version]) => VERSIONS[name] === version)
      )
    )
  } catch (e) {
    return false
  }
}

async function compile(inputs, options = {}) {
  const project = classify(inputs)

  if (project.modules.length === 0) {
    return { error: { type: "error", path: null, title: "NO ELM CODE", message: ["There is no Elm module in this code block."] } }
  }

  const elmJson = project.elmJson || defaultElmJson(project.modules.map((m) => m.text))
  const root = "root/p" + hash(elmJson)

  return exclusive(async () => {
    const preloadedOk = await preload(options.log)
    // Guida asks the registry for new packages on every compile; not needed
    // when all packages come from the archive (and it fails without a
    // connection)
    config.skipRegistryUpdate = preloadedOk === true && onlyPreloaded(elmJson)
    await mkdirs(root)
    await fs.writeFile(root + "/elm.json", elmJson)

    if (await fs.exists(root + "/src")) await fs.removeDirectory(root + "/src")

    const paths = {}
    const offsets = {}
    for (const mod of project.modules) {
      const path = root + "/src/" + mod.name.replace(/\./g, "/") + ".elm"
      await mkdirs(path.split("/").slice(0, -1).join("/"))
      await fs.writeFile(path, mod.text)
      paths[path] = mod.index
      offsets[path] = mod.offset
    }

    cwd = root
    const entry = root + "/src/" + project.modules[0].name.replace(/\./g, "/") + ".elm"

    const result = await guida.make(config, entry, {
      debug: options.mode === "debug",
      optimize: options.mode === "optimize",
    })

    if (result && result.error) {
      let error
      try {
        error = JSON.parse(result.error)
      } catch (e) {
        error = { type: "error", path: null, title: "ERROR", message: [String(result.error)] }
      }
      return { error: shiftLines(error, offsets), paths, project }
    }

    let warnings = []
    try {
      warnings = JSON.parse(result.warnings || "[]")
    } catch (e) {}

    return { html: patchNavigation(result.output), warnings, paths, project }
  })
}

// ---------------------------------------------------------------------------
// Browser.application in the frame: a srcdoc frame has no URL of its own
// (about:srcdoc, which Elm rejects) and must not write into the history of
// the course. The kernel of elm/browser gets a virtual location instead,
// starting at VIRTUAL_URL: pushUrl, replaceUrl, back and forward move inside
// it, links are resolved against it, internal `load`s change the URL like
// pushUrl, external ones open in a new tab.

const VIRTUAL_URL = "http://localhost/"

const NAVIGATION = `var _Lia_nav = (function () {
  var stack = [${JSON.stringify(VIRTUAL_URL)}], pos = 0;
  function abs(url) { try { return new URL(url, stack[pos]).href; } catch (e) { return String(url); } }
  function origin(url) { try { return new URL(url).origin; } catch (e) { return null; } }
  return {
    href: function () { return stack[pos]; },
    link: function (node) { var a = node.getAttribute('href'); return a === null ? String(node.href) : abs(a); },
    push: function (url) { stack = stack.slice(0, pos + 1); stack.push(abs(url)); pos = stack.length - 1; },
    replace: function (url) { stack[pos] = abs(url); },
    go: function (n) { pos = Math.max(0, Math.min(stack.length - 1, pos + n)); },
    load: function (url) {
      var next = abs(url);
      if (origin(next) === origin(stack[pos])) {
        this.push(next);
        window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
      } else {
        window.open(next, '_blank', 'noopener');
      }
    }
  };
})();

`

function patchNavigation(html) {
  if (!html || !html.includes("function _Browser_getUrl()")) return html
  const patches = [
    ["function _Browser_getUrl()", NAVIGATION + "function _Browser_getUrl()"],
    ["_VirtualDom_doc.location.href", "_Lia_nav.href()"],
    ["var href = domNode.href;", "var href = _Lia_nav.link(domNode);"],
    ["history.go(n)", "_Lia_nav.go(n)"],
    ["history.pushState({}, '', url)", "_Lia_nav.push(url)"],
    ["history.replaceState({}, '', url)", "_Lia_nav.replace(url)"],
    ["_Browser_window.location = url", "_Lia_nav.load(url)"],
  ]
  for (const [from, to] of patches) html = html.split(from).join(to)
  return html
}

// ---------------------------------------------------------------------------
// Output: the compiled program runs in an iframe (srcdoc) that resizes itself
// and forwards console output (Debug.log) to the LiaScript terminal.

const loggers = {}

function hook(uid) {
  return `<script>(function(){
  var p = window.parent && window.parent.ElmGuida;
  ["log","info","warn","error","debug"].forEach(function(k){
    var o = console[k];
    console[k] = function(){
      try { p && p.log(${JSON.stringify(uid)}, k, [].slice.call(arguments)); } catch(e) {}
      return o.apply(console, arguments);
    };
  });
  window.addEventListener("error", function(e){
    try { p && p.log(${JSON.stringify(uid)}, "error", [e.message]); } catch(_) {}
  });
})()</script>`
}

function extractJs(html) {
  const m = html.match(/<script>\s*try \{\n([\s\S]*?)\n\s*var app = (?:Elm|Guida)\./)
  return m ? m[1] : null
}

function page(uid, compiled) {
  const { html, project } = compiled

  if (!project.html) {
    return html.replace("<head>", "<head>\n" + hook(uid))
  }

  // own host page (ports, flags): insert the compiled JavaScript where the
  // page loads elm.js / main.js, or before its first script
  const js = "<script>" + extractJs(html) + "</script>"
  let host = project.html
  const src = /<script[^>]*\bsrc=["']?\.?\/?(elm|main|index)\.js["']?[^>]*>\s*<\/script>/i

  if (src.test(host)) host = host.replace(src, () => js)
  else if (/<script/i.test(host)) host = host.replace(/<script/i, () => js + "\n<script")
  else host = host + js

  if (/<head[^>]*>/i.test(host)) return host.replace(/<head[^>]*>/i, (m) => m + hook(uid))
  return hook(uid) + host
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;")
}

function iframe(uid, compiled, height) {
  const style = height
    ? `height:${height};`
    : "height:0;"

  return `<iframe class="lia-elm-guida" data-uid="${escapeAttr(uid)}"
    title="Elm program" ${height ? "" : 'data-fit="true"'}
    style="width:100%;border:0;display:block;background:white;${style}"
    onload="window.ElmGuida && window.ElmGuida.fit(this)"
    srcdoc="${escapeAttr(page(uid, compiled))}"></iframe>`
}

function fit(frame) {
  if (frame.dataset.fit !== "true") return
  try {
    const doc = frame.contentDocument
    const resize = () => {
      const h = Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0)
      // long output (e.g. a whole book) scrolls inside the frame
      const max = Math.max(200, Math.round(window.innerHeight * 0.8))
      frame.style.height = Math.min(Math.max(h, 24), max) + "px"
    }
    new ResizeObserver(() => requestAnimationFrame(resize)).observe(doc.documentElement)
    resize()
  } catch (e) {
    frame.style.height = "300px"
  }
}

function log(uid, level, args) {
  const out = loggers[uid]
  if (!out) return
  const text = args
    .map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a) } catch (e) { return String(a) } })()))
    .join(" ")
  if (text.startsWith("Compiled in DEV mode") || text.startsWith("Compiled in DEBUG mode")) return
  try {
    ;(out[level] || out.log)(text)
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Error messages: Elm's colored JSON report -> HTML for the terminal, text
// for the editor annotations

const COLORS = {
  red: "#e5484d", RED: "#e5484d",
  yellow: "#d4a72c", YELLOW: "#d4a72c",
  green: "#30a46c", GREEN: "#30a46c",
  cyan: "#0e9eb3", CYAN: "#0e9eb3",
  blue: "#3e63dd", BLUE: "#3e63dd",
  magenta: "#ab4aba", MAGENTA: "#ab4aba",
  black: "inherit", white: "inherit",
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function messageToHtml(message) {
  return message
    .map((part) => {
      if (typeof part === "string") return escapeHtml(part)
      let s = escapeHtml(part.string)
      const style = []
      if (part.bold) style.push("font-weight:bold")
      if (part.underline) style.push("text-decoration:underline")
      if (part.color && COLORS[part.color]) style.push("color:" + COLORS[part.color])
      return style.length ? `<span style="${style.join(";")}">${s}</span>` : s
    })
    .join("")
}

function messageToText(message) {
  return message.map((part) => (typeof part === "string" ? part : part.string)).join("")
}

function header(title, path) {
  const left = "-- " + title + " "
  const right = path ? " " + path.replace(/^root\/p[a-z0-9]+\//, "") : ""
  const dashes = "-".repeat(Math.max(2, 60 - left.length - right.length))
  return `<span style="color:#0e9eb3">${escapeHtml(left + dashes + right)}</span>`
}

function report(error) {
  const blocks = []
  const problems = []

  if (error.type === "compile-errors") {
    for (const file of error.errors) {
      for (const p of file.problems) {
        blocks.push(header(p.title, file.path) + "\n\n" + messageToHtml(p.message))
        problems.push({ path: file.path, problem: p })
      }
    }
  } else {
    blocks.push(header(error.title || "ERROR", error.path) + "\n\n" + messageToHtml(error.message || []))
  }

  return {
    html: `<pre style="white-space:pre-wrap;margin:0;font-size:0.85em">${blocks.join("\n\n\n")}</pre>`,
    problems,
  }
}

// ---------------------------------------------------------------------------
// Entry point for the LiaScript macros

async function run({ uid, inputs, send, console: out, mode, height }) {
  loggers[uid] = out

  const start = Date.now()
  const slow = setTimeout(() => out.log("Compiling …"), 1500)

  let compiled
  try {
    compiled = await compile(inputs, { mode, log: (msg) => out.log(msg) })
  } catch (e) {
    clearTimeout(slow)
    send.lia(String(e && e.message ? e.message : e), [], false)
    return
  }
  clearTimeout(slow)

  if (compiled.error) {
    const { html, problems } = report(compiled.error)
    out.html(html)

    if (problems.length > 0) {
      // same shape as LiaError.details: one list of annotations per listing
      const details = inputs.map(() => [])
      for (const { path, problem } of problems) {
        const index = compiled.paths[path] ?? 0
        details[index].push({
          row: problem.region.start.line - 1,
          column: problem.region.start.column - 1,
          text: problem.title + "\n\n" + messageToText(problem.message),
          type: "error",
        })
      }
      send.lia(problems.length === 1 ? "1 problem found" : problems.length + " problems found", details, false)
    } else {
      send.lia(messageToText(compiled.error.message || []), [], false)
    }
    return
  }

  if (Date.now() - start > 1500) out.log("Done in " + ((Date.now() - start) / 1000).toFixed(1) + " s")
  out.html(iframe(uid, compiled, height))
  send.lia("LIA: stop")
}

async function format(code) {
  const result = await exclusive(() => guida.format(config, code))
  if (result && result.error) throw new Error(result.error)
  return result.output
}

async function reset() {
  await exclusive(async () => {
    if (await fs.exists("root")) await fs.removeDirectory("root")
    preloaded = null
  })
}

const repl = require("./repl.js")({ compile, extractJs, report, escapeHtml })

window.ElmGuida = {
  compile,
  run,
  repl,
  format,
  reset,
  fit,
  log,
  defaultElmJson,
  listings,
  // URL of the precompiled packages (default: packages.zip next to the bundle)
  packages: undefined,
  // package registry for everything that is not preloaded
  set registry(url) {
    config.env.GUIDA_REGISTRY = url
  },
  get registry() {
    return config.env.GUIDA_REGISTRY || "https://package.guida-lang.org"
  },
}
