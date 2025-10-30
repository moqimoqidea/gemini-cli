/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { ModelGenerationServiceConfig } from './modelGenerationConfigService.js';
import { ModelGenerationConfigService } from './modelGenerationConfigService.js';

describe('ModelGenerationConfigService', () => {
  it('should resolve a basic alias to its model and settings', () => {
    const config: ModelGenerationServiceConfig = {
      aliases: {
        'classifier-v1': {
          settings: {
            model: 'models/gemini-1.5-flash-latest',
            config: {
              temperature: 0,
              topP: 0.9,
            },
          },
        },
      },
      overrides: [],
    };
    const service = new ModelGenerationConfigService(config);
    const resolved = service.getResolvedConfig({ model: 'classifier-v1' });

    expect(resolved.model).toBe('models/gemini-1.5-flash-latest');
    expect(resolved.sdkConfig).toEqual({
      temperature: 0,
      topP: 0.9,
    });
  });

  it('should apply global defaults when no alias or override matches', () => {
    const config: ModelGenerationServiceConfig = {
      config: {
        temperature: 0.7,
        topK: 40,
      },
      aliases: {},
      overrides: [],
    };
    const service = new ModelGenerationConfigService(config);
    const resolved = service.getResolvedConfig({ model: 'some-model' });

    expect(resolved.model).toBe('some-model');
    expect(resolved.sdkConfig).toEqual({
      temperature: 0.7,
      topK: 40,
    });
  });

  it('should apply a simple override on top of an alias', () => {
    const config: ModelGenerationServiceConfig = {
      aliases: {
        'classifier-v1': {
          settings: {
            model: 'models/gemini-1.5-flash-latest',
            config: {
              temperature: 0,
              topP: 0.9,
            },
          },
        },
      },
      overrides: [
        {
          match: { model: 'classifier-v1' },
          settings: {
            config: {
              temperature: 0.5,
              maxOutputTokens: 1000,
            },
          },
        },
      ],
    };
    const service = new ModelGenerationConfigService(config);
    const resolved = service.getResolvedConfig({ model: 'classifier-v1' });

    expect(resolved.model).toBe('models/gemini-1.5-flash-latest');
    expect(resolved.sdkConfig).toEqual({
      temperature: 0.5,
      topP: 0.9,
      maxOutputTokens: 1000,
    });
  });

  it('should apply the most specific override rule', () => {
    const config: ModelGenerationServiceConfig = {
      aliases: {},
      overrides: [
        {
          match: { model: 'my-model' },
          settings: { config: { temperature: 0.5 } },
        },
        {
          match: { model: 'my-model', agent: 'my-agent' },
          settings: { config: { temperature: 0.1 } },
        },
      ],
    };
    const service = new ModelGenerationConfigService(config);
    const resolved = service.getResolvedConfig({
      model: 'my-model',
      agent: 'my-agent',
    });

    expect(resolved.model).toBe('my-model');
    expect(resolved.sdkConfig).toEqual({ temperature: 0.1 });
  });

  it('should use the last override in case of a tie in specificity', () => {
    const config: ModelGenerationServiceConfig = {
      aliases: {},
      overrides: [
        {
          match: { model: 'my-model' },
          settings: { config: { temperature: 0.5, topP: 0.8 } },
        },
        {
          match: { model: 'my-model' },
          settings: { config: { temperature: 0.1 } },
        },
      ],
    };
    const service = new ModelGenerationConfigService(config);
    const resolved = service.getResolvedConfig({ model: 'my-model' });

    expect(resolved.model).toBe('my-model');
    expect(resolved.sdkConfig).toEqual({ temperature: 0.1, topP: 0.8 });
  });

  it('should correctly pass through generation config from an alias', () => {
    const config: ModelGenerationServiceConfig = {
      aliases: {
        'thinking-alias': {
          settings: {
            model: 'some-model',
            config: {
              candidateCount: 500,
            },
          },
        },
      },
      overrides: [],
    };
    const service = new ModelGenerationConfigService(config);
    const resolved = service.getResolvedConfig({ model: 'thinking-alias' });

    expect(resolved.sdkConfig).toEqual({ candidateCount: 500 });
  });

  it('should let an override generation config win over an alias config', () => {
    const config: ModelGenerationServiceConfig = {
      aliases: {
        'thinking-alias': {
          settings: {
            model: 'some-model',
            config: {
              candidateCount: 500,
            },
          },
        },
      },
      overrides: [
        {
          match: { model: 'thinking-alias' },
          settings: {
            config: {
              candidateCount: 1000,
            },
          },
        },
      ],
    };
    const service = new ModelGenerationConfigService(config);
    const resolved = service.getResolvedConfig({ model: 'thinking-alias' });

    expect(resolved.sdkConfig).toEqual({
      candidateCount: 1000,
    });
  });

  it('should merge settings from global, alias, and multiple matching overrides', () => {
    const config: ModelGenerationServiceConfig = {
      config: {
        temperature: 0.7,
        topP: 1.0,
      },
      aliases: {
        'test-alias': {
          settings: {
            model: 'test-model',
            config: {
              topP: 0.9,
              topK: 50,
            },
          },
        },
      },
      overrides: [
        {
          match: { model: 'test-model' },
          settings: {
            config: {
              topK: 40,
              maxOutputTokens: 2048,
            },
          },
        },
        {
          match: { agent: 'test-agent' },
          settings: {
            config: {
              maxOutputTokens: 4096,
            },
          },
        },
        {
          match: { model: 'test-model', agent: 'test-agent' },
          settings: {
            config: {
              temperature: 0.2,
            },
          },
        },
      ],
    };

    const service = new ModelGenerationConfigService(config);
    const resolved = service.getResolvedConfig({
      model: 'test-alias',
      agent: 'test-agent',
    });

    expect(resolved.model).toBe('test-model');
    expect(resolved.sdkConfig).toEqual({
      // From global, overridden by most specific override
      temperature: 0.2,
      // From alias, not overridden
      topP: 0.9,
      // From alias, overridden by less specific override
      topK: 40,
      // From first matching override, overridden by second matching override
      maxOutputTokens: 4096,
    });
  });

  it('should match an agent:core override when agent is undefined', () => {
    const config: ModelGenerationServiceConfig = {
      config: {
        temperature: 0.7,
      },
      aliases: {},
      overrides: [
        {
          match: { agent: 'core' },
          settings: {
            config: {
              temperature: 0.1,
            },
          },
        },
      ],
    };

    const service = new ModelGenerationConfigService(config);
    const resolved = service.getResolvedConfig({
      model: 'some-model',
      agent: undefined, // Explicitly undefined
    });

    expect(resolved.model).toBe('some-model');
    expect(resolved.sdkConfig).toEqual({
      temperature: 0.1,
    });
  });

  describe('alias inheritance', () => {
    it('should resolve a simple "extends" chain', () => {
      const config: ModelGenerationServiceConfig = {
        aliases: {
          base: {
            settings: {
              model: 'models/gemini-1.5-pro-latest',
              config: {
                temperature: 0.7,
                topP: 0.9,
              },
            },
          },
          'flash-variant': {
            extends: 'base',
            settings: {
              model: 'models/gemini-1.5-flash-latest',
            },
          },
        },
      };
      const service = new ModelGenerationConfigService(config);
      const resolved = service.getResolvedConfig({ model: 'flash-variant' });

      expect(resolved.model).toBe('models/gemini-1.5-flash-latest');
      expect(resolved.sdkConfig).toEqual({
        temperature: 0.7,
        topP: 0.9,
      });
    });

    it('should override parent properties from child alias', () => {
      const config: ModelGenerationServiceConfig = {
        aliases: {
          base: {
            settings: {
              model: 'models/gemini-1.5-pro-latest',
              config: {
                temperature: 0.7,
                topP: 0.9,
              },
            },
          },
          'flash-variant': {
            extends: 'base',
            settings: {
              model: 'models/gemini-1.5-flash-latest',
              config: {
                temperature: 0.2,
              },
            },
          },
        },
      };
      const service = new ModelGenerationConfigService(config);
      const resolved = service.getResolvedConfig({ model: 'flash-variant' });

      expect(resolved.model).toBe('models/gemini-1.5-flash-latest');
      expect(resolved.sdkConfig).toEqual({
        temperature: 0.2,
        topP: 0.9,
      });
    });

    it('should resolve a multi-level "extends" chain', () => {
      const config: ModelGenerationServiceConfig = {
        aliases: {
          base: {
            settings: {
              model: 'models/gemini-1.5-pro-latest',
              config: {
                temperature: 0.7,
                topP: 0.9,
              },
            },
          },
          'base-flash': {
            extends: 'base',
            settings: {
              model: 'models/gemini-1.5-flash-latest',
            },
          },
          'classifier-flash': {
            extends: 'base-flash',
            settings: {
              config: {
                temperature: 0,
              },
            },
          },
        },
      };
      const service = new ModelGenerationConfigService(config);
      const resolved = service.getResolvedConfig({
        model: 'classifier-flash',
      });

      expect(resolved.model).toBe('models/gemini-1.5-flash-latest');
      expect(resolved.sdkConfig).toEqual({
        temperature: 0,
        topP: 0.9,
      });
    });

    it('should throw an error for circular dependencies', () => {
      const config: ModelGenerationServiceConfig = {
        aliases: {
          a: { extends: 'b', settings: {} },
          b: { extends: 'a', settings: {} },
        },
      };
      const service = new ModelGenerationConfigService(config);
      expect(() => service.getResolvedConfig({ model: 'a' })).toThrow(
        'Circular alias dependency: a -> b -> a',
      );
    });

    it('should throw an error if a base alias does not define a model', () => {
      const config: ModelGenerationServiceConfig = {
        aliases: {
          base: {
            settings: {
              config: { temperature: 0.7 },
            },
          },
        },
      };
      const service = new ModelGenerationConfigService(config);
      expect(() => service.getResolvedConfig({ model: 'base' })).toThrow(
        'Alias "base" must define a "model" in its settings as it does not extend another alias.',
      );
    });

    it('should throw an error if an extended alias does not exist', () => {
      const config: ModelGenerationServiceConfig = {
        aliases: {
          'bad-alias': {
            extends: 'non-existent',
            settings: {},
          },
        },
      };
      const service = new ModelGenerationConfigService(config);
      expect(() => service.getResolvedConfig({ model: 'bad-alias' })).toThrow(
        'Alias "non-existent" not found.',
      );
    });
  });
});
