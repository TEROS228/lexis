import { auth, onAuthStateChanged, logOut, getCachedAuthState, cacheAuthState } from '../services/firebase';
import { getUserNativeLanguage, getProgress, saveProgressBatch, initUserProfile, saveSession } from '../db';
import tier2Words from '../data/words-tier2-full';
import wordDetails from '../data/word-details-data';
import { quizData } from '../data/quiz-data';
import { setAvatar } from '../utils/avatar';
import { initI18n, setLanguage, getCurrentLanguage, updatePageTranslations } from '../i18n';

let currentUser = null;
let currentLang = getCurrentLanguage();

// ─── Pool System ───────────────────────────────────────────────────────
//
// Phase A — INTRO: show 10 new words one by one (explanation + multiChoice quiz)
// Phase B — QUIZ:  shuffle quiz tasks for all pool words and present them
//                  When a word reaches mastered → remove, add 1 new word
//                  (that word goes through intro first, then joins quiz pool)
//
// Quiz stages per word: multiChoice → fillBlank → fillBlank2 → fillBlank3 → scenario → scenario2 → scenario3
// Wrong answer on fillBlank/scenario → word resets to intro (explanation + multiChoice)
// All stages passed → mastered (multiChoice + all 6 quiz stages)

const POOL_SIZE = 10;

type QuizStage = 'multiChoice' | 'fillBlank' | 'fillBlank2' | 'fillBlank3' | 'scenario' | 'scenario2' | 'scenario3';

interface PoolItem {
    wordId: string;
    // 'intro'    = showing explanation + multiChoice
    // 'quiz'     = in fillBlank/scenario rotation
    // 'mastered' = done
    phase: 'intro' | 'quiz' | 'mastered';
    quizStage: QuizStage;  // kept for localStorage compat, not used in quiz phase
    attempts: number;
    completedStages: QuizStage[];  // which quiz stages have been passed
}

// Words not yet added to pool
let pendingWordIds: string[] = [];

// Active pool
let activePool: PoolItem[] = [];

// Quiz task queue: array of { wordId, stage } to present next
// Rebuilt whenever pool changes or quiz phase starts
let quizQueue: { wordId: string; stage: QuizStage }[] = [];

// Words mastered this session
let masteredIds: Set<string> = new Set();

// Whether we're still in intro phase (showing new words)
// true  = still introducing words (all 10 not yet shown)
// false = quiz phase (fillBlank + scenario mixed)
let introPhase = true;

// Index for intro phase (which word we're on)
let introCursor = 0;

// Whether quiz on current intro word has been answered (unlocks Next)
let introQuizAnswered = false;

function loadPoolState(uid: string) {
    try {
        const stored = localStorage.getItem(`poolv6_${uid}`);
        if (stored) {
            const s = JSON.parse(stored);
            activePool = (s.pool || []).map((item: any) => ({ ...item, completedStages: item.completedStages || [] }));
            pendingWordIds = s.pending || [];
            masteredIds = new Set(s.mastered || []);
            quizQueue = s.quizQueue || [];
            introPhase = s.introPhase !== undefined ? s.introPhase : true;
            introCursor = s.introCursor || 0;
            introQuizAnswered = s.introQuizAnswered || false;
        }
        // Clear old broken state
        localStorage.removeItem(`poolv2_${uid}`);
        localStorage.removeItem(`poolv3_${uid}`);
        localStorage.removeItem(`poolv4_${uid}`);
        localStorage.removeItem(`poolv5_${uid}`);
    } catch { /* ignore */ }
}

function savePoolState(uid: string) {
    try {
        localStorage.setItem(`poolv6_${uid}`, JSON.stringify({
            pool: activePool,
            pending: pendingWordIds,
            mastered: [...masteredIds],
            quizQueue,
            introPhase,
            introCursor,
            introQuizAnswered
        }));
    } catch { /* ignore */ }
}

