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

// Shuffled word order — generated once per user and persisted
let shuffledWords: typeof tier2Words = [];

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function loadShuffledOrder(uid: string) {
    try {
        const stored = localStorage.getItem(`wordOrder_${uid}`);
        if (stored) {
            const ids: string[] = JSON.parse(stored);
            // Rebuild array preserving saved order; append any new words at random positions
            const idMap = new Map(tier2Words.map(w => [w.id, w]));
            const ordered = ids.map(id => idMap.get(id)).filter(Boolean) as typeof tier2Words;
            const newWords = tier2Words.filter(w => !ids.includes(w.id));
            // Insert new words at random positions among unseen words
            newWords.forEach(w => {
                const pos = Math.floor(Math.random() * (ordered.length + 1));
                ordered.splice(pos, 0, w);
            });
            shuffledWords = ordered;
        } else {
            shuffledWords = shuffle(tier2Words);
            localStorage.setItem(`wordOrder_${uid}`, JSON.stringify(shuffledWords.map(w => w.id)));
        }
    } catch {
        shuffledWords = shuffle(tier2Words);
    }
}

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

// Spaced check queue: words waiting for stage-2 check after N new words
// { wordId: string, dueAfter: number }[]  — dueAfter is a word-counter value
interface CheckItem { wordId: string; dueAfter: number; }
let checkQueue: CheckItem[] = [];
let wordsSeenCount = 0; // increments each time a genuinely new word is displayed

function loadCheckQueue(uid: string) {
    try {
        const stored = localStorage.getItem(`checkQueue_${uid}`);
        checkQueue = stored ? JSON.parse(stored) : [];
        const cnt = localStorage.getItem(`wordsSeenCount_${uid}`);
        wordsSeenCount = cnt ? parseInt(cnt) : 0;
    } catch { checkQueue = []; wordsSeenCount = 0; }
}

function saveCheckQueue(uid: string) {
    try {
        localStorage.setItem(`checkQueue_${uid}`, JSON.stringify(checkQueue));
        localStorage.setItem(`wordsSeenCount_${uid}`, String(wordsSeenCount));
    } catch {}
}

function enqueueForCheck(uid: string, wordId: string) {
    // Schedule check after 4–8 new words from now
    const delay = 4 + Math.floor(Math.random() * 5); // 4,5,6,7,8
    checkQueue.push({ wordId, dueAfter: wordsSeenCount + delay });
    saveCheckQueue(uid);
}

