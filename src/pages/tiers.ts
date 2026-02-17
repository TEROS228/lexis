import { auth, onAuthStateChanged, getCachedAuthState, cacheAuthState } from '../services/firebase';
import { getUserNativeLanguage, getProgress, initUserProfile } from '../db';
import { setAvatar } from '../utils/avatar';
import { initI18n, setLanguage, getCurrentLanguage, updatePageTranslations } from '../i18n';
let currentUser = null;
let currentLang = getCurrentLanguage();

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

// Elements
const userProfile = document.getElementById('userProfile');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const signOutBtn = document.getElementById('signOutBtn');
const userInfoTrigger = document.getElementById('userInfoTrigger');
const userDropdown = document.getElementById('userDropdown');

// Language selector (reuse from main page)
const languageBtn = document.getElementById('languageBtn');
const languageDropdown = document.getElementById('languageDropdown');
const languageOptions = document.querySelectorAll('.language-option');

const languages = {
    ru: { flag: '🇷🇺', code: 'RU' },
    en: { flag: '🇬🇧', code: 'EN' },
    zh: { flag: '🇨🇳', code: 'ZH' }
};

// Initialize language
const savedLang = localStorage.getItem('preferred-language');
if (savedLang && languages[savedLang]) {
    const flagSpan = languageBtn.querySelector('.flag');
    const langText = languageBtn.querySelector('.lang-text');
    flagSpan.textContent = languages[savedLang].flag;
    langText.textContent = languages[savedLang].code;
    currentLang = savedLang;
}

// Language selector events
languageBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    languageBtn.classList.toggle('active');
    languageDropdown.classList.toggle('active');
});

document.addEventListener('click', () => {
    languageBtn.classList.remove('active');
    languageDropdown.classList.remove('active');
});

languageOptions.forEach(option => {
    option.addEventListener('click', (e) => {
        e.stopPropagation();
        const lang = option.dataset.lang;
        currentLang = lang;

        const flagSpan = languageBtn.querySelector('.flag');
        const langText = languageBtn.querySelector('.lang-text');
        flagSpan.textContent = languages[lang].flag;
        langText.textContent = languages[lang].code;

        languageOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');

        languageBtn.classList.remove('active');
        languageDropdown.classList.remove('active');

        setLanguage(lang);
    });
});

// Initialize translations
initI18n();

// Dropdown toggle
userInfoTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    userInfoTrigger.classList.toggle('active');
    userDropdown.classList.toggle('active');
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!userProfile?.contains(e.target)) {
        userInfoTrigger?.classList.remove('active');
        userDropdown?.classList.remove('active');
    }
});

// Show cached user immediately
const cachedAuth = getCachedAuthState();
if (cachedAuth) {
    userProfile.style.display = 'flex';
    setAvatar(userAvatar as HTMLImageElement, cachedAuth.photoURL, cachedAuth.displayName || cachedAuth.email, 36);
    userName.textContent = cachedAuth.displayName || cachedAuth.email;
}

// Auth
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        cacheAuthState(user);
        userProfile.style.display = 'flex';
        setAvatar(userAvatar as HTMLImageElement, user.photoURL, user.displayName || user.email, 36);
        userName.textContent = user.displayName || user.email;

        // Ensure user exists in PostgreSQL
        try {
            await initUserProfile(user);
        } catch (error) {
            console.error('Error initializing user profile:', error);
        }

        // Get user's native language and set it automatically
        const nativeLang = await getUserNativeLanguage(user.uid);
        if (nativeLang) {
            currentLang = nativeLang;
            setLanguage(nativeLang);
            updatePageTranslations();

            // Update language selector UI
            const flagSpan = languageBtn.querySelector('.flag');
            const langText = languageBtn.querySelector('.lang-text');
            flagSpan.textContent = languages[nativeLang].flag;
            langText.textContent = languages[nativeLang].code;

            // Update selected option
            languageOptions.forEach(opt => {
                if (opt.dataset.lang === nativeLang) {
                    opt.classList.add('selected');
                } else {
                    opt.classList.remove('selected');
                }
            });
        }

        // Load progress
        await loadProgress();
        hideLoading();
    } else {
        cacheAuthState(null);
        alert('Пожалуйста, войдите в систему');
        window.location.href = '/';
    }
});

signOutBtn.addEventListener('click', async () => {
    try {
        await auth.signOut();
        window.location.href = '/';
    } catch (error) {
        console.error('Sign out error:', error);
    }
});

// Load progress
async function loadProgress() {
    try {
        const data = await getProgress(currentUser.uid, 'tier2');
        const words = data.words || {};

        let knownCount = 0;
        let unsureCount = 0;
        let unknownCount = 0;

        Object.values(words).forEach(status => {
            if (status === 'known') knownCount++;
            else if (status === 'unsure') unsureCount++;
            else if (status === 'unknown') unknownCount++;
        });

        // Update stats
        document.getElementById('knownTotal').textContent = knownCount;
        document.getElementById('unsureTotal').textContent = unsureCount;
        document.getElementById('unknownTotal').textContent = unknownCount;

        // Show tier 2 progress
        const totalWords = Object.keys(words).length;
        if (totalWords > 0) {
            const tier2Progress = document.getElementById('tier2Progress');
            const tier2ProgressBar = document.getElementById('tier2ProgressBar');
            const tier2Percentage = document.getElementById('tier2Percentage');

            tier2Progress.style.display = 'block';
            const percentage = Math.round((totalWords / 311) * 100);
            tier2Percentage.textContent = `${percentage}%`;
            tier2ProgressBar.style.width = `${percentage}%`;
        }
    } catch (error) {
        console.error('Error loading progress:', error);
    }
}

// Start learning
document.querySelectorAll('.btn-tier').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const tier = e.target.dataset.tier;
        if (tier === '2') {
            window.location.href = '/learn?tier=2';
        }
    });
});
