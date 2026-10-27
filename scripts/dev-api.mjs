// FoodHerons — run ONLY the C# order service for local dev.
//
// Sets ASPNETCORE_ENVIRONMENT=Development so `dotnet user-secrets` (Supabase
// URL/keys + service-role key) are loaded; without it the API fails fast on the
// missing Supabase config. Use this when the Vite dev server is already running
// in another terminal. To launch both at once, use `npm run dev:all`.
//
//   npm run dev:api

import { spawn } from 'node:child_process'
import process from 'node:process'

const child = spawn(
  'dotnet',
  ['run', '--project', 'server/FoodHerons.Api/FoodHerons.Api.csproj', '--no-launch-profile'],
  {
    cwd: process.cwd(),
    env: { ...process.env, ASPNETCORE_ENVIRONMENT: 'Development' },
    stdio: 'inherit',
    shell: false,
  },
)

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig))
}
