// FoodHerons — local dev launcher.
//
// Starts BOTH processes the app needs, in one terminal:
//   1. api  — the C# order service (ASP.NET, port 5080). Run with
//             ASPNETCORE_ENVIRONMENT=Development so `dotnet user-secrets`
//             (Supabase URL/keys, service-role key) are loaded. Without this
//             the service fails fast on missing config.
//   2. web  — the Vite dev server (port 5173), which proxies /api -> :5080.
//
// Both children share this terminal; their output is line-prefixed [api]/[web].
// Ctrl+C (or either process exiting) tears down the other so you never leave a
// stale backend bound to 5080 — the "failed to fetch" / port-in-use trap.
//
//   npm run dev:all
//
// Needs the .NET SDK on PATH (`dotnet`) and `npm install` already run.
//
// Implementation note: the web side runs Vite's JS entry with the SAME Node
// binary (process.execPath), NOT `npm run dev`. Spawning `npm.cmd` with
// shell:false throws EINVAL on recent Node for Windows (it refuses to spawn
// .cmd/.bat without a shell), so we bypass the shim and call Vite directly.
// This is also faster and fully cross-platform.

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)

// Resolve the local Vite CLI entry (node_modules/vite/bin/vite.js) from the
// installed package, so we don't depend on a global vite or on npm.
function resolveViteBin() {
  // vite's package.json "bin" -> bin/vite.js; resolve the package root first.
  const pkgJson = require.resolve('vite/package.json')
  return path.join(path.dirname(pkgJson), 'bin', 'vite.js')
}

const RESET = '\x1b[0m'

let viteBin
try {
  viteBin = resolveViteBin()
} catch {
  console.error(
    '\x1b[31m[dev]\x1b[0m could not find the local "vite" package. Run `npm install` first.',
  )
  process.exit(1)
}

// Each child: a label, the command, its args, and any extra env.
const targets = [
  {
    name: 'api',
    color: '\x1b[36m', // cyan
    command: 'dotnet',
    args: [
      'run',
      '--project',
      'server/FoodHerons.Api/FoodHerons.Api.csproj',
      '--no-launch-profile',
    ],
    // Development => user-secrets load (Supabase config + service-role key).
    env: { ASPNETCORE_ENVIRONMENT: 'Development' },
  },
  {
    name: 'web',
    color: '\x1b[35m', // magenta
    // Run Vite with the current Node binary — avoids the npm.cmd EINVAL issue.
    command: process.execPath,
    args: [viteBin],
    env: {},
  },
]

const children = []
let shuttingDown = false

// Prefix every line of a child's output with its colored label.
function pipe(label, color, stream, sink) {
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) sink.write(`${color}[${label}]${RESET} ${line}\n`)
  })
  stream.on('end', () => {
    if (buffer) sink.write(`${color}[${label}]${RESET} ${buffer}\n`)
  })
}

function shutdown(reason) {
  if (shuttingDown) return
  shuttingDown = true
  if (reason) console.log(`\n\x1b[33m[dev]\x1b[0m ${reason} — stopping all processes...`)
  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      if (process.platform === 'win32') {
        // Kill the whole tree so dotnet's child build/run procs die too.
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
        } catch {
          child.kill('SIGKILL')
        }
      } else {
        child.kill('SIGINT')
      }
    }
  }
}

for (const t of targets) {
  console.log(`${t.color}[${t.name}]${RESET} starting`)
  const child = spawn(t.command, t.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...t.env },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)

  pipe(t.name, t.color, child.stdout, process.stdout)
  pipe(t.name, t.color, child.stderr, process.stderr)

  child.on('error', (err) => {
    console.error(`${t.color}[${t.name}]${RESET} failed to start: ${err.message}`)
    shutdown(`${t.name} could not start`)
  })
  child.on('exit', (code, signal) => {
    const how = signal ? `signal ${signal}` : `code ${code}`
    console.log(`${t.color}[${t.name}]${RESET} exited (${how})`)
    // If one side dies, bring the other down too so the pair stays consistent.
    shutdown(`${t.name} exited`)
  })
}

// Relay Ctrl+C / termination to the children.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => shutdown(`received ${sig}`))
}
