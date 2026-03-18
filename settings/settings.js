import ModelConfig from '../shared/models.js';
import APIClient from '../shared/api-client.js';

// Settings now use chrome.storage directly (standardized across browsers)

class SettingsController {
  constructor() {
    this.elements = {
      provider: document.getElementById('provider'),
      apiKey: document.getElementById('apiKey'),
      apiEndpoint: document.getElementById('apiEndpoint'),
      customEndpointSection: document.getElementById('customEndpointSection'),
      model: document.getElementById('model'),
      customModel: document.getElementById('customModel'),
      customModelSection: document.getElementById('customModelSection'),
      targetLanguage: document.getElementById('targetLanguage'),
      reasoningEffort: document.getElementById('reasoningEffort'),
      toggleApiKey: document.getElementById('toggleApiKey'),
      testConnection: document.getElementById('testConnection'),
      saveSettings: document.getElementById('saveSettings'),
      resetSettings: document.getElementById('resetSettings'),
      status: document.getElementById('status'),
    };

    this.defaultSettings = ModelConfig.getDefaultSettings();

    this.init();
  }

  async init() {
    this.populateProviderOptions();
    await this.loadSettings();
    this.bindEvents();
    this.updateProviderSection();
    this.updateModelSection();
  }

  populateProviderOptions() {
    const providerSelect = this.elements.provider;
    providerSelect.innerHTML = '';

    ModelConfig.getProviderIds().forEach(providerId => {
      const provider = ModelConfig.getProvider(providerId);
      const option = document.createElement('option');
      option.value = providerId;
      option.textContent = provider.name;
      providerSelect.appendChild(option);
    });
  }

  populateModelOptions(providerId) {
    const modelSelect = this.elements.model;
    modelSelect.innerHTML = '';

    const models = ModelConfig.getModelsForProvider(providerId);
    models.forEach(modelId => {
      const option = document.createElement('option');
      option.value = modelId;
      option.textContent = ModelConfig.getModelDescription(providerId, modelId);
      modelSelect.appendChild(option);
    });

    // Always add custom option at the end
    const customOption = document.createElement('option');
    customOption.value = 'custom';
    customOption.textContent = 'Custom Model...';
    modelSelect.appendChild(customOption);
  }

  async loadSettings() {
    try {
      const settings = await chrome.storage.local.get(Object.keys(this.defaultSettings));
      const migrated = ModelConfig.migrateSettings({ ...this.defaultSettings, ...settings });

      this.elements.provider.value = migrated.provider;
      this.elements.apiKey.value = migrated.apiKey;
      this.elements.apiEndpoint.value = migrated.apiEndpoint;
      this.elements.customModel.value = migrated.customModel;
      this.elements.targetLanguage.value = migrated.targetLanguage;
      this.elements.reasoningEffort.value = migrated.reasoningEffort || 'medium';

      // Populate models for the selected provider
      this.populateModelOptions(migrated.provider);

      // Handle model selection
      if (ModelConfig.isPredefinedModel(migrated.provider, migrated.model)) {
        this.elements.model.value = migrated.model;
      } else if (migrated.model && migrated.model !== '') {
        this.elements.model.value = 'custom';
        this.elements.customModel.value = migrated.model;
      }

      this.updateProviderSection();
      this.updateModelSection();
    } catch (error) {
      this.showStatus('Error loading settings', 'error');
      console.error('Settings load error:', error);
    }
  }

