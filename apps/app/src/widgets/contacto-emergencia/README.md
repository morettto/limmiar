# widgets/contacto-emergencia

## Responsabilidade

O caminho de contacto de emergência (CVV 188, SAMU 192) que o produto nunca esconde nem substitui
(ADR-S11-04). Não decide risco nem intervém em crise -- só mantém o contacto sempre alcançável.

## Contrato público

- `ContactoEmergencia()` -- componente sem props, `<nav>` com os dois links `tel:`.

## Invariantes

- CVV 188 é a ação principal e vem primeiro no DOM: o 1.º `Tab` de qualquer ecrã de paciente foca
  esse link (ticket S11-01, critério "alcançável por teclado").
- Montado uma única vez, como irmão do `<Outlet/>` no layout `paciente` de `app/routing/router.tsx`
  -- nunca repetido dentro de cada página. Ecrã de paciente novo que não for filho desse layout
  perde a emergência; ver `app/routing/README.md`.
- `<nav>` nativo com `aria-label`, sem ARIA extra: os dois `<a>` já são focáveis e lidos por
  leitores de ecrã de graça.

## Armadilhas

- `tel:` pode não fazer nada em desktop sem app de telefone -- o número fica sempre legível no
  texto do link como fallback. Humano confirma 188/192 antes do release (spec S11).
