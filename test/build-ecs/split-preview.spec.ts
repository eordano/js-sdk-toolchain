import { resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import { spawn } from 'child_process'
import { itExecutes, ensureFileExists, itDeletesFolder } from '../../scripts/helpers'

// ecs7-composite is used by no other spec and is not in the workspace fixture, so nothing mutates
// its bin/ concurrently while this long-running watch process is inspected.
describe('preview: watch splits the scene into cacheable chunks', () => {
  const cwd = resolve(__dirname, './fixtures/ecs7-composite')
  const cli = resolve(__dirname, '../../packages/@dcl/sdk-commands/dist/index.js')

  itDeletesFolder('./bin', cwd)
  itDeletesFolder('./node_modules', cwd)
  itExecutes('npm i --silent --no-progress', cwd)

  it('build --watch emits the SDK-runtime chunk, the scene chunk and a loader stub', async () => {
    // detached so we can kill the whole tree (esbuild + the forked tsc --watch)
    const child = spawn('node', [cli, 'build', '--dir', cwd, '--watch', '--skip-install'], {
      detached: true,
      stdio: 'ignore'
    })
    try {
      const waitFor = async (rel: string) => {
        const file = resolve(cwd, rel)
        for (let i = 0; i < 120; i++) {
          if (existsSync(file)) return file
          await new Promise((r) => setTimeout(r, 500))
        }
        throw new Error(`${rel} was not emitted by build --watch within 60s`)
      }
      await waitFor('bin/sdk-runtime.js')
      await waitFor('bin/scene.js')

      const stub = readFileSync(ensureFileExists('bin/game.js', cwd), 'utf8')
      // the scene main is a loader stub that reads both chunks from the scene runtime
      expect(stub).toContain('bin/sdk-runtime.js')
      expect(stub).toContain('bin/scene.js')
      expect(stub).toContain('~system/Runtime')

      // the scene chunk requires the SDK as an external and does not inline the engine
      const scene = readFileSync(resolve(cwd, 'bin/scene.js'), 'utf8')
      expect(scene).toContain('require("@dcl/')
      expect(scene).not.toContain('~system/EngineApi')

      // the SDK-runtime chunk carries the engine and exposes the require registry
      const sdk = readFileSync(resolve(cwd, 'bin/sdk-runtime.js'), 'utf8')
      expect(sdk).toContain('require("~system/EngineApi")')
      expect(sdk).toContain('module.exports = registry')
    } finally {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL')
      } catch {}
    }
  }, 90000)
})
