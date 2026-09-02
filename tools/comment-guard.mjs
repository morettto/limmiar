// Claude Code hook: runs the repo's own oxlint rule on a file an agent just wrote and hands the
// violation back, so a long comment is caught at the edit instead of at the next lint run.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const LINTABLE = /\.(ts|tsx|js|jsx|mjs|cjs)$/

function workspaceOf(filePath) {
  let dir = dirname(resolve(filePath))
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.oxlintrc.json'))) return dir
    dir = dirname(dir)
  }
  return undefined
}

const payload = JSON.parse(readFileSync(0, 'utf8'))
const filePath = payload.tool_input?.file_path
if (!filePath || !LINTABLE.test(filePath)) process.exit(0)

const workspace = workspaceOf(filePath)
if (!workspace) process.exit(0)

const binary = join(workspace, 'node_modules', '.bin', process.platform === 'win32' ? 'oxlint.cmd' : 'oxlint')
if (!existsSync(binary)) process.exit(0)

// oxlint exits non-zero on findings, so the output matters, not the status.
let output = ''
try {
  output = execFileSync(binary, [resolve(filePath)], {
    cwd: workspace,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
} catch (error) {
  output = `${error.stdout ?? ''}${error.stderr ?? ''}`
}

const findings = output.split('\n').filter((line) => line.includes('no-long-comments'))
if (findings.length === 0) process.exit(0)

console.error(`Comment blocks over 3 lines in ${filePath}. Keep the "why", drop the prose, or move it to a README:`)
console.error(findings.join('\n'))
process.exit(2)
