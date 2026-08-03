const LOCALE_SENSITIVE_METHODS = new Set(['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString'])

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow calling toLocaleDateString/toLocaleTimeString/toLocaleString without an explicit locale argument (ADR-S00.5-03: Intl is the single source of truth for formatting — relying on the runtime default locale silently breaks the other 3 locales).',
    },
    schema: [],
    messages: {
      missingLocale: '{{method}}() must be called with an explicit locale argument — the runtime default locale is not one of the 4 supported locales.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node

        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') {
          return
        }

        if (!LOCALE_SENSITIVE_METHODS.has(callee.property.name)) {
          return
        }

        if (node.arguments.length === 0) {
          context.report({
            node,
            messageId: 'missingLocale',
            data: { method: callee.property.name },
          })
        }
      },
    }
  },
}
