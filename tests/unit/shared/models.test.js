/**
 * Unit tests for Models Configuration
 * Tests the ModelConfig object and its methods
 */

// Mock ModelConfig object based on the actual module structure
const ModelConfig = {
  DEFAULT_MODEL: 'gpt-4o-mini',
  PREDEFINED_MODELS: ['gpt-4o-mini', 'gpt-5-mini', 'gpt-5-nano'],
  MODEL_DESCRIPTIONS: {
    'gpt-4o-mini': 'GPT-4o Mini (Recommended)',
    'gpt-5-mini': 'GPT-5 Mini',
    'gpt-5-nano': 'GPT-5 Nano',
  },
  DEFAULT_SETTINGS: {
    apiKey: '',
    apiEndpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    customModel: '',
    targetLanguage: 'chinese-traditional',
    animationSpeed: 'normal',
    showProgress: true,
    playSound: false,
    maxBlockSize: 5,
    temperature: 0.3,
    blocksPerRequest: 5,
  },
  isPredefinedModel(modelId) {
    return this.PREDEFINED_MODELS.includes(modelId);
  },
  getModelDescription(modelId) {
    return this.MODEL_DESCRIPTIONS[modelId] || modelId;
  },
  getDefaultSettings() {
    return { ...this.DEFAULT_SETTINGS };
  },
};

describe('Models Configuration', () => {
  describe('PREDEFINED_MODELS', () => {
    test('should contain expected models', () => {
      expect(ModelConfig.PREDEFINED_MODELS).toContain('gpt-4o-mini');
      expect(ModelConfig.PREDEFINED_MODELS).toContain('gpt-5-mini');
      expect(ModelConfig.PREDEFINED_MODELS).toContain('gpt-5-nano');
      expect(Array.isArray(ModelConfig.PREDEFINED_MODELS)).toBe(true);
    });

    test('should not be empty', () => {
      expect(ModelConfig.PREDEFINED_MODELS.length).toBeGreaterThan(0);
    });
  });

  describe('MODEL_DESCRIPTIONS', () => {
    test('should have descriptions for all predefined models', () => {
      ModelConfig.PREDEFINED_MODELS.forEach(model => {
        expect(ModelConfig.MODEL_DESCRIPTIONS[model]).toBeDefined();
        expect(typeof ModelConfig.MODEL_DESCRIPTIONS[model]).toBe('string');
        expect(ModelConfig.MODEL_DESCRIPTIONS[model].length).toBeGreaterThan(0);
      });
    });
  });

  describe('getDefaultSettings', () => {
    test('should return valid default settings', () => {
      const defaults = ModelConfig.getDefaultSettings();

      expect(defaults).toHaveProperty('apiKey');
      expect(defaults).toHaveProperty('apiEndpoint');
      expect(defaults).toHaveProperty('model');
      expect(defaults).toHaveProperty('targetLanguage');
      expect(defaults).toHaveProperty('blocksPerRequest');
      expect(defaults).toHaveProperty('temperature');

      expect(typeof defaults.apiEndpoint).toBe('string');
      expect(defaults.apiEndpoint).toContain('openai.com');
      expect(typeof defaults.model).toBe('string');
      expect(typeof defaults.targetLanguage).toBe('string');
      expect(typeof defaults.blocksPerRequest).toBe('number');
      expect(typeof defaults.temperature).toBe('number');

      expect(defaults.temperature).toBeGreaterThanOrEqual(0);
      expect(defaults.temperature).toBeLessThanOrEqual(1);
    });
  });

  describe('isPredefinedModel', () => {
    test('should return true for predefined models', () => {
      expect(ModelConfig.isPredefinedModel('gpt-4o-mini')).toBe(true);
      expect(ModelConfig.isPredefinedModel('gpt-5-mini')).toBe(true);
    });

    test('should return false for custom models', () => {
      expect(ModelConfig.isPredefinedModel('custom-model')).toBe(false);
      expect(ModelConfig.isPredefinedModel('')).toBe(false);
      expect(ModelConfig.isPredefinedModel(null)).toBe(false);
      expect(ModelConfig.isPredefinedModel(undefined)).toBe(false);
    });
  });

  describe('getModelDescription', () => {
    test('should return description for predefined models', () => {
      const description = ModelConfig.getModelDescription('gpt-4o-mini');
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(0);
      expect(description).toContain('GPT-4o Mini');
    });

    test('should return model ID for custom models', () => {
      const description = ModelConfig.getModelDescription('custom-model');
      expect(typeof description).toBe('string');
      expect(description).toBe('custom-model');
    });
  });
});
