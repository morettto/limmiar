import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import plugin from './index.js'

function comment(type, value, startLine, endLine) {
  return { type, value, loc: { start: { line: startLine, column: 0 }, end: { line: endLine, column: 0 } } }
}

function run(comments) {
  const reports = []
  const context = {
    sourceCode: { getAllComments: () => comments },
    report: (r) => reports.push(r),
  }
  plugin.rules['no-long-comments'].create(context).Program()
  return reports
}

test('allows a comment of three lines or fewer', () => {
  assert.equal(run([comment('Block', '\n * one\n * two\n * three\n ', 1, 5)]).length, 0)
})

test('flags a block comment with more than three lines of text', () => {
  const reports = run([comment('Block', '\n * one\n * two\n * three\n * four\n ', 1, 6)])
  assert.equal(reports.length, 1)
  assert.match(reports[0].message, /says 4 lines/)
})

test('groups consecutive line comments into one block', () => {
  const comments = [1, 2, 3, 4].map((line) => comment('Line', ` line ${line}`, line, line))
  assert.match(run(comments)[0].message, /says 4 lines/)
})

test('keeps line comments separated by code apart', () => {
  const comments = [1, 3, 5].map((line) => comment('Line', ` line ${line}`, line, line))
  assert.equal(run(comments).length, 0)
})

test('ignores delimiter-only and blank lines inside a block comment', () => {
  const long = comment('Block', '\n *\n * one\n *\n * two\n *\n * three\n *\n ', 1, 9)
  assert.equal(run([long]).length, 0)
})

test('never counts a tool directive, and lets it split a run of line comments', () => {
  const comments = [
    comment('Line', ' one', 1, 1),
    comment('Line', ' two', 2, 2),
    comment('Line', ' Stryker disable all', 3, 3),
    comment('Line', ' three', 4, 4),
    comment('Line', ' four', 5, 5),
  ]
  assert.equal(run(comments).length, 0)
})
