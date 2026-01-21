// kullanici-yonetimi.js
import { _supabase } from './supabaseClient.js';
import { initializeAuthenticatedPage } from './layout.js';

const container = document.getElementById('user-management-container');
const userListDiv = document.getElementById('user-list');
const createUserForm = document.getElementById('create-user-form');

/**
 * Mevcut kullanıcıları veritabanından çeker ve listeler.
 */
const fetchUsers = async () => {
    userListDiv.innerHTML = 'Yükleniyor...';
    
    // Kendini silmesini/rolünü değiştirmesini engellemek için mevcut admin'in ID'sini al
    const { data: { user: adminUser } } = await _supabase.auth.getUser();
    if (!adminUser) return; // Admin bulunamazsa devam etme

    // SQL'de oluşturduğumuz güvenli RPC fonksiyonunu çağırıyoruz (403 hatasını aşmak için)
    const { data: users, error } = await _supabase.rpc('get_users_with_roles');

    if (error) {
        console.error('Kullanıcı listesi çekilirken hata:', error);
        userListDiv.innerHTML = `<p style="color:red;">Kullanıcılar yüklenemedi.</p>`;
        return;
    }

    if (users.length === 0) {
        userListDiv.innerHTML = '<p>Gösterilecek kullanıcı bulunamadı.</p>';
        return;
    }

    const tableHtml = `
        <table>
            <thead>
                <tr>
                    <th>E-posta</th>
                    <th>Rol</th>
                    <th>Rol Değiştir</th>
                </tr>
            </thead>
            <tbody>
                ${users.map(user => {
                    const isCurrentUser = user.id === adminUser.id;
                    return `
                    <tr>
                        <td>${user.email}</td>
                        <td>${user.role}</td>
                        <td>
                            <select class="role-select" data-user-id="${user.id}" ${isCurrentUser ? 'disabled' : ''}>
                                <option value="montaj" ${user.role === 'montaj' ? 'selected' : ''}>Montaj</option>
                                <option value="kalite" ${user.role === 'kalite' ? 'selected' : ''}>Kalite</option>
                                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                            </select>
                        </td>
                    </tr>
                `}).join('')}
            </tbody>
        </table>
    `;
    userListDiv.innerHTML = tableHtml;
};

/**
 * Yeni kullanıcı oluşturma formunu yönetir.
 * @param {Event} event 
 */
const handleCreateUser = async (event) => {
    event.preventDefault();
    const button = createUserForm.querySelector('button');
    button.disabled = true;
    button.textContent = 'Oluşturuluyor...';

    const email = document.getElementById('new-user-email').value;
    const password = document.getElementById('new-user-password').value;
    const role = document.getElementById('new-user-role').value;

    try {
        // 1. Mevcut admin oturumunu sakla.
        const { data: { session: adminSession } } = await _supabase.auth.getSession();
        if (!adminSession) throw new Error("Admin oturumu bulunamadı. Lütfen tekrar giriş yapın.");

        // 2. Yeni kullanıcıyı kaydet. Bu işlem, geçici olarak yeni kullanıcıyı oturum açtırır.
        const { data: newUserResponse, error: signUpError } = await _supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;

        // 3. Admin'in oturumunu HEMEN geri yükle.
        const { error: sessionError } = await _supabase.auth.setSession({
            access_token: adminSession.access_token,
            refresh_token: adminSession.refresh_token,
        });
        if (sessionError) throw new Error("Admin oturumu geri yüklenemedi.");

        // 4. Artık admin oturumu aktif olduğuna göre, yeni kullanıcının profilindeki rolü güncelle.
        const { error: updateError } = await _supabase
            .from('profiles')
            .update({ role: role })
            .eq('id', newUserResponse.user.id);
        if (updateError) throw updateError;

        alert(`Kullanıcı ${email} başarıyla oluşturuldu.`);
        createUserForm.reset();
        await fetchUsers(); // Kullanıcı listesini yenile

    } catch (error) {
        console.error("Kullanıcı oluşturma hatası:", error);
        alert(`Hata: ${error.message}`);
    } finally {
        button.disabled = false;
        button.textContent = 'Kullanıcı Oluştur';
    }
};

/**
 * Bir kullanıcının rolünü veritabanında günceller.
 * @param {string} userId 
 * @param {string} newRole 
 */
const updateUserRole = async (userId, newRole) => {
    if (!confirm(`Bu kullanıcının rolünü "${newRole}" olarak değiştirmek istediğinizden emin misiniz?`)) {
        await fetchUsers(); // Kullanıcı iptal ederse, dropdown'ı eski haline getir.
        return;
    }

    try {
        const { error } = await _supabase.from('profiles').update({ role: newRole }).eq('id', userId);
        if (error) throw error;
        alert("Kullanıcı rolü başarıyla güncellendi.");
        await fetchUsers();
    } catch (error) {
        console.error("Rol güncelleme hatası:", error);
        alert(`Hata: Rol güncellenemedi. ${error.message}`);
        await fetchUsers(); // Hata durumunda dropdown'ı eski haline getir.
    }
};

/**
 * Sayfa yüklendiğinde çalışacak ana fonksiyon.
 */
const init = async () => {
    const { userRole } = await initializeAuthenticatedPage();

    // Yetki kontrolü
    if (userRole !== 'admin') {
        container.innerHTML = `
            <h1>Erişim Engellendi</h1>
            <p>Bu sayfayı görüntüleme yetkiniz bulunmamaktadır.</p>
        `;
        return;
    }

    // Olay dinleyicilerini kur
    createUserForm.addEventListener('submit', handleCreateUser);

    // Olay delegasyonu ile rol değiştirme ve silme işlemlerini yönet
    userListDiv.addEventListener('change', (event) => {
        if (event.target.classList.contains('role-select')) {
            const userId = event.target.dataset.userId;
            const newRole = event.target.value;
            updateUserRole(userId, newRole);
        }
    });

    // Verileri yükle
    await fetchUsers();
};

document.addEventListener('DOMContentLoaded', init);