import { test, expect, type Page } from '@playwright/test'

// S08-01, fatia 5: prova o percurso só-teclado do editor SOAP -- Tab até à listbox da fila,
// j/k para navegar, Enter para abrir a nota, Tab para o editor, escrever, e ⌘↵/Ctrl+↵ para
// assinar (ehAtalhoAssinar, features/nota-fila/navegacao-teclado.ts).
//
// `/notas` (router.tsx) ainda não tem sessão/keychain real montada -- mesmo "sem ponto de
// entrada de navegação real ainda" que CopilotKeySetup já documenta no seu próprio e2e
// (copilot-key-setup.spec.ts), e NotaPage.tsx traz o mesmo comentário `ponytail:` no topo.
// S08-07: `kek` é prop obrigatória `CryptoKey | null` de NotaPage; `NotaRouteComponent`
// em router.tsx monta `<NotaPage kek={null} />` explicitamente (mesmo padrão de
// `BibliotecaRouteComponent`, sem KeychainProvider/sessão real montada ainda). `aoAssinar`
// guarda cedo sobre `kek === null` e nem chega a tentar a cadeia real
// (openRecord/appendPatientEntry/assinarNota) -- isso resolve de forma determinística para
// o caminho "sem sessão" desta fatia (role=alert, item continua pendente), o mesmo
// desfecho que NotaPage.test.tsx cobre com os módulos de crypto/api duplados -- não
// depende de o Postgres deste webServer estar alcançável (não está, ver playwright.config.ts)
// nem de uma sessão real existir. Ligar `/notas` a uma sessão/Keychain real (substituir
// `kek={null}` por uma `CryptoKey` real em router.tsx), e então provar aqui o desfecho de
// sucesso ("Assinada"), fica para quando esse ponto de entrada existir.

async function tabAteListbox(page: Page): Promise<void> {
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    const role = await page.evaluate(() => document.activeElement?.getAttribute('role'))
    if (role === 'listbox') {
      return
    }
    await page.keyboard.press('Tab')
  }
  throw new Error('Tab não alcançou a listbox da fila de assinatura em 10 tentativas')
}

test.describe('Editor SOAP -- assinar só com teclado (S08-01)', () => {
  test.use({ locale: 'pt-BR' })

  test('Tab até à listbox, j/k, Enter, Tab para o editor, escrever e Ctrl+Enter para assinar', async ({ page }) => {
    await page.goto('/notas')

    await tabAteListbox(page)

    // j/k navegam a listbox -- um único item na fixture desta fatia, então o cursor fica no
    // mesmo (e único) item, mas o atalho de teclado em si é o que este e2e prova.
    await page.keyboard.press('j')
    await page.keyboard.press('k')
    await page.keyboard.press('Enter')

    await expect(page.getByRole('option', { selected: true })).toBeVisible()

    await page.keyboard.press('Tab')
    const editorAtivo = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
    expect(editorAtivo).toBe('Subjetivo 1')

    await page.keyboard.type('Paciente relata melhora dos sintomas.')
    await page.keyboard.press('Control+Enter')

    const alerta = page.getByRole('alert')
    await expect(alerta).toBeVisible()
    await expect(alerta).toHaveText('Sem sessão ativa. Não é possível assinar.')

    // O item continua na aba "Pendentes" -- a guarda de sessão interrompeu antes de
    // qualquer chamada à cadeia real, então nada foi marcado como assinado.
    await expect(page.getByRole('tab', { name: 'Pendentes', selected: true })).toBeVisible()
  })
})
