import { useState } from 'react'
import { Menu, MessageSquare } from 'lucide-react'
import { NavLink } from 'react-router'
import { AIStatusPill } from './AIStatusPill'
import { Logo } from './Logo'
import { SeasonSelect } from './SeasonSelect'
import { TeamGrid, TeamPicker } from './TeamPicker'
import { useChat } from '@/app/chat-context'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ThemeToggle } from '@/design/ThemeToggle'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/play-caller', label: 'Play-Caller' },
  { to: '/players', label: 'Players' },
]

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'relative inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
    isActive && 'text-foreground after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:bg-accent',
  )

export function TopBar() {
  const chat = useChat()
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-1.5 px-3 sm:gap-4 sm:px-6">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation menu">
              <Menu aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[min(22rem,100vw)] overflow-y-auto">
            <SheetHeader>
              <SheetTitle className="font-display text-xl uppercase">Audible</SheetTitle>
              <SheetDescription className="sr-only">Site navigation</SheetDescription>
            </SheetHeader>
            <nav aria-label="Mobile" className="flex flex-col gap-1 px-4">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={navClass} onClick={() => setMenuOpen(false)}>
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <div className="px-4 pb-6">
              <div className="chalk-rule my-3" />
              <TeamGrid onPick={() => setMenuOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>

        <Logo />

        <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 md:flex">
          <NavLink to="/" end className={navClass}>
            Dashboard
          </NavLink>
          <TeamPicker className="text-muted-foreground" />
          {NAV.slice(1).map((n) => (
            <NavLink key={n.to} to={n.to} className={navClass}>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <SeasonSelect />
          <AIStatusPill />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => (chat.isOpen ? chat.close() : chat.open())}
            aria-label={chat.isOpen ? 'Close coordinator chat' : 'Open coordinator chat'}
            aria-expanded={chat.isOpen}
            aria-controls="chat-drawer"
          >
            <MessageSquare aria-hidden />
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
