// @group TestSetup > MSW : Shared MSW server instance for all tests
// Import and extend `handlers` in individual test files to override specific endpoints.

import { setupServer } from 'msw/node'
import { defaultHandlers } from './handlers'

export const server = setupServer(...defaultHandlers)