  bindEvents() {
    // Provider change — swap model list and toggle endpoint visibility
    this.elements.provider.addEventListener('change', () => {
      const providerId = this.elements.provider.value;
      const provider = ModelConfig.getProvider(providerId);

      this.populateModelOptions(providerId);

      // Set the provider's default model
      if (provider.defaultModel) {
        this.elements.model.value = provider.defaultModel;
      } else {
        this.elements.model.value = 'custom';
      }

      this.updateProviderSection();
      this.updateModelSection();
    });

    // Model selection change
    this.elements.model.addEventListener('change', () => {
      this.updateModelSection();
    });

    // API key visibility toggle
    this.elements.toggleApiKey.addEventListener('click', () => {
      const input = this.elements.apiKey;
      const icon = this.elements.toggleApiKey.querySelector('.toggle-icon');
      if (input.type === 'password') {
        input.type = 'text';
        icon.textContent = '\u25CE';
        this.elements.toggleApiKey.title = 'Hide API key';
      } else {
        input.type = 'password';
        icon.textContent = '\u25C9';
        this.elements.toggleApiKey.title = 'Show API key';
      }
    });

    // Button events
    this.elements.saveSettings.addEventListener('click', () => this.saveSettings());
    this.elements.testConnection.addEventListener('click', () => this.testConnection());
    this.elements.resetSettings.addEventListener('click', () => this.resetSettings());

    // Auto-save on input changes (with debouncing)
    let saveTimeout;
    const autoSaveElements = [
      this.elements.provider,
      this.elements.apiKey,
      this.elements.apiEndpoint,
      this.elements.customModel,
      this.elements.targetLanguage,
      this.elements.reasoningEffort,
    ];

    autoSaveElements.forEach(element => {
      const eventType = element.tagName === 'SELECT' ? 'change' : 'input';
      element.addEventListener(eventType, () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => this.saveSettings(true), 1000);
      });
    });
  }

  updateProviderSection() {
    const providerId = this.elements.provider.value;
    const isCustom = providerId === 'custom';
    this.elements.customEndpointSection.style.display = isCustom ? 'block' : 'none';
  }

  updateModelSection() {
    if (this.elements.model.value === 'custom') {
      this.elements.customModelSection.style.display = 'block';
      this.elements.customModel.focus();
    } else {
      this.elements.customModelSection.style.display = 'none';
    }
  }

  getResolvedEndpoint() {
    const providerId = this.elements.provider.value;
    return ModelConfig.resolveEndpoint(providerId, this.elements.apiEndpoint.value.trim());
  }

  getResolvedModel() {
    return this.elements.model.value === 'custom'
      ? this.elements.customModel.value.trim()
      : this.elements.model.value;
  }

  async saveSettings(silent = false) {
    try {
      const actualModel = this.getResolvedModel();
      const providerId = this.elements.provider.value;

      if (this.elements.model.value === 'custom' && !actualModel) {
        this.showStatus('Please enter a custom model ID', 'error');
        return;
      }

      if (providerId === 'custom' && !this.elements.apiEndpoint.value.trim()) {
        if (!silent) {
          this.showStatus('Please enter an API endpoint', 'error');
        }
        return;
      }

      const settings = {
        provider: providerId,
        apiKey: this.elements.apiKey.value.trim(),
        apiEndpoint: this.getResolvedEndpoint(),
        model: actualModel,
        customModel: this.elements.customModel.value.trim(),
        targetLanguage: this.elements.targetLanguage.value,
        reasoningEffort: this.elements.reasoningEffort.value,
      };

      await chrome.storage.local.set(settings);

      if (!silent) {
        this.showStatus('Settings saved successfully', 'success');
      }
    } catch (error) {
      this.showStatus('Error saving settings', 'error');
      console.error('Settings save error:', error);
    }
  }

  async testConnection() {
    const apiKey = this.elements.apiKey.value.trim();
    const apiEndpoint = this.getResolvedEndpoint();
    const actualModel = this.getResolvedModel();

    if (!apiKey) {
      this.showStatus('Please enter your API key first', 'error');
      return;
    }

    if (!actualModel) {
      this.showStatus('Please select or enter a model', 'error');
      return;
    }

    if (!apiEndpoint) {
      this.showStatus('Please enter an API endpoint', 'error');
      return;
    }

    try {
      this.elements.testConnection.disabled = true;
      this.elements.testConnection.textContent = 'Testing...';
      this.showStatus('Testing API connection...', 'loading');

      // Use centralized API client for connection test
      const result = await APIClient.testConnection(
        {
          apiKey: apiKey,
          apiEndpoint: apiEndpoint,
          model: actualModel,
        },
        {
          reasoningEffort: this.elements.reasoningEffort.value,
        }
      );

      if (result.success) {
        this.showStatus(`Connection successful — model responded: "${result.response}"`, 'success');
      } else {
        let errorMessage = result.error;
        if (result.errorStatus) {
          errorMessage = `API Error (${result.errorStatus}): ${result.apiMessage || result.error}`;
        }
        if (result.retryAfter) {
          errorMessage += ` (Retry after: ${result.retryAfter}s)`;
        }
        this.showStatus(`Connection failed: ${errorMessage}`, 'error');
      }
    } catch (error) {
      this.showStatus(`Connection failed: ${error.message}`, 'error');
    } finally {
      this.elements.testConnection.disabled = false;
      this.elements.testConnection.textContent = 'Test Connection';
    }
  }

  async resetSettings() {
    if (
      !confirm('Are you sure you want to reset all settings to defaults? This cannot be undone.')
    ) {
      return;
    }

    try {
      // Clear all stored settings
      await chrome.storage.local.clear();

      // Reset provider and repopulate models
      this.elements.provider.value = this.defaultSettings.provider;
      this.populateModelOptions(this.defaultSettings.provider);

      // Reset form to defaults
      this.elements.apiKey.value = this.defaultSettings.apiKey;
      this.elements.apiEndpoint.value = this.defaultSettings.apiEndpoint;
      this.elements.customModel.value = this.defaultSettings.customModel;
      this.elements.targetLanguage.value = this.defaultSettings.targetLanguage;
      this.elements.reasoningEffort.value = this.defaultSettings.reasoningEffort;
      this.elements.model.value = this.defaultSettings.model;

      this.updateProviderSection();
      this.updateModelSection();

      this.showStatus('Settings reset to defaults', 'info');
    } catch (error) {
      this.showStatus('Error resetting settings', 'error');
      console.error('Settings reset error:', error);
    }
  }

  showStatus(message, type = 'info') {
    this.elements.status.textContent = message;
    this.elements.status.className = `status show ${type}`;

    setTimeout(() => {
      this.elements.status.classList.remove('show');
    }, 8000);
  }
}

// Initialize settings controller when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new SettingsController();
});
