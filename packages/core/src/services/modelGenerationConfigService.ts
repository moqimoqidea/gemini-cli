/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerationConfig } from '@google/genai';

export interface GenerationContext {
  agent?: string;
  model: string; // Can be a model name or an alias
}

export interface GenerationSettings {
  model?: string;
  config?: Partial<GenerationConfig>;
}

export interface GenerationOverride {
  match: {
    agent?: string;
    model?: string; // Can be a model name or an alias
  };
  settings: GenerationSettings;
}

export interface GenerationAlias {
  extends?: string;
  settings: GenerationSettings;
}

export interface ModelGenerationServiceConfig {
  aliases?: Record<string, GenerationAlias>;
  overrides?: GenerationOverride[];
  config?: Partial<GenerationConfig>;
}

export type ResolvedModelConfig = _ResolvedGenerationSettings & {
  readonly _brand: unique symbol;
};

export interface _ResolvedGenerationSettings {
  model: string; // The actual, resolved model name

  sdkConfig: GenerationConfig;
}

export class ModelGenerationConfigService {
  constructor(
    private readonly config: ModelGenerationServiceConfig | undefined,
  ) {}

  private resolveAlias(
    aliasName: string,
    aliases: Record<string, GenerationAlias>,
    visited = new Set<string>(),
  ): GenerationAlias {
    if (visited.has(aliasName)) {
      throw new Error(
        `Circular alias dependency: ${[...visited, aliasName].join(' -> ')}`,
      );
    }
    visited.add(aliasName);

    const alias = aliases[aliasName];
    if (!alias) {
      throw new Error(`Alias "${aliasName}" not found.`);
    }

    if (!alias.extends) {
      if (!alias.settings.model) {
        throw new Error(
          `Alias "${aliasName}" must define a "model" in its settings as it does not extend another alias.`,
        );
      }
      return alias;
    }

    const baseAlias = this.resolveAlias(alias.extends, aliases, visited);

    return {
      settings: {
        model: alias.settings.model ?? baseAlias.settings.model,
        config: {
          ...baseAlias.settings.config,
          ...(alias.settings.config ?? {}),
        },
      },
    };
  }

  getResolvedConfig(context: GenerationContext): ResolvedModelConfig {
    const config = this.config || {};
    const { aliases = {}, overrides = [], config: globalConfig = {} } = config;
    let baseModel = context.model;
    let resolvedConfig: Partial<GenerationConfig> = { ...globalConfig };

    // Step 1: Alias Resolution
    if (aliases[context.model]) {
      const resolvedAlias = this.resolveAlias(context.model, aliases);
      baseModel = resolvedAlias.settings.model!; // We know model is non-null from resolveAlias logic
      resolvedConfig = { ...resolvedConfig, ...resolvedAlias.settings.config };
    }

    const finalContext = {
      ...context,
      model: baseModel, // Use the resolved model name for matching
    };

    // Step 2: Override Application
    const matches = overrides
      .map((override, index) => {
        const matchEntries = Object.entries(override.match);
        if (matchEntries.length === 0) {
          return null;
        }

        const isMatch = matchEntries.every(([key, value]) => {
          if (key === 'model') {
            return value === context.model || value === finalContext.model;
          }
          if (key === 'agent' && value === 'core') {
            // The 'core' agent is special. It should match if the agent is
            // explicitly 'core' or if the agent is not specified in a way
            // that implies a different agent context (i.e., it's undefined).
            // We check for the presence of the key in the original context
            // to distinguish between a truly absent agent and an explicitly
            // undefined one.
            return (
              'agent' in context &&
              (context.agent === 'core' || context.agent === undefined)
            );
          }
          return finalContext[key as keyof GenerationContext] === value;
        });

        if (isMatch) {
          return {
            specificity: matchEntries.length,
            settings: override.settings,
            index,
          };
        }
        return null;
      })
      .filter((match): match is NonNullable<typeof match> => match !== null);

    // The override application logic is designed to be both simple and powerful.
    // By first sorting all matching overrides by specificity (and then by their
    // original order as a tie-breaker), we ensure that as we merge the `config`
    // objects, the settings from the most specific rules are applied last,
    // correctly overwriting any values from broader, less-specific rules.
    // This achieves a per-property override effect without complex per-property logic.
    matches.sort((a, b) => {
      if (a.specificity !== b.specificity) {
        return a.specificity - b.specificity;
      }
      return a.index - b.index;
    });

    // Apply matching overrides
    for (const match of matches) {
      if (match.settings.model) {
        baseModel = match.settings.model;
      }
      if (match.settings.config) {
        resolvedConfig = { ...resolvedConfig, ...match.settings.config };
      }
    }

    return {
      model: baseModel,
      sdkConfig: resolvedConfig as GenerationConfig,
    } as ResolvedModelConfig;
  }
}
