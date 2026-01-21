// layout.js
import { _supabase } from './supabaseClient.js';

/**
 * Kimlik doğrulaması yapılmış sayfalar için ortak kurulumu yönetir:
 * 1. Geçerli bir oturum olup olmadığını kontrol eder, yoksa login'e yönlendirir.
 * 2. Kullanıcının e-posta adresini ekranda gösterir.
 * 3. Çıkış yapma (logout) butonunu ayarlar.
 * 4. Hamburger menünün açılıp kapanma işlevselliğini ayarlar.
 */
export const initializeAuthenticatedPage = async () => {
    // --- 1. Oturum Kontrolü ---
    const { data: { session }, error: sessionError } = await _supabase.auth.getSession();
    if (sessionError || !session) {
        // Aktif oturum yok, login sayfasına yönlendir.
        window.location.href = 'login.html';
        return { session: null, userRole: null }; // Fonksiyonun geri kalanının çalışmasını engelle.
    }

    // --- YENİ: Kullanıcı Rolünü Çekme ---
    // SQL ile oluşturduğumuz 'profiles' tablosundan kullanıcının rolünü alıyoruz.
    const { data: profile, error: profileError } = await _supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .maybeSingle();

    if (profileError) {
        console.error("Kullanıcı profili çekilirken hata:", profileError);
    }

    // DEBUG: Veritabanından gelen rolü konsola yazdır
    //console.log("Veritabanı Profili:", profile);

    // Profil varsa rolünü, yoksa varsayılan 'montaj' rolünü ata.
    // Bu, handle_new_user trigger'ı çalışmadan önce bir sorun olursa diye bir güvencedir.
    const userRole = profile ? profile.role : 'montaj';

    // --- 2. Kullanıcı Email'ini Gösterme ---
    const userEmailElement = document.getElementById('user-email');
    if (userEmailElement) {
        userEmailElement.textContent = session.user.email;
    }

    // --- 3. Çıkış Butonunu Ayarlama ---
    const logoutButton = document.getElementById('logout-btn');
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            await _supabase.auth.signOut();
            window.location.href = 'login.html';
        });
    }

    // --- 4. Hamburger Menüyü Ayarlama ---
    const hamburger = document.querySelector('.hamburger');
    const navContainer = document.querySelector('.nav-container');
    if (hamburger && navContainer) {
        hamburger.addEventListener('click', () => {
            hamburger.classList.toggle('active');
            navContainer.classList.toggle('active');
        });
    }

    // YENİ: Rol bazlı link görünürlüğü
    const adminOnlyLinks = document.querySelectorAll('.admin-only');
    adminOnlyLinks.forEach(link => {
        if (userRole === 'admin') {
            link.style.display = 'block';
        } else {
            link.style.display = 'none';
        }
    });

    // Fonksiyonun sonunda oturum ve rol bilgisini döndürerek diğer sayfalarda kullanılmasını sağla.
    return { session, userRole };
};