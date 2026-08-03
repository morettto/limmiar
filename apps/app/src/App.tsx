import { useEffect } from 'react'
import { I18nProvider } from '@lingui/react'
import { Trans } from '@lingui/react/macro'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { i18n, dynamicActivate, initialLocale } from './i18n'

export function App() {
  useEffect(() => {
    void dynamicActivate(initialLocale())
  }, [])

  return (
    <I18nProvider i18n={i18n}>
      <p>
        <Trans>Bem-vindo ao Limmiar</Trans>
      </p>
      {/* PR canhoto S00.5-03 — 4 violacoes plantadas de proposito, prova os gates, PR fecha sem merge */}
      <p>Hardcoded string plantada pelo PR canhoto</p>
      <p>Ultima atualizacao: {new Date().toLocaleDateString()}</p>
      <p>
        <Trans>Mensagem nova plantada, nunca passou por lingui extract</Trans>
      </p>
      <RouterProvider router={router} />
    </I18nProvider>
  )
}
