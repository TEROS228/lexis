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

type QuizStage = 'multiChoice' | 'listening' | 'fillBlank' | 'fillBlank2' | 'fillBlank3' | 'scenario' | 'scenario2' | 'scenario3';

interface PoolItem {
    wordId: string;
    // 'intro'    = showing explanation + multiChoice
    // 'quiz'     = in fillBlank/scenario rotation
    // 'mastered' = done
    phase: 'intro' | 'quiz' | 'mastered';
    quizStage: QuizStage;  // kept for localStorage compat, not used in quiz phase
    attempts: number;
    completedStages: QuizStage[];  // which quiz stages have been passed
    isReview?: boolean;  // true if word returned after wrong answer
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
let listeningQuizAnswered = false;

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
            listeningQuizAnswered = s.listeningQuizAnswered || false;
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
            introQuizAnswered,
            listeningQuizAnswered
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
    listeningQuizAnswered = false;
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
const timerToggleBtn = document.getElementById('timerToggleBtn');
const timerContent = document.getElementById('timerContent');
const endSessionBtn = document.getElementById('endSessionBtn');
const endSessionModal = document.getElementById('endSessionModal');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');
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

    // Scroll to top of page
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Hide everything first
    wordExplanation.style.display = 'none';
    wordQuiz.style.display = 'none';
    wordActions.style.display = 'none';
    quizFeedback.style.display = 'none';
    quizAttempts.innerHTML = '';
    btnKnow.onclick = null;
    btnUnsure.onclick = null;
    btnUnknown.onclick = null;

    // Show content first
    if (introPhase) {
        showIntroWord();
    } else {
        showNextQuiz();
    }

    // Add slide-in animation after a brief delay to ensure content is rendered
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const wordCard = document.querySelector('.word-card-large') as HTMLElement;
            if (wordCard) {
                wordCard.style.opacity = '1';
                wordCard.style.animation = 'slideInRight 0.4s ease-in-out';
                setTimeout(() => {
                    wordCard.style.animation = '';
                }, 400);
            }
        });
    });
}

