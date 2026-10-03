import { Link } from 'react-router'

/** Wordmark: a chalk "A" route arrow + AUDIBLE. */
export function Logo() {
  return (
    <Link to="/" aria-label="Audible home" className="group flex shrink-0 items-center gap-2 rounded-md">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="7" className="fill-foreground" />
        <path d="M8 23 L16 8 L24 23" fill="none" strokeWidth="3" strokeLinejoin="round" className="stroke-background" />
        <path d="M11.5 17.5h9" strokeWidth="2" className="stroke-accent transition-colors" />
      </svg>
      <span className="hidden font-display text-2xl leading-none font-extrabold tracking-[0.06em] uppercase min-[420px]:inline">Audible</span>
    </Link>
  )
}
