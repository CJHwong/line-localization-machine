// Centralized model configuration for Line Localization Machine
// This file manages all available models and default settings

const ModelConfig = {
  // Default model
  DEFAULT_MODEL: 'gpt-4o-mini',

  // Available predefined models
  PREDEFINED_MODELS: ['gpt-4o-mini', 'gpt-5-mini', 'gpt-5-nano'],

  // Model display names with descriptions
  MODEL_DESCRIPTIONS: {
    'gpt-4o-mini': 'GPT-4o Mini (Recommended)',
    'gpt-5-mini': 'GPT-5 Mini',
    'gpt-5-nano': 'GPT-5 Nano',
  },

  // Default extension settings
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

  // Helper methods
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

// ES6 export
export default ModelConfig;
