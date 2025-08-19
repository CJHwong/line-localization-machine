import ModelConfig from '../shared/models.js';
import APIClient from '../shared/api-client.js';

// Settings now use chrome.storage directly (standardized across browsers)

class SettingsController {
  constructor() {
    this.elements = {
      apiKey: document.getElementById('apiKey'),
      apiEndpoint: document.getElementById('apiEndpoint'),
      model: document.getElementById('model'),
      customModel: document.getElementById('customModel'),
      customModelSection: document.getElementById('customModelSection'),
      targetLanguage: document.getElementById('targetLanguage'),
      animationSpeed: document.getElementById('animationSpeed'),
      showProgress: document.getElementById('showProgress'),
      playSound: document.getElementById('playSound'),
      maxBlockSize: document.getElementById('maxBlockSize'),
      temperature: document.getElementById('temperature'),
      blocksPerRequest: document.getElementById('blocksPerRequest'),
      testConnection: document.getElementById('testConnection'),
      saveSettings: document.getElementById('saveSettings'),
      resetSettings: document.getElementById('resetSettings'),
      status: document.getElementById('status'),
    };

    this.defaultSettings = ModelConfig.getDefaultSettings();

    this.init();
  }

  async init() {
    this.populateModelOptions();
    await this.loadSettings();
    this.bindEvents();
    this.updateModelSection();
  }

  populateModelOptions() {
    const modelSelect = this.elements.model;

    // Clear existing options except custom
    const customOption = modelSelect.querySelector('option[value="custom"]');
    modelSelect.innerHTML = '';

    // Add predefined models
    ModelConfig.PREDEFINED_MODELS.forEach(modelId => {
      const option = document.createElement('option');
      option.value = modelId;
      option.textContent = ModelConfig.getModelDescription(modelId);
      modelSelect.appendChild(option);
    });

    // Add custom option at the end
    modelSelect.appendChild(customOption);
  }

  async loadSettings() {
    try {
      const settings = await chrome.storage.local.get(Object.keys(this.defaultSettings));

      // Merge with defaults
      const mergedSettings = { ...this.defaultSettings, ...settings };

      // Apply settings to form elements
      this.elements.apiKey.value = mergedSettings.apiKey;
      this.elements.apiEndpoint.value = mergedSettings.apiEndpoint;
      this.elements.customModel.value = mergedSettings.customModel;
      this.elements.targetLanguage.value = mergedSettings.targetLanguage;
      this.elements.animationSpeed.value = mergedSettings.animationSpeed;
      this.elements.showProgress.checked = mergedSettings.showProgress;
      this.elements.playSound.checked = mergedSettings.playSound;
      this.elements.maxBlockSize.value = mergedSettings.maxBlockSize.toString();
      // Handle temperature conversion to match select option values exactly
      const tempValue = parseFloat(mergedSettings.temperature);
      if (tempValue === 0.1) {
        this.elements.temperature.value = '0.1';
      } else if (tempValue === 0.3) {
        this.elements.temperature.value = '0.3';
      } else if (tempValue === 0.5) {
        this.elements.temperature.value = '0.5';
      } else if (tempValue === 0.85) {
        this.elements.temperature.value = '0.85';
      } else if (tempValue === 1.0 || tempValue === 1) {
        this.elements.temperature.value = '1.0';
      } else {
        this.elements.temperature.value = tempValue.toString();
      }
      this.elements.blocksPerRequest.value = mergedSettings.blocksPerRequest.toString();

      // Handle model selection
      if (ModelConfig.isPredefinedModel(mergedSettings.model)) {
        this.elements.model.value = mergedSettings.model;
      } else {
        this.elements.model.value = 'custom';
        this.elements.customModel.value = mergedSettings.model;
      }

      this.updateModelSection();
    } catch (error) {
      this.showStatus('Error loading settings', 'error');
      console.error('Settings load error:', error);
    }
  }

