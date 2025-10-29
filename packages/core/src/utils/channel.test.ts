/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { isNightly, isPreview, isStable } from './channel.js';
import * as packageJson from './package.js';

vi.mock('./package.js', () => ({
  getPackageJson: vi.fn(),
}));

describe('channel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('isStable', () => {
    it('should return true for a stable version', async () => {
      vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue({
        name: 'test',
        version: '1.0.0',
      });
      await expect(isStable('/test/dir')).resolves.toBe(true);
    });

    it('should return false for a nightly version', async () => {
      vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue({
        name: 'test',
        version: '1.0.0-nightly.1',
      });
      await expect(isStable('/test/dir')).resolves.toBe(false);
    });

    it('should return false for a preview version', async () => {
      vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue({
        name: 'test',
        version: '1.0.0-preview.1',
      });
      await expect(isStable('/test/dir')).resolves.toBe(false);
    });

    it('should return false if package.json is not found', async () => {
      vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue(undefined);
      await expect(isStable('/test/dir')).resolves.toBe(false);
    });

    it('should return false if version is not defined', async () => {
      vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue({
        name: 'test',
      });
      await expect(isStable('/test/dir')).resolves.toBe(false);
    });
  });

  describe('isNightly', () => {
    it('should return false for a stable version', async () => {
      vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue({
        name: 'test',
        version: '1.0.0',
      });
      await expect(isNightly('/test/dir')).resolves.toBe(false);
    });

    it('should return true for a nightly version', async () => {
      vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue({
        name: 'test',
        version: '1.0.0-nightly.1',
      });
      await expect(isNightly('/test/dir')).resolves.toBe(true);
    });

    it('should return false for a preview version', async () => {
      vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue({
        name: 'test',
        version: '1.0.0-preview.1',
      });
      await expect(isNightly('/test/dir')).resolves.toBe(false);
    });

    it('should return true if package.json is not found', async () => {
      vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue(undefined);
      await expect(isNightly('/test/dir')).resolves.toBe(true);
    });

    it('should return true if version is not defined', async () => {
      vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue({
        name: 'test',
      });
      await expect(isNightly('/test/dir')).resolves.toBe(true);
    });
  });

  describe('isPreview', () => {
    it('should return false for a stable version', async () => {
      vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue({
        name: 'test',
        version: '1.0.0',
      });
      await expect(isPreview('/test/dir')).resolves.toBe(false);
    });

    it('should return false for a nightly version', async () => {
      vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue({
        name: 'test',
        version: '1.0.0-nightly.1',
      });
      await expect(isPreview('/test/dir')).resolves.toBe(false);
    });

    it('should return true for a preview version', async () => {
      vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue({
        name: 'test',
        version: '1.0.0-preview.1',
      });
      await expect(isPreview('/test/dir')).resolves.toBe(true);
    });

    it('should return false if package.json is not found', async () => {
      vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue(undefined);
      await expect(isPreview('/test/dir')).resolves.toBe(false);
    });

    it('should return false if version is not defined', async () => {
      vi.spyOn(packageJson, 'getPackageJson').mockResolvedValue({
        name: 'test',
      });
      await expect(isPreview('/test/dir')).resolves.toBe(false);
    });
  });
});
