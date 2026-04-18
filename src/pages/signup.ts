import {
  auth,
  onAuthStateChanged,
  signInWithGoogle,
  signUpWithEmail,
  updateProfile
} from '../services/firebase';
import { initUserProfile, saveUserRoleAndLanguage, getUserProfile } from '../db';

// Toast notification
const successToast = document.getElementById('successToast');
const toastTitle = document.getElementById('toastTitle');
const toastMessage = document.getElementById('toastMessage');
const toastIcon = document.getElementById('toastIcon');

const toastIcons = {
    success: '✓',
    info: '→',
};

function showToast(title: string, message: string, duration: number = 4000, type: 'success' | 'info' = 'success') {
    toastTitle.textContent = title;
    toastMessage.textContent = message;
    toastIcon.textContent = toastIcons[type];
    successToast.classList.remove('toast-type-info', 'toast-type-success');
    successToast.classList.add(`toast-type-${type}`, 'show');

    setTimeout(() => {
        successToast.classList.remove('show');
    }, duration);
}

// Role selection modal
const roleModal = document.getElementById('roleModal');
const selectTeacher = document.getElementById('selectTeacher');
const selectStudent = document.getElementById('selectStudent');
const roleStep = document.getElementById('roleStep');

let selectedRole = null;
let pendingUser = null;

// Show role modal
function showRoleModal() {
    roleModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Reset to first step
    const teacherNameStep = document.getElementById('teacherNameStep');
    roleStep.classList.add('active');
    roleStep.classList.remove('slide-out');
    if (teacherNameStep) {
        teacherNameStep.classList.remove('active');
        teacherNameStep.classList.remove('slide-out');
    }
}

// Hide role modal
function hideRoleModal() {
    roleModal.classList.add('fade-out');

    setTimeout(() => {
        roleModal.style.display = 'none';
        roleModal.classList.remove('fade-out');
        document.body.style.overflow = '';
        selectedRole = null;
        pendingUser = null;
        selectTeacher.classList.remove('selected');
        selectStudent.classList.remove('selected');

        // Redirect to tiers page after role selection
        window.location.href = '/tiers.html';
    }, 300);
}

// Teacher selection
selectTeacher.addEventListener('click', () => {
    selectedRole = 'teacher';
    selectTeacher.classList.add('selected');
    selectStudent.classList.remove('selected');

    setTimeout(() => {
        slideToTeacherName();
    }, 300);
});

function slideToTeacherName() {
    const roleStep = document.getElementById('roleStep');
    const teacherNameStep = document.getElementById('teacherNameStep');

    roleStep.classList.remove('active');
    roleStep.classList.add('slide-out');
    teacherNameStep.classList.add('active');
}

// Confirm teacher name
const confirmTeacherNameBtn = document.getElementById('confirmTeacherName');
const teacherNameInput = document.getElementById('teacherNameInput') as HTMLInputElement;

confirmTeacherNameBtn.addEventListener('click', async () => {
    const teacherName = teacherNameInput.value.trim();

    if (!teacherName) {
        alert('Please enter your name');
        return;
    }

    if (pendingUser) {
        try {
            await updateProfile(pendingUser, {
                displayName: teacherName
            });

            await saveUserRoleAndLanguage(pendingUser.uid, 'teacher', 'en');
            localStorage.setItem('preferred-language', 'en');

            hideRoleModal();
        } catch (error) {
            console.error('Error saving teacher info:', error);
            alert('Error saving information. Please try again.');
        }
    }
});

// Student selection
selectStudent.addEventListener('click', async () => {
    selectedRole = 'student';
    selectStudent.classList.add('selected');
    selectTeacher.classList.remove('selected');

    if (pendingUser) {
        try {
            await saveUserRoleAndLanguage(pendingUser.uid, 'student', 'en');
            localStorage.setItem('preferred-language', 'en');

            hideRoleModal();
        } catch (error) {
            console.error('Error saving student role:', error);
            alert('Error saving role. Please try again.');
        }
    }
});

// Auth Form Elements
const emailAuthForm = document.getElementById('emailAuthForm') as HTMLFormElement;
const authEmail = document.getElementById('authEmail') as HTMLInputElement;
const authPassword = document.getElementById('authPassword') as HTMLInputElement;
const authDisplayName = document.getElementById('authDisplayName') as HTMLInputElement;
const emailAuthSubmit = document.getElementById('emailAuthSubmit');
const googleSignInBtn = document.getElementById('googleSignInBtn');

// Google sign in
googleSignInBtn.addEventListener('click', async () => {
    try {
        const user = await signInWithGoogle();
        const result = await initUserProfile(user);

        showToast('Account created!', `Welcome, ${user.displayName || user.email}! 🎉`);

        // Always show role modal for new users with Google
        pendingUser = user;
        setTimeout(() => {
            showRoleModal();
        }, 500);
    } catch (error) {
        console.error('Google sign in error:', error);
        alert('Sign-up error. Please try again.');
    }
});

// Email/Password auth form submit
emailAuthForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = authEmail.value.trim();
    const password = authPassword.value;
    const displayName = authDisplayName.value.trim();

    try {
        const user = await signUpWithEmail(email, password, displayName || undefined);
        const result = await initUserProfile(user);

        showToast('Account created!', `Welcome, ${displayName || user.email}! 🎉`);

        // Show role modal for new users
        pendingUser = user;
        setTimeout(() => {
            showRoleModal();
        }, 500);
    } catch (error) {
        console.error('Auth error:', error);
        alert(error.message || 'Authentication error. Please try again.');
    }
});

// Check if already authenticated
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // User is already signed in, redirect to tiers
        const userData = await getUserProfile(user.uid);
        if (userData && userData.role) {
            window.location.href = '/tiers.html';
        }
    }
});
