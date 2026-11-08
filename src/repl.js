// An Elm REPL on top of `make`, for the LiaScript terminal.
//
// Every entry (import, type, definition or expression) is collected into one
// module. Two compiles per entry:
//   1. probe: every value to show gets the wrong annotation `LiaReplProbe`,
//      the type mismatch error then tells its inferred type
//   2. run:   without the probes, the values are printed with Debug.log in a
//      Web Worker (an endless loop can be stopped there)

const TIMEOUT = 5000

// ---------------------------------------------------------------------------
// Splitting code into top-level entries

// a definition `name args =`, the arguments are patterns without operators
const DEFINITION = /^([a-z_][\w']*)((?:\s+[\w'(),_{}\[\]\s]*)?)\s*=(?![=>])/
const ANNOTATION = /^([a-z_][\w']*)\s*:(?!:)/

function chunks(text, origin) {
  const lines = text.replace(/\r/g, "").split("\n")
  const result = []
  let current = null
  let comment = 0

  lines.forEach((line, index) => {
    const opens = (line.match(/\{-/g) || []).length
    const closes = (line.match(/-\}/g) || []).length
    const inComment = comment > 0
    comment += opens - closes

    if (inComment || opens > 0 && line.trim().startsWith("{-")) return
    if (/^\s*--/.test(line) || line.trim() === "") {
      if (current) current.lines.push(line)
      return
    }
    if (/^\S/.test(line)) {
      current = { lines: [line], origin, line: index }
      result.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      // indented first line: treat the whole input as one expression
      current = { lines: [line.trim()], origin, line: index }
      result.push(current)
    }
  })

  return result
    .map((c) => {
      while (c.lines.length && c.lines[c.lines.length - 1].trim() === "") c.lines.pop()
      return { ...c, text: c.lines.join("\n") }
    })
    .map(classify)
}

function classify(chunk) {
  const first = chunk.lines[0]
  let m
  if (/^module\s/.test(first) || /^port\s+module\s/.test(first)) return { ...chunk, kind: "module" }
  if ((m = first.match(/^import\s+([A-Z][\w.]*)/))) return { ...chunk, kind: "import", name: m[1] }
  if ((m = first.match(/^type\s+(?:alias\s+)?([A-Z]\w*)/))) return { ...chunk, kind: "type", name: m[1] }
  if ((m = first.match(ANNOTATION))) return { ...chunk, kind: "annotation", name: m[1] }
  if ((m = first.match(DEFINITION))) return { ...chunk, kind: "definition", name: m[1], value: m[2].trim() === "" }
  return { ...chunk, kind: "expression" }
}

// annotations belong to the definition below them
function merge(list) {
  const result = []
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    const next = list[i + 1]
    if (c.kind === "annotation" && next && next.kind === "definition" && next.name === c.name) {
      result.push({ ...next, text: c.text + "\n" + next.text, line: c.line, lines: [...c.lines, ...next.lines], annotated: true })
      i++
    } else if (c.kind !== "module") {
      result.push(c)
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Session state

function emptyState() {
  return { imports: [], decls: [] }
}

function addEntry(state, entry) {
  const next = { imports: [...state.imports], decls: [...state.decls] }
  const same = (e) => e.kind === entry.kind && e.name === entry.name

  if (entry.kind === "import") {
    next.imports = next.imports.filter((e) => e.name !== entry.name)
    next.imports.push(entry)
  } else if (entry.kind === "definition" || entry.kind === "type") {
    next.decls = next.decls.filter((e) => !same(e))
    next.decls.push(entry)
  }
  return next
}

// ---------------------------------------------------------------------------
// Module generation with a map from module lines to the origin of each line

function build(state, shows, mode) {
  const out = []
  const map = {}

  const emit = (text, origin, line, indent = "") => {
    text.split("\n").forEach((l, i) => {
      out.push(indent + l)
      if (origin) map[out.length] = { origin, line: line + i }
    })
  }

  emit(mode === "run" ? "module Main exposing (main)" : "module Main exposing (main)")
  emit("")
  for (const i of state.imports) emit(i.text, i.origin, i.line)
  emit("")
  emit("")
  if (mode === "probe") emit("type LiaReplProbe = LiaReplProbe\n\n")
  emit("lia_repl_id : a -> a\nlia_repl_id a =\n    a\n\n")

  for (const d of state.decls) {
    emit(d.text, d.origin, d.line)
    emit("\n")
  }

  shows.forEach((s, n) => {
    if (mode === "probe") emit("lia_repl_" + n + " : LiaReplProbe")
    // probe: wrapped in a list, so the failing unification does not mark the
    // type of a definition as broken (Elm would hide later errors with it)
    const [open, close] = mode === "probe" ? ["[", "]"] : ["(", ")"]
    emit("lia_repl_" + n + " =\n    lia_repl_id\n        " + open)
    if (s.kind === "expression") emit(s.text, s.origin, s.line, "        ")
    else emit(s.name, s.origin, s.line, "        ")
    emit("        " + close + "\n\n")
  })

  const logs = shows.map((_, n) => `        _ = Debug.log "LIA_REPL_${n}" lia_repl_${n}`).join("\n")

  emit(`lia_repl_show : ()
lia_repl_show =
${shows.length ? "    let\n" + logs + "\n    in\n    ()" : "    ()"}


main : Program () () ()
main =
    Platform.worker
        { init = \\_ -> ( lia_repl_show, Cmd.none )
        , update = \\_ m -> ( m, Cmd.none )
        , subscriptions = \\_ -> Sub.none
        }
`)

  return { code: out.join("\n"), map }
}

// ---------------------------------------------------------------------------

function text(message) {
  return message.map((p) => (typeof p === "string" ? p : p.string)).join("")
}

function problemsOf(error) {
  if (error.type !== "compile-errors") return null
  return error.errors.flatMap((file) => file.problems)
}

const PROBE = /This `lia_repl_id` call produces:\n\n([\s\S]*?)\n\nBut the type annotation on `lia_repl_(\d+)`/

// "    List (String -> String)" -> "String -> String"
// "    List ( Bool, String )"   -> "( Bool, String )" (tuples and () keep
// their parentheses)
function unwrapList(type) {
  let t = type.replace(/^ {4}/gm, "").replace(/^List\s+/, "")

  if (t.startsWith("(") && t.endsWith(")")) {
    let depth = 0
    let outer = true
    let comma = false
    for (let i = 0; i < t.length - 1; i++) {
      if ("([{".includes(t[i])) depth++
      else if (")]}".includes(t[i])) depth--
      else if (t[i] === "," && depth === 1) comma = true
      if (depth === 0) {
        outer = false
        break
      }
    }
    if (outer && !comma && t.slice(1, -1).trim() !== "") t = t.slice(1, -1).trim()
  }

  const lines = t.split("\n")
  const rest = lines.slice(1).filter((l) => l.trim())
  if (rest.length) {
    const indent = Math.min(...rest.map((l) => l.match(/^ */)[0].length))
    t = [lines[0], ...lines.slice(1).map((l) => l.slice(indent))].join("\n")
  }
  return t
}

function runWorker(js, onLog) {
  return new Promise((resolve) => {
    const source = `
self.console.log = function () { postMessage({ log: [].join.call(arguments, " ") }) };
self.console.warn = self.console.info = self.console.debug = function () {};
try {
${js}
(self.Elm || self.Guida).Main.init();
postMessage({ done: true });
} catch (e) {
postMessage({ error: String(e && e.message || e) });
}`
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }))
    const worker = new Worker(url)
    const finish = (result) => {
      clearTimeout(timer)
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve(result)
    }
    const timer = setTimeout(() => finish({ error: "Timeout: the evaluation took longer than " + TIMEOUT / 1000 + " s." }), TIMEOUT)
    worker.onmessage = (e) => {
      if (e.data.log !== undefined) onLog(e.data.log)
      else finish(e.data)
    }
    worker.onerror = (e) => {
      e.preventDefault()
      finish({ error: e.message })
    }
  })
}

// ---------------------------------------------------------------------------

module.exports = function createRepl({ compile, extractJs, report, escapeHtml }) {
  // translate line numbers in Elm's code snippets ("12|") back to the input
  function relabel(error, map) {
    const fix = (part) => {
      const swap = (s) =>
        s.replace(/(^|\n)(\s*)(\d+)\|/g, (all, nl, sp, n) => {
          const m = map[parseInt(n)]
          return m ? nl + sp + String(m.line + 1).padStart(n.length) + "|" : all
        })
      return typeof part === "string" ? swap(part) : { ...part, string: swap(part.string) }
    }
    if (error.type === "compile-errors") {
      return {
        ...error,
        errors: error.errors.map((f) => ({
          ...f,
          path: null,
          problems: f.problems.map((p) => ({ ...p, message: p.message.map(fix) })),
        })),
      }
    }
    return { ...error, message: (error.message || []).map(fix) }
  }

  function formatResult(value, type) {
    const v = `<span style="color:#4fb3d9">${escapeHtml(value)}</span>`
    const t = `<span style="opacity:0.7">${escapeHtml(type)}</span>`
    if (type.includes("\n") || value.length + type.length > 70) {
      return v + "\n    : " + t.replace(/\n/g, "\n      ")
    }
    return v + " : " + t
  }

  function prompt(entry) {
    return entry.lines.map((l, i) => (i === 0 ? "> " : "| ") + l).join("\n")
  }

  // evaluate entries on top of a state; returns { state } or { error }
  async function evaluate(state, entries, out, echo) {
    let next = state
    for (const e of entries) next = addEntry(next, e)

    // what to show: expressions and definitions of values/functions
    const shows = entries.filter((e) => e.kind === "expression" || e.kind === "definition")

    // 1. probe for the types
    const probe = build(next, shows, "probe")
    const probed = await compile([probe.code])

    const types = {}
    if (probed.error) {
      const problems = problemsOf(probed.error)
      const real = []
      for (const p of problems || []) {
        const m = text(p.message).match(PROBE)
        if (m) types[m[2]] = unwrapList(m[1])
        else real.push(p)
      }
      if (!problems || real.length) {
        const error = problems
          ? { type: "compile-errors", errors: [{ path: null, name: "Main", problems: real }] }
          : probed.error
        const relabeled = relabel(error, probe.map)
        return { error: relabeled, problems: problemsOf(relabeled) || [], map: probe.map }
      }
    }

    // 2. run for the values
    const run = build(next, shows, "run")
    const compiled = await compile([run.code])
    if (compiled.error) {
      const relabeled = relabel(compiled.error, run.map)
      return { error: relabeled, problems: problemsOf(relabeled) || [], map: run.map }
    }

    const values = {}
    const logs = []
    const result = await runWorker(extractJs(compiled.html), (line) => {
      const m = line.match(/^LIA_REPL_(\d+): ([\s\S]*)$/)
      if (m) values[m[1]] = m[2]
      else logs.push(line)
    })

    for (const l of logs) out.log(l)

    if (result.error) {
      out.error(result.error)
      return { state }
    }

    shows.forEach((s, n) => {
      if (echo) out.html(`<span style="opacity:0.7">${escapeHtml(prompt(s))}</span>`)
      out.html(formatResult(values[n] ?? "?", types[n] ?? "?"))
    })

    return { state: next }
  }

  const HELP = `Elm REPL in the browser (compiled with Guida)

  Type an expression, a definition, a type or an import.
  End a line with \\ to continue on the next line.

  :help   show this help
  :reset  forget everything typed in the terminal
  :exit   stop the REPL`

  return async function repl({ inputs, send, console: out }) {
    const block = inputs[0] || ""
    const entries = merge(chunks(block, "block"))

    let start = emptyState()
    let state = start
    let buffer = []
    let busy = Promise.resolve()

    const showError = (r) => {
      out.html(report(r.error).html)
    }

    // the code block
    if (entries.length) {
      const t = setTimeout(() => out.log("Compiling …"), 1500)
      let r
      try {
        r = await evaluate(state, entries, out, true)
      } catch (e) {
        clearTimeout(t)
        send.lia(String(e && e.message ? e.message : e), [], false)
        return
      }
      clearTimeout(t)

      if (r.error) {
        showError(r)
        const details = inputs.map(() => [])
        for (const p of r.problems) {
          const m = r.map[p.region.start.line]
          if (m && m.origin === "block") {
            details[0].push({
              row: m.line,
              column: Math.max(0, p.region.start.column - 1),
              text: p.title + "\n\n" + text(p.message),
              type: "error",
            })
          }
        }
        send.lia(r.problems.length === 1 ? "1 problem found" : r.problems.length + " problems found", details, false)
        return
      }
      start = state = r.state
    }

    out.log('REPL ready. Type an Elm expression, or :help')

    send.handle("input", (input) => {
      busy = busy.then(async () => {
        // the terminal sends every line with a trailing newline
        const line = input.replace(/\r/g, "").replace(/\s+$/, "")

        // continuation lines are indented, as Elm needs it for definitions
        const indent = buffer.length ? "  " : ""
        if (line.endsWith("\\")) {
          buffer.push(indent + line.slice(0, -1))
          return
        }
        buffer.push(indent + line)
        const code = buffer.join("\n")
        buffer = []

        const command = code.trim()
        if (command === "") return
        if (command === ":help") return out.log(HELP)
        if (command === ":reset") {
          state = start
          return out.log("Forgot everything typed in the terminal.")
        }
        if (command === ":exit") return send.lia("LIA: stop")

        const entries = merge(chunks(code, "input"))
        try {
          const r = await evaluate(state, entries, out, false)
          if (r.error) showError(r)
          else state = r.state
        } catch (e) {
          out.error(String(e && e.message ? e.message : e))
        }
      })
    })

    send.handle("stop", () => {})
  }
}
