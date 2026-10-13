import { Trans } from '@lingui/react/macro'
import { AuditTrail, type AuditTrailProps } from '../../features/audit-trail/AuditTrail'

export function AuditPage(props: AuditTrailProps) {
  return <main className="settings-page">
    <header><h1><Trans>Trilha de auditoria</Trans></h1></header>
    <AuditTrail key={props.accountId} {...props} />
  </main>
}
