/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getPackageJson } from './package.js';

export enum ReleaseChannel {
  NIGHTLY = 'nightly',
  PREVIEW = 'preview',
  STABLE = 'stable',
}

async function _getReleaseChannel(cwd: string): Promise<ReleaseChannel> {
  const packageJson = await getPackageJson(cwd);
  const version = packageJson?.version ?? '';

  if (version === '') {
    return ReleaseChannel.NIGHTLY;
  } else if (version.includes('nightly')) {
    return ReleaseChannel.NIGHTLY;
  } else if (version.includes('preview')) {
    return ReleaseChannel.PREVIEW;
  } else {
    return ReleaseChannel.STABLE;
  }
}

export async function isNightly(cwd: string): Promise<boolean> {
  return (await _getReleaseChannel(cwd)) === ReleaseChannel.NIGHTLY;
}

export async function isPreview(cwd: string): Promise<boolean> {
  return (await _getReleaseChannel(cwd)) === ReleaseChannel.PREVIEW;
}

export async function isStable(cwd: string): Promise<boolean> {
  return (await _getReleaseChannel(cwd)) === ReleaseChannel.STABLE;
}
