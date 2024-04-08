/**
 * © 2021 Thoughtworks, Inc.
 */

import moment from 'moment'
import { promises } from 'fs'
import { FileHandle } from 'fs/promises'
import { env } from 'process'
import { GroupBy, Logger } from '@cloud-carbon-footprint/common'
import { getCachedData, writeToFile } from '../common/helpers'
import LocalCacheManager from '../LocalCacheManager'
import { EstimationRequest } from '../CreateValidRequest'

jest.mock('fs', () => {
  const actual = jest.requireActual('fs')
  return {
    ...actual,
    promises: { access: jest.fn(), writeFile: jest.fn(), open: jest.fn() },
  }
})

jest.mock('../common/helpers', () => {
  const requireActual = jest.requireActual('../common/helpers')
  return {
    ...requireActual,
    writeToFile: jest.fn(),
    getCachedData: jest.fn(),
  }
})

const mockWrite = writeToFile as jest.Mocked<never>
const mockGetCachedData = getCachedData as jest.Mock
const mockFs = promises as jest.Mocked<typeof promises>

const buildFootprintEstimates = (
  startDate: string,
  consecutiveDays: number,
) => {
  const grouping = 'day' as GroupBy
  return [...Array(consecutiveDays)].map((v, i) => {
    return {
      timestamp: moment.utc(startDate).add(i, 'days').toDate(),
      serviceEstimates: [],
      periodStartDate: undefined,
      periodEndDate: undefined,
      groupBy: grouping,
    }
  })
}

describe('Local Cache Manager', () => {
  let cacheManager: LocalCacheManager

  beforeEach(() => {
    cacheManager = new LocalCacheManager()
    jest.resetModules() // Most important - it clears the cache
    jest.resetAllMocks()
    env.TEST_MODE = 'true'
    console.warn = jest.fn()
  })

  it('gets estimates', async () => {
    const cachedEstimates = buildFootprintEstimates('2020-01-01', 1)

    cacheManager.cachedEstimates = cachedEstimates
    const estimates = await cacheManager.getEstimates()

    await expect(estimates).toEqual(cachedEstimates)
  })

  it('sets estimates', async () => {
    const estimates = buildFootprintEstimates('2020-01-01', 1)

    mockFs.open.mockResolvedValue({
      close: jest.fn(),
    } as unknown as FileHandle)

    mockGetCachedData.mockResolvedValue([])

    await cacheManager.setEstimates(estimates, GroupBy.day)

    expect(cacheManager.fetchedEstimates).toEqual(estimates)
    expect(mockWrite).toHaveBeenCalledWith(
      expect.anything(),
      estimates,
      expect.anything(),
    )
  })

  it('gets missing dates', async () => {
    const request: EstimationRequest = {
      startDate: new Date('2022-01-01'),
      endDate: new Date('2022-01-02'),
      ignoreCache: false,
      groupBy: 'day',
    }

    const estimates = buildFootprintEstimates('2022-01-01', 1)

    mockGetCachedData.mockReturnValue(estimates)

    const missingDates = await cacheManager.getMissingDates(request, 'day')

    expect(cacheManager.cachedEstimates).toEqual(estimates)
    expect(JSON.stringify(missingDates)).toEqual(
      JSON.stringify([moment.utc(request.endDate)]),
    )
  })

  it('will create a new empty file if fails to load cache', async () => {
    type FSError = Error & { code: string }
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    mockFs.access.mockImplementation(() => {
      // throw new error with error code ENOENT
      const error = new Error('failed to open cache') as FSError
      error.code = 'ENOENT'
      throw error
    })

    const loggerMessage = 'Cache file not found. Creating new cache file...'

    await cacheManager.getMissingDates({} as EstimationRequest, 'day')

    expect(Logger.prototype.warn).toHaveBeenCalledWith(loggerMessage)
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      'mock-estimates.json',
      '[]',
      'utf8',
    )
  })

  it('will ignore the cache if there is an error parsing the file', async () => {
    const parsingErrorMessage = 'Unexpected token ] in JSON at position 0' // Happens with a corrupted file
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    mockGetCachedData.mockImplementation(() => {
      throw new SyntaxError(parsingErrorMessage)
    })

    const loggerMessage =
      'There was an error parsing the cache file. Ignoring cache and fetching fresh estimates...'

    await cacheManager.getMissingDates({} as EstimationRequest, 'day')

    expect(Logger.prototype.warn).toHaveBeenCalledWith(loggerMessage)
  })
})