// Returns the next word due for a check, or null
function dequeueDueCheck(): CheckItem | null {
    const idx = checkQueue.findIndex(item => wordsSeenCount >= item.dueAfter);
    if (idx === -1) return null;
    const item = checkQueue.splice(idx, 1)[0];
    saveCheckQueue(currentUser?.uid);
    return item;
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
                quizFeedback.textContent = '✓ Correct! We\'ll check again in a few words...';
                quizFeedback.className = 'quiz-feedback feedback-correct';
                quizFeedback.style.display = 'block';
                quizAttempts.textContent = '';
                markWordExplained(currentUser.uid, word.id);
                enqueueForCheck(currentUser.uid, word.id);
                // Mark as unsure for now — will become known after stage 2
                setTimeout(() => markWord('unsure'), 900);
            } else {
                attemptsLeft = remaining;
                if (attemptsLeft <= 0) {
                    // Used all attempts — reveal answer, queue for check anyway
                    quizFeedback.textContent = '✗ The correct answer is highlighted. We\'ll check again soon.';
                    quizFeedback.className = 'quiz-feedback feedback-wrong';
                    quizFeedback.style.display = 'block';
                    quizAttempts.textContent = '';
                    markWordExplained(currentUser.uid, word.id);
                    enqueueForCheck(currentUser.uid, word.id);
                    setTimeout(() => markWord('unsure'), 1800);
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

// Stage 2: check quiz WITHOUT explanation (spaced check)
function showCheckQuiz(word: any) {
    const quiz = quizData[word.id];

    // Hide explanation, show quiz only
    wordExplanation.style.display = 'none';
    wordQuiz.style.display = 'block';
    wordActions.style.display = 'none';
    quizFeedback.style.display = 'none';
    quizAttempts.innerHTML = '<span class="check-badge">🧠 Recall check</span>';

    if (!quiz) {
        // No quiz — just mark known and continue
        markWordStatus(word.id, 'known');
        setTimeout(() => nextWord(), 500);
        return;
    }

    quizQuestion.textContent = quiz.question;

    renderQuizOptions(quiz, (correct, _) => {
        if (correct) {
            quizFeedback.textContent = '✓ Great job! Word learned.';
            quizFeedback.className = 'quiz-feedback feedback-correct';
            quizFeedback.style.display = 'block';
            markWordStatus(word.id, 'known');
            setTimeout(() => nextWord(), 900);
        } else {
            quizFeedback.textContent = '✗ Not quite — this word will come back for review.';
            quizFeedback.className = 'quiz-feedback feedback-wrong';
            quizFeedback.style.display = 'block';
            markWordStatus(word.id, 'unknown');
            // Re-queue with another delay
            enqueueForCheck(currentUser.uid, word.id);
            setTimeout(() => nextWord(), 1800);
        }
    }, 1);
}

// Update word status without advancing the card (used by spaced check)
function markWordStatus(wordId: string, status: string) {
    const previousStatus = userProgress[wordId];
    if (previousStatus === 'known') knownCount--;
    else if (previousStatus === 'unsure') unsureCount--;
    else if (previousStatus === 'unknown') unknownCount--;

    if (status === 'known') knownCount++;
    else if (status === 'unsure') unsureCount++;
    else if (status === 'unknown') unknownCount++;

    userProgress[wordId] = status;
    updateStats();
    saveProgress();
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

        // Load shuffled word order, explained words and check queue from localStorage
        loadShuffledOrder(user.uid);
        loadExplainedWords(user.uid);
        loadCheckQueue(user.uid);

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
        currentWordIndex = 0;

        // Find first word in shuffled order that hasn't been seen yet
        for (let i = 0; i < shuffledWords.length; i++) {
            if (!userProgress[shuffledWords[i].id]) {
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
    if (currentWordIndex >= shuffledWords.length) {
        showCompletionScreen();
        return;
    }

    const word = shuffledWords[currentWordIndex];
    wordMain.textContent = word.en;
    meaningText.textContent = word[currentLang] || word.ru;
    wordMeaning.style.display = 'none';

    // Update UI
    currentWordNum.textContent = currentWordIndex + 1;
    totalWords.textContent = shuffledWords.length;
    progressFill.style.width = `${((currentWordIndex + 1) / shuffledWords.length) * 100}%`;

    // Update navigation buttons
    btnPrev.disabled = currentWordIndex === 0;
    btnNext.disabled = false;

    // Decide: explanation+quiz mode OR normal mode
    const isNew = !explainedWords.has(word.id);
    const hasQuizOrDetails = quizData[word.id] || wordDetails[word.id];

    // Count this as a "seen" word for spaced check scheduling
    if (isNew) {
        wordsSeenCount++;
        saveCheckQueue(currentUser?.uid);
    }

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
    const word = shuffledWords[currentWordIndex];
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
        if (currentWordIndex < shuffledWords.length - 1) {
            nextWord();
        } else {
            showCompletionScreen();
        }
    }, 500);
}

// Navigation
function nextWord() {
    // Check if any queued word is due for stage-2 check
    const due = dequeueDueCheck();
    if (due) {
        const word = tier2Words.find(w => w.id === due.wordId);
        if (word) {
            // Show stage-2 check quiz as an interruption (don't advance index)
            wordMain.textContent = word.en;
            meaningText.textContent = word[currentLang] || word.ru;
            wordMeaning.style.display = 'none';
            showCheckQuiz(word);
            return;
        }
    }

    // Normal advance
    if (currentWordIndex < shuffledWords.length - 1) {
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
