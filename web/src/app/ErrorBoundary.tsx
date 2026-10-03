import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  /** Changing this resets the boundary (e.g. the route pathname). */
  resetKey?: unknown
  onReset?: () => void
}
interface State {
  error: Error | null
  resetKey?: unknown
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Audible] render error', error, info.componentStack)
  }

  reset = () => {
    this.props.onReset?.()
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="mx-auto my-16 max-w-lg rounded-lg border bg-card p-6 text-card-foreground">
        <div className="flex items-center gap-2 text-critical">
          <AlertTriangle className="size-5" aria-hidden />
          <h2 className="font-display text-2xl font-bold uppercase">Something broke</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">This view hit an unexpected error. Retrying usually fixes it.</p>
        <pre className="mt-4 max-h-40 overflow-auto rounded bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{this.state.error.message}</pre>
        <Button className="mt-4" onClick={this.reset} aria-label="Retry rendering this view">
          <RotateCcw aria-hidden /> Retry
        </Button>
      </div>
    )
  }
}
