// @group UnitTests : Utility function tests — formatUptime, formatBytes, formatCpu,
//                    statusColor, parseArgs, parseEnvString, parseDotEnv, envToString

import { describe, it, expect } from 'vitest'
import {
  formatUptime,
  formatBytes,
  formatCpu,
  statusColor,
  parseArgs,
  parseEnvString,
  parseDotEnv,
  envToString,
  STATUS_COLORS,
} from '@/lib/utils'

// @group UnitTests > formatUptime : Seconds-level formatting
describe('formatUptime', () => {
  it('formats 0 seconds', () => {
    expect(formatUptime(0)).toBe('0s')
  })

  it('formats single seconds', () => {
    expect(formatUptime(1)).toBe('1s')
    expect(formatUptime(59)).toBe('59s')
  })

  it('formats exactly 60 seconds as minutes', () => {
    expect(formatUptime(60)).toBe('1m 0s')
  })

  it('formats minutes and seconds', () => {
    expect(formatUptime(90)).toBe('1m 30s')
    expect(formatUptime(3599)).toBe('59m 59s')
  })

  it('formats exactly 1 hour', () => {
    expect(formatUptime(3600)).toBe('1h 0m')
  })

  it('formats hours and minutes', () => {
    expect(formatUptime(3661)).toBe('1h 1m')
    expect(formatUptime(7384)).toBe('2h 3m')
  })

  it('formats exactly 1 day', () => {
    expect(formatUptime(86400)).toBe('1d 0h')
  })

  it('formats days and hours', () => {
    expect(formatUptime(90000)).toBe('1d 1h')
    expect(formatUptime(172800)).toBe('2d 0h')
  })
})

// @group UnitTests > formatBytes : Human-readable byte sizes
describe('formatBytes', () => {
  it('formats 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
  })

  it('formats bytes under 1 KB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB')
  })

  it('formats gigabytes', () => {
    expect(formatBytes(1024 ** 3)).toBe('1.00 GB')
    expect(formatBytes(1024 ** 3 * 2)).toBe('2.00 GB')
  })

  it('formats 1023 KB boundary correctly (stays as KB)', () => {
    const justUnderMB = 1024 * 1024 - 1
    expect(formatBytes(justUnderMB)).toContain('KB')
  })
})

// @group UnitTests > formatCpu : CPU percentage formatting
describe('formatCpu', () => {
  it('formats 0 percent', () => {
    expect(formatCpu(0)).toBe('0.0%')
  })

  it('formats whole numbers with one decimal', () => {
    expect(formatCpu(50)).toBe('50.0%')
    expect(formatCpu(100)).toBe('100.0%')
  })

  it('formats floating point values', () => {
    expect(formatCpu(12.5)).toBe('12.5%')
    expect(formatCpu(99.9)).toBe('99.9%')
  })

  it('rounds to one decimal place', () => {
    expect(formatCpu(33.333)).toBe('33.3%')
    expect(formatCpu(66.666)).toBe('66.7%')
  })
})

// @group UnitTests > statusColor : CSS color lookup by status
describe('statusColor', () => {
  it('returns a string for running status', () => {
    const color = statusColor('running')
    expect(typeof color).toBe('string')
    expect(color.length).toBeGreaterThan(0)
  })

  it('returns different values for running vs crashed', () => {
    expect(statusColor('running')).not.toBe(statusColor('crashed'))
  })

  it('covers all defined statuses', () => {
    const statuses = Object.keys(STATUS_COLORS) as Array<keyof typeof STATUS_COLORS>
    for (const s of statuses) {
      const color = statusColor(s)
      expect(typeof color).toBe('string')
      expect(color.length).toBeGreaterThan(0)
    }
  })

  it('returns fallback #888 for unknown status', () => {
    // @ts-expect-error intentionally passing unknown status
    expect(statusColor('unknown_status')).toBe('#888')
  })
})

// @group UnitTests > parseArgs : Shell-style argument tokenization
describe('parseArgs', () => {
  it('splits simple space-separated arguments', () => {
    expect(parseArgs('server.js --port 3000')).toEqual(['server.js', '--port', '3000'])
  })

  it('preserves double-quoted strings as single tokens', () => {
    expect(parseArgs('"hello world"')).toEqual(['"hello world"'])
  })

  it('preserves single-quoted strings as single tokens', () => {
    expect(parseArgs("'hello world'")).toEqual(["'hello world'"])
  })

  it('handles mixed quoted and unquoted args', () => {
    expect(parseArgs('--message "my message" --flag')).toEqual([
      '--message', '"my message"', '--flag',
    ])
  })

  it('returns empty array for empty string', () => {
    expect(parseArgs('')).toEqual([])
  })

  it('returns empty array for whitespace-only string', () => {
    expect(parseArgs('   ')).toEqual([])
  })

  it('handles single argument with no spaces', () => {
    expect(parseArgs('server.js')).toEqual(['server.js'])
  })

  it('handles flag=value syntax without splitting', () => {
    expect(parseArgs('--config=my.json')).toEqual(['--config=my.json'])
  })
})

