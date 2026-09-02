// PreToolUse guard on Bash: a branch that is behind origin/main never gets to commit, push
// or spawn another branch. Conflicts are cheap to resolve one merge at a time and expensive
// to resolve at the end, so the sync is enforced where the work happens, not at the MR.
import { execFileSync } from 'node:child_process'

const COMMIT_OR_PUSH = /git\s+(commit|push)\b/
const NEW_BRANCH = /git\s+(checkout\s+-b|switch\s+-c)\b/
const MERGE_IN_PROGRESS = /git\s+(merge|rebase|cherry-pick|revert)\b/

function git(args, timeout = 20000) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout }).trim()
}

export function baseBranch() {
  try {
    return git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '') || 'main'
  } catch {
    return 'main'
  }
}

export function behindCount(base) {
  return Number(git(['rev-list', '--count', `HEAD..origin/${base}`]))
}

export function reason(command, { base, behind, current }) {
  if (MERGE_IN_PROGRESS.test(command)) return null
  if (!COMMIT_OR_PUSH.test(command) && !NEW_BRANCH.test(command)) return null
  if (current === base || behind === 0) return null
  const acao = NEW_BRANCH.test(command) ? 'branch nova' : 'commit/push'
  return `branch-sync: ${current} está ${behind} commit(s) atrás de origin/${base}. Corre \`git fetch origin ${base} && git merge origin/${base}\`, resolve os conflitos e volta a correr os portões antes do ${acao}.`
}

function deny(text) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: text,
    },
  }))
}

function mergeInProgress() {
  try {
    git(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'])
    return true
  } catch {
    return false
  }
}

function check(command) {
  if (!COMMIT_OR_PUSH.test(command) && !NEW_BRANCH.test(command)) return null
  if (MERGE_IN_PROGRESS.test(command)) return null
  // O commit que fecha um merge é a própria sincronia: HEAD ainda está atrás, o resultado não.
  if (mergeInProgress()) return null
  const base = baseBranch()
  let current
  try {
    current = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  } catch {
    return null
  }
  if (current === base || current === 'HEAD') return null
  try {
    git(['fetch', 'origin', base, '--quiet'], 30000)
  } catch {
    return null // Offline or no remote: never block work on a network failure.
  }
  let behind
  try {
    behind = behindCount(base)
  } catch {
    return null
  }
  return reason(command, { base, behind, current })
}

if (process.argv.includes('--demo')) {
  const assert = await import('node:assert')
  const atras = { base: 'main', behind: 3, current: 'feat/x' }
  const emDia = { base: 'main', behind: 0, current: 'feat/x' }
  assert.ok(reason('git commit -m x', atras), 'commit atrás da base tem de ser recusado')
  assert.ok(reason('git push origin feat/x', atras), 'push atrás da base tem de ser recusado')
  assert.ok(reason('git checkout -b feat/y', atras), 'branch nova sobre base velha tem de ser recusada')
  assert.strictEqual(reason('git commit -m x', emDia), null, 'branch em dia passa')
  assert.strictEqual(reason('git merge origin/main', atras), null, 'o próprio merge nunca é bloqueado')
  assert.strictEqual(reason('git commit -m x', { ...atras, current: 'main' }), null, 'a própria base passa')
  assert.strictEqual(reason('pnpm test', atras), null, 'comando não-git passa')
  console.log('branch-sync-guard: all checks passed')
  process.exit(0)
}

let input = ''
process.stdin.on('data', (d) => { input += d })
process.stdin.on('end', () => {
  let event
  try {
    event = JSON.parse(input)
  } catch {
    process.exit(0)
  }
  const text = check((event.tool_input && event.tool_input.command) || '')
  if (text) deny(text)
  process.exit(0)
})
