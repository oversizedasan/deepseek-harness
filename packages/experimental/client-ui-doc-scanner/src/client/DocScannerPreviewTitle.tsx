/** Tab chip title for the document-scanner preview pane. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'

export type DocScannerPreviewTitleProps =
  & PropsRuntime<'sidebar.right.pane.tab.title'>
  & PropsLocale<typeof NS>

/** Localized chip label. */
export function DocScannerPreviewTitle({ t }: DocScannerPreviewTitleProps) {
  return <>{t('tabTitle')}</>
}
