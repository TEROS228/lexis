import { auth, onAuthStateChanged, logOut, getCachedAuthState, cacheAuthState } from '../services/firebase';
import { getUserNativeLanguage, getProgress, saveProgressBatch, initUserProfile, saveSession } from '../db';
import tier2Words from '../data/words-tier2-full';
import wordDetails from '../data/word-details-data';
import { quizData } from '../data/quiz-data';
import { setAvatar } from '../utils/avatar';
import { initI18n, setLanguage, getCurrentLanguage, updatePageTranslations } from '../i18n';

let currentUser = null;
let currentLang = getCurrentLanguage();

// ─── 10-Word Active Pool ───────────────────────────────────────────────
const POOL_SIZE = 10;

type WordStage = 'explanation' | 'multiChoice' | 'fillBlank' | 'scenario' | 'mastered';

interface PoolItem {
    wordId: string;
    stage: WordStage;
    attempts: number; // attempts on current stage
}

// Ordered list of all word IDs not yet introduced to the pool
let pendingWordIds: string[] = [];

// Active pool (up to POOL_SIZE items, each at some stage)
let activePool: PoolItem[] = [];

// Index into activePool of the currently displayed item
let poolCursor = 0;

// Words that have been mastered (saved to DB as 'known')
let masteredIds: Set<string> = new Set();

function loadPoolState(uid: string) {
    try {
        const stored = localStorage.getItem(`pool_${uid}`);
        if (stored) {
            const s = JSON.parse(stored);
            activePool = s.pool || [];
            pendingWordIds = s.pending || [];
            masteredIds = new Set(s.mastered || []);
            poolCursor = 0;
        }
    } catch { /* ignore */ }
}

function savePoolState(uid: string) {
    try {
        localStorage.setItem(`pool_${uid}`, JSON.stringify({
            pool: activePool,
            pending: pendingWordIds,
            mastered: [...masteredIds]
        }));
    } catch { /* ignore */ }
}

function initPoolFromProgress(uid: string, progress: Record<string, string>) {
    // Load stored state first
    loadPoolState(uid);

    // If we already have a valid pool, keep it
    if (activePool.length > 0 || pendingWordIds.length > 0) {
        // Re-fill pool if needed
        fillPool(uid);
        return;
    }

    // Build pending list: all unseen or non-mastered words in shuffled order
    const shuffled = loadShuffledOrder(uid);
    masteredIds = new Set(
        Object.entries(progress)
            .filter(([, status]) => status === 'known')
            .map(([id]) => id)
    );

    pendingWordIds = shuffled
        .map(w => w.id)
        .filter(id => !masteredIds.has(id));

    activePool = [];
    fillPool(uid);
}

function fillPool(uid: string) {
    // Remove mastered items from pool
    activePool = activePool.filter(item => item.stage !== 'mastered');

    while (activePool.length < POOL_SIZE && pendingWordIds.length > 0) {
        const wordId = pendingWordIds.shift()!;
        activePool.push({ wordId, stage: 'explanation', attempts: 0 });
    }

    // Clamp cursor
    if (poolCursor >= activePool.length) poolCursor = 0;

    savePoolState(uid);
}

// ─── Shuffled Word Order ──────────────────────────────────────────────
function loadShuffledOrder(uid: string): typeof tier2Words {
    try {
        const stored = localStorage.getItem(`wordOrder_${uid}`);
        if (stored) {
            const ids: string[] = JSON.parse(stored);
            const idMap = new Map(tier2Words.map(w => [w.id, w]));
            const ordered = ids.map(id => idMap.get(id)).filter(Boolean) as typeof tier2Words;
            const newWords = tier2Words.filter(w => !ids.includes(w.id));
            newWords.forEach(w => {
                const pos = Math.floor(Math.random() * (ordered.length + 1));
                ordered.splice(pos, 0, w);
            });
            return ordered;
        }
    } catch { /* ignore */ }
    const shuffled = shuffle(tier2Words);
    try {
        localStorage.setItem(`wordOrder_${uid}`, JSON.stringify(shuffled.map(w => w.id)));
    } catch { /* ignore */ }
    return shuffled;
}

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ─── Timer ────────────────────────────────────────────────────────────
let studyStartTime = null;
let timerInterval = null;
let totalStudySeconds = 0;

