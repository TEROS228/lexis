import { auth, onAuthStateChanged, logOut, getCachedAuthState, cacheAuthState } from '../services/firebase';
import { getUserNativeLanguage, getProgress, saveProgressBatch, initUserProfile, saveSession } from '../db';
import tier2Words from '../data/words-tier2-full';
import wordDetails from '../data/word-details-data';
import { quizData } from '../data/quiz-data';
import { setAvatar } from '../utils/avatar';
import { initI18n, setLanguage, getCurrentLanguage, updatePageTranslations } from '../i18n';
let currentUser = null;
let currentWordIndex = 0;
let userProgress = {};
let currentLang = getCurrentLanguage();

// Track which words have been explained (shown explanation card + quiz)
// Key: `explained_${uid}`, Value: Set of word IDs
let explainedWords: Set<string> = new Set();

function loadExplainedWords(uid: string) {
    try {
        const stored = localStorage.getItem(`explained_${uid}`);
        explainedWords = stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { explainedWords = new Set(); }
}

function markWordExplained(uid: string, wordId: string) {
    explainedWords.add(wordId);
    try {
        localStorage.setItem(`explained_${uid}`, JSON.stringify([...explainedWords]));
    } catch {}
}

// Timer
let studyStartTime = null;
let timerInterval = null;
let totalStudySeconds = 0;

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

// Language selector
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
        updatePageTranslations();

        // Refresh current word with new language
        displayCurrentWord();
    });
});

// Initialize translations
initI18n();
updatePageTranslations();

// Elements - declare early
const userProfile = document.getElementById('userProfile');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const userInfoTrigger = document.getElementById('userInfoTrigger');
const userDropdown = document.getElementById('userDropdown');
const signOutBtn = document.getElementById('signOutBtn');

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

// Stats (total from DB)
let knownCount = 0;
let unsureCount = 0;
let unknownCount = 0;

// Session stats (only words marked in this session)
let sessionKnown = 0;
let sessionUnsure = 0;
let sessionUnknown = 0;
let sessionWordsReviewed = 0;
let sessionProgress: Record<string, string> = {};

// Elements
const wordMain = document.getElementById('wordMain');
const wordMeaning = document.getElementById('wordMeaning');
const meaningText = document.getElementById('meaningText');
const showMeaningBtn = document.getElementById('showMeaning');
const btnKnow = document.getElementById('btnKnow');
const btnUnsure = document.getElementById('btnUnsure');
const btnUnknown = document.getElementById('btnUnknown');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const btnSaveExit = document.getElementById('btnSaveExit');
const progressFill = document.getElementById('progressFill');
const currentWordNum = document.getElementById('currentWordNum');
const totalWords = document.getElementById('totalWords');
const timerDisplay = document.getElementById('timerDisplay');
const knownCountEl = document.getElementById('knownCount');
const unsureCountEl = document.getElementById('unsureCount');
const unknownCountEl = document.getElementById('unknownCount');
const completionScreen = document.getElementById('completionScreen');

// Explanation + quiz elements
const wordExplanation = document.getElementById('wordExplanation');
const wordQuiz = document.getElementById('wordQuiz');
const wordActions = document.getElementById('wordActions');
const explMeaning = document.getElementById('explMeaning');
const explContext = document.getElementById('explContext');
const explExample = document.getElementById('explExample');
const quizQuestion = document.getElementById('quizQuestion');
const quizOptions = document.getElementById('quizOptions');
const quizFeedback = document.getElementById('quizFeedback');
const quizAttempts = document.getElementById('quizAttempts');

const MAX_ATTEMPTS = 3;

// Stage 1: explanation + quiz (must answer correctly, up to 3 attempts)
// Stage 2: check quiz without explanation (1 attempt, wrong = unknown)
function renderQuizOptions(quiz: any, onAnswer: (correct: boolean, attemptsLeft: number) => void, attemptsLeft: number) {
    quizFeedback.style.display = 'none';
    quizFeedback.className = 'quiz-feedback';

    quizOptions.innerHTML = quiz.options.map((opt: string, i: number) =>
        `<button class="quiz-option" data-index="${i}">${opt}</button>`
    ).join('');

    quizOptions.querySelectorAll('.quiz-option').forEach((btn: Element) => {
        btn.addEventListener('click', () => {
            const idx = parseInt((btn as HTMLElement).dataset.index);
            const correct = idx === quiz.correct;

            quizOptions.querySelectorAll('.quiz-option').forEach((b: Element, i: number) => {
                if (i === quiz.correct) b.classList.add('correct');
                else if (i === idx && !correct) b.classList.add('wrong');
                (b as HTMLButtonElement).disabled = true;
            });

            onAnswer(correct, attemptsLeft - 1);
        }, { once: true });
    });
}

