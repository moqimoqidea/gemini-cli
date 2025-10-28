/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, beforeEach, afterEach } from 'vitest';

global.IS_REACT_ACT_ENVIRONMENT = true;

// Unset NO_COLOR environment variable to ensure consistent theme behavior between local and CI test runs
if (process.env.NO_COLOR !== undefined) {
  delete process.env.NO_COLOR;
}

import './src/test-utils/customMatchers.js';

let consoleErrorSpy: vi.SpyInstance;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  const errorCalls = consoleErrorSpy.mock.calls.filter((call) => {
    const firstArg = call[0];
    return (
      typeof firstArg === 'string' &&
      firstArg.includes('was not wrapped in act(...)')
    );
  });

  consoleErrorSpy.mockRestore();

  if (errorCalls.length > 0) {
    const messages = errorCalls.map((call) => call.join(' ')).join('\n');
    throw new Error(`Failing test due to "act(...)" warnings:\n${messages}`);
  }
});