// ─── Speech Synthesis Helper ──────────────────────────────────────────
function speakWord(text: string) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.7;

    const voices = speechSynthesis.getVoices();
    const englishVoice = voices.find(v =>
        v.lang.startsWith('en-') && (v.name.includes('Google') || v.name.includes('Microsoft') || v.name.includes('Samantha') || v.name.includes('Alex'))
    ) || voices.find(v => v.lang.startsWith('en-'));

    if (englishVoice) {
        utterance.voice = englishVoice;
    }

    speechSynthesis.speak(utterance);
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
    wordMain.innerHTML = `
        ${word.en}
        <button class="speak-btn" style="margin-left: 12px; background: none; border: none; cursor: pointer; font-size: 24px;" title="Listen to pronunciation">
            🔊
        </button>
    `;

    // Add click handler for speak button
    const speakBtn = wordMain.querySelector('.speak-btn') as HTMLButtonElement;
    if (speakBtn) {
        speakBtn.onclick = (e) => {
            e.stopPropagation();
            const utterance = new SpeechSynthesisUtterance(word.en);
            utterance.lang = 'en-US';
            utterance.rate = 0.7; // slower for learning

            // Try to find and use an English voice
            const voices = speechSynthesis.getVoices();
            const englishVoice = voices.find(v =>
                v.lang.startsWith('en-') && (v.name.includes('Google') || v.name.includes('Microsoft') || v.name.includes('Samantha') || v.name.includes('Alex'))
            ) || voices.find(v => v.lang.startsWith('en-'));

            if (englishVoice) {
                utterance.voice = englishVoice;
            }

            speechSynthesis.speak(utterance);
        };
    }

    meaningText.textContent = word[currentLang] || word.ru;
    wordMeaning.style.display = 'none';
    wordActions.style.display = 'none';

    // Show eye button in intro phase (before quizzes)
    showMeaningBtn.style.display = 'inline-block';

    btnPrev.disabled = introCursor === 0;
    btnNext.disabled = !introQuizAnswered;
    btnNext.onclick = null;

    // Auto-play pronunciation when word first appears
    if (!introQuizAnswered) {
        setTimeout(() => speakWord(word.en), 500);
    }

    // ── Badge
    if (item.isReview) {
        quizAttempts.innerHTML = `<span class="check-badge">🔄 Review</span>`;
    } else {
        quizAttempts.innerHTML = `<span class="check-badge">📖 ${introCursor + 1} / ${totalInPool}</span>`;
    }

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
        listeningQuizAnswered = true;
        btnNext.disabled = false;
        wordQuiz.style.display = 'none';
    } else if (introQuizAnswered && listeningQuizAnswered) {
        // Both quizzes completed — show as read-only, unlock Next
        wordQuiz.style.display = 'block';
        quizQuestion.textContent = quiz.question;
        btnNext.disabled = false;
    } else if (introQuizAnswered && !listeningQuizAnswered) {
        // MultiChoice done, but listening not done — show listening quiz
        wordQuiz.style.display = 'block';
        showListeningQuiz(word, item);
    } else {
        // Show fresh multiChoice quiz
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
                    quizFeedback.textContent = '✓ Correct! Now write what you hear...';
                    quizFeedback.className = 'quiz-feedback feedback-correct';
                    quizFeedback.style.display = 'block';

                    // Slide out and show listening quiz with animation
                    setTimeout(() => {
                        const wordCard = document.querySelector('.word-card-large') as HTMLElement;
                        if (wordCard) {
                            wordCard.style.animation = 'slideOutLeft 0.4s ease-in-out';
                            setTimeout(() => {
                                // Hide card while loading new content
                                wordCard.style.opacity = '0';
                                wordCard.style.animation = '';
                                showListeningQuiz(word, item);

                                // Show with slide-in animation
                                requestAnimationFrame(() => {
                                    requestAnimationFrame(() => {
                                        wordCard.style.opacity = '1';
                                        wordCard.style.animation = 'slideInRight 0.4s ease-in-out';
                                        setTimeout(() => {
                                            wordCard.style.animation = '';
                                        }, 400);
                                    });
                                });
                            }, 400);
                        }
                    }, 1500);
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

// ─── LISTENING QUIZ: type what you hear ────────────────────────────────
function showListeningQuiz(word: any, item: PoolItem) {
    // Hide explanation when showing listening quiz
    wordExplanation.style.display = 'none';

    // Hide word header to not give away the answer
    wordMain.textContent = '';

    // Hide eye button during quiz
    showMeaningBtn.style.display = 'none';

    quizQuestion.innerHTML = `
        <div style="text-align: center; margin-bottom: 40px; width: 100%;">
            <div style="display: inline-block; background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); padding: 12px 32px; border-radius: 50px; margin-bottom: 20px; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);">
                <span style="font-size: 14px; font-weight: 700; color: white; text-transform: uppercase; letter-spacing: 1.5px; -webkit-text-fill-color: white;">🎧 Listening Practice</span>
            </div>
            <h3 style="font-size: 36px; font-weight: 900; background: linear-gradient(135deg, #fbbf24, #f59e0b); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; margin: 0; text-shadow: 0 0 30px rgba(251, 191, 36, 0.3);">Listen and type the word</h3>
            <p style="color: #fbbf24; margin-top: 16px; font-size: 17px; font-weight: 500; -webkit-text-fill-color: #fbbf24;">Click the speaker button to hear the word 🔊</p>
        </div>
    `;

    quizOptions.innerHTML = `
        <div style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(147, 51, 234, 0.15) 100%); backdrop-filter: blur(20px); border-radius: 28px; padding: 50px 45px; border: 2px solid rgba(59, 130, 246, 0.3); box-shadow: 0 12px 40px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.1);">
            <button class="listen-btn-animated" id="listenBtn">
                <svg viewBox="0 0 24 24" style="width: 52px; height: 52px; stroke: white; stroke-width: 2.2; fill: none; stroke-linecap: round; stroke-linejoin: round;">
                    <polygon points="5 9 9 9 14 5 14 19 9 15 5 15"></polygon>
                    <path d="M17 9c1.2 1 1.8 2 1.8 3s-.6 2-1.8 3"></path>
                </svg>
            </button>
            <div style="background: white; border-radius: 18px; padding: 4px; margin-top: 35px; margin-bottom: 24px; box-shadow: 0 4px 20px rgba(59, 130, 246, 0.2);">
                <input type="text" id="listeningInput" class="listening-input" placeholder="Type the word here..." autocomplete="off" style="background: white; color: #1f2937; border: none; box-shadow: none;" />
            </div>
            <button id="listeningSubmit" class="listening-submit">
                <span style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span>Check Answer</span>
                </span>
            </button>
        </div>
    `;

    const speakBtnLarge = quizOptions.querySelector('#listenBtn') as HTMLButtonElement;
    const input = document.getElementById('listeningInput') as HTMLInputElement;
    const submitBtn = document.getElementById('listeningSubmit') as HTMLButtonElement;

    // Auto-play once with animation
    setTimeout(() => {
        speakBtnLarge.classList.add('playing');
        speakWord(word.en);
        setTimeout(() => speakBtnLarge.classList.remove('playing'), 1000);
    }, 300);

    speakBtnLarge.onclick = () => {
        speakBtnLarge.classList.add('playing');
        speakWord(word.en);
        setTimeout(() => speakBtnLarge.classList.remove('playing'), 1000);
    };

    const checkAnswer = () => {
        const userAnswer = input.value.trim().toLowerCase();
        const correctAnswer = word.en.toLowerCase();

        if (userAnswer === correctAnswer) {
            // Hide speaker and submit button, show user answer in input
            speakBtnLarge.style.display = 'none';
            submitBtn.style.display = 'none';
            input.disabled = true;
            input.style.color = '#10b981';
            input.style.fontWeight = '700';

            quizFeedback.textContent = '✓ Perfect! You got it right! 🎉';
            quizFeedback.className = 'quiz-feedback feedback-correct';
            quizFeedback.style.display = 'block';
            listeningQuizAnswered = true;
            btnNext.disabled = false;
            savePoolState(currentUser?.uid);

            // Auto-advance after 1.5 seconds with slide animation
            setTimeout(() => {
                const wordCard = document.querySelector('.word-card-large') as HTMLElement;
                if (wordCard) {
                    wordCard.style.animation = 'slideOutLeft 0.4s ease-in-out';
                    setTimeout(() => {
                        // Hide card while loading new content
                        wordCard.style.opacity = '0';
                        wordCard.style.animation = '';
                        btnNext.click();
                    }, 400);
                }
            }, 1500);
        } else {
            // Show correct answer in input field
            speakBtnLarge.style.display = 'none';
            submitBtn.style.display = 'none';
            input.value = word.en;
            input.disabled = true;
            input.style.color = '#ef4444';
            input.style.fontWeight = '700';

            quizFeedback.textContent = `✗ Wrong. Correct word: "${word.en}".`;
            quizFeedback.className = 'quiz-feedback feedback-wrong';
            quizFeedback.style.display = 'block';
            listeningQuizAnswered = true;
            btnNext.disabled = false;
            savePoolState(currentUser?.uid);

            // Auto-advance after 2 seconds with slide animation
            setTimeout(() => {
                const wordCard = document.querySelector('.word-card-large') as HTMLElement;
                if (wordCard) {
                    wordCard.style.animation = 'slideOutLeft 0.4s ease-in-out';
                    setTimeout(() => {
                        // Hide card while loading new content
                        wordCard.style.opacity = '0';
                        wordCard.style.animation = '';
                        btnNext.click();
                    }, 400);
                }
            }, 2000);
        }
    };

    submitBtn.onclick = checkAnswer;
    input.onkeypress = (e) => {
        if (e.key === 'Enter') checkAnswer();
    };

    // Focus input after a slight delay to prevent auto-scroll on load
    setTimeout(() => {
        input.focus({ preventScroll: true });
    }, 100);
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

    // Hide word for fillBlank and scenario quizzes
    wordMain.textContent = '';
    meaningText.textContent = word[currentLang] || word.ru;
    wordMeaning.style.display = 'none';

    // Hide eye button during quiz
    showMeaningBtn.style.display = 'none';

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

    const MAX_ATTEMPTS = stageType === 'multiChoice' ? 3 : 1;

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

            // Auto-advance after 1.5 seconds with slide animation
            setTimeout(() => {
                const wordCard = document.querySelector('.word-card-large') as HTMLElement;
                if (wordCard) {
                    wordCard.style.animation = 'slideOutLeft 0.4s ease-in-out';
                    setTimeout(() => {
                        // Hide card while loading new content
                        wordCard.style.opacity = '0';
                        wordCard.style.animation = '';

                        if (item.phase === 'mastered') {
                            handleMastered(item);
                        } else {
                            showNextQuiz();
                        }
                    }, 400);
                }
            }, 1500);
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
                item.isReview = true;  // Mark as review
                applyStatus(item.wordId, 'unknown');
                // Move to front of intro cursor
                introPhase = true;
                const introItems = activePool.filter(i => i.phase === 'intro');
                introCursor = introItems.findIndex(i => i.wordId === item.wordId);
                if (introCursor === -1) introCursor = 0;
                introQuizAnswered = false;
                listeningQuizAnswered = false;
                savePoolState(currentUser?.uid);

                // Auto-advance after 2 seconds with slide animation
                setTimeout(() => {
                    const wordCard = document.querySelector('.word-card-large') as HTMLElement;
                    if (wordCard) {
                        wordCard.style.animation = 'slideOutLeft 0.4s ease-in-out';
                        setTimeout(() => {
                            // Hide card while loading new content
                            wordCard.style.opacity = '0';
                            wordCard.style.animation = '';
                            displayCurrentWord();
                        }, 400);
                    }
                }, 2000);
            } else {
                quizFeedback.textContent = `✗ Not quite — try again! (${attemptsLeft} attempt${attemptsLeft > 1 ? 's' : ''} left)`;
                quizFeedback.className = 'quiz-feedback feedback-wrong';
                quizFeedback.style.display = 'block';
                renderAttemptsUI(attemptsLeft, MAX_ATTEMPTS, stageType);
                savePoolState(currentUser?.uid);
                setTimeout(() => {
                    quizFeedback.style.display = 'none';
                    renderQuizTask(word, item, quiz, stageType);
                }, 1500);
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
        listeningQuizAnswered = false;
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
        if (!introQuizAnswered || !listeningQuizAnswered) return; // locked until both quizzes answered
        // Reset isReview flag when moving to next word
        const introItems = activePool.filter(i => i.phase === 'intro');
        if (introItems[introCursor]) {
            introItems[introCursor].isReview = false;
        }
        introCursor++;
        introQuizAnswered = false;
        listeningQuizAnswered = false;
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
        listeningQuizAnswered = true; // already answered when we were on this word
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

// Timer toggle functionality
timerToggleBtn?.addEventListener('click', () => {
    timerContent?.classList.toggle('hidden');
});

// End session button - show modal
endSessionBtn?.addEventListener('click', () => {
    if (endSessionModal) {
        endSessionModal.style.display = 'flex';
    }
});

// Modal cancel button
modalCancelBtn?.addEventListener('click', () => {
    if (endSessionModal) {
        endSessionModal.style.display = 'none';
    }
});

// Modal confirm button
modalConfirmBtn?.addEventListener('click', () => {
    saveProgress();
    finishSession(false);
    window.location.href = '/';
});

// Close modal on overlay click
endSessionModal?.addEventListener('click', (e) => {
    if (e.target === endSessionModal) {
        endSessionModal.style.display = 'none';
    }
});

document.getElementById('btnViewUnknown')?.addEventListener('click', () => {
    alert('Функция в разработке');
});

setInterval(saveProgress, 30000);
