// @group TestSetup : Global vitest setup — extends jest-dom matchers and wires MSW

import '@testing-library/jest-dom'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './msw-server'

// @group TestSetup > MSW : Start mock server before tests, reset handlers after each test,
// and stop after all tests to prevent handler leakage between test files
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