function startTimer() {
    if (timerInterval) return;
    studyStartTime = Date.now();
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - studyStartTime) / 1000) + totalStudySeconds;
        const minutes = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        totalStudySeconds += Math.floor((Date.now() - studyStartTime) / 1000);
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// ─── Loading overlay ─────────────────────────────────────────────────
const loadingOverlay = document.getElementById('loadingOverlay');
function hideLoading() { if (loadingOverlay) loadingOverlay.style.display = 'none'; }

// ─── Language selector ───────────────────────────────────────────────
const languageBtn = document.getElementById('languageBtn');
const languageDropdown = document.getElementById('languageDropdown');
const languageOptions = document.querySelectorAll('.language-option');

const languages = {
    ru: { flag: '🇷🇺', code: 'RU' },
    en: { flag: '🇬🇧', code: 'EN' },
    zh: { flag: '🇨🇳', code: 'ZH' }
};

const savedLang = localStorage.getItem('preferred-language');
if (savedLang && languages[savedLang]) {
    languageBtn.querySelector('.flag').textContent = languages[savedLang].flag;
    languageBtn.querySelector('.lang-text').textContent = languages[savedLang].code;
    currentLang = savedLang;
}

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
        const lang = (option as HTMLElement).dataset.lang;
        currentLang = lang;
        languageBtn.querySelector('.flag').textContent = languages[lang].flag;
        languageBtn.querySelector('.lang-text').textContent = languages[lang].code;
        languageOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        languageBtn.classList.remove('active');
        languageDropdown.classList.remove('active');
        setLanguage(lang);
        updatePageTranslations();
        displayCurrentWord();
    });
});

initI18n();
updatePageTranslations();

// ─── DOM Elements ─────────────────────────────────────────────────────
const userProfile = document.getElementById('userProfile');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const userInfoTrigger = document.getElementById('userInfoTrigger');
const userDropdown = document.getElementById('userDropdown');
const signOutBtn = document.getElementById('signOutBtn');

const wordMain = document.getElementById('wordMain');
const wordMeaning = document.getElementById('wordMeaning');
const meaningText = document.getElementById('meaningText');
const showMeaningBtn = document.getElementById('showMeaning');
const btnKnow = document.getElementById('btnKnow');
const btnUnsure = document.getElementById('btnUnsure');
const btnUnknown = document.getElementById('btnUnknown');
const btnPrev = document.getElementById('btnPrev') as HTMLButtonElement;
const btnNext = document.getElementById('btnNext') as HTMLButtonElement;
const btnSaveExit = document.getElementById('btnSaveExit');
const progressFill = document.getElementById('progressFill');
const currentWordNum = document.getElementById('currentWordNum');
const totalWords = document.getElementById('totalWords');
const timerDisplay = document.getElementById('timerDisplay');
const knownCountEl = document.getElementById('knownCount');
const unsureCountEl = document.getElementById('unsureCount');
const unknownCountEl = document.getElementById('unknownCount');
const completionScreen = document.getElementById('completionScreen');

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

// ─── User/session state ───────────────────────────────────────────────
let userProgress: Record<string, string> = {};
let knownCount = 0;
let unsureCount = 0;
let unknownCount = 0;
let sessionKnown = 0;
let sessionUnsure = 0;
let sessionUnknown = 0;
let sessionWordsReviewed = 0;
let sessionProgress: Record<string, string> = {};

// ─── Dropdown ─────────────────────────────────────────────────────────
userInfoTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    userInfoTrigger.classList.toggle('active');
    userDropdown.classList.toggle('active');
});

document.addEventListener('click', (e) => {
    if (!userProfile?.contains(e.target as Node)) {
        userInfoTrigger?.classList.remove('active');
        userDropdown?.classList.remove('active');
    }
});

signOutBtn.addEventListener('click', async () => {
    try { await logOut(); window.location.href = '/'; }
    catch (error) { console.error('Sign out error:', error); }
});

// ─── Show cached user immediately ─────────────────────────────────────
const cachedAuth = getCachedAuthState();
if (cachedAuth) {
    userProfile.style.display = 'flex';
    setAvatar(userAvatar as HTMLImageElement, cachedAuth.photoURL, cachedAuth.displayName || cachedAuth.email, 36);
    userName.textContent = cachedAuth.displayName || cachedAuth.email;
}