  bindEvents() {
    // Model selection change
    this.elements.model.addEventListener('change', () => {
      this.updateModelSection();
    });

    // Button events
    this.elements.saveSettings.addEventListener('click', () => this.saveSettings());
    this.elements.testConnection.addEventListener('click', () => this.testConnection());
    this.elements.resetSettings.addEventListener('click', () => this.resetSettings());

    // Auto-save on input changes (with debouncing)
    let saveTimeout;
    const autoSaveElements = [
      this.elements.apiKey,
      this.elements.apiEndpoint,
      this.elements.customModel,
      this.elements.targetLanguage,
      this.elements.animationSpeed,
      this.elements.showProgress,
      this.elements.playSound,
      this.elements.maxBlockSize,
      this.elements.temperature,
      this.elements.blocksPerRequest,
    ];

    autoSaveElements.forEach(element => {
      const eventType = element.type === 'checkbox' ? 'change' : 'input';
      element.addEventListener(eventType, () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => this.saveSettings(true), 1000);
      });
    });
  }

  updateModelSection() {
    if (this.elements.model.value === 'custom') {
      this.elements.customModelSection.style.display = 'block';
      this.elements.customModel.focus();
    } else {
      this.elements.customModelSection.style.display = 'none';
    }
  }

  async saveSettings(silent = false) {
    try {
      const actualModel =
        this.elements.model.value === 'custom'
          ? this.elements.customModel.value.trim()
          : this.elements.model.value;

      if (this.elements.model.value === 'custom' && !actualModel) {
        this.showStatus('Please enter a custom model ID', 'error');
        return;
      }

      const settings = {
        apiKey: this.elements.apiKey.value.trim(),
        apiEndpoint: this.elements.apiEndpoint.value.trim() || this.defaultSettings.apiEndpoint,
        model: actualModel,
        customModel: this.elements.customModel.value.trim(),
        targetLanguage: this.elements.targetLanguage.value,
        animationSpeed: this.elements.animationSpeed.value,
        showProgress: this.elements.showProgress.checked,
        playSound: this.elements.playSound.checked,
        maxBlockSize: parseInt(this.elements.maxBlockSize.value),
        temperature: parseFloat(this.elements.temperature.value),
        blocksPerRequest: parseInt(this.elements.blocksPerRequest.value),
      };

      await chrome.storage.local.set(settings);

      if (!silent) {
        this.showStatus('✅ Settings saved successfully!', 'success');
      }
    } catch (error) {
      this.showStatus('Error saving settings', 'error');
      console.error('Settings save error:', error);
    }
  }

  async testConnection() {
    const apiKey = this.elements.apiKey.value.trim();
    const apiEndpoint = this.elements.apiEndpoint.value.trim();
    const actualModel =
      this.elements.model.value === 'custom'
        ? this.elements.customModel.value.trim()
        : this.elements.model.value;

    if (!apiKey) {
      this.showStatus('Please enter your API key first', 'error');
      return;
    }

    if (!actualModel) {
      this.showStatus('Please select or enter a model', 'error');
      return;
    }

    try {
      this.elements.testConnection.disabled = true;
      this.elements.testConnection.textContent = '🔄 Testing...';
      this.showStatus('Testing API connection...', 'loading');

      // Use centralized API client for connection test
      const result = await APIClient.testConnection({
        apiKey: apiKey,
        apiEndpoint: apiEndpoint,
        model: actualModel,
      });

      if (result.success) {
        this.showStatus(
          `✅ Connection successful! Model responded: "${result.response}"`,
          'success'
        );
      } else {
        let errorMessage = result.error;
        if (result.errorStatus) {
          errorMessage = `API Error (${result.errorStatus}): ${result.apiMessage || result.error}`;
        }
        if (result.retryAfter) {
          errorMessage += ` (Retry after: ${result.retryAfter}s)`;
        }
        this.showStatus(`❌ Connection failed: ${errorMessage}`, 'error');
      }
    } catch (error) {
      this.showStatus(`❌ Connection failed: ${error.message}`, 'error');
    } finally {
      this.elements.testConnection.disabled = false;
      this.elements.testConnection.textContent = '🔍 Test Connection';
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

      // Reset form to defaults
      Object.entries(this.defaultSettings).forEach(([key, value]) => {
        const element = this.elements[key];
        if (element) {
          if (element.type === 'checkbox') {
            element.checked = value;
          } else {
            element.value = value;
          }
        }
      });

      this.elements.model.value = this.defaultSettings.model;
      this.updateModelSection();

      this.showStatus('🔄 Settings reset to defaults', 'info');
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
