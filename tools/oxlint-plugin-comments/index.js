// Comments carry only what the code cannot: a "why". Anything longer than
// MAX_LINES is either prose that belongs in a README or a restatement of the
// code below it. Enforced because agents write both by default.
const MAX_LINES = 3

// Only lines with actual text count, so a JSDoc is judged by what it says and
// not by its `/**` and `*/` delimiters.
function contentLines(comment) {
  return comment.value
    .split('\n')
    .map((line) => line.replace(/^\s*\*+/, '').trim())
    .filter((line) => line !== '').length
}

// Tool directives (`eslint-disable`, `Stryker disable`, `@ts-expect-error`, ...) are machine
// instructions, not prose: never counted, and they break a run of `//` lines in two.
const DIRECTIVE = /^\s*(eslint|oxlint|stryker|prettier-ignore|biome-ignore|istanbul|c8 |v8 |@ts-|@vite-|@vitest-|deno-lint|type-coverage)/i

function isDirective(comment) {
  return DIRECTIVE.test(comment.value)
}

function report(context, block) {
  if (block.lines <= MAX_LINES) return
  context.report({
    message: `Comment block says ${block.lines} lines (max ${MAX_LINES}). Keep the "why", drop the prose, or move it to a README.`,
    loc: { start: block.start, end: block.end },
  })
}

const plugin = {
  meta: { name: 'comments' },
  rules: {
    'no-long-comments': {
      create(context) {
        return {
          Program() {
            let block = null
            for (const comment of context.sourceCode.getAllComments()) {
              if (isDirective(comment)) {
                if (block !== null) report(context, block)
                block = null
                continue
              }
              const loc = comment.loc
              // Consecutive `//` lines read as one block, so a wall of them
              // cannot dodge the limit by being ten one-line comments.
              const consecutive =
                block !== null && comment.type === 'Line' && loc.start.line === block.end.line + 1
              if (consecutive) {
                block.end = loc.end
                block.lines += contentLines(comment)
                continue
              }
              if (block !== null) report(context, block)
              block = { start: loc.start, end: loc.end, lines: contentLines(comment) }
            }
            if (block !== null) report(context, block)
          },
        }
      },
    },
  },
}

export default plugin
