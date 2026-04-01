// @group TestSetup > MSW : Default API mock handlers — mirrors the Axum REST API
// Override in individual tests with server.use(http.get('/api/v1/...', ...))

import { http, HttpResponse } from 'msw'

// @group TestSetup > MSW > Stubs : Minimal shape for each commonly used endpoint
export const defaultHandlers = [
  // @group TestSetup > MSW > Stubs : System health
  http.get('/api/v1/system/health', () =>
    HttpResponse.json({ version: '0.9.0', uptime_secs: 0, process_count: 0 })
  ),

  // @group TestSetup > MSW > Stubs : Process list
  http.get('/api/v1/processes', () => HttpResponse.json([])),

  // @group TestSetup > MSW > Stubs : Auth session check
  http.get('/api/v1/auth/session', () => HttpResponse.json({ valid: true })),
]