function updateAttemptsUI(attemptsLeft: number, stage: 1 | 2) {
    if (stage === 2 || attemptsLeft >= MAX_ATTEMPTS) {
        quizAttempts.textContent = '';
        return;
    }
    const dots = Array.from({ length: MAX_ATTEMPTS }, (_, i) =>
        `<span class="attempt-dot ${i < attemptsLeft ? 'dot-active' : 'dot-used'}"></span>`
    ).join('');
    quizAttempts.innerHTML = `<span class="attempts-label">Attempts left:</span>${dots}`;
}

function showExplanationAndQuiz(word: any) {
    const details = wordDetails[word.id];
    const langDetails = details && (details[currentLang] || details['ru'] || details['en'] || Object.values(details)[0]) as any;
    const quiz = quizData[word.id];

    // Show explanation
    if (langDetails) {
        explMeaning.textContent = langDetails.meaning || '';
        explContext.textContent = langDetails.context || '';
        explExample.textContent = langDetails.example || '';
        wordExplanation.style.display = 'block';
    } else {
        wordExplanation.style.display = 'none';
    }

    if (!quiz) {
        // No quiz — show explanation + normal buttons, mark as explained
        wordQuiz.style.display = 'none';
        wordActions.style.display = 'flex';
        if (langDetails) markWordExplained(currentUser.uid, word.id);
        return;
    }

    // Stage 1: quiz with explanation visible, up to 3 attempts
    wordQuiz.style.display = 'block';
    wordActions.style.display = 'none';
    quizQuestion.textContent = quiz.question;

    let attemptsLeft = MAX_ATTEMPTS;
    updateAttemptsUI(attemptsLeft, 1);

    function stage1Attempt() {
        renderQuizOptions(quiz, (correct, remaining) => {
            if (correct) {
                quizFeedback.textContent = '✓ Correct! Now let\'s check without hints...';
                quizFeedback.className = 'quiz-feedback feedback-correct';
                quizFeedback.style.display = 'block';
                quizAttempts.textContent = '';
                // Move to stage 2 after short pause
                setTimeout(() => showCheckQuiz(word), 1200);
            } else {
                attemptsLeft = remaining;
                if (attemptsLeft <= 0) {
                    // Used all attempts — reveal answer and move to stage 2
                    quizFeedback.textContent = '✗ The correct answer is highlighted. Let\'s continue.';
                    quizFeedback.className = 'quiz-feedback feedback-wrong';
                    quizFeedback.style.display = 'block';
                    quizAttempts.textContent = '';
                    markWordExplained(currentUser.uid, word.id);
                    setTimeout(() => showCheckQuiz(word), 1800);
                } else {
                    updateAttemptsUI(attemptsLeft, 1);
                    quizFeedback.textContent = `✗ Not quite — try again! Read the explanation above.`;
                    quizFeedback.className = 'quiz-feedback feedback-wrong';
                    quizFeedback.style.display = 'block';
                    // Re-enable after short pause for retry
                    setTimeout(() => {
                        quizFeedback.style.display = 'none';
                        stage1Attempt();
                    }, 1200);
                }
            }
        }, attemptsLeft);
    }

    stage1Attempt();
}

