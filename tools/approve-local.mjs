const email = process.argv[2]?.trim().toLowerCase()
const apiUrl = process.env.LIMMIAR_API_URL?.trim().replace(/\/+$/, '')
const staffKey = process.env.LIMMIAR_STAFF_API_KEY
if (!email || !apiUrl || !staffKey) {
  console.error('Uso: LIMMIAR_API_URL=https://<api> LIMMIAR_STAFF_API_KEY=<chave> node tools/approve-local.mjs email-da-conta')
  console.error('Local: LIMMIAR_API_URL=http://127.0.0.1:5259 e a StaffAccess.ApiKey de .local/settings.json.')
  process.exit(1)
}
const { protocol, hostname } = new URL(apiUrl)
if (protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(hostname)) {
  console.error('A chave da equipe só viaja por https (ou por loopback).')
  process.exit(1)
}
const headers = { 'X-Staff-Api-Key': staffKey, 'Content-Type': 'application/json' }
const queueResponse = await fetch(`${apiUrl}/accounts/professional-verification/queue`, { headers })
if (!queueResponse.ok) throw new Error(`Não foi possível ler a fila de verificação: HTTP ${queueResponse.status}`)
const queue = await queueResponse.json()
const account = queue.find((item) => item.email.toLowerCase() === email)
if (!account) throw new Error('Conta ausente na fila. Envie o documento pela interface primeiro.')
const decision = await fetch(`${apiUrl}/accounts/${account.accountId}/professional-verification/decision`,
  { method: 'POST', headers, body: JSON.stringify({ approved: true }) })
if (!decision.ok) throw new Error(`Não foi possível aprovar: HTTP ${decision.status}`)
console.log('Conta aprovada. Clique em Atualizar verificação na interface.')
