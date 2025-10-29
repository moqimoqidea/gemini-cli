/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { getReleaseChannel, ReleaseChannel } from './channel.js';
import * as packageJson from './package.js';

vi.mock('./package.js', () => ({
  getPackageJson: vi.fn(),
}));

describe('getReleaseChannel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return STABLE for a stable version', async () => {
    vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue({
      name: 'test',
      version: '1.0.0',
    });
    const channel = await getReleaseChannel('/test/dir');
    expect(channel).toBe(ReleaseChannel.STABLE);
  });

  it('should return NIGHTLY for a nightly version', async () => {
    vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue({
      name: 'test',
      version: '1.0.0-nightly.1',
    });
    const channel = await getReleaseChannel('/test/dir');
    expect(channel).toBe(ReleaseChannel.NIGHTLY);
  });

  it('should return PREVIEW for a preview version', async () => {
    vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue({
      name: 'test',
      version: '1.0.0-preview.1',
    });
    const channel = await getReleaseChannel('/test/dir');
    expect(channel).toBe(ReleaseChannel.PREVIEW);
  });

  it('should return STABLE if package.json is not found', async () => {
    vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue(undefined);
    const channel = await getReleaseChannel('/test/dir');
    expect(channel).toBe(ReleaseChannel.STABLE);
  });

  it('should return STABLE if version is not defined', async () => {
    vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue({
      name: 'test',
    });
    const channel = await getReleaseChannel('/test/dir');
    expect(channel).toBe(ReleaseChannel.STABLE);
  });
});
