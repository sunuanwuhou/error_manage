import { test } from '@playwright/test'

test.describe('pdf import flow', () => {
  test('temporarily skipped: pdf import is not in current delivery scope', async () => {
    test.skip(true, 'PDF import is deferred by product priority')
  })
})
