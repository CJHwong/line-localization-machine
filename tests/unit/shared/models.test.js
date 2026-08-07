/**
 * Unit tests for the actual provider and model configuration module.
 */

const fs = require('fs');
const path = require('path');

const modelSource = fs
  .readFileSync(path.join(__dirname, '../../../shared/models.js'), 'utf8')
  .replace('export default ModelConfig;', 'global.ModelConfig = ModelConfig;');

eval(modelSource);

const ModelConfig = global.ModelConfig;

describe('ModelConfig', () => {
  describe('provider model presets', () => {
    test('uses the confirmed current defaults', () => {
      expect(ModelConfig.PROVIDERS.openai.defaultModel).toBe('gpt-5.6-luna');
      expect(ModelConfig.PROVIDERS.google.defaultModel).toBe('gemini-3.5-flash-lite');
      expect(ModelConfig.PROVIDERS.ollama.defaultModel).toBe('deepseek-v4-flash:cloud');
    });

    test('contains the supported current models', () => {
      expect(ModelConfig.getModelsForProvider('openai')).toEqual([
        'gpt-5.6',
        'gpt-5.6-terra',
        'gpt-5.6-luna',
      ]);
      expect(ModelConfig.getModelsForProvider('google')).toEqual([
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
      ]);
      expect(ModelConfig.getModelsForProvider('ollama')).toEqual([
        'deepseek-v4-flash:cloud',
        'deepseek-v4-pro:cloud',
        'qwen3.5:cloud',
        'gpt-oss:120b-cloud',
        'gpt-oss:20b-cloud',
      ]);
    });

    test('has descriptions for every predefined model', () => {
      for (const providerId of ModelConfig.getProviderIds()) {
        const provider = ModelConfig.getProvider(providerId);
        for (const modelId of provider.models) {
          expect(ModelConfig.getModelDescription(providerId, modelId)).toEqual(
            provider.descriptions[modelId]
          );
        }
      }
    });
  });

  describe('default settings', () => {
    test('returns provider-scoped API keys without a global key', () => {
      const defaults = ModelConfig.getDefaultSettings();

      expect(defaults).not.toHaveProperty('apiKey');
      expect(defaults.apiKeys).toEqual({
        openai: '',
        google: '',
        ollama: '',
        custom: '',
      });
      expect(defaults.provider).toBe('openai');
      expect(defaults.model).toBe('gpt-5.6-luna');
      expect(defaults.reasoningEffort).toBe('medium');
    });

    test('returns a fresh nested API-key object', () => {
      const first = ModelConfig.getDefaultSettings();
      first.apiKeys.openai = 'do-not-leak-between-calls';

      expect(ModelConfig.getDefaultSettings().apiKeys.openai).toBe('');
    });
  });

  describe('provider API keys', () => {
    test('returns the key for the selected provider', () => {
      expect(
        ModelConfig.getApiKey({
          provider: 'google',
          apiKeys: { openai: 'openai-key', google: 'google-key' },
        })
      ).toBe('google-key');
    });

    test('returns an empty key when the selected provider has no key', () => {
      expect(ModelConfig.getApiKey({ provider: 'ollama', apiKeys: {} })).toBe('');
    });
  });

  describe('migrateSettings', () => {
    test('moves a legacy global key to the provider inferred from its endpoint', () => {
      const migrated = ModelConfig.migrateSettings({
        apiKey: 'legacy-openai-key',
        apiEndpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-5.4',
      });

      expect(migrated.provider).toBe('openai');
      expect(migrated.apiKeys.openai).toBe('legacy-openai-key');
      expect(migrated).not.toHaveProperty('apiKey');
    });

    test('moves a legacy key to custom when its endpoint is unknown', () => {
      const migrated = ModelConfig.migrateSettings({
        apiKey: 'legacy-custom-key',
        apiEndpoint: 'https://llm.example.test/v1',
      });

      expect(migrated.provider).toBe('custom');
      expect(migrated.apiKeys.custom).toBe('legacy-custom-key');
    });

    test('preserves existing provider keys when a legacy key is also present', () => {
      const migrated = ModelConfig.migrateSettings({
        provider: 'google',
        apiKey: 'legacy-key',
        apiKeys: { google: 'current-google-key', ollama: 'ollama-key' },
      });

      expect(migrated.apiKeys.google).toBe('current-google-key');
      expect(migrated.apiKeys.ollama).toBe('ollama-key');
    });

    test('defaults an empty configuration to OpenAI', () => {
      const migrated = ModelConfig.migrateSettings({});

      expect(migrated.provider).toBe('openai');
      expect(migrated.apiKeys.openai).toBe('');
    });
  });

  describe('model helpers', () => {
    test('recognizes predefined models per provider', () => {
      expect(ModelConfig.isPredefinedModel('openai', 'gpt-5.6-luna')).toBe(true);
      expect(ModelConfig.isPredefinedModel('google', 'gpt-5.6-luna')).toBe(false);
      expect(ModelConfig.isPredefinedModel('ollama', 'custom-model')).toBe(false);
    });

    test('returns the model ID for custom models', () => {
      expect(ModelConfig.getModelDescription('google', 'custom-model')).toBe('custom-model');
    });
  });
});
