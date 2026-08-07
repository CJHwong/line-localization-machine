// Centralized model & provider configuration for Line Localization Machine

const ModelConfig = {
  // Provider presets — each has a name, endpoint, default model, and model list
  PROVIDERS: {
    openai: {
      name: 'OpenAI',
      endpoint: 'https://api.openai.com/v1',
      defaultModel: 'gpt-5.6-luna',
      models: ['gpt-5.6', 'gpt-5.6-terra', 'gpt-5.6-luna'],
      descriptions: {
        'gpt-5.6': 'GPT-5.6 (Sol)',
        'gpt-5.6-terra': 'GPT-5.6 Terra',
        'gpt-5.6-luna': 'GPT-5.6 Luna (Recommended)',
      },
    },
    google: {
      name: 'Google',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      defaultModel: 'gemini-3.5-flash-lite',
      models: [
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
      ],
      descriptions: {
        'gemini-3.6-flash': 'Gemini 3.6 Flash',
        'gemini-3.5-flash': 'Gemini 3.5 Flash',
        'gemini-3.5-flash-lite': 'Gemini 3.5 Flash Lite (Recommended)',
        'gemini-3.1-flash-lite': 'Gemini 3.1 Flash Lite',
      },
    },
    ollama: {
      name: 'Ollama',
      endpoint: 'https://ollama.com/v1/',
      defaultModel: 'deepseek-v4-flash:cloud',
      models: [
        'deepseek-v4-flash:cloud',
        'deepseek-v4-pro:cloud',
        'qwen3.5:cloud',
        'gpt-oss:120b-cloud',
        'gpt-oss:20b-cloud',
      ],
      descriptions: {
        'deepseek-v4-flash:cloud': 'DeepSeek V4 Flash Cloud (Recommended)',
        'deepseek-v4-pro:cloud': 'DeepSeek V4 Pro Cloud',
        'qwen3.5:cloud': 'Qwen 3.5 Cloud',
        'gpt-oss:120b-cloud': 'GPT-OSS 120B Cloud',
        'gpt-oss:20b-cloud': 'GPT-OSS 20B Cloud',
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
    apiKeys: {
      openai: '',
      google: '',
      ollama: '',
      custom: '',
    },
    provider: 'openai',
    apiEndpoint: 'https://api.openai.com/v1',
    model: 'gpt-5.6-luna',
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

  getDefaultApiKeys() {
    return this.getProviderIds().reduce((apiKeys, providerId) => {
      apiKeys[providerId] = '';
      return apiKeys;
    }, {});
  },

  normalizeApiKeys(apiKeys) {
    const storedApiKeys =
      apiKeys && typeof apiKeys === 'object' && !Array.isArray(apiKeys) ? apiKeys : {};
    return { ...this.getDefaultApiKeys(), ...storedApiKeys };
  },

  getApiKey(settings = {}) {
    const providerId = settings.provider || this.DEFAULT_PROVIDER;
    const apiKey = this.normalizeApiKeys(settings.apiKeys)[providerId];
    return typeof apiKey === 'string' ? apiKey : '';
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

  // Migrate legacy settings and move a global key into the selected provider.
  migrateSettings(settings = {}) {
    let providerId = settings.provider;

    if (!providerId || !this.PROVIDERS[providerId]) {
      const endpoint = (settings.apiEndpoint || '')
        .replace(/\/+$/, '')
        .replace(/\/chat\/completions$/, '');
      providerId = endpoint ? 'custom' : this.DEFAULT_PROVIDER;

      for (const [id, provider] of Object.entries(this.PROVIDERS)) {
        if (id === 'custom') continue;
        const knownEndpoint = provider.endpoint
          .replace(/\/+$/, '')
          .replace(/\/chat\/completions$/, '');
        if (endpoint === knownEndpoint) {
          providerId = id;
          break;
        }
      }
    }

    const apiKeys = this.normalizeApiKeys(settings.apiKeys);
    if (typeof settings.apiKey === 'string' && settings.apiKey && !apiKeys[providerId]) {
      apiKeys[providerId] = settings.apiKey;
    }

    const migrated = { ...settings, provider: providerId, apiKeys };
    delete migrated.apiKey;
    return migrated;
  },

  getDefaultSettings() {
    return {
      ...this.DEFAULT_SETTINGS,
      apiKeys: { ...this.DEFAULT_SETTINGS.apiKeys },
    };
  },
};

// ES6 export
export default ModelConfig;
