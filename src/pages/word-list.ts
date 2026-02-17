import { auth, onAuthStateChanged, logOut, getCachedAuthState, cacheAuthState } from '../services/firebase';
import { getUserNativeLanguage, getProgress, initUserProfile, saveWordProgress, getLearnedWords } from '../db';
import { setAvatar } from '../utils/avatar';
import tier2Words from '../data/words-tier2-full';
import quizData from '../data/quiz-data';
import { t, updatePageTranslations, setLanguage, getCurrentLanguage } from '../i18n';

console.log('=== word-list.js LOADED ===');
console.log('tier2Words loaded:', tier2Words?.length);

let currentUser = null;
let currentLang = getCurrentLanguage();
let currentStatus = 'known'; // Default filter
let allProgress = {};
let learnedWordsData = [];

console.log('Initial currentStatus:', currentStatus);

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

// Update page translations
function updateTranslations() {
    updatePageTranslations();

    // Update page title based on status
    const titles = {
        known: t('wordList.pageTitles.known'),
        learned: t('wordList.pageTitles.learned'),
        unsure: t('wordList.pageTitles.unsure'),
        unknown: t('wordList.pageTitles.unknown')
    };
    pageTitle.textContent = titles[currentStatus];
}

// Elements
const userProfile = document.getElementById('userProfile');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const signOutBtn = document.getElementById('signOutBtn');
const userInfoTrigger = document.getElementById('userInfoTrigger');
const userDropdown = document.getElementById('userDropdown');
const wordsGrid = document.getElementById('wordsGrid');
const emptyState = document.getElementById('emptyState');
const filterTabs = document.querySelectorAll('.filter-tab');
const pageTitle = document.getElementById('pageTitle');
const startQuizBtn = document.getElementById('startQuizBtn');

// Language selector
const languageBtn = document.getElementById('languageBtn');
const languageDropdown = document.getElementById('languageDropdown');
const languageOptions = document.querySelectorAll('.language-option');

const languages = {
    ru: { flag: '🇷🇺', code: 'RU' },
    en: { flag: '🇬🇧', code: 'EN' },
    zh: { flag: '🇨🇳', code: 'ZH' }
};

// Get status from URL
const urlParams = new URLSearchParams(window.location.search);
const statusParam = urlParams.get('status');
console.log('URL status param:', statusParam);
if (statusParam && ['known', 'learned', 'unsure', 'unknown'].includes(statusParam)) {
    currentStatus = statusParam;
    console.log('currentStatus updated from URL to:', currentStatus);
}

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

        // Update translations
        updateTranslations();

        // Refresh words with new language
        displayWords();
    });
});

// Initialize translations on page load
updateTranslations();

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