function initPoolFromProgress(uid: string, progress: Record<string, string>) {
    loadPoolState(uid);

    // If valid saved state exists, use it
    if (activePool.length > 0 || pendingWordIds.length > 0) {
        return;
    }

    // Fresh start
    const shuffled = loadShuffledOrder(uid);
    masteredIds = new Set(
        Object.entries(progress)
            .filter(([, status]) => status === 'known')
            .map(([id]) => id)
    );

    pendingWordIds = shuffled.map(w => w.id).filter(id => !masteredIds.has(id));

    activePool = [];
    // Fill pool with first POOL_SIZE words in intro phase
    for (let i = 0; i < POOL_SIZE && pendingWordIds.length > 0; i++) {
        const wordId = pendingWordIds.shift()!;
        activePool.push({ wordId, phase: 'intro', quizStage: 'multiChoice', attempts: 0, completedStages: [] });
    }

    introPhase = true;
    introCursor = 0;
    introQuizAnswered = false;
    quizQueue = [];
    savePoolState(uid);
}

// Build/rebuild quiz queue: all pending fillBlank+fillBlank2+fillBlank3+scenario+scenario2+scenario3 tasks for quiz-phase words, shuffled
function buildQuizQueue() {
    const tasks: { wordId: string; stage: QuizStage }[] = [];
    for (const item of activePool) {
        if (item.phase !== 'quiz') continue;
        const quiz = (quizData as any)[item.wordId];
        for (const stage of ['fillBlank', 'fillBlank2', 'fillBlank3', 'scenario', 'scenario2', 'scenario3'] as QuizStage[]) {
            if (item.completedStages.includes(stage)) continue;
            if (stage === 'fillBlank' && !quiz?.fillBlank) continue;
            if (stage === 'fillBlank2' && !quiz?.fillBlank2) continue;
            if (stage === 'fillBlank3' && !quiz?.fillBlank3) continue;
            if (stage === 'scenario' && !quiz?.scenario) continue;
            if (stage === 'scenario2' && !quiz?.scenario2) continue;
            if (stage === 'scenario3' && !quiz?.scenario3) continue;
            tasks.push({ wordId: item.wordId, stage });
        }
    }
    // Fisher-Yates shuffle
    for (let i = tasks.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
    }
    quizQueue = tasks;
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

// ─── Session/Progress state ───────────────────────────────────────────
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

// ─── Cached user ──────────────────────────────────────────────────────
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

// ─── Load / Save Progress ─────────────────────────────────────────────
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
    try { await saveProgressBatch(currentUser.uid, 'tier2', userProgress); }
    catch (error) { console.error('Error saving progress:', error); }
}

