import { auth, onAuthStateChanged, logOut, getCachedAuthState, cacheAuthState } from '../services/firebase';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import { setAvatar } from '../utils/avatar';
import { quizData } from '../data/quiz-data';

const db = getFirestore();
let currentUser = null;
let quizWords = [];
let currentQuestionIndex = 0;
let userAnswers = [];
let shuffledOptions = []; // Store shuffled options for each question
let score = 0;

// Elements
const userProfile = document.getElementById('userProfile');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const userInfoTrigger = document.getElementById('userInfoTrigger');
const userDropdown = document.getElementById('userDropdown');
const signOutBtn = document.getElementById('signOutBtn');
const languageBtn = document.getElementById('languageBtn');
const languageDropdown = document.getElementById('languageDropdown');
const languageOptions = document.querySelectorAll('.language-option');

const languages = {
    ru: { flag: '🇷🇺', code: 'RU' },
    en: { flag: '🇬🇧', code: 'EN' },
    zh: { flag: '🇨🇳', code: 'ZH' }
};

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

        const flagSpan = languageBtn.querySelector('.flag');
        const langText = languageBtn.querySelector('.lang-text');
        flagSpan.textContent = languages[lang].flag;
        langText.textContent = languages[lang].code;

        languageOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');

        languageBtn.classList.remove('active');
        languageDropdown.classList.remove('active');

        localStorage.setItem('preferred-language', lang);
    });
});

// Initialize language from localStorage
const savedLang = localStorage.getItem('preferred-language');
if (savedLang && languages[savedLang]) {
    const flagSpan = languageBtn.querySelector('.flag');
    const langText = languageBtn.querySelector('.lang-text');
    flagSpan.textContent = languages[savedLang].flag;
    langText.textContent = languages[savedLang].code;

    languageOptions.forEach(opt => {
        if (opt.dataset.lang === savedLang) {
            opt.classList.add('selected');
        }
    });
}

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
const questionNumber = document.getElementById('questionNumber');
const totalQuestions = document.getElementById('totalQuestions');
const quizProgressFill = document.getElementById('quizProgressFill');
const quizQuestion = document.getElementById('quizQuestion');
const quizOptions = document.getElementById('quizOptions');
const quizFeedback = document.getElementById('quizFeedback');
const feedbackIcon = document.getElementById('feedbackIcon');
const feedbackText = document.getElementById('feedbackText');
const btnPrevQuestion = document.getElementById('btnPrevQuestion');
const btnNextQuestion = document.getElementById('btnNextQuestion');
const quizResults = document.getElementById('quizResults');
const finalScore = document.getElementById('finalScore');
const finalTotal = document.getElementById('finalTotal');
const correctCount = document.getElementById('correctCount');
const incorrectCount = document.getElementById('incorrectCount');
const btnRetakeQuiz = document.getElementById('btnRetakeQuiz');

// Auth
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        cacheAuthState(user);
        userProfile.style.display = 'flex';
        setAvatar(userAvatar as HTMLImageElement, user.photoURL, user.displayName || user.email, 36);
        userName.textContent = user.displayName || user.email;

        // Load quiz words
        loadQuiz();
    } else {
        cacheAuthState(null);
        alert('Пожалуйста, войдите в систему');
        window.location.href = '/';
    }
});

// Load quiz
function loadQuiz() {
    const wordIds = JSON.parse(sessionStorage.getItem('quizWords'));

    if (!wordIds || wordIds.length === 0) {
        alert('Нет слов для квиза');
        window.location.href = '/word-list';
        return;
    }

    // Filter words that have quiz data
    quizWords = wordIds.filter(id => quizData[id]);

    if (quizWords.length === 0) {
        alert('Квизы для этих слов еще не добавлены');
        window.location.href = '/word-list';
        return;
    }

    // Shuffle quiz words
    quizWords = shuffleArray(quizWords);

    totalQuestions.textContent = quizWords.length;
    userAnswers = new Array(quizWords.length).fill(null);
    shuffledOptions = []; // Reset shuffled options for new quiz

    displayQuestion();
}

// Shuffle array
function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