// Timeout fallback - if auth doesn't fire in 500ms, use cache
let authFired = false;
setTimeout(() => {
    if (!authFired) {
        console.log('=== Using cached auth (Firebase auth slow) ===');
        const cached = getCachedAuthState();
        if (cached && cached.uid) {
            console.log('Using cached user:', cached.uid);
            currentUser = { uid: cached.uid, email: cached.email, displayName: cached.displayName, photoURL: cached.photoURL };
            loadProgress().then(() => {
                displayWords();
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
    console.log('=== onAuthStateChanged fired ===');
    console.log('user:', user ? user.uid : 'null');
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

            // Update translations with native language
            updateTranslations();
        }

        await loadProgress();
        displayWords();
        hideLoading();
    } else {
        cacheAuthState(null);
        alert('Пожалуйста, войдите в систему');
        window.location.href = '/';
    }
});

signOutBtn.addEventListener('click', async () => {
    try {
        await logOut();
        window.location.href = '/';
    } catch (error) {
        console.error('Sign out error:', error);
    }
});

// Load progress
async function loadProgress() {
    console.log('=== loadProgress called ===');
    console.log('currentUser.uid:', currentUser.uid);
    try {
        console.log('Fetching progress from API...');
        const data = await getProgress(currentUser.uid, 'tier2');
        console.log('Progress data received:', data);
        allProgress = data.words || {};
        console.log('allProgress keys count:', Object.keys(allProgress).length);

        // Load learned words
        console.log('Fetching learned words from API...');
        const learnedData = await getLearnedWords(currentUser.uid, 'tier2');
        console.log('Learned data received:', learnedData);
        learnedWordsData = learnedData.words || [];
        console.log('learnedWordsData count:', learnedWordsData.length);

        updateCounts();
    } catch (error) {
        console.error('Error loading progress:', error);
    }
}

// Update counts
function updateCounts() {
    let knownCount = 0;
    let unsureCount = 0;
    let unknownCount = 0;

    Object.values(allProgress).forEach(status => {
        if (status === 'known') knownCount++;
        else if (status === 'unsure') unsureCount++;
        else if (status === 'unknown') unknownCount++;
    });

    document.getElementById('knownCount').textContent = knownCount;
    document.getElementById('unsureCount').textContent = unsureCount;
    document.getElementById('unknownCount').textContent = unknownCount;
    document.getElementById('learnedCount').textContent = learnedWordsData.length;
}

// Mark word as known
async function markWordAsKnown(wordId) {
    try {
        await saveWordProgress(currentUser.uid, 'tier2', wordId, 'known');
        allProgress[wordId] = 'known';

        // Reload learned words to update the count
        const learnedData = await getLearnedWords(currentUser.uid, 'tier2');
        learnedWordsData = learnedData.words || [];

        updateCounts();
        displayWords();

        // Show success notification
        const notification = document.createElement('div');
        notification.className = 'success-notification';
        notification.textContent = '✓ Слово отмечено как выученное!';
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: var(--success);
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
        `;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }, 2000);
    } catch (error) {
        console.error('Error marking word as known:', error);
        alert('Ошибка при сохранении. Попробуйте еще раз.');
    }
}

// Display words
function displayWords() {
    console.log('=== displayWords called ===');
    console.log('currentStatus:', currentStatus);
    console.log('allProgress keys:', Object.keys(allProgress).length);
    console.log('tier2Words length:', tier2Words.length);

    wordsGrid.innerHTML = '';

    let filteredWords;
    if (currentStatus === 'learned') {
        // Show only learned words (that moved from unknown/unsure to known)
        const learnedWordIds = learnedWordsData.map(w => w.word_id);
        filteredWords = tier2Words.filter(word => learnedWordIds.includes(word.id));
        console.log('Learned mode - learnedWordIds:', learnedWordIds.length);
    } else {
        filteredWords = tier2Words.filter(word => allProgress[word.id] === currentStatus);
        console.log('Filter mode - looking for status:', currentStatus);
    }

    console.log('filteredWords length:', filteredWords.length);

    // Show/hide quiz button (only for unsure and unknown)
    if ((currentStatus === 'unsure' || currentStatus === 'unknown') && filteredWords.length > 0) {
        // Check if all words have quizzes
        const wordsWithQuiz = filteredWords.filter(word => quizData[word.id]);
        if (wordsWithQuiz.length > 0) {
            startQuizBtn.style.display = 'block';
        } else {
            startQuizBtn.style.display = 'none';
        }
    } else {
        startQuizBtn.style.display = 'none';
    }

    if (filteredWords.length === 0) {
        console.log('No words found - showing empty state');
        wordsGrid.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    console.log('Showing words grid');
    wordsGrid.style.display = 'grid';
    emptyState.style.display = 'none';

    console.log('Displaying', filteredWords.length, 'words');

    filteredWords.forEach(word => {
        const wordItem = document.createElement('div');
        wordItem.className = `word-item ${currentStatus}`;

        // Show button only for unsure and unknown words
        const showButton = currentStatus === 'unsure' || currentStatus === 'unknown';

        console.log('Creating word item for:', word.id, word.en);

        wordItem.innerHTML = `
            <div class="word-item-content">
                <div class="word-item-en">${word.en}</div>
                <div class="word-item-translation">${word[currentLang] || word.ru}</div>
            </div>
            ${showButton ? `
                <div class="word-item-actions">
                    <button class="btn-mark-known" data-word-id="${word.id}">
                        <span>✓</span>
                        <span data-i18n="wordList.markAsKnown">Выучил</span>
                    </button>
                </div>
            ` : ''}
        `;

        // Add click handler to open word details on the whole card
        wordItem.style.cursor = 'pointer';
        wordItem.addEventListener('click', (e) => {
            // Don't navigate if clicking on the button
            if (e.target.closest('.btn-mark-known')) {
                return;
            }
            console.log('Clicked on word:', word.id);
            const url = `/word-details?word=${word.id}`;
            console.log('Navigating to:', url);
            window.location.href = url;
        });

        // Add click handler for the button
        if (showButton) {
            const markKnownBtn = wordItem.querySelector('.btn-mark-known');
            markKnownBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await markWordAsKnown(word.id);
            });
        }

        wordsGrid.appendChild(wordItem);
    });

    // Update page title
    const titles = {
        known: t('wordList.pageTitles.known'),
        learned: t('wordList.pageTitles.learned'),
        unsure: t('wordList.pageTitles.unsure'),
        unknown: t('wordList.pageTitles.unknown')
    };
    pageTitle.textContent = titles[currentStatus];
}

// Filter tabs
filterTabs.forEach(tab => {
    if (tab.dataset.status === currentStatus) {
        tab.classList.add('active');
    }

    tab.addEventListener('click', () => {
        currentStatus = tab.dataset.status;
        filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        displayWords();

        // Update URL
        window.history.pushState({}, '', `?status=${currentStatus}`);
    });
});

// Start quiz button
startQuizBtn.addEventListener('click', () => {
    const filteredWords = tier2Words.filter(word => allProgress[word.id] === currentStatus);
    const wordsWithQuiz = filteredWords.filter(word => quizData[word.id]);

    if (wordsWithQuiz.length > 0) {
        // Store words to quiz in sessionStorage
        const wordIds = wordsWithQuiz.map(w => w.id);
        sessionStorage.setItem('quizWords', JSON.stringify(wordIds));
        sessionStorage.setItem('quizStatus', currentStatus);
        window.location.href = '/quiz';
    } else {
        alert('Квизы для этих слов пока не добавлены');
    }
});
