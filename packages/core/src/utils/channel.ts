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

export async function getReleaseChannel(cwd: string): Promise<ReleaseChannel> {
  const packageJson = await getPackageJson(cwd);
  const version = packageJson?.version ?? '';

  if (version.includes('nightly')) {
    return ReleaseChannel.NIGHTLY;
  } else if (version.includes('preview')) {
    return ReleaseChannel.PREVIEW;
  } else {
    return ReleaseChannel.STABLE;
  }
}