// Stage 2: check quiz WITHOUT explanation
function showCheckQuiz(word: any) {
    const quiz = quizData[word.id];
    if (!quiz) {
        // No quiz data — just mark explained and go to normal mode
        markWordExplained(currentUser.uid, word.id);
        showNormalMode();
        markWord('known');
        return;
    }

    // Hide explanation, show quiz only
    wordExplanation.style.display = 'none';
    wordQuiz.style.display = 'block';
    wordActions.style.display = 'none';
    quizFeedback.style.display = 'none';
    quizAttempts.textContent = '';

    quizQuestion.textContent = '🧠 ' + quiz.question;

    renderQuizOptions(quiz, (correct, _) => {
        markWordExplained(currentUser.uid, word.id);
        if (correct) {
            quizFeedback.textContent = '✓ Great job! Word learned.';
            quizFeedback.className = 'quiz-feedback feedback-correct';
            quizFeedback.style.display = 'block';
            setTimeout(() => markWord('known'), 900);
        } else {
            // Highlight correct
            quizFeedback.textContent = '✗ Not quite — this word will come back for review.';
            quizFeedback.className = 'quiz-feedback feedback-wrong';
            quizFeedback.style.display = 'block';
            setTimeout(() => markWord('unknown'), 1800);
        }
    }, 1);
}

function showNormalMode() {
    wordExplanation.style.display = 'none';
    wordQuiz.style.display = 'none';
    wordActions.style.display = 'flex';
}

// Timer functions
function startTimer() {
    if (timerInterval) return; // Already running

    studyStartTime = Date.now();
    timerInterval = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - studyStartTime) / 1000) + totalStudySeconds;
        updateTimerDisplay(elapsedSeconds);
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        totalStudySeconds += Math.floor((Date.now() - studyStartTime) / 1000);
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function updateTimerDisplay(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Sign out button
signOutBtn.addEventListener('click', async () => {
    try {
        await logOut();
        window.location.href = '/';
    } catch (error) {
        console.error('Sign out error:', error);
    }
});

// Show cached user immediately
const cachedAuth = getCachedAuthState();
if (cachedAuth) {
    userProfile.style.display = 'flex';
    setAvatar(userAvatar as HTMLImageElement, cachedAuth.photoURL, cachedAuth.displayName || cachedAuth.email, 36);
    userName.textContent = cachedAuth.displayName || cachedAuth.email;
}

// Initialize
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

        // Load explained words from localStorage
        loadExplainedWords(user.uid);

        // Load progress from Firestore
        await loadProgress();
        displayCurrentWord();
        startTimer(); // Start study timer
        hideLoading();
    } else {
        cacheAuthState(null);
        // Redirect to home if not authenticated
        alert('Пожалуйста, войдите в систему');
        window.location.href = '/';
    }
});

// Load progress from PostgreSQL
async function loadProgress() {
    try {
        const data = await getProgress(currentUser.uid, 'tier2');
        userProgress = data.words || {};
        currentWordIndex = 0; // Will find first unreviewed word

        // Find last reviewed word index
        for (let i = 0; i < tier2Words.length; i++) {
            if (!userProgress[tier2Words[i].id]) {
                currentWordIndex = i;
                break;
            }
        }

        // Calculate stats
        Object.values(userProgress).forEach(status => {
            if (status === 'known') knownCount++;
            else if (status === 'unsure') unsureCount++;
            else if (status === 'unknown') unknownCount++;
        });

        updateStats();
    } catch (error) {
        console.error('Error loading progress:', error);
    }
}

// Save progress to PostgreSQL
async function saveProgress() {
    if (!currentUser) return;

    try {
        await saveProgressBatch(currentUser.uid, 'tier2', userProgress);
        console.log('Progress saved');
    } catch (error) {
        console.error('Error saving progress:', error);
    }
}

// Display current word
function displayCurrentWord() {
    if (currentWordIndex >= tier2Words.length) {
        showCompletionScreen();
        return;
    }

    const word = tier2Words[currentWordIndex];
    wordMain.textContent = word.en;
    meaningText.textContent = word[currentLang] || word.ru;
    wordMeaning.style.display = 'none';

    // Update UI
    currentWordNum.textContent = currentWordIndex + 1;
    totalWords.textContent = tier2Words.length;
    progressFill.style.width = `${((currentWordIndex + 1) / tier2Words.length) * 100}%`;

    // Update navigation buttons
    btnPrev.disabled = currentWordIndex === 0;
    btnNext.disabled = false;

    // Decide: explanation+quiz mode OR normal mode
    const isNew = !explainedWords.has(word.id);
    const hasQuizOrDetails = quizData[word.id] || wordDetails[word.id];

    if (isNew && hasQuizOrDetails) {
        showExplanationAndQuiz(word);
    } else {
        showNormalMode();
        // Show previous selection
        const status = userProgress[word.id];
        btnKnow.classList.toggle('selected', status === 'known');
        btnUnsure.classList.toggle('selected', status === 'unsure');
        btnUnknown.classList.toggle('selected', status === 'unknown');
    }
}