// ─── Auth ──────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        cacheAuthState(user);
        userProfile.style.display = 'flex';
        setAvatar(userAvatar as HTMLImageElement, user.photoURL, user.displayName || user.email, 36);
        userName.textContent = user.displayName || user.email;

        try { await initUserProfile(user); } catch { /* ignore */ }

        const nativeLang = await getUserNativeLanguage(user.uid);
        if (nativeLang) {
            currentLang = nativeLang;
            setLanguage(nativeLang);
            updatePageTranslations();
            languageBtn.querySelector('.flag').textContent = languages[nativeLang]?.flag || '🌐';
            languageBtn.querySelector('.lang-text').textContent = languages[nativeLang]?.code || nativeLang.toUpperCase();
            languageOptions.forEach(opt => {
                (opt as HTMLElement).classList.toggle('selected', (opt as HTMLElement).dataset.lang === nativeLang);
            });
        }

        await loadProgress();
        initPoolFromProgress(user.uid, userProgress);
        updateStats();
        displayCurrentWord();
        startTimer();
        hideLoading();
    } else {
        cacheAuthState(null);
        alert('Пожалуйста, войдите в систему');
        window.location.href = '/';
    }
});

// ─── Load / Save Progress ──────────────────────────────────────────────
async function loadProgress() {
    try {
        const data = await getProgress(currentUser.uid, 'tier2');
        userProgress = data.words || {};
        knownCount = 0; unsureCount = 0; unknownCount = 0;
        Object.values(userProgress).forEach(status => {
            if (status === 'known') knownCount++;
            else if (status === 'unsure') unsureCount++;
            else if (status === 'unknown') unknownCount++;
        });
    } catch (error) {
        console.error('Error loading progress:', error);
    }
}

async function saveProgress() {
    if (!currentUser) return;
    try {
        await saveProgressBatch(currentUser.uid, 'tier2', userProgress);
    } catch (error) {
        console.error('Error saving progress:', error);
    }
}

// ─── Stats ─────────────────────────────────────────────────────────────
function updateStats() {
    knownCountEl.textContent = String(knownCount);
    unsureCountEl.textContent = String(unsureCount);
    unknownCountEl.textContent = String(unknownCount);

    const totalAll = tier2Words.length;
    currentWordNum.textContent = String(masteredIds.size + 1);
    totalWords.textContent = String(totalAll);
    progressFill.style.width = `${(masteredIds.size / totalAll) * 100}%`;
}

// ─── Mark word status helper ───────────────────────────────────────────
function applyStatus(wordId: string, status: string) {
    const prev = userProgress[wordId];
    if (prev === 'known') knownCount--;
    else if (prev === 'unsure') unsureCount--;
    else if (prev === 'unknown') unknownCount--;

    if (status === 'known') knownCount++;
    else if (status === 'unsure') unsureCount++;
    else if (status === 'unknown') unknownCount++;

    // Session tracking
    const prevSess = sessionProgress[wordId];
    if (prevSess === 'known') sessionKnown--;
    else if (prevSess === 'unsure') sessionUnsure--;
    else if (prevSess === 'unknown') sessionUnknown--;
    else sessionWordsReviewed++;

    if (status === 'known') sessionKnown++;
    else if (status === 'unsure') sessionUnsure++;
    else if (status === 'unknown') sessionUnknown++;
    sessionProgress[wordId] = status;

    userProgress[wordId] = status;
    updateStats();
    saveProgress();
}

// ─── Stage progression ─────────────────────────────────────────────────
const STAGE_ORDER: WordStage[] = ['explanation', 'multiChoice', 'fillBlank', 'scenario', 'mastered'];

function advanceStage(item: PoolItem) {
    const next = nextStageFor(item);
    item.stage = next;
    item.attempts = 0;
    if (item.stage === 'mastered') {
        masteredIds.add(item.wordId);
        applyStatus(item.wordId, 'known');
    } else if (item.stage === 'multiChoice') {
        applyStatus(item.wordId, 'unsure');
    }
}

