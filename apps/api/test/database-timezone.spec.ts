import { EventEmitter } from 'node:events'
import { createPool, type PoolConnection } from 'mysql2'
import { afterEach, expect, it, vi } from 'vitest'
import { createDatabase } from '../src/database/db.js'

vi.mock('mysql2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mysql2')>()
  return { ...actual, createPool: vi.fn(actual.createPool) }
})

const pools: ReturnType<typeof createPool>[] = []

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.promise().end()))
  vi.mocked(createPool).mockClear()
})

async function setup(acquisitionError: Error | null = null) {
  const actual = await vi.importActual<typeof import('mysql2')>('mysql2')
  const callbackPool = actual.createPool({ timezone: 'Z' })
  pools.push(callbackPool)
  let finishInitialization: (error: Error | null) => void = () => {
    throw new Error('Connection initialization has not started')
  }
  const connection = Object.assign(new EventEmitter(), {
    query: vi.fn((_sql: string, callback: (error: Error | null) => void) => {
      finishInitialization = callback
    }),
    destroy: vi.fn(),
    release: vi.fn(),
  })
  vi.spyOn(callbackPool, 'getConnection').mockImplementation((callback) => {
    callback(acquisitionError, connection as unknown as PoolConnection)
  })
  vi.mocked(createPool).mockReturnValueOnce(callbackPool)
  const database = createDatabase('mysql://example:example@localhost/example')
  return {
    ...database,
    connection,
    finishInitialization: (error: Error | null = null) => finishInitialization(error),
  }
}

it('sets UTC before checkout and reinitializes reused connections', async () => {
  const { pool, connection, finishInitialization } = await setup()
  expect(createPool).toHaveBeenCalledWith({
    uri: 'mysql://example:example@localhost/example',
    timezone: 'Z',
  })

  for (let checkout = 0; checkout < 2; checkout++) {
    const ready = vi.fn()
    const pending = pool.getConnection().then((borrowed) => {
      ready()
      return borrowed
    })
    await Promise.resolve()
    expect(ready).not.toHaveBeenCalled()
    expect(connection.query).toHaveBeenLastCalledWith(
      "SET SESSION time_zone = '+00:00'",
      expect.any(Function),
    )
    finishInitialization()
    const borrowed = await pending
    borrowed.release()
  }
  expect(connection.query).toHaveBeenCalledTimes(2)
  expect(connection.destroy).not.toHaveBeenCalled()
})

it('rejects checkout and discards a connection when UTC initialization fails', async () => {
  const { pool, connection, finishInitialization } = await setup()
  const pending = pool.getConnection()
  const failure = new Error('Session initialization failed')
  finishInitialization(failure)
  await expect(pending).rejects.toBe(failure)
  expect(connection.destroy).toHaveBeenCalledOnce()
  expect(connection.release).not.toHaveBeenCalled()
})

it('propagates acquisition failure without attempting initialization', async () => {
  const failure = new Error('Connection unavailable')
  const { pool, connection } = await setup(failure)
  await expect(pool.getConnection()).rejects.toBe(failure)
  expect(connection.query).not.toHaveBeenCalled()
})