// @group UnitTests > parseEnvString : Comma-separated KEY=VALUE parsing
describe('parseEnvString', () => {
  it('parses a single KEY=VALUE pair', () => {
    expect(parseEnvString('NODE_ENV=production')).toEqual({ NODE_ENV: 'production' })
  })

  it('parses multiple comma-separated pairs', () => {
    const result = parseEnvString('NODE_ENV=production, PORT=3000')
    expect(result).toEqual({ NODE_ENV: 'production', PORT: '3000' })
  })

  it('handles empty input', () => {
    expect(parseEnvString('')).toEqual({})
  })

  it('ignores entries without an equals sign', () => {
    const result = parseEnvString('NO_EQUALS, KEY=value')
    expect(result).not.toHaveProperty('NO_EQUALS')
    expect(result.KEY).toBe('value')
  })

  it('preserves values with equals signs in them', () => {
    const result = parseEnvString('DB_URL=postgres://user:pass@host/db')
    expect(result.DB_URL).toBe('postgres://user:pass@host/db')
  })
})

// @group UnitTests > parseDotEnv : .env file format parsing
describe('parseDotEnv', () => {
  it('parses a single KEY=VALUE line', () => {
    expect(parseDotEnv('NODE_ENV=production')).toEqual({ NODE_ENV: 'production' })
  })

  it('parses multiple lines', () => {
    const raw = 'NODE_ENV=production\nPORT=3000\nDEBUG=false'
    const result = parseDotEnv(raw)
    expect(result).toEqual({ NODE_ENV: 'production', PORT: '3000', DEBUG: 'false' })
  })

  it('ignores comment lines starting with #', () => {
    const raw = '# This is a comment\nNODE_ENV=production'
    const result = parseDotEnv(raw)
    expect(result).not.toHaveProperty('#')
    expect(result.NODE_ENV).toBe('production')
  })

  it('ignores blank lines', () => {
    const raw = '\nNODE_ENV=production\n\nPORT=3000\n'
    const result = parseDotEnv(raw)
    expect(Object.keys(result)).toHaveLength(2)
  })

  it('preserves values with equals signs', () => {
    const result = parseDotEnv('DB=postgres://user:pass@host/db')
    expect(result.DB).toBe('postgres://user:pass@host/db')
  })

  it('preserves values with spaces', () => {
    const result = parseDotEnv('GREETING=hello world')
    expect(result.GREETING).toBe('hello world')
  })

  it('handles empty input', () => {
    expect(parseDotEnv('')).toEqual({})
  })

  it('handles Windows-style line endings (CRLF)', () => {
    const raw = 'NODE_ENV=production\r\nPORT=3000'
    const result = parseDotEnv(raw)
    // Values may include \r on some implementations — check keys are present
    expect(Object.keys(result)).toContain('NODE_ENV')
    expect(Object.keys(result)).toContain('PORT')
  })

  it('parses inline comments after value are kept as-is', () => {
    // parseDotEnv does NOT strip inline comments — the full value after = is kept
    const result = parseDotEnv('PORT=3000 # web server')
    expect(result.PORT).toBe('3000 # web server')
  })
})

// @group UnitTests > envToString : Serialize env record to .env format
describe('envToString', () => {
  it('serializes an empty object to empty string', () => {
    expect(envToString({})).toBe('')
  })

  it('serializes a single entry', () => {
    expect(envToString({ NODE_ENV: 'production' })).toBe('NODE_ENV=production')
  })

  it('serializes multiple entries separated by newlines', () => {
    const result = envToString({ A: '1', B: '2' })
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines).toContain('A=1')
    expect(lines).toContain('B=2')
  })

  it('roundtrips with parseDotEnv', () => {
    const original = { NODE_ENV: 'production', PORT: '3000', DEBUG: 'false' }
    const serialized = envToString(original)
    const parsed = parseDotEnv(serialized)
    expect(parsed).toEqual(original)
  })
})
