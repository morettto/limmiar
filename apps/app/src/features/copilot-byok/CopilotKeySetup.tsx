import { useState, type CSSProperties } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { CryptoKey } from '@limmiar/crypto'
import { SUPPORTED_PROVIDERS, type AiProvider } from './provider-registry'
import { saveApiKey } from './key-store'

export interface CopilotKeySetupProps {
  accountId: string
  /** null = the keychain is locked; the form shows no input (same contract as patients/PatientWallet.tsx). */
  kek: CryptoKey | null
  providers?: readonly AiProvider[]
  onDone: () => void
}

type Status = { status: 'idle' } | { status: 'saving' } | { status: 'error' }

export function CopilotKeySetup({ accountId, kek, providers = SUPPORTED_PROVIDERS, onDone }: CopilotKeySetupProps) {
  const { t } = useLingui()
  const [providerId, setProviderId] = useState<string>(providers[0]?.id ?? '')
  const [apiKey, setApiKey] = useState('')
  const [persist, setPersist] = useState(false)
  const [state, setState] = useState<Status>({ status: 'idle' })

  if (kek === null) {
    // ponytail: the skip affordance is duplicated across both the locked and unlocked
    // branches on purpose -- collapse it into a shared footer only if a third branch shows up.
    return (
      <div className="mx-auto max-w-sm p-4">
        <p role="status">
          <Trans>Chaveiro bloqueado. Desbloqueie para cadastrar sua chave de API.</Trans>
        </p>
        <button type="button" onClick={onDone} className="mt-4 w-full rounded-md border border-neutral-300 px-4 py-2">
          {t`Pular`}
        </button>
      </div>
    )
  }

  // Reassigned to a plain `const` (not just referenced) so its own declared type narrows to
  // CryptoKey once and for all -- referencing the destructured `kek` prop straight from inside
  // handleSubmit's closure would keep TS's wider `CryptoKey | null` param type instead.
  const unlockedKek = kek

  async function handleSave() {
    setState({ status: 'saving' })
    try {
      await saveApiKey(unlockedKek, accountId, providerId, apiKey, persist)
      onDone()
    } catch {
      setState({ status: 'error' })
    }
  }

  return (
    <div className="mx-auto max-w-sm p-4">
      <h2 className="mb-2 text-lg font-semibold">
        <Trans>Cadastrar chave de API de IA</Trans>
      </h2>
      {state.status === 'error' ? (
        <p role="alert" className="mb-4 text-sm text-red-700">
          <Trans>Não foi possível salvar a chave. Tente novamente.</Trans>
        </p>
      ) : null}
      <div>
        <label htmlFor="copilot-provider" className="mb-1 block text-sm font-medium">
          <Trans>Fornecedor</Trans>
        </label>
        <select
          id="copilot-provider"
          className="mb-4 w-full rounded-md border border-neutral-300 px-2 py-1"
          value={providerId}
          onChange={(event) => setProviderId(event.target.value)}
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
        <label htmlFor="copilot-api-key" className="mb-1 block text-sm font-medium">
          <Trans>Chave de API</Trans>
        </label>
        <input
          id="copilot-api-key"
          type="text"
          autoComplete="off"
          spellCheck={false}
          // ponytail: -webkit-text-security masks visually without type=password, which password
          // managers key off of. The DOM value stays plaintext (CSS-only masking, not a security
          // boundary); id/name avoid "password"/"senha" so autofill has nothing to latch onto.
          style={{ WebkitTextSecurity: 'disc' } as CSSProperties}
          className="mb-4 w-full rounded-md border border-neutral-300 px-2 py-1"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <label htmlFor="copilot-persist" className="mb-4 flex items-center gap-2 text-sm">
          <input
            id="copilot-persist"
            type="checkbox"
            checked={persist}
            onChange={(event) => setPersist(event.target.checked)}
          />
          <Trans>Lembrar neste dispositivo</Trans>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={state.status === 'saving' || apiKey === '' || providerId === ''}
            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
          >
            {t`Salvar`}
          </button>
          <button type="button" onClick={onDone} className="w-full rounded-md border border-neutral-300 px-4 py-2">
            {t`Pular`}
          </button>
        </div>
      </div>
    </div>
  )
}