function nextStageFor(item: PoolItem): WordStage {
    const quiz = (quizData as any)[item.wordId];
    const idx = STAGE_ORDER.indexOf(item.stage);
    for (let i = idx + 1; i < STAGE_ORDER.length; i++) {
        const s = STAGE_ORDER[i];
        if (s === 'mastered') return 'mastered';
        if (s === 'multiChoice' && quiz) return 'multiChoice';
        if (s === 'fillBlank' && quiz?.fillBlank) return 'fillBlank';
        if (s === 'scenario' && quiz?.scenario) return 'scenario';
    }
    return 'mastered';
}

function resetToExplanation(item: PoolItem) {
    item.stage = 'explanation';
    item.attempts = 0;
    applyStatus(item.wordId, 'unknown');
}

// ─── Display ───────────────────────────────────────────────────────────
function displayCurrentWord() {
    if (activePool.length === 0 && pendingWordIds.length === 0) {
        showCompletionScreen();
        return;
    }

    if (activePool.length === 0) {
        fillPool(currentUser?.uid);
    }

    if (poolCursor >= activePool.length) poolCursor = 0;

    const item = activePool[poolCursor];
    const word = tier2Words.find(w => w.id === item.wordId);
    if (!word) { advanceToNextPoolItem(); return; }

    wordMain.textContent = word.en;
    meaningText.textContent = word[currentLang] || word.ru;
    wordMeaning.style.display = 'none';

    btnPrev.disabled = poolCursor === 0 && masteredIds.size === 0;
    btnNext.disabled = false;

    wordExplanation.style.display = 'none';
    wordQuiz.style.display = 'none';
    wordActions.style.display = 'none';
    quizFeedback.style.display = 'none';
    quizAttempts.innerHTML = '';

    switch (item.stage) {
        case 'explanation':
            renderExplanationStage(word, item);
            break;
        case 'multiChoice':
            renderQuizStage(word, item, quizData[item.wordId], 'multiChoice');
            break;
        case 'fillBlank':
            renderQuizStage(word, item, quizData[item.wordId]?.fillBlank, 'fillBlank');
            break;
        case 'scenario':
            renderQuizStage(word, item, quizData[item.wordId]?.scenario, 'scenario');
            break;
    }
}

function renderExplanationStage(word: any, item: PoolItem) {
    const details = wordDetails[word.id];
    const langDetails = details && (details[currentLang] || details['ru'] || details['en'] || Object.values(details)[0]) as any;

    // Show explanation card
    if (langDetails) {
        explMeaning.textContent = langDetails.meaning || '';
        explContext.textContent = langDetails.context || '';
        explExample.textContent = langDetails.example || '';
        wordExplanation.style.display = 'block';
    }

    // Hide action buttons — go straight to multiChoice quiz
    wordActions.style.display = 'none';
    btnKnow.onclick = null;
    btnUnsure.onclick = null;
    btnUnknown.onclick = null;

    // Advance to multiChoice and render it immediately
    advanceStage(item);
    savePoolState(currentUser?.uid);

    if (item.stage === 'mastered') {
        finishMastered(item);
    } else {
        const quiz = (quizData as any)[item.wordId];
        const stageQuiz = item.stage === 'fillBlank' ? quiz?.fillBlank
                        : item.stage === 'scenario'  ? quiz?.scenario
                        : quiz;
        renderQuizStage(word, item, stageQuiz, item.stage);
    }
}

