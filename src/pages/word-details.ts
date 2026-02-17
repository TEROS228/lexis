import { auth, onAuthStateChanged, getCachedAuthState } from '../services/firebase';
import { getUserNativeLanguage } from '../db';
import tier2Words from '../data/words-tier2-full';
import wordDetails from '../data/word-details-data';
import { t, updatePageTranslations, setLanguage, getCurrentLanguage } from '../i18n';

console.log('=== word-details.js LOADED ===');

let currentUser = null;
let currentLang = getCurrentLanguage();
let wordId = null;

// Loading overlay
const loadingOverlay = document.getElementById('loadingOverlay');

function hideLoading() {
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
    }
}

function showLoading() {
    if (loadingOverlay) {
        loadingOverlay.style.display = 'flex';
    }
}

// Get word ID from URL
const urlParams = new URLSearchParams(window.location.search);
wordId = urlParams.get('word');

console.log('Current URL:', window.location.href);
console.log('URL params:', window.location.search);
console.log('Word ID:', wordId);

// Back button
const backBtn = document.getElementById('backBtn');
if (backBtn) {
    backBtn.addEventListener('click', () => {
        window.history.back();
    });
}

// Update translations
function updateTranslations() {
    updatePageTranslations();
}

// Display word details
function displayWordDetails() {
    // Check if word ID exists
    if (!wordId) {
        alert('Слово не указано');
        window.location.href = '/word-list';
        return;
    }

    const word = tier2Words.find(w => w.id === wordId);
    if (!word) {
        alert('Слово не найдено');
        window.location.href = '/word-list';
        return;
    }

    const details = wordDetails[wordId];

    // Update page title
    const wordTitle = document.getElementById('wordTitle');
    const wordEn = document.getElementById('wordEn');
    const wordTranslation = document.getElementById('wordTranslation');
    const meaningContent = document.getElementById('meaningContent');
    const contextContent = document.getElementById('contextContent');
    const exampleContent = document.getElementById('exampleContent');

    if (wordTitle) wordTitle.textContent = word.en;
    document.title = `${word.en} - English Study`;

    // Update word header
    if (wordEn) wordEn.textContent = word.en;
    if (wordTranslation) wordTranslation.textContent = word[currentLang] || word.ru;

    // If word details exist, show them
    if (details && details[currentLang]) {
        const langDetails = details[currentLang];
        if (meaningContent) meaningContent.textContent = langDetails.meaning;
        if (contextContent) contextContent.textContent = langDetails.context;
        if (exampleContent) {
            const exampleText = exampleContent.querySelector('.example-text');
            if (exampleText) exampleText.textContent = langDetails.example;
        }
    } else {
        // Fallback if details don't exist yet
        if (meaningContent) meaningContent.textContent = 'Детали для этого слова скоро будут добавлены.';
        if (contextContent) contextContent.textContent = '-';
        if (exampleContent) {
            const exampleText = exampleContent.querySelector('.example-text');
            if (exampleText) exampleText.textContent = '-';
        }
    }
}

// Timeout fallback - if auth doesn't fire in 500ms, use cache
let authFired = false;
setTimeout(() => {
    if (!authFired) {
        console.log('=== Using cached auth (Firebase auth slow) ===');
        const cached = getCachedAuthState();
        if (cached && cached.uid) {
            console.log('Using cached user:', cached.uid);
            currentUser = { uid: cached.uid, email: cached.email, displayName: cached.displayName, photoURL: cached.photoURL };

            // Get user's native language
            getUserNativeLanguage(cached.uid).then(nativeLang => {
                if (nativeLang) {
                    currentLang = nativeLang;
                    setLanguage(nativeLang);
                }
                updateTranslations();
                displayWordDetails();
                hideLoading();
            }).catch(error => {
                console.error('Error getting native language:', error);
                updateTranslations();
                displayWordDetails();
                hideLoading();
            });
        } else {
            alert('Ошибка авторизации. Пожалуйста, войдите заново.');
            window.location.href = '/';
        }
    }
}, 500);

// Auth
onAuthStateChanged(auth, async (user) => {
    authFired = true;
    console.log('=== onAuthStateChanged fired in word-details ===');
    try {
        if (user) {
            currentUser = user;

            // Get user's native language
            try {
                const nativeLang = await getUserNativeLanguage(user.uid);
                if (nativeLang) {
                    currentLang = nativeLang;
                    setLanguage(nativeLang);
                }
            } catch (error) {
                console.error('Error getting native language:', error);
                // Continue with default language
            }

            // Update translations
            updateTranslations();

            // Display word details
            displayWordDetails();

            hideLoading();
        } else {
            hideLoading();
            alert('Пожалуйста, войдите в систему');
            window.location.href = '/';
        }
    } catch (error) {
        console.error('Auth error:', error);
        hideLoading();
        alert('Произошла ошибка. Попробуйте перезагрузить страницу.');
    }
});
