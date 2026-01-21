// app.js
import { _supabase } from './supabaseClient.js';

// 2. Gerekli HTML Elementlerini Seçelim
const loginForm = document.getElementById('login-form');

// --- LOGIN SAYFASI İÇİN ---
loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    // Supabase ile kullanıcı girişi yapmayı dene
    const { data, error } = await _supabase.auth.signInWithPassword({
        email: email,
        password: password,
    });

    if (error) {
        alert('Giriş başarısız: ' + error.message);
    } else {
        // Giriş başarılıysa index.html'e yönlendir
        window.location.href = 'index.html';
    }
});