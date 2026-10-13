import { Trans } from '@lingui/react/macro'
import { VoiceSettings, type VoiceSettingsProps } from '../../features/voice-enrollment/VoiceSettings'

export function VoicePage(props: VoiceSettingsProps) {
  return <main className="settings-page">
    <header><h1><Trans>Identificação da sua voz</Trans></h1></header>
    <VoiceSettings key={props.accountId} {...props} />
  </main>
}