function applyStatus(wordId: string, status: string) {
    const prev = userProgress[wordId];
    if (prev === 'known') knownCount--;
    else if (prev === 'unsure') unsureCount--;
    else if (prev === 'unknown') unknownCount--;

    if (status === 'known') knownCount++;
    else if (status === 'unsure') unsureCount++;
    else if (status === 'unknown') unknownCount++;

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

// ─── Stats ─────────────────────────────────────────────────────────────
function updateStats() {
    knownCountEl.textContent = String(knownCount);
    unsureCountEl.textContent = String(unsureCount);
    unknownCountEl.textContent = String(unknownCount);
    currentWordNum.textContent = String(masteredIds.size + 1);
    totalWords.textContent = String(tier2Words.length);
    progressFill.style.width = `${(masteredIds.size / tier2Words.length) * 100}%`;
}

// ─── Main display function ────────────────────────────────────────────
function displayCurrentWord() {
    if (activePool.length === 0 && pendingWordIds.length === 0) {
        showCompletionScreen();
        return;
    }

    // Hide everything first
    wordExplanation.style.display = 'none';
    wordQuiz.style.display = 'none';
    wordActions.style.display = 'none';
    quizFeedback.style.display = 'none';
    quizAttempts.innerHTML = '';
    btnKnow.onclick = null;
    btnUnsure.onclick = null;
    btnUnknown.onclick = null;

    if (introPhase) {
        showIntroWord();
    } else {
        showNextQuiz();
    }
}

// ─── INTRO PHASE: show explanation + multiChoice quiz on same page ────────────
function showIntroWord() {
    const introItems = activePool.filter(item => item.phase === 'intro');

    if (introItems.length === 0 || introCursor >= introItems.length) {
        // All 10 words shown — switch to fillBlank+scenario phase
        introPhase = false;
        introCursor = 0;
        introQuizAnswered = false;
        activePool.forEach(item => {
            if (item.phase !== 'mastered') {
                item.phase = 'quiz';
            }
        });
        buildQuizQueue();
        savePoolState(currentUser?.uid);
        showNextQuiz();
        return;
    }

    const item = introItems[introCursor];
    const word = tier2Words.find(w => w.id === item.wordId);
    if (!word) { introCursor++; showIntroWord(); return; }

    const totalInPool = introItems.length + activePool.filter(i => i.phase === 'quiz').length;

    // ── Word header
    wordMain.textContent = word.en;
    meaningText.textContent = word[currentLang] || word.ru;
    wordMeaning.style.display = 'none';
    wordActions.style.display = 'none';
    btnPrev.disabled = introCursor === 0;
    btnNext.disabled = !introQuizAnswered;
    btnNext.onclick = null;

    // ── Badge
    quizAttempts.innerHTML = `<span class="check-badge">📖 ${introCursor + 1} / ${totalInPool}</span>`;

    // ── Explanation card
    const details = wordDetails[word.id];
    const langDetails = details && (details[currentLang] || details['ru'] || details['en'] || Object.values(details)[0]) as any;
    if (langDetails) {
        explMeaning.textContent = langDetails.meaning || '';
        explContext.textContent = langDetails.context || '';
        explExample.textContent = langDetails.example || '';
        wordExplanation.style.display = 'block';
    } else {
        wordExplanation.style.display = 'none';
    }

    // ── multiChoice quiz (same page, below explanation)
    const quiz = (quizData as any)[word.id];
    if (!quiz) {
        // No quiz — just unlock Next immediately
        introQuizAnswered = true;
        btnNext.disabled = false;
        wordQuiz.style.display = 'none';
    } else if (introQuizAnswered) {
        // Already answered — show quiz panel locked (read-only feedback visible)
        wordQuiz.style.display = 'block';
        quizQuestion.textContent = quiz.question;
        btnNext.disabled = false;
    } else {
        // Show fresh quiz
        wordQuiz.style.display = 'block';
        quizQuestion.textContent = quiz.question;
        quizFeedback.style.display = 'none';

        const disabledIndices = new Set<number>();
        const tryQuiz = (keepFeedback = false) => {
            if (!keepFeedback) quizFeedback.style.display = 'none';
            renderQuizOptions(quiz, (correct, chosenIdx) => {
                if (correct) {
                    introQuizAnswered = true;
                    savePoolState(currentUser?.uid);
                    quizFeedback.textContent = '✓ Correct!';
                    quizFeedback.className = 'quiz-feedback feedback-correct';
                    quizFeedback.style.display = 'block';
                    btnNext.disabled = false;
                } else {
                    disabledIndices.add(chosenIdx);
                    quizFeedback.textContent = '✗ Not quite — try again!';
                    quizFeedback.className = 'quiz-feedback feedback-wrong';
                    quizFeedback.style.display = 'block';
                    tryQuiz(true);
                }
            }, false, disabledIndices);
        };
        tryQuiz();
    }

}

// ─── QUIZ PHASE: show next quiz task from queue ───────────────────────
function showNextQuiz() {
    // Rebuild queue if empty
    if (quizQueue.length === 0) {
        buildQuizQueue();
        savePoolState(currentUser?.uid);
    }

    if (quizQueue.length === 0) {
        // No quiz items left — check if truly done
        if (activePool.length === 0 && pendingWordIds.length === 0) {
            showCompletionScreen();
        }
        // Otherwise some words are in intro phase — displayCurrentWord handles it
        return;
    }

    const task = quizQueue.shift()!;
    savePoolState(currentUser?.uid);

    // Make sure this word/stage is still valid (not already completed or word moved back to intro)
    const item = activePool.find(i => i.wordId === task.wordId && i.phase === 'quiz');
    if (!item || item.completedStages.includes(task.stage)) {
        // Stale task — skip
        showNextQuiz();
        return;
    }

    const word = tier2Words.find(w => w.id === task.wordId);
    if (!word) { showNextQuiz(); return; }

    wordMain.textContent = word.en;
    meaningText.textContent = word[currentLang] || word.ru;
    wordMeaning.style.display = 'none';
    btnPrev.disabled = true;
    btnNext.disabled = true;
    btnNext.onclick = null;

    const quiz = (quizData as any)[word.id];
    const stageQuiz = task.stage === 'fillBlank' ? quiz?.fillBlank
                    : task.stage === 'fillBlank2' ? quiz?.fillBlank2
                    : task.stage === 'fillBlank3' ? quiz?.fillBlank3
                    : task.stage === 'scenario'  ? quiz?.scenario
                    : task.stage === 'scenario2' ? quiz?.scenario2
                    : task.stage === 'scenario3' ? quiz?.scenario3
                    : quiz;

    renderQuizTask(word, item, stageQuiz, task.stage);
}

function renderQuizTask(word: any, item: PoolItem, quiz: any, stageType: QuizStage) {
    if (!quiz) {
        // No quiz for this stage — advance stage
        advanceQuizStage(item, true);
        showNextQuiz();
        return;
    }

    const stageBadge = {
        multiChoice: '📝 Multiple choice',
        fillBlank: '✏️ Fill in the blank',
        fillBlank2: '✏️ Fill in the blank 2',
        fillBlank3: '✏️ Fill in the blank 3',
        scenario: '🎭 Scenario',
        scenario2: '🎭 Scenario 2',
        scenario3: '🎭 Scenario 3'
    }[stageType];

    quizAttempts.innerHTML = `<span class="check-badge">${stageBadge}</span>`;
    quizQuestion.textContent = quiz.question;
    wordQuiz.style.display = 'block';

    const MAX_ATTEMPTS = stageType === 'multiChoice' ? 3 : 2;

    renderAttemptsUI(MAX_ATTEMPTS - item.attempts, MAX_ATTEMPTS, stageType);
    quizFeedback.style.display = 'none';

    renderQuizOptions(quiz, (correct) => {
        if (correct) {
            quizFeedback.textContent = '✓ Correct!';
            quizFeedback.className = 'quiz-feedback feedback-correct';
            quizFeedback.style.display = 'block';
            item.attempts = 0;
            markStageCompleted(item, stageType);
            savePoolState(currentUser?.uid);

            if (item.phase === 'mastered') {
                setTimeout(() => handleMastered(item), 800);
            } else {
                setTimeout(showNextQuiz, 800);
            }
        } else {
            item.attempts++;
            const attemptsLeft = MAX_ATTEMPTS - item.attempts;

            if (attemptsLeft <= 0) {
                quizFeedback.textContent = '✗ Incorrect. Review this word.';
                quizFeedback.className = 'quiz-feedback feedback-wrong';
                quizFeedback.style.display = 'block';
                // Send word back to intro phase — reset completedStages
                item.phase = 'intro';
                item.completedStages = [];
                item.attempts = 0;
                applyStatus(item.wordId, 'unknown');
                savePoolState(currentUser?.uid);
                // Redirect to word-details page
                setTimeout(() => {
                    window.location.href = `/word-details.html?word=${item.wordId}`;
                }, 1500);
            } else {
                quizFeedback.textContent = `✗ Not quite — try again! (${attemptsLeft} attempt${attemptsLeft > 1 ? 's' : ''} left)`;
                quizFeedback.className = 'quiz-feedback feedback-wrong';
                quizFeedback.style.display = 'block';
                renderAttemptsUI(attemptsLeft, MAX_ATTEMPTS, stageType);
                savePoolState(currentUser?.uid);
                setTimeout(() => {
                    quizFeedback.style.display = 'none';
                    renderQuizTask(word, item, quiz, stageType);
                }, 1200);
            }
        }
    });
}

function markStageCompleted(item: PoolItem, stage: QuizStage) {
    if (!item.completedStages.includes(stage)) {
        item.completedStages.push(stage);
    }
    const quiz = (quizData as any)[item.wordId];
    const needsFill = !!quiz?.fillBlank;
    const needsFill2 = !!quiz?.fillBlank2;
    const needsFill3 = !!quiz?.fillBlank3;
    const needsScen = !!quiz?.scenario;
    const needsScen2 = !!quiz?.scenario2;
    const needsScen3 = !!quiz?.scenario3;

    const fillDone = !needsFill || item.completedStages.includes('fillBlank');
    const fill2Done = !needsFill2 || item.completedStages.includes('fillBlank2');
    const fill3Done = !needsFill3 || item.completedStages.includes('fillBlank3');
    const scenDone = !needsScen || item.completedStages.includes('scenario');
    const scen2Done = !needsScen2 || item.completedStages.includes('scenario2');
    const scen3Done = !needsScen3 || item.completedStages.includes('scenario3');

    if (fillDone && fill2Done && fill3Done && scenDone && scen2Done && scen3Done) {
        item.phase = 'mastered';
        masteredIds.add(item.wordId);
        applyStatus(item.wordId, 'known');
    } else {
        applyStatus(item.wordId, 'unsure');
    }
}

function handleMastered(item: PoolItem) {
    // Remove mastered item from pool
    activePool = activePool.filter(i => i !== item);

    // Add 1 new word in intro phase
    if (pendingWordIds.length > 0) {
        const wordId = pendingWordIds.shift()!;
        activePool.push({ wordId, phase: 'intro', quizStage: 'multiChoice', attempts: 0, completedStages: [] });
        introPhase = true;
        introCursor = 0;
        introQuizAnswered = false;
    }

    updateStats();
    savePoolState(currentUser?.uid);

    if (activePool.length === 0 && pendingWordIds.length === 0) {
        showCompletionScreen();
        return;
    }

    displayCurrentWord();
}

function renderAttemptsUI(attemptsLeft: number, max: number, stageType: string) {
    if (stageType !== 'multiChoice') return;
    const dots = Array.from({ length: max }, (_, i) =>
        `<span class="attempt-dot ${i < attemptsLeft ? 'dot-active' : 'dot-used'}"></span>`
    ).join('');
    quizAttempts.innerHTML = `<span class="attempts-label">Attempts:</span>${dots}`;
}

function renderQuizOptions(quiz: any, onAnswer: (correct: boolean, chosenIdx: number) => void, showCorrectOnWrong = true, disabledIndices: Set<number> = new Set()) {
    quizOptions.innerHTML = quiz.options.map((opt: string, i: number) =>
        `<button class="quiz-option" data-index="${i}">${opt}</button>`
    ).join('');

    quizOptions.querySelectorAll('.quiz-option').forEach((btn: Element) => {
        const idx = parseInt((btn as HTMLElement).dataset.index);
        if (disabledIndices.has(idx)) {
            (btn as HTMLButtonElement).disabled = true;
            btn.classList.add('wrong');
        } else {
            btn.addEventListener('click', () => {
                const correct = idx === quiz.correct;
                quizOptions.querySelectorAll('.quiz-option').forEach((b: Element, i: number) => {
                    if (correct && i === quiz.correct) b.classList.add('correct');
                    else if (!correct && showCorrectOnWrong && i === quiz.correct) b.classList.add('correct');
                    else if (i === idx && !correct) b.classList.add('wrong');
                    (b as HTMLButtonElement).disabled = true;
                });
                onAnswer(correct, idx);
            }, { once: true });
        }
    });
}

// ─── Navigation ───────────────────────────────────────────────────────
function nextWord() {
    if (introPhase) {
        if (!introQuizAnswered) return; // locked until quiz answered
        introCursor++;
        introQuizAnswered = false;
        savePoolState(currentUser?.uid);
        displayCurrentWord();
    } else {
        showNextQuiz();
    }
}

function prevWord() {
    if (introPhase && introCursor > 0) {
        introCursor--;
        introQuizAnswered = true; // already answered when we were on this word
        savePoolState(currentUser?.uid);
        displayCurrentWord();
    }
}

// ─── Session finish ───────────────────────────────────────────────────
async function finishSession(completed: boolean) {
    stopTimer();
    if (currentUser && totalStudySeconds > 0 && sessionWordsReviewed > 0) {
        try {
            await saveSession(currentUser.uid, 'tier2', totalStudySeconds,
                sessionWordsReviewed, sessionKnown, sessionUnsure, sessionUnknown, completed);
        } catch (error) { console.error('Error saving session:', error); }
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

setInterval(saveProgress, 30000);
