# widgets/app-shell

## Responsabilidade

A barra de navegação do consultório: marca, destinos principais, menu da conta e "Sair". É a
única navegação global do app; as páginas não repetem links de volta ao consultório.

## Contrato público

- `AppShell({ children })` -- montado uma vez em `RootLayout` (`app/routing/router.tsx`), em volta
  do `<Outlet/>`. Só desenha a barra para conta profissional com token e KEK desbloqueada; para
  paciente ou sessão incompleta renderiza os filhos e, depois deles, o `LanguageSwitcher` (o 1.º
  `Tab` de um ecrã de paciente continua a ser o CVV, ADR-S11-04; o CSS leva o seletor ao topo).
- `useBloquearNavegacao(ativo)` (`bloqueio.ts`) -- a página com gravação ou texto sem salvar chama
  com `true`: todos os links e o "Sair" ficam desabilitados e a barra explica por quê. Hoje só
  `pages/atendimento` usa. Lança fora de um `AppShell`.

## Estrutura

- `<nav aria-label="Navegação principal">`: Consultório (`/`, ativo só no caminho exato), Pacientes
  (ativo também nas pastas e sessões), Biblioteca de notas, Acervo pessoal e Sinais compartilhados.
  O destino atual vem do `aria-current="page"` do `Link` do TanStack.
- `<nav aria-label="Conta">`: seletor de idioma (a única instância da tela), e-mail, botão "Conta"
  (configurações, atrás de um disclosure) e "Sair".
- Um DOM só, o CSS decide: a partir de 1024 px a barra é uma linha (marca, conta) e abas abaixo, e
  o painel da conta é um dropdown; abaixo disso fica a marca e um botão "Menu" que abre tudo na vertical.

## Decisões

- Padrão *disclosure navigation* do APG, sem `role="menu"`: botões `aria-expanded` +
  `aria-controls`. Esc fecha primeiro a conta e depois o menu, devolvendo o foco ao botão; clique
  fora fecha a conta. Não fecha no `blur` (Safari não foca botão ao clicar).
- Os estilos são CSS puro com `#root .classe`: os `#root a` e `#root button` de `index.css` são
  seletores com ID e ganham das utilitárias do Tailwind.
- O bloqueio é um contador, não um booleano: o cleanup da página que sai não solta o de quem entra.