function renderQuizStage(word: any, item: PoolItem, quiz: any, stageType: string) {
    if (!quiz) {
        // No quiz for this stage — skip
        advanceStage(item);
        savePoolState(currentUser?.uid);
        if (item.stage === 'mastered') {
            finishMastered(item);
        } else {
            displayCurrentWord();
        }
        return;
    }

    // Stage badge
    const stageBadge = {
        multiChoice: '📝 Multiple choice',
        fillBlank: '✏️ Fill in the blank',
        scenario: '🎭 Scenario'
    }[stageType] || '📝 Quiz';

    quizAttempts.innerHTML = `<span class="check-badge">${stageBadge}</span>`;
    quizQuestion.textContent = quiz.question;
    wordQuiz.style.display = 'block';
    wordActions.style.display = 'none';

    const MAX_ATTEMPTS = stageType === 'multiChoice' ? 3 : 2;
    item.attempts = item.attempts || 0;
    let attemptsLeft = MAX_ATTEMPTS - item.attempts;

    if (stageType === 'multiChoice') {
        renderAttemptsUI(attemptsLeft, MAX_ATTEMPTS);
    }

    renderQuizOptions(quiz, (correct) => {
        if (correct) {
            quizFeedback.textContent = '✓ Correct!';
            quizFeedback.className = 'quiz-feedback feedback-correct';
            quizFeedback.style.display = 'block';
            item.attempts = 0;
            advanceStage(item);
            savePoolState(currentUser?.uid);
            if (item.stage === 'mastered') {
                setTimeout(() => finishMastered(item), 800);
            } else {
                setTimeout(displayCurrentWord, 800);
            }
        } else {
            item.attempts++;
            attemptsLeft = MAX_ATTEMPTS - item.attempts;

            if (attemptsLeft <= 0) {
                quizFeedback.textContent = '✗ The correct answer is highlighted. Let\'s review this word again.';
                quizFeedback.className = 'quiz-feedback feedback-wrong';
                quizFeedback.style.display = 'block';
                resetToExplanation(item);
                savePoolState(currentUser?.uid);
                setTimeout(advanceToNextPoolItem, 1800);
            } else {
                quizFeedback.textContent = `✗ Not quite — try again! (${attemptsLeft} attempt${attemptsLeft > 1 ? 's' : ''} left)`;
                quizFeedback.className = 'quiz-feedback feedback-wrong';
                quizFeedback.style.display = 'block';
                if (stageType === 'multiChoice') renderAttemptsUI(attemptsLeft, MAX_ATTEMPTS);
                setTimeout(() => {
                    quizFeedback.style.display = 'none';
                    renderQuizStage(word, item, quiz, stageType);
                }, 1200);
            }
        }
    });
}

function renderAttemptsUI(attemptsLeft: number, max: number) {
    const dots = Array.from({ length: max }, (_, i) =>
        `<span class="attempt-dot ${i < attemptsLeft ? 'dot-active' : 'dot-used'}"></span>`
    ).join('');
    quizAttempts.innerHTML = `<span class="attempts-label">Attempts:</span>${dots}`;
}

function renderQuizOptions(quiz: any, onAnswer: (correct: boolean) => void) {
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

            onAnswer(correct);
        }, { once: true });
    });
}

function finishMastered(item: PoolItem) {
    // Remove from pool and fill with new word
    activePool = activePool.filter(i => i !== item);
    fillPool(currentUser?.uid);
    updateStats();
    if (activePool.length === 0 && pendingWordIds.length === 0) {
        showCompletionScreen();
    } else {
        displayCurrentWord();
    }
}

function advanceToNextPoolItem() {
    if (activePool.length === 0) {
        displayCurrentWord();
        return;
    }
    poolCursor = (poolCursor + 1) % activePool.length;
    displayCurrentWord();
}

// ─── Navigation ───────────────────────────────────────────────────────
function nextWord() {
    advanceToNextPoolItem();
}

function prevWord() {
    if (poolCursor > 0) {
        poolCursor--;
    } else {
        poolCursor = activePool.length - 1;
    }
    displayCurrentWord();
}

// ─── Session finish ───────────────────────────────────────────────────
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

async function showCompletionScreen() {
    await finishSession(true);
    completionScreen.style.display = 'flex';
    document.getElementById('finalKnown').textContent = String(knownCount);
    document.getElementById('finalUnsure').textContent = String(unsureCount);
    document.getElementById('finalUnknown').textContent = String(unknownCount);
}

// ─── Event listeners ──────────────────────────────────────────────────
showMeaningBtn.addEventListener('click', () => {
    wordMeaning.style.display = wordMeaning.style.display === 'none' ? 'block' : 'none';
});

btnNext.addEventListener('click', nextWord);
btnPrev.addEventListener('click', prevWord);

btnSaveExit.addEventListener('click', () => {
    saveProgress();
    finishSession(false);
    window.location.href = '/';
});

document.getElementById('btnViewUnknown')?.addEventListener('click', () => {
    alert('Функция в разработке');
});

// Auto-save every 30 seconds
setInterval(saveProgress, 30000);
