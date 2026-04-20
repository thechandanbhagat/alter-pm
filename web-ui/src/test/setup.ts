// @group TestSetup : Global vitest setup — extends jest-dom matchers and wires MSW

import '@testing-library/jest-dom'
import { afterAll, afterEach, beforeAll } from 'vitest'

// @group TestSetup > Polyfills : Web Streams API (needed by MSW in vmThreads pool / Node < 18)
import { ReadableStream, WritableStream, TransformStream } from 'node:stream/web'
if (!globalThis.ReadableStream)   Object.assign(globalThis, { ReadableStream })
if (!globalThis.WritableStream)   Object.assign(globalThis, { WritableStream })
if (!globalThis.TransformStream)  Object.assign(globalThis, { TransformStream })

// @group TestSetup > Polyfills : jsdom does not implement scrollIntoView — stub it out
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = () => {}
}

import { server } from './msw-server'

// @group TestSetup > MSW : Start mock server before tests, reset handlers after each test,
// and stop after all tests to prevent handler leakage between test files
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
