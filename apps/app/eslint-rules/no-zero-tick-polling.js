function contains(node, predicate) {
  if (!node || typeof node !== 'object') return false
  if (predicate(node)) return true
  return Object.entries(node).some(([key, value]) => {
    if (key === 'parent' || key === 'tokens' || key === 'comments') return false
    return Array.isArray(value) ? value.some(child => contains(child, predicate)) : contains(value, predicate)
  })
}

function isReadinessProbe(node) {
  return node.type === 'CallExpression'
    || (node.type === 'MemberExpression'
      && node.property.type === 'Identifier'
      && node.property.name === 'length'
      && node.object.type === 'MemberExpression'
      && node.object.property.type === 'Identifier'
      && node.object.property.name === 'calls')
}

function exitsEarly(node) {
  return contains(node, child => child.type === 'ReturnStatement' || child.type === 'BreakStatement')
}

function hasReadinessGate(loop) {
  if (loop.test && contains(loop.test, isReadinessProbe)) return true
  return contains(loop.body, node => node.type === 'IfStatement'
    && contains(node.test, isReadinessProbe)
    && exitsEarly(node.consequent))
}

function isLoop(node) {
  return ['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement'].includes(node.type)
}

function isFunction(node) {
  return ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'disallow zero-tick timer polling for asynchronous test state' },
    schema: [],
    messages: {
      polling: 'Replace zero-tick polling with vi.waitFor(...) or Testing Library waitFor(...); use a nonzero timer advance when testing elapsed time.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node
        if (callee.type !== 'MemberExpression'
          || callee.object.type !== 'Identifier'
          || callee.object.name !== 'vi'
          || callee.property.type !== 'Identifier'
          || !['advanceTimersByTime', 'advanceTimersByTimeAsync'].includes(callee.property.name)
          || node.arguments[0]?.type !== 'Literal'
          || node.arguments[0].value !== 0) return

        let ancestor = node.parent
        while (ancestor && !isLoop(ancestor) && !isFunction(ancestor)) ancestor = ancestor.parent
        if (ancestor && isLoop(ancestor) && ancestor.body && contains(ancestor.body, child => child === node) && hasReadinessGate(ancestor)) {
          context.report({ node, messageId: 'polling' })
        }
      },
    }
  },
}
