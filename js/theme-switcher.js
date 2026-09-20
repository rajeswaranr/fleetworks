/**
 * FleetWorks Theme Switcher
 * Manages application-wide theme selection
 * Saves preference to localStorage
 */

class ThemeSwitcher {
  constructor() {
    this.storageKey = 'fleetworks-theme';
    this.defaultTheme = 'dark-minimal';
    this.themes = [
      { id: 'dark-minimal', name: 'Dark Minimal', category: 'Default' },
      { id: 'light-minimal', name: 'Light Minimal', category: 'Default' },
      { id: 'material-3-dark', name: 'Material Design 3 (Dark)', category: 'Open Source' },
      { id: 'material-3-light', name: 'Material Design 3 (Light)', category: 'Open Source' },
      { id: 'dracula', name: 'Dracula', category: 'Open Source' },
      { id: 'nord', name: 'Nord', category: 'Open Source' },
      { id: 'one-dark', name: 'One Dark', category: 'Open Source' },
      { id: 'solarized-dark', name: 'Solarized Dark', category: 'Open Source' },
      { id: 'gruvbox-dark', name: 'Gruvbox Dark', category: 'Open Source' },
      { id: 'monokai', name: 'Monokai', category: 'Open Source' },
      { id: 'high-contrast-light', name: 'High Contrast Light', category: 'Accessibility' }
    ];
  }

  /**
   * Initialize theme system
   * Load saved theme or use default
   */
  init() {
    const savedTheme = this.getSavedTheme();
    this.setTheme(savedTheme);
    this.attachListeners();
  }

  /**
   * Get saved theme from localStorage
   */
  getSavedTheme() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved && this.themes.some(t => t.id === saved)) {
        return saved;
      }
    } catch (e) {
      console.warn('localStorage unavailable:', e);
    }
    return this.defaultTheme;
  }

  /**
   * Set current theme
   */
  setTheme(themeId) {
    const theme = this.themes.find(t => t.id === themeId);
    if (!theme) {
      console.warn(`Theme not found: ${themeId}, using default`);
      themeId = this.defaultTheme;
    }

    // Apply theme to HTML element
    document.documentElement.setAttribute('data-theme', themeId);

    // Save preference
    try {
      localStorage.setItem(this.storageKey, themeId);
    } catch (e) {
      console.warn('Failed to save theme preference:', e);
    }

    // Trigger change event
    this.dispatchThemeChange(themeId);
  }

  /**
   * Get current theme
   */
  getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') || this.defaultTheme;
  }

  /**
   * Get all available themes
   */
  getThemes() {
    return this.themes;
  }

  /**
   * Get themes grouped by category
   */
  getThemesByCategory() {
    const grouped = {};
    this.themes.forEach(theme => {
      if (!grouped[theme.category]) {
        grouped[theme.category] = [];
      }
      grouped[theme.category].push(theme);
    });
    return grouped;
  }

  /**
   * Attach event listeners to theme switcher elements
   */
  attachListeners() {
    // Radio button switchers
    document.querySelectorAll('input[name="theme"]').forEach(input => {
      input.addEventListener('change', (e) => {
        this.setTheme(e.target.value);
      });
    });

    // Select dropdown switcher
    const selectElement = document.querySelector('select[name="theme-select"]');
    if (selectElement) {
      selectElement.addEventListener('change', (e) => {
        this.setTheme(e.target.value);
      });
    }

    // Update checked state
    const currentTheme = this.getCurrentTheme();
    document.querySelectorAll(`input[name="theme"][value="${currentTheme}"]`).forEach(input => {
      input.checked = true;
    });
    if (selectElement) {
      selectElement.value = currentTheme;
    }
  }

  /**
   * Dispatch custom event when theme changes
   */
  dispatchThemeChange(themeId) {
    const event = new CustomEvent('themechange', {
      detail: { theme: themeId }
    });
    document.dispatchEvent(event);
  }

  /**
   * Create theme selector UI element
   */
  createThemeSelector() {
    const container = document.createElement('div');
    container.className = 'theme-selector';

    const label = document.createElement('label');
    label.className = 'theme-selector-label';
    label.textContent = 'Choose Theme';
    container.appendChild(label);

    const grouped = this.getThemesByCategory();

    Object.entries(grouped).forEach(([category, themes]) => {
      const categoryLabel = document.createElement('div');
      categoryLabel.style.width = '100%';
      categoryLabel.style.fontSize = 'var(--text-xs)';
      categoryLabel.style.fontWeight = 'var(--fw-semibold)';
      categoryLabel.style.color = 'var(--muted-light)';
      categoryLabel.style.textTransform = 'uppercase';
      categoryLabel.style.marginTop = 'var(--space-md)';
      categoryLabel.style.marginBottom = 'var(--space-sm)';
      categoryLabel.textContent = category;
      container.appendChild(categoryLabel);

      themes.forEach(theme => {
        const option = document.createElement('label');
        option.className = 'theme-option';
        if (this.getCurrentTheme() === theme.id) {
          option.classList.add('active');
        }

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'theme';
        radio.value = theme.id;
        radio.checked = this.getCurrentTheme() === theme.id;

        const preview = document.createElement('div');
        preview.className = 'theme-preview';

        const name = document.createElement('span');
        name.className = 'theme-name';
        name.textContent = theme.name;

        option.appendChild(radio);
        option.appendChild(preview);
        option.appendChild(name);

        // Add click listener to parent label
        option.addEventListener('click', () => {
          this.setTheme(theme.id);
        });

        container.appendChild(option);
      });
    });

    return container;
  }

  /**
   * Create settings section with theme selector
   */
  createSettingsSection() {
    const section = document.createElement('div');
    section.className = 'settings-theme-section';

    const title = document.createElement('h3');
    title.className = 'settings-theme-title';
    title.textContent = '🎨 Theme';
    section.appendChild(title);

    const description = document.createElement('p');
    description.className = 'settings-theme-description';
    description.textContent = 'Choose your favorite color theme. Changes apply instantly across the entire app.';
    section.appendChild(description);

    const grid = document.createElement('div');
    grid.className = 'theme-options-grid';

    this.themes.forEach(theme => {
      const card = document.createElement('label');
      card.className = 'theme-option';
      if (this.getCurrentTheme() === theme.id) {
        card.classList.add('active');
      }
      card.style.cursor = 'pointer';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'theme';
      radio.value = theme.id;
      radio.checked = this.getCurrentTheme() === theme.id;

      const preview = document.createElement('div');
      preview.className = 'theme-preview';

      const name = document.createElement('span');
      name.className = 'theme-name';
      name.textContent = theme.name;

      card.appendChild(radio);
      card.appendChild(preview);
      card.appendChild(name);

      // Handle selection
      card.addEventListener('click', (e) => {
        if (e.target !== radio) {
          radio.checked = true;
        }
        this.setTheme(theme.id);

        // Update UI
        document.querySelectorAll('.theme-option').forEach(opt => {
          opt.classList.remove('active');
        });
        card.classList.add('active');
      });

      grid.appendChild(card);
    });

    section.appendChild(grid);
    return section;
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.themeSwitcher = new ThemeSwitcher();
    window.themeSwitcher.init();
  });
} else {
  window.themeSwitcher = new ThemeSwitcher();
  window.themeSwitcher.init();
}
