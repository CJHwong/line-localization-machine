// Centralized model & provider configuration for Line Localization Machine

const ModelConfig = {
  // Provider presets — each has a name, endpoint, default model, and model list
  PROVIDERS: {
    openai: {
      name: 'OpenAI',
      endpoint: 'https://api.openai.com/v1',
      defaultModel: 'gpt-5.4-nano',
      models: ['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4'],
      descriptions: {
        'gpt-5.4-nano': 'GPT-5.4 Nano (Recommended)',
        'gpt-5.4-mini': 'GPT-5.4 Mini',
        'gpt-5.4': 'GPT-5.4',
      },
    },
    google: {
      name: 'Google',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      defaultModel: 'gemini-2.5-flash-lite',
      models: ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro'],
      descriptions: {
        'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite (Recommended)',
        'gemini-2.5-flash': 'Gemini 2.5 Flash',
        'gemini-2.5-pro': 'Gemini 2.5 Pro',
      },
    },
    ollama: {
      name: 'Ollama',
      endpoint: 'https://ollama.com/v1/',
      defaultModel: 'gpt-oss:120b-cloud',
      models: ['gpt-oss:120b-cloud'],
      descriptions: {
        'gpt-oss:120b-cloud': 'GPT-OSS 120B Cloud',
      },
    },
    custom: {
      name: 'Custom',
      endpoint: '',
      defaultModel: '',
      models: [],
      descriptions: {},
    },
  },

  DEFAULT_PROVIDER: 'openai',

  // Default extension settings
  DEFAULT_SETTINGS: {
    apiKey: '',
    provider: 'openai',
    apiEndpoint: 'https://api.openai.com/v1',
    model: 'gpt-5.4-nano',
    customModel: '',
    targetLanguage: 'chinese-traditional',
    reasoningEffort: 'medium',
  },

  // Helper methods
  getProvider(providerId) {
    return this.PROVIDERS[providerId] || this.PROVIDERS.custom;
  },

  getProviderIds() {
    return Object.keys(this.PROVIDERS);
  },

  getModelsForProvider(providerId) {
    const provider = this.getProvider(providerId);
    return provider.models;
  },

  getModelDescription(providerId, modelId) {
    const provider = this.getProvider(providerId);
    return provider.descriptions[modelId] || modelId;
  },

  isPredefinedModel(providerId, modelId) {
    const provider = this.getProvider(providerId);
    return provider.models.includes(modelId);
  },

  resolveEndpoint(providerId, customEndpoint) {
    if (providerId === 'custom') {
      return customEndpoint || '';
    }
    return this.getProvider(providerId).endpoint;
  },

  // Migrate legacy settings that have no provider field
  migrateSettings(settings) {
    if (settings.provider) {
      return settings;
    }

    // Match existing endpoint against known providers
    const endpoint = (settings.apiEndpoint || '').replace(/\/+$/, '');
    for (const [id, provider] of Object.entries(this.PROVIDERS)) {
      if (id === 'custom') continue;
      const knownEndpoint = provider.endpoint.replace(/\/+$/, '');
      if (endpoint === knownEndpoint) {
        return { ...settings, provider: id };
      }
    }

    // No match — preserve as custom
    return { ...settings, provider: 'custom' };
  },

  getDefaultSettings() {
    return { ...this.DEFAULT_SETTINGS };
  },
};

// ES6 export
export default ModelConfig;
