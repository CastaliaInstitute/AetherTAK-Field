import { liveQuery } from 'dexie'
import { useEffect, useState } from 'react'
import { demoSnapshot } from '../domain/seed'
import {
  initializeFieldDatabase,
  loadDashboard,
} from './fieldRepository'

export type FieldDashboard = Awaited<ReturnType<typeof loadDashboard>>

const emptyDashboard: FieldDashboard = {
  properties: [],
  seasons: [],
  fields: [],
  ecologicalSites: [],
  readings: [],
  observations: [],
  media: [],
  alerts: [],
  insights: [],
  offlineMapRegions: [],
}

export function useDashboard() {
  const [data, setData] = useState<FieldDashboard>(emptyDashboard)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    void initializeFieldDatabase(demoSnapshot)
      .then(() => {
        if (disposed) return
        const subscription = liveQuery(loadDashboard).subscribe({
          next: (dashboard) => {
            setData(dashboard)
            setLoading(false)
            setError(null)
          },
          error: (cause) => {
            setLoading(false)
            setError(
              cause instanceof Error
                ? cause.message
                : 'Field records could not be loaded.',
            )
          },
        })
        unsubscribe = () => subscription.unsubscribe()
      })
      .catch((cause) => {
        if (disposed) return
        setLoading(false)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Field records could not be initialized.',
        )
      })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  return { data, loading, error }
}
