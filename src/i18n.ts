import translations from './translations.js';

let currentLang = localStorage.getItem('preferred-language') || 'ru';

// Translation function
export function t(key) {
    const keys = key.split('.');
    let value = translations[currentLang];
    for (const k of keys) {
        value = value?.[k];
    }
    return value || key;
}

// Update all elements with data-i18n attribute
export function updatePageTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const translation = t(key);

        // Check if element has placeholder attribute
        if (element.hasAttribute('placeholder')) {
            element.setAttribute('placeholder', translation);
        } else {
            element.textContent = translation;
        }
    });
}

// Set current language
export function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('preferred-language', lang);
    updatePageTranslations();
}

// Get current language
export function getCurrentLanguage() {
    return currentLang;
}

// Initialize i18n on page load
export function initI18n() {
    updatePageTranslations();
}
