import { lazy } from 'react'
import { Route, Routes } from 'react-router'
import { Layout } from './Layout'

const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Team = lazy(() => import('@/pages/Team'))
const Matchup = lazy(() => import('@/pages/Matchup'))
const PlayCaller = lazy(() => import('@/pages/PlayCaller'))
const Players = lazy(() => import('@/pages/Players'))
const NotFound = lazy(() => import('@/pages/NotFound'))
// Dev-only: the branch (and so the chunk) is dropped from production builds.
const KitchenSink = import.meta.env.DEV ? lazy(() => import('./dev/KitchenSink')) : null

export const ROUTE_PATHS = {
  dashboard: '/',
  team: (abbr: string) => `/team/${abbr}`,
  matchup: (season: number, week: number, gameId: string) => `/matchup/${season}/${week}/${gameId}`,
  playCaller: '/play-caller',
  players: '/players',
} as const

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="team/:abbr" element={<Team />} />
        <Route path="matchup/:season/:week/:gameId" element={<Matchup />} />
        <Route path="play-caller" element={<PlayCaller />} />
        <Route path="players" element={<Players />} />
        {KitchenSink && <Route path="dev/kitchen-sink" element={<KitchenSink />} />}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