// Update stats
function updateStats() {
    knownCountEl.textContent = knownCount;
    unsureCountEl.textContent = unsureCount;
    unknownCountEl.textContent = unknownCount;
}

// Mark word status
async function markWord(status) {
    const word = tier2Words[currentWordIndex];
    const previousStatus = userProgress[word.id];

    // Update total counts
    if (previousStatus === 'known') knownCount--;
    else if (previousStatus === 'unsure') unsureCount--;
    else if (previousStatus === 'unknown') unknownCount--;

    if (status === 'known') knownCount++;
    else if (status === 'unsure') unsureCount++;
    else if (status === 'unknown') unknownCount++;

    // Update session counts
    const prevSession = sessionProgress[word.id];
    if (prevSession === 'known') sessionKnown--;
    else if (prevSession === 'unsure') sessionUnsure--;
    else if (prevSession === 'unknown') sessionUnknown--;
    else sessionWordsReviewed++; // First time this word is marked in session

    if (status === 'known') sessionKnown++;
    else if (status === 'unsure') sessionUnsure++;
    else if (status === 'unknown') sessionUnknown++;
    sessionProgress[word.id] = status;

    userProgress[word.id] = status;
    updateStats();

    // Visual feedback
    btnKnow.classList.remove('selected');
    btnUnsure.classList.remove('selected');
    btnUnknown.classList.remove('selected');

    if (status === 'known') btnKnow.classList.add('selected');
    else if (status === 'unsure') btnUnsure.classList.add('selected');
    else if (status === 'unknown') btnUnknown.classList.add('selected');

    saveProgress(); // save in background, don't await

    // Auto-advance after 500ms
    setTimeout(() => {
        if (currentWordIndex < tier2Words.length - 1) {
            nextWord();
        } else {
            showCompletionScreen();
        }
    }, 500);
}

// Navigation
function nextWord() {
    if (currentWordIndex < tier2Words.length - 1) {
        currentWordIndex++;
        displayCurrentWord();
    }
}

function prevWord() {
    if (currentWordIndex > 0) {
        currentWordIndex--;
        displayCurrentWord();
    }
}

// Save session to DB
async function finishSession(completed: boolean) {
    stopTimer();
    if (currentUser && totalStudySeconds > 0 && sessionWordsReviewed > 0) {
        try {
            await saveSession(
                currentUser.uid,
                'tier2',
                totalStudySeconds,
                sessionWordsReviewed,
                sessionKnown,
                sessionUnsure,
                sessionUnknown,
                completed
            );
        } catch (error) {
            console.error('Error saving session:', error);
        }
    }
}

// Show completion screen
async function showCompletionScreen() {
    await finishSession(true);
    completionScreen.style.display = 'flex';
    document.getElementById('finalKnown').textContent = knownCount;
    document.getElementById('finalUnsure').textContent = unsureCount;
    document.getElementById('finalUnknown').textContent = unknownCount;
}

// Event listeners
showMeaningBtn.addEventListener('click', () => {
    wordMeaning.style.display = wordMeaning.style.display === 'none' ? 'block' : 'none';
});

btnKnow.addEventListener('click', () => markWord('known'));
btnUnsure.addEventListener('click', () => markWord('unsure'));
btnUnknown.addEventListener('click', () => markWord('unknown'));

btnNext.addEventListener('click', nextWord);
btnPrev.addEventListener('click', prevWord);

btnSaveExit.addEventListener('click', () => {
    saveProgress();
    finishSession(false);
    window.location.href = '/';
});

document.getElementById('btnViewUnknown').addEventListener('click', () => {
    // TODO: Navigate to unknown words list
    alert('Функция в разработке');
});

// Auto-save every 30 seconds
setInterval(saveProgress, 30000);