// Display question
function displayQuestion() {
    const wordId = quizWords[currentQuestionIndex];
    const quiz = quizData[wordId];

    if (!quiz) {
        console.error('Quiz not found for:', wordId);
        return;
    }

    console.log('=== displayQuestion ===');
    console.log('currentQuestionIndex:', currentQuestionIndex);
    console.log('shuffledOptions.length:', shuffledOptions.length);
    console.log('shuffledOptions[currentQuestionIndex]:', shuffledOptions[currentQuestionIndex]);

    // Update progress
    questionNumber.textContent = currentQuestionIndex + 1;
    quizProgressFill.style.width = `${((currentQuestionIndex + 1) / quizWords.length) * 100}%`;

    // Update question
    quizQuestion.textContent = quiz.question;

    // Shuffle options if not already answered
    if (!shuffledOptions[currentQuestionIndex]) {
        const optionsWithIndex = quiz.options.map((option, index) => ({ option, originalIndex: index }));
        shuffledOptions[currentQuestionIndex] = shuffleArray(optionsWithIndex);
        console.log('Shuffled options for question', currentQuestionIndex, ':', shuffledOptions[currentQuestionIndex].map(o => o.originalIndex));
    }

    const shuffled = shuffledOptions[currentQuestionIndex];
    console.log('Question:', wordId, 'Correct answer original index:', quiz.correct);

    // Update options
    quizOptions.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];

    // Find the new position of the correct answer after shuffling
    const correctShuffledIndex = shuffled.findIndex(item => item.originalIndex === quiz.correct);

    shuffled.forEach((item, shuffledIndex) => {
        const option = item.option;
        const originalIndex = item.originalIndex;
        const optionEl = document.createElement('button');
        optionEl.className = 'quiz-option';
        optionEl.innerHTML = `
            <span class="option-letter">${letters[shuffledIndex]}</span>
            <span class="option-text">${option}</span>
        `;

        // Show previous answer if exists
        if (userAnswers[currentQuestionIndex] !== null) {
            const selectedShuffledIndex = shuffled.findIndex(item => item.originalIndex === userAnswers[currentQuestionIndex]);
            if (shuffledIndex === selectedShuffledIndex) {
                optionEl.classList.add('selected');
            }
            if (shuffledIndex === correctShuffledIndex) {
                optionEl.classList.add('correct');
            }
            if (selectedShuffledIndex !== correctShuffledIndex && shuffledIndex === selectedShuffledIndex) {
                optionEl.classList.add('incorrect');
            }
            btnNextQuestion.disabled = false;
        }

        optionEl.addEventListener('click', () => selectOption(shuffledIndex, correctShuffledIndex));
        quizOptions.appendChild(optionEl);
    });

    // Update navigation
    btnPrevQuestion.disabled = currentQuestionIndex === 0;
    btnNextQuestion.disabled = userAnswers[currentQuestionIndex] === null;

    // Hide feedback initially
    if (userAnswers[currentQuestionIndex] === null) {
        quizFeedback.style.display = 'none';
    }
}

// Select option
function selectOption(selectedShuffledIndex, correctShuffledIndex) {
    if (userAnswers[currentQuestionIndex] !== null) return; // Already answered

    const shuffled = shuffledOptions[currentQuestionIndex];
    const selectedOriginalIndex = shuffled[selectedShuffledIndex].originalIndex;
    const correctOriginalIndex = shuffled[correctShuffledIndex].originalIndex;

    userAnswers[currentQuestionIndex] = selectedOriginalIndex;

    // Disable all options
    const options = quizOptions.querySelectorAll('.quiz-option');
    options.forEach(opt => opt.classList.add('disabled'));

    // Mark correct and incorrect
    options[correctShuffledIndex].classList.add('correct');
    if (selectedShuffledIndex !== correctShuffledIndex) {
        options[selectedShuffledIndex].classList.add('incorrect');
    } else {
        score++;
    }

    showFeedback(selectedOriginalIndex, correctOriginalIndex);
    btnNextQuestion.disabled = false;
}

// Show feedback
function showFeedback(selectedIndex, correctIndex) {
    quizFeedback.style.display = 'flex';

    if (selectedIndex === correctIndex) {
        quizFeedback.className = 'quiz-feedback correct';
        feedbackIcon.textContent = '✓';
        feedbackText.textContent = 'Правильно!';
    } else {
        quizFeedback.className = 'quiz-feedback incorrect';
        feedbackIcon.textContent = '✗';
        feedbackText.textContent = 'Неправильно. Правильный ответ выделен зеленым.';
    }
}

// Next question
btnNextQuestion.addEventListener('click', () => {
    if (currentQuestionIndex < quizWords.length - 1) {
        currentQuestionIndex++;
        displayQuestion();
    } else {
        showResults();
    }
});

// Previous question
btnPrevQuestion.addEventListener('click', () => {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        displayQuestion();
    }
});

// Show results
function showResults() {
    const correct = userAnswers.filter((answer, index) => {
        const wordId = quizWords[index];
        const quiz = quizData[wordId];
        return answer === quiz.correct;
    }).length;

    const incorrect = quizWords.length - correct;

    finalScore.textContent = correct;
    finalTotal.textContent = quizWords.length;
    correctCount.textContent = correct;
    incorrectCount.textContent = incorrect;

    quizResults.style.display = 'flex';

    // Save quiz results to Firestore
    saveQuizResults(correct, quizWords.length);
}

// Save quiz results
async function saveQuizResults(score, total) {
    if (!currentUser) return;

    try {
        const quizStatus = sessionStorage.getItem('quizStatus');
        await setDoc(doc(db, 'users', currentUser.uid, 'quizResults', `quiz_${Date.now()}`), {
            score,
            total,
            percentage: Math.round((score / total) * 100),
            status: quizStatus,
            words: quizWords,
            timestamp: new Date().toISOString()
        });
        console.log('Quiz results saved');
    } catch (error) {
        console.error('Error saving quiz results:', error);
    }
}

// Retake quiz
btnRetakeQuiz.addEventListener('click', () => {
    console.log('=== RETAKE QUIZ ===');
    console.log('Before shuffle, first 3 words:', quizWords.slice(0, 3));
    currentQuestionIndex = 0;
    userAnswers = new Array(quizWords.length).fill(null);
    shuffledOptions = []; // Reset shuffled options for new quiz
    score = 0;
    quizResults.style.display = 'none';
    quizWords = shuffleArray(quizWords);
    console.log('After shuffle, first 3 words:', quizWords.slice(0, 3));
    displayQuestion();
});
