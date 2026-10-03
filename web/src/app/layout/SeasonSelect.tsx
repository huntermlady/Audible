import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useOptionalSeason } from '@/data/season'
import { cn } from '@/lib/utils'

export function SeasonSelect({ className }: { className?: string }) {
  const s = useOptionalSeason()
  return (
    <Select value={s ? String(s.season) : ''} onValueChange={(v) => s?.setSeason(Number(v))} disabled={!s}>
      <SelectTrigger size="sm" aria-label="Season" className={cn('w-[5rem] font-mono tabular sm:w-[5.5rem]', className)}>
        <SelectValue placeholder="Season" />
      </SelectTrigger>
      <SelectContent>
        {s?.seasons.map((y) => (
          <SelectItem key={y} value={String(y)} className="font-mono tabular">
            {y}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
