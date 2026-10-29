/**
 * Ambient types for @deepseek-ai/dsh-client-ui-primitives — provided at
 * runtime by the host's platform module table. The published npm package is
 * only a dev-time mirror, so the browser bundle stays external; keep these
 * signatures in sync with deepseek-harness/packages/client/ui-primitives/src/.
 * Only the members this plugin uses are declared.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactElement, ReactNode } from 'react'

  export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'toolbar'
  export function Button(props: {
    variant?: ButtonVariant
    size?: 'md' | 'sm'
    icon?: ReactNode
    className?: string | undefined
    children?: ReactNode
  } & ButtonHTMLAttributes<HTMLButtonElement>): ReactElement

  export function Pill(props: {
    active?: boolean
    className?: string | undefined
    children?: ReactNode
  } & ButtonHTMLAttributes<HTMLButtonElement>): ReactElement

  export function Input(props: {
    icon?: ReactNode
    className?: string
  } & InputHTMLAttributes<HTMLInputElement>): ReactElement

  export function Switch(props: {
    checked: boolean
    onChange: (next: boolean) => void
    label: string
    disabled?: boolean
    title?: string | undefined
    className?: string | undefined
  }): ReactElement

  export interface SegmentedTab {
    value: string
    label: ReactNode
    id: string
    panelId: string
  }
  export function SegmentedTabs(props: {
    items: readonly [SegmentedTab, ...SegmentedTab[]]
    value: string
    onChange: (value: string) => void
    label: string
    className?: string | undefined
  }): ReactElement

  // 0.2.1 renders `label` verbatim as the tooltip text — an object here
  // throws React #31 (object is not a valid child) and the host tears the
  // whole slot entry down until reload. Plain strings only.
  export function Tooltip(props: {
    label: string
    side?: 'top' | 'bottom' | 'left' | 'right'
    delayMs?: number
    maxWidth?: number
    disabled?: boolean
    children: ReactElement
  }): ReactElement
}
