import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { nextPreference, useTheme, type ThemePreference } from './theme'

const ICON = { system: Monitor, light: Sun, dark: Moon } satisfies Record<ThemePreference, unknown>
const LABEL: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' }

/** Cycles system → light → dark. */
export function ThemeToggle() {
  const { preference, cycle } = useTheme()
  const Icon = ICON[preference]
  const label = `Theme: ${LABEL[preference]}. Switch to ${LABEL[nextPreference(preference)]}`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" onClick={cycle} aria-label={label} data-theme-pref={preference}>
          <Icon aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
