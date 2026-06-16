// uretim-takip.js
import { _supabase } from './supabaseClient.js';
import { initializeAuthenticatedPage } from './layout.js';
import { showDetailView } from './machine-detail.js';

// --- 1. Sabitler ve Global Değişkenler ---

// Eski projeden alınan süreç adımları
const PROCESS_STEPS = [
    "Durum", "Tamamlama 1", "ROTUS 1", "ETIKET", "TEST 1", "Tamamlama Kabin",
    "ROTUS 2 ve TEMIZLIK", "PDI öncesi", "PDI öncesi Tmmlm", "PDI-1",
    "PDI-1 Tmmlm", "PDI-2", "PDI-2 Tmmlm"
];

// YENİ: Sıralama durumu için global değişkenler
let currentSortField = 'created_at';
let currentSortDirection = 'desc'; // Varsayılan: en yeni eklenen en üstte
let currentUserRole = null; // YENİ: Kullanıcının rolünü modül içinde saklamak için
// YENİ: Arama ve Filtreleme durumu için global değişkenler
let currentSearchTerm = '';
let currentMachineTypeFilter = '';
let currentCategoryFilter = 'all'; // YENİ: Kategori filtresi (Bekolar/Diğer)
// YENİ: Sayfalama durumu için global değişkenler
const PAGE_SIZE = 20; // Sayfa başına gösterilecek makina sayısı
let currentPage = 1;

// YENİ: Hata düzeltme adımlarının, hataların hangi adımdan geldiğini belirten harita
const DEFECT_SOURCE_MAP = {
    'tamamlama_kabin': 'test_1',
    'rotus_2_ve_temizlik': 'test_1',
    'pdi_oncesi_tmmlm': 'pdi_oncesi',
    'pdi-1_tmmlm': 'pdi-1',
    'pdi-2_tmmlm': 'pdi-2'
};

// YENİ: Bir düzeltme adımı tamamlandığında, giderilmemiş hataların hangi sonraki adıma aktarılacağını belirten harita
const DEFECT_TRANSFER_MAP = {
    'rotus_2_ve_temizlik': { source: 'test_1', target: 'pdi_oncesi' },
    'pdi_oncesi_tmmlm': { source: 'pdi_oncesi', target: 'pdi-1' },
    'pdi-1_tmmlm': { source: 'pdi-1', target: 'pdi-2' }
};

// Görünen adı veritabanı anahtarına çeviren yardımcı fonksiyon
function getStatusKey(stepName) {
    return stepName.toLowerCase().replace(/ /g, '_').replace('ö', 'o').replace('ı', 'i');
}

// --- 2. HTML Elementlerini Seçme ---
const dataContainer = document.getElementById('production-data-container');
const showModalButton = document.getElementById('show-add-machine-modal');
const modal = document.getElementById('add-machine-modal');
const closeModalButton = modal.querySelector('.close-button');
const addMachineForm = document.getElementById('add-machine-form');
const addMachineButton = document.getElementById('add-machine-button');
const machineDetailView = document.getElementById('machine-detail-view');
const mainContentView = document.querySelector('.content'); // This is the main list view
const shipmentModal = document.getElementById('shipment-modal');

// --- 3. Ana Fonksiyonlar ---

/**
 * Üretimdeki makinaları Supabase'den çeker ve tabloyu render eder.
 */
const fetchProductionData = async () => {
    dataContainer.innerHTML = `<p>Veriler yükleniyor...</p>`;

    // 'machines' tablosundan sevk edilmemiş olanları çekiyoruz.
    let query = _supabase
        .from('machines')
        .select('*', { count: 'exact' }) // YENİ: Toplam sonuç sayısını almak için
        .eq('is_shipped', false);

    // YENİ: Filtreleme
    if (currentCategoryFilter === 'bekolar') {
        query = query.eq('machine_type', 'BL');
    } else if (currentCategoryFilter === 'diger') {
        query = query.neq('machine_type', 'BL');
    }

    if (currentMachineTypeFilter) {
        query = query.eq('machine_type', currentMachineTypeFilter);
    }

    // YENİ: Arama
    if (currentSearchTerm) {
        // Kullanıcının girdiği her kelimeyi '&' ile birleştirerek hepsinin metinde geçmesini zorunlu kılar.
        const plainQuery = currentSearchTerm.trim().split(' ').filter(term => term).join(' & ');
        query = query.textSearch('search_vector', plainQuery);
    }

    // YENİ: Sayfalama
    const from = (currentPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    query = query.range(from, to);

    // Sıralamayı uygula
    const { data, error, count } = await query.order(currentSortField, { ascending: currentSortDirection === 'asc' });

    if (error) {
        console.error('Veri çekme hatası:', error);
        dataContainer.innerHTML = `<p style="color: red;">Veriler yüklenirken bir hata oluştu: ${error.message}</p>`;
        return;
    }

    // YENİ: Sayfalama UI'ını güncelle
    const pageInfo = document.getElementById('page-info');
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    if (pageInfo && prevBtn && nextBtn) {
        const totalPages = Math.ceil(count / PAGE_SIZE);
        pageInfo.textContent = `Sayfa ${currentPage} / ${totalPages || 1}`;
        prevBtn.disabled = currentPage === 1;
        nextBtn.disabled = currentPage >= totalPages;
    }

    if (data && data.length > 0) {
        renderMachineTable(data, from);
    } else {
        dataContainer.innerHTML = '<p>Gösterilecek üretim verisi bulunamadı. Yeni bir makina ekleyebilirsiniz.</p>';
    }
};

/**
 * Gelen makina verilerine göre HTML tablosunu oluşturur ve ekrana basar.
 * @param {Array} machines - Makina verilerini içeren dizi.
 */
const renderMachineTable = (machines, from) => {
    // Tablo başlıklarını oluştur. "Durum" adımı genel bir özet olduğu için listede göstermiyoruz.
    // YENİ: Başlıkları ve veritabanı sütun adlarını eşleştir
    const headerConfig = [
        { title: "SN", sortable: false },
        { title: "Makina Tipi", sortable: true, field: 'machine_type' },
        { title: "Model", sortable: true, field: 'model' },
        { title: "Müşteri İsmi", sortable: true, field: 'customer_name' },
        { title: "Seri No", sortable: true, field: 'serial_number' },
        { title: "Şase No", sortable: true, field: 'chassis_number' },
        { title: "Bant Çıkış", sortable: true, field: 'production_date' },
        { title: "Sevk Tarihi", sortable: true, field: 'shipment_date' },
        { title: "Son Durum", sortable: false },
    ];

    let processHeaders = PROCESS_STEPS.filter(step => step !== "Durum")
        .map(step => ({ title: step, sortable: false }));
    processHeaders.push({ title: "İşlemler", sortable: false }); // Add Actions column

    const allHeaders = headerConfig.concat(processHeaders);

    const headerHtml = allHeaders.map(config => {
        if (config.sortable) {
            const isCurrentSort = currentSortField === config.field;
            const sortClass = isCurrentSort ? `sorted-${currentSortDirection}` : '';
            // data-sort attribute'u ile sıralama alanını belirtiyoruz.
            return `<th class="sortable ${sortClass}" data-sort="${config.field}">${config.title}</th>`;
        }
        return `<th>${config.title}</th>`;
    }).join('');

    // Her makina için tablo satırlarını oluştur.
    const tableRows = machines.map((machine, index) => {
        const productionDate = new Date(machine.production_date).toLocaleDateString('tr-TR');

        // Sevk tarihi varsa formatla, yoksa '-' göster.
        const shipmentDate = machine.shipment_date
            ? new Date(machine.shipment_date).toLocaleDateString('tr-TR')
            : '-';

        // Süreç adımlarının durumlarını (OK/Bekliyor) oluştur.
        const statusCells = PROCESS_STEPS
            .filter(step => step !== "Durum")
            .map(step => {
                const stepKey = getStatusKey(step);
                const isCompleted = machine.status && machine.status[stepKey]?.completed;
                const badgeClass = isCompleted ? 'status-ok' : 'status-pending';
                const badgeText = isCompleted ? 'OK' : 'Bekliyor';
                return `<td><span class="status-badge ${badgeClass}">${badgeText}</span></td>`;
            }).join('');
        
        // YENİ: İşlemler sütunu için HTML oluştur
        let actionsCell = '<td>-</td>';
        if (['admin'].includes(currentUserRole)) {
            actionsCell = `
                <td><button class="button-primary action-button ship-btn" data-machine-id="${machine.id}">Sevk Et</button></td>
            `;
        }

        // YENİ: Son Durum Notu alanı sadece admin ve montaj yetkisi olanlar için düzenlenebilir.
        const canEditFinalStatus = ['admin', 'montaj'].includes(currentUserRole);

        return `
            <tr data-machine-id="${machine.id}" class="clickable-row" title="Detayları görmek için tıkla">
                <td>${from + index + 1}</td>
                <td>${machine.machine_type || '-'}</td>
                <td>${machine.model || '-'}</td>
                <td>${machine.customer_name || '-'}</td>
                <td>${machine.serial_number || '-'}</td>
                <td>${machine.chassis_number || '-'}</td>
                <td>${productionDate}</td>
                <td>${shipmentDate}</td>
                <td><textarea class="final-status-textarea" data-machine-id="${machine.id}" rows="2" ${canEditFinalStatus ? '' : 'disabled'}>${machine.final_status || ''}</textarea></td>
                ${statusCells}
                ${actionsCell}
            </tr>
        `;
    }).join('');

    // Final tablo HTML'ini oluştur ve container'a yerleştir.
    dataContainer.innerHTML = `
        <div class="table-wrapper">
            <table>
                <thead>
                    <tr>${headerHtml}</tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>
    `;
};

/**
 * Ana listeyi gizler ve seçilen makinanın detay görünümünü gösterir.
 * @param {string} machineId - Görüntülenecek makinanın ID'si.
 */
const showMachineDetail = async (machineId) => {
    // 1. Listeyi gizle, detay görünümünü göster ve yükleniyor mesajı bas
    mainContentView.style.display = 'none';
    machineDetailView.style.display = 'block';
    machineDetailView.innerHTML = `<p>Makina detayları yükleniyor...</p>`;

    // 2. Supabase'den ilgili makinanın tüm verilerini çek
    const { data: machine, error } = await _supabase
        .from('machines')
        .select('*')
        .eq('id', machineId)
        .single();

    if (error || !machine) {
        console.error("Makina detayı alınamadı:", error);
        machineDetailView.innerHTML = `<p style="color:red;">Hata: Makina detayları yüklenemedi.</p>`;
        return;
    }

    // 3. Detay sayfasının ana yapısını oluştur
    renderDetailLayout(machine);
};

/**
 * Detay görünümünü gizler ve ana makina listesini tekrar gösterir.
 */
const hideMachineDetail = async () => {
    machineDetailView.style.display = 'none';
    machineDetailView.innerHTML = ''; // Temizlik için içeriği boşalt

    // Ana listeyi tekrar göstermeden önce verileri yenile.
    // Bu, detay sayfasında yapılan değişikliklerin listeye yansımasını sağlar.
    await fetchProductionData();

    mainContentView.style.display = 'block';
};

/**
 * Makina verilerine göre detay sayfasının genel yerleşimini (sidebar, content) oluşturur.
 * @param {object} machine - Makina verileri.
 */
const renderDetailLayout = (machine) => {
    machineDetailView.innerHTML = `
        <div class="detail-header">
            <button id="back-to-list-btn" class="button-secondary">&larr; Listeye Dön</button>
            <h1>${machine.model || ''} - ${machine.serial_number || ''}</h1>
        </div>
        <div class="detail-layout">
            <div id="detail-sidebar" class="process-sidebar">
                <!-- YENİ: Mobil için açılır menü butonu -->
                <div class="mobile-step-selector">
                    <span id="current-step-name-mobile">Durum</span>
                    <svg class="arrow-icon" xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M0 0h24v24H0z" fill="none"/><path d="M7 10l5 5 5-5z"/></svg>
                </div>
                <!-- Süreç adımları listesi -->
                <div id="process-steps-list"></div>
            </div>
            <div id="detail-content" class="process-content"></div>
        </div>
    `;

    // "Listeye Dön" butonuna tıklama olayı ekle
    document.getElementById('back-to-list-btn').addEventListener('click', hideMachineDetail);

    // YENİ: Mobil menü açma/kapama olayı
    document.querySelector('.mobile-step-selector').addEventListener('click', () => {
        document.getElementById('detail-sidebar').classList.toggle('open');
    });

    // Süreç adımlarını sol menüye/açılır listeye çiz
    renderProcessSteps(machine);

    // Varsayılan olarak "Durum" sekmesinin içeriğini sağ tarafa çiz
    renderContentForStep('Durum', machine);
};

/**
 * Süreç adımlarını sol taraftaki menüye (sidebar) ekler.
 * @param {object} machine - Makina verileri.
 */
const renderProcessSteps = (machine) => {
    const stepsListContainer = document.getElementById('process-steps-list');
    stepsListContainer.innerHTML = ''; // Önceki adımları temizle
    const mobileStepName = document.getElementById('current-step-name-mobile');

    PROCESS_STEPS.forEach(stepName => {
        const stepKey = getStatusKey(stepName);
        const isCompleted = machine.status && machine.status[stepKey]?.completed;

        const stepEl = document.createElement('div');
        stepEl.className = 'process-step';
        stepEl.textContent = stepName;
        stepEl.dataset.stepKey = stepKey;

        if (isCompleted) stepEl.classList.add('completed');
        if (stepName === 'Durum') {
            stepEl.classList.add('active'); // Varsayılan aktif adım
            if (mobileStepName) mobileStepName.textContent = stepName;
        }

        stepEl.addEventListener('click', () => {
            // Mevcut aktif adımı deaktif et
            stepsListContainer.querySelector('.process-step.active')?.classList.remove('active');
            // Tıklananı aktif et
            stepEl.classList.add('active');
            // Mobil için başlığı güncelle
            if (mobileStepName) mobileStepName.textContent = stepName;
            // Mobil menüyü kapat
            document.getElementById('detail-sidebar').classList.remove('open');
            // İçeriği render et
            renderContentForStep(stepName, machine);
        });

        stepsListContainer.appendChild(stepEl);
    });
};

/**
 * YENİ: Detay sayfasının altına süreç adımlarının özetini çizer.
 * @param {object} machine - Makina verileri.
 */
const renderProcessSummary = (machine) => {
    const summaryGrid = document.getElementById('process-summary-grid');
    if (!summaryGrid) return;

    const summaryHtml = PROCESS_STEPS
        .filter(step => step !== "Durum")
        .map(stepName => {
            const stepKey = getStatusKey(stepName);
            const stepData = machine.status ? machine.status[stepKey] : null;
            const isCompleted = stepData && stepData.completed;

            let completedDate = '';
            if (isCompleted && stepData.completedAt) {
                completedDate = new Date(stepData.completedAt).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            }

            return `
                <div class="summary-item ${isCompleted ? 'completed' : ''}">
                    <span class="summary-item-name">${stepName}</span>
                    <div class="summary-item-status">
                        ${completedDate ? `<span class="summary-item-date">${completedDate}</span>` : ''}
                        <span class="status-badge ${isCompleted ? 'status-ok' : 'status-pending'}">
                            ${isCompleted ? 'OK' : 'Bekliyor'}
                        </span>
                    </div>
                </div>
            `;
        }).join('');
    
    summaryGrid.innerHTML = summaryHtml;
};

/**
 * Tıklanan süreç adımına göre sağdaki içerik alanını doldurur.
 * @param {string} stepName - Görüntülenecek adımın adı.
 * @param {object} machine - Makina verileri.
 */
const renderContentForStep = async (stepName, machine) => {
    const contentArea = document.getElementById('detail-content');
    contentArea.innerHTML = `<p>İçerik yükleniyor...</p>`;

    if (stepName === "Durum") {
        // --- YENİ: "Durum" adımı için detaylı görünüm ---

        // 1. Başlangıç eksiklerini Supabase'den çek
        const { data: initialDefects, error: defectsError } = await _supabase
            .from('defects')
            .select('*')
            .eq('machine_id', machine.id)
            .eq('step', 'initial')
            .order('orderIndex', { ascending: true });

        if (defectsError) {
            console.error("Başlangıç eksikleri alınamadı:", defectsError);
            contentArea.innerHTML = `<p style="color:red;">Başlangıç eksikleri yüklenemedi.</p>`;
            return;
        }

        // 2. Başlangıç eksikleri için HTML oluştur
        let initialDefectsHtml = '<li>Başlangıç eksiği girilmemiş.</li>';
        if (initialDefects && initialDefects.length > 0) {
            initialDefectsHtml = initialDefects.map((defect, index) => `
                <li class="checklist-item ${defect.is_fixed ? 'fixed' : ''}">
                    <input type="checkbox" id="defect-${defect.id}" data-defect-id="${defect.id}" ${defect.is_fixed ? 'checked' : ''}>
                    <label for="defect-${defect.id}"><strong>${index + 1}.</strong> ${defect.description}</label>
                </li>
            `).join('');
        }

        // 3. Sevk tarihi input'u için tarihi formatla
        const shipmentDateForInput = machine.shipment_date ? new Date(machine.shipment_date).toISOString().split('T')[0] : '';

        // 4. Final HTML'i oluştur
        contentArea.innerHTML = `
            <h2>Makina Künyesi ve Durum Özeti</h2>
            <div class="info-grid">
                <div><strong>Tip:</strong> ${machine.machine_type || '-'}</div>
                <div><strong>Model:</strong> ${machine.model || '-'}</div>
                <div><strong>Seri No:</strong> ${machine.serial_number || '-'}</div>
                <div><strong>Şase No:</strong> ${machine.chassis_number || '-'}</div>
                <div><strong>Bant Çıkış:</strong> ${new Date(machine.production_date).toLocaleDateString('tr-TR')}</div>
                <div class="form-group">
                    <label for="shipment-date-input"><strong>Sevk Tarihi:</strong></label>
                    <input type="date" id="shipment-date-input" value="${shipmentDateForInput}">
                </div>
            </div>
            <hr>
            <h2>Başlangıç Eksikleri</h2>
            <ul id="initial-defects-list" class="defect-checklist">${initialDefectsHtml}</ul>
            <hr>
            <h2>Son Durum Notu</h2>
            <textarea id="final-status-textarea-detail" class="form-control" rows="4" placeholder="Makina ile ilgili genel durumu veya notları buraya girin...">${machine.final_status || ''}</textarea>

            <!-- YENİ: Süreç özetini buraya taşıdık -->
            <div class="process-summary-container">
                <h2>Süreç Genel Bakış</h2>
                <div id="process-summary-grid"></div>
            </div>
        `;

        // 5. Olay dinleyicilerini ekle
        addDetailViewEventListeners(machine.id);

        // YENİ: Süreç özetini çiz
        renderProcessSummary(machine);

    } else if (["Tamamlama 1", "ROTUS 1", "ETIKET"].includes(stepName)) {
        renderSimpleCompletionStep(stepName, machine);
    } else if (["TEST 1", "PDI öncesi", "PDI-1", "PDI-2"].includes(stepName)) {
        renderDefectEntryStep(stepName, machine);
    } else if (["Tamamlama Kabin", "ROTUS 2 ve TEMIZLIK", "PDI öncesi Tmmlm", "PDI-1 Tmmlm", "PDI-2 Tmmlm"].includes(stepName)) {
        renderDefectFixingStep(stepName, machine);
    } else {
        // Diğer adımlar için geçici bir içerik
        contentArea.innerHTML = `<h2>${stepName}</h2><p>Bu adım için detaylı arayüz yakında eklenecek.</p>`;
    }
};

/**
 * "Tamamlama 1", "ROTUS 1", "ETIKET" gibi basit adımlar için içerik oluşturur.
 * @param {string} stepName - Görüntülenecek adımın adı.
 * @param {object} machine - Makina verileri.
 */
const renderSimpleCompletionStep = (stepName, machine) => {
    const contentArea = document.getElementById('detail-content');
    const stepKey = getStatusKey(stepName);
    const isCompleted = machine.status && machine.status[stepKey]?.completed;

    if (isCompleted) {
        const note = machine.status[stepKey]?.note || 'Not bırakılmamış.';
        // YENİ: Admin rolü için iptal butonu oluştur
        const cancelButtonHtml = currentUserRole === 'admin'
            ? `<button id="cancel-step-btn" class="button-secondary" style="margin-top: 20px;">Tamamlamayı İptal Et</button>`
            : '';

        contentArea.innerHTML = `
            <h2>${stepName}</h2>
            <div class="completed-info">
                <p>Bu adım zaten tamamlanmış.</p>
                <strong>Bırakılan Not:</strong>
                <div class="note-display">${note}</div>
            </div>
            ${cancelButtonHtml}
        `;

        // YENİ: Buton varsa olay dinleyicisini ekle
        if (currentUserRole === 'admin') {
            const cancelButton = document.getElementById('cancel-step-btn');
            if (cancelButton) {
                cancelButton.addEventListener('click', () => cancelStepCompletion(stepKey, machine));
            }
        }
    } else {
        contentArea.innerHTML = `
            <h2>${stepName}</h2>
            <div class="form-group">
                <label for="step-note-textarea">Bu adıma not ekle (isteğe bağlı):</label>
                <textarea id="step-note-textarea" class="form-control" rows="4" placeholder="Eklenen not, 'Son Durum' alanına da yansıtılacaktır..."></textarea>
            </div>
            <button id="complete-step-btn" class="button-primary">Süreç Tamamlandı</button>
        `;

        document.getElementById('complete-step-btn').addEventListener('click', async () => {
            const button = document.getElementById('complete-step-btn');
            button.disabled = true;
            button.textContent = 'Kaydediliyor...';

            const noteText = document.getElementById('step-note-textarea').value.trim();
            
            try {
                const currentFinalStatus = machine.final_status || '';
                const newFinalStatus = noteText ? (currentFinalStatus ? `${currentFinalStatus}\n- ${noteText}` : `- ${noteText}`) : currentFinalStatus;

                const currentStatus = machine.status || {};
                currentStatus[stepKey] = { completed: true, note: noteText, completedAt: new Date().toISOString() };
                
                const { data: updatedMachine, error } = await _supabase.from('machines').update({ status: currentStatus, final_status: newFinalStatus }).eq('id', machine.id).select().single();
                if (error) throw error;

                renderContentForStep(stepName, updatedMachine);
                renderProcessSteps(updatedMachine);
            } catch (error) {
                console.error('Adım tamamlanırken hata:', error);
                alert('Hata: Adım tamamlanamadı. ' + error.message);
                button.disabled = false;
                button.textContent = 'Süreç Tamamlandı';
            }
        });
    }
};

/**
 * YENİ: Bir adımın tamamlanma durumunu iptal eder. Sadece adminler kullanabilir.
 * @param {string} stepKey - İptal edilecek adımın veritabanı anahtarı.
 * @param {object} machine - İlgili makina nesnesi.
 */
const cancelStepCompletion = async (stepKey, machine, skipConfirm = false) => {
    const stepName = PROCESS_STEPS.find(name => getStatusKey(name) === stepKey);
    if (!skipConfirm && !confirm(`'${stepName}' adımının tamamlanma durumunu iptal etmek istediğinizden emin misiniz? Bu işlem, adıma ait notu da silecektir.`)) {
        return; // Kullanıcı iptal ederse fonksiyondan çık
    }

    try {
        const currentStatus = machine.status || {};
        if (currentStatus[stepKey]) {
            delete currentStatus[stepKey]; // Adım verisini status JSON'ından sil
        }

        // Güncellenmiş status objesini veritabanına yaz
        const { data: updatedMachine, error } = await _supabase
            .from('machines')
            .update({ status: currentStatus })
            .eq('id', machine.id)
            .select()
            .single();
        
        if (error) throw error;

        // Arayüzü yenile
        renderContentForStep(stepName, updatedMachine); // İçerik alanını yeniden çiz
        renderProcessSteps(updatedMachine); // Kenar çubuğunu yeniden çiz (completed class'ı kaldırmak için)
    } catch (error) {
        console.error('Adım iptal edilirken hata:', error);
        alert('Hata: Adım iptal edilemedi. ' + error.message);
    }
};

/**
 * YENİ: Hata düzeltme adımları ("Tamamlama Kabin" vb.) için arayüz oluşturur.
 * @param {string} stepName - Görüntülenecek adımın adı.
 * @param {object} machine - Makina verileri.
 */
const renderDefectFixingStep = async (stepName, machine) => {
    const contentArea = document.getElementById('detail-content');
    const currentStepKey = getStatusKey(stepName);
    const sourceStepKey = DEFECT_SOURCE_MAP[currentStepKey];
    const isCompleted = machine.status && machine.status[currentStepKey]?.completed;

    // Yetki kontrolü
    if (!['admin', 'montaj'].includes(currentUserRole)) {
        contentArea.innerHTML = `
            <h2>${stepName}</h2>
            <div class="completed-info" style="border-left-color: #ffc107;">
                <p>Bu alanda işlem yapma yetkiniz bulunmamaktadır.</p>
                <strong>Bu adım 'Montaj' veya 'Admin' rolü gerektirir.</strong>
            </div>
        `;
        return;
    }

    contentArea.innerHTML = `<p>Düzeltilecek hata listesi yükleniyor...</p>`;

    // Kaynak adıma ait hataları çek
    const { data: defects, error } = await _supabase.from('defects').select('*').eq('machine_id', machine.id).eq('step', sourceStepKey).order('orderIndex', { ascending: true });

    if (error) {
        console.error("Hata listesi çekilirken hata:", error);
        contentArea.innerHTML = `<p style="color:red;">Hata listesi yüklenemedi.</p>`;
        return;
    }

    // Adım tamamlanmışsa, salt okunur bir liste göster
    if (isCompleted) {
        const defectListHtml = defects.length > 0 ? defects.map((defect, index) => `
            <li class="checklist-item ${defect.is_fixed ? 'fixed' : ''}">
                <div class="checklist-item-content">
                    <input type="checkbox" id="fix-defect-${defect.id}" ${defect.is_fixed ? 'checked' : ''} disabled>
                    <label for="fix-defect-${defect.id}"><strong>${index + 1}.</strong> ${defect.description}</label>
                </div>
                ${defect.note ? `<div class="defect-note-display"><strong>Not:</strong> ${defect.note}</div>` : ''}
            </li>
        `).join('') : '<li>Bu adım için düzeltilecek hata bulunamadı.</li>';

        contentArea.innerHTML = `
            <h2>${stepName}</h2>
            <div class="completed-info">
                <p>Bu adım zaten tamamlanmış.</p>
            </div>
            <h3 style="margin-top: 20px; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px;">İlgili Hata Listesi</h3>
            <ul class="defect-checklist">${defectListHtml}</ul>
        `;
        return; // Fonksiyonun geri kalanını çalıştırma
    }

    // Adım tamamlanmamışsa, interaktif arayüzü göster
    if (defects.length === 0) {
        contentArea.innerHTML = `
            <h2>${stepName}</h2>
            <div class="completed-info">
                <p>Bu adım için düzeltilecek hata bulunamadı.</p>
            </div>
            <button id="complete-fixing-step-btn" class="button-primary green">Adımı Tamamla</button>
        `;
    } else {
        const defectListHtml = defects.map((defect, index) => `
            <li class="checklist-item ${defect.is_fixed ? 'fixed' : ''}" data-defect-id="${defect.id}">
                <div class="checklist-item-content">
                    <input type="checkbox" id="fix-defect-${defect.id}" data-defect-id="${defect.id}" ${defect.is_fixed ? 'checked' : ''}>
                    <label for="fix-defect-${defect.id}"><strong>${index + 1}.</strong> ${defect.description}</label>
                    <button class="add-note-btn" title="Not Ekle/Düzenle">+</button>
                </div>
                ${defect.note ? `<div class="defect-note-display"><strong>Not:</strong> ${defect.note}</div>` : ''}
                <div class="defect-note-form" style="display: none;">
                    <textarea class="defect-note-input" placeholder="Bu madde için not ekleyin...">${defect.note || ''}</textarea>
                    <div class="note-form-buttons">
                        <button class="save-note-btn">Kaydet</button>
                        <button class="cancel-note-btn">İptal</button>
                    </div>
                </div>
            </li>
        `).join('');

        contentArea.innerHTML = `
            <h2>"${stepName}" Hata Düzeltme</h2>
            <p>Önceki adımdan gelen hataları giderin veya not bırakın.</p>
            <ul class="defect-checklist">${defectListHtml}</ul>
            <button id="complete-fixing-step-btn" class="button-primary green" style="margin-top: 20px;">Adımı Tamamla</button>
        `;
    }

    // Olay dinleyicilerini ekle
    setupDefectFixingEventListeners(currentStepKey, machine);
};

/**
 * YENİ: Hata düzeltme ekranındaki elemanlar için olay dinleyicilerini kurar.
 * @param {string} currentStepKey - Mevcut düzeltme adımının veritabanı anahtarı.
 * @param {object} machine - Makina nesnesi.
 */
const setupDefectFixingEventListeners = (currentStepKey, machine) => {
    const stepName = PROCESS_STEPS.find(name => getStatusKey(name) === currentStepKey);

    // Checkbox'lar
    document.querySelectorAll('.checklist-item input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', async (e) => {
            const defectId = e.target.dataset.defectId;
            const isFixed = e.target.checked;
            const { error } = await _supabase.from('defects').update({ is_fixed: isFixed }).eq('id', defectId);
            if (error) {
                alert('Hata durumu güncellenemedi: ' + error.message);
                e.target.checked = !isFixed;
            } else {
                e.target.closest('.checklist-item').classList.toggle('fixed', isFixed);
            }
        });
    });

    // Not Ekle (+) butonları
    document.querySelectorAll('.add-note-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const noteForm = e.target.closest('.checklist-item').querySelector('.defect-note-form');
            noteForm.style.display = noteForm.style.display === 'none' ? 'flex' : 'none';
        });
    });

    // Not İptal butonları
    document.querySelectorAll('.cancel-note-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.target.closest('.defect-note-form').style.display = 'none';
        });
    });

    // Not Kaydet butonları
    document.querySelectorAll('.save-note-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const item = e.target.closest('.checklist-item');
            const defectId = item.dataset.defectId;
            const noteInput = item.querySelector('.defect-note-input');
            const newNote = noteInput.value.trim();

            const { error } = await _supabase.from('defects').update({ note: newNote }).eq('id', defectId);
            if (error) {
                alert('Not kaydedilemedi: ' + error.message);
            } else {
                item.querySelector('.defect-note-form').style.display = 'none';
                let noteDisplay = item.querySelector('.defect-note-display');
                if (newNote) {
                    if (!noteDisplay) {
                        noteDisplay = document.createElement('div');
                        noteDisplay.className = 'defect-note-display';
                        item.insertBefore(noteDisplay, item.querySelector('.defect-note-form'));
                    }
                    noteDisplay.innerHTML = `<strong>Not:</strong> ${newNote}`;
                } else if (noteDisplay) {
                    noteDisplay.remove();
                }
            }
        });
    });

    // Adımı Tamamla butonu
    const completeBtn = document.getElementById('complete-fixing-step-btn');
    if (completeBtn) {
        completeBtn.addEventListener('click', async (e) => {
            e.target.disabled = true;
            e.target.textContent = 'Kaydediliyor...';

            try {
                // Hata aktarma mantığı
                if (DEFECT_TRANSFER_MAP[currentStepKey]) {
                    const { source, target } = DEFECT_TRANSFER_MAP[currentStepKey];
                    const { data: unfixedDefects } = await _supabase.from('defects').select('*').eq('machine_id', machine.id).eq('step', source).eq('is_fixed', false);

                    if (unfixedDefects && unfixedDefects.length > 0) {
                        const { data: lastTargetDefect } = await _supabase.from('defects').select('orderIndex').eq('machine_id', machine.id).eq('step', target).order('orderIndex', { ascending: false }).limit(1).single();
                        const lastOrderIndex = lastTargetDefect ? lastTargetDefect.orderIndex : -1;
                        
                        const defectsToInsert = unfixedDefects.map((defect, index) => ({ machine_id: machine.id, description: defect.description, is_fixed: false, step: target, note: defect.note, orderIndex: lastOrderIndex + 1 + index }));

                        await _supabase.from('defects').insert(defectsToInsert);
                    }
                }

                // Mevcut adımı tamamla
                const currentStatus = machine.status || {};
                currentStatus[currentStepKey] = { completed: true, note: 'Hatalar giderildi.', completedAt: new Date().toISOString() };
                
                const { data: updatedMachine, error } = await _supabase.from('machines').update({ status: currentStatus }).eq('id', machine.id).select().single();
                if (error) throw error;

                renderContentForStep(stepName, updatedMachine);
                renderProcessSteps(updatedMachine);

            } catch (error) {
                console.error('Hata düzeltme adımı tamamlanırken hata:', error);
                alert('Hata: Adım tamamlanamadı. ' + error.message);
                e.target.disabled = false;
                e.target.textContent = 'Adımı Tamamla';
            }
        });
    }
};

/**
 * YENİ: "TEST 1", "PDI-1" gibi hata girişi yapılan adımlar için arayüz oluşturur.
 * @param {string} stepName - Görüntülenecek adımın adı.
 * @param {object} machine - Makina verileri.
 */
const renderDefectEntryStep = async (stepName, machine) => {
    const contentArea = document.getElementById('detail-content');
    const stepKey = getStatusKey(stepName);
    const isCompleted = machine.status && machine.status[stepKey]?.completed;

    // Yetki kontrolü
    if (!['admin', 'kalite'].includes(currentUserRole)) {
        contentArea.innerHTML = `
            <h2>${stepName}</h2>
            <div class="completed-info" style="border-left-color: #ffc107;">
                <p>Bu alana veri girişi yapma yetkiniz bulunmamaktadır.</p>
                <strong>Bu adım 'Kalite' veya 'Admin' rolü gerektirir.</strong>
            </div>
        `;
        return;
    }

    contentArea.innerHTML = `<p>Hata listesi yükleniyor...</p>`;

    // Adıma ait mevcut hataları çek
    const { data: defects, error } = await _supabase
        .from('defects')
        .select('*')
        .eq('machine_id', machine.id)
        .eq('step', stepKey)
        .order('orderIndex', { ascending: true });

    if (error) {
        console.error("Hata listesi çekilirken hata:", error);
        contentArea.innerHTML = `<p style="color:red;">Hata listesi yüklenemedi.</p>`;
        return;
    }

    const defectListHtml = defects.length > 0
        ? defects.map((defect, index) => `
            <li class="defect-management-item" data-defect-id="${defect.id}">
                <span><strong>${index + 1}.</strong> ${defect.description}</span>
                <button class="delete-defect-btn" title="Sil">&times;</button>
            </li>
        `).join('')
        : '<li>Bu adım için henüz hata girilmemiş.</li>';

    const deleteAllButtonHtml = (currentUserRole === 'admin' || currentUserRole === 'kalite') && defects.length > 0
        ? `<button id="delete-all-defects-btn" class="button-secondary">Tüm Maddeleri Sil</button>`
        : '';

    contentArea.innerHTML = `
        <h2>"${stepName}" Hata Girişi</h2>
        <ul class="defect-management-list">${defectListHtml}</ul>
        <hr>
        <div class="form-group">
            <label for="add-defect-textarea">Yeni Hata/Hatalar Ekle (Her satıra bir tane):</label>
            <textarea id="add-defect-textarea" class="form-control" rows="5" placeholder="Yeni hataları buraya yazın veya yapıştırın..."></textarea>
        </div>
        <div class="button-group">
            <button id="add-defects-btn" class="button-primary">Yeni Hataları Ekle</button>
            <button id="complete-defect-step-btn" class="button-primary green">${isCompleted ? 'Adımı Güncelle' : 'Adımı Tamamla'}</button>
            ${deleteAllButtonHtml}
        </div>
    `;

    // Olay dinleyicilerini ekle
    setupDefectEntryEventListeners(stepKey, machine);
};

/**
 * YENİ: Hata giriş ekranındaki butonlar için olay dinleyicilerini kurar.
 * @param {string} stepKey - İlgili adımın veritabanı anahtarı.
 * @param {object} machine - Makina nesnesi.
 */
const setupDefectEntryEventListeners = (stepKey, machine) => {
    const stepName = PROCESS_STEPS.find(name => getStatusKey(name) === stepKey);

    // Tekil hata silme butonları
    document.querySelectorAll('.delete-defect-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const defectId = e.target.closest('.defect-management-item').dataset.defectId;
            if (confirm("Bu hatayı silmek istediğinizden emin misiniz?")) {
                const { error } = await _supabase.from('defects').delete().eq('id', defectId);
                if (error) {
                    alert('Hata silinirken bir sorun oluştu: ' + error.message);
                } else {
                    renderDefectEntryStep(stepName, machine);
                }
            }
        });
    });

    // Tüm hataları silme butonu
    const deleteAllBtn = document.getElementById('delete-all-defects-btn');
    if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', async () => {
            if (confirm(`Bu adımdaki TÜM hataları kalıcı olarak silmek ve adımı 'Bekliyor' durumuna geri almak istediğinizden emin misiniz?`)) {
                await _supabase.from('defects').delete().eq('machine_id', machine.id).eq('step', stepKey);
                await cancelStepCompletion(stepKey, machine, true); // `true` ile onayı atla
            }
        });
    }

    // Yeni hataları ekleme butonu
    document.getElementById('add-defects-btn').addEventListener('click', async () => {
        const textarea = document.getElementById('add-defect-textarea');
        const newDefects = textarea.value.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        if (newDefects.length === 0) return;

        const { data: lastDefect } = await _supabase.from('defects').select('orderIndex').eq('machine_id', machine.id).eq('step', stepKey).order('orderIndex', { ascending: false }).limit(1).single();
        const lastOrderIndex = lastDefect ? lastDefect.orderIndex : -1;
        const defectsToInsert = newDefects.map((desc, index) => ({ machine_id: machine.id, description: desc, is_fixed: false, step: stepKey, orderIndex: lastOrderIndex + 1 + index }));
        
        const { error } = await _supabase.from('defects').insert(defectsToInsert);
        if (error) {
            alert("Hata: Yeni hatalar eklenemedi. " + error.message);
        } else {
            renderDefectEntryStep(stepName, machine);
        }
    });

    // Adımı tamamlama butonu
    document.getElementById('complete-defect-step-btn').addEventListener('click', async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Kaydediliyor...';

        const { count } = await _supabase.from('defects').select('*', { count: 'exact', head: true }).eq('machine_id', machine.id).eq('step', stepKey);
        const note = `${count || 0} adet hata bulgusu mevcut.`;
        
        const currentStatus = machine.status || {};
        currentStatus[stepKey] = { completed: true, note: note, completedAt: new Date().toISOString() };
        
        const { data: updatedMachine, error } = await _supabase.from('machines').update({ status: currentStatus }).eq('id', machine.id).select().single();
        
        if (error) {
            alert("Hata: Adım tamamlanamadı. " + error.message);
            e.target.disabled = false;
            e.target.textContent = 'Adımı Tamamla';
        } else {
            renderDefectEntryStep(stepName, updatedMachine);
            renderProcessSteps(updatedMachine);
        }
    });
};

/**
 * Detay sayfasındaki "Durum" sekmesinde yer alan interaktif elemanlar için olay dinleyicilerini kurar.
 * @param {string} machineId - İlgili makinanın ID'si.
 */
const addDetailViewEventListeners = (machineId) => {
    // Sevk Tarihi Değişikliği
    const shipmentDateInput = document.getElementById('shipment-date-input');
    shipmentDateInput.addEventListener('change', async (event) => {
        const newDate = event.target.value || null; // Boş tarih null olarak gitsin
        const { error } = await _supabase.from('machines').update({ shipment_date: newDate }).eq('id', machineId);
        if (error) {
            alert('Sevk tarihi güncellenirken hata oluştu: ' + error.message);
        } else {
            // Başarı bildirimi eklenebilir.
        }
    });

    // Son Durum Notu Değişikliği (blur: odaktan çıkınca kaydeder)
    const finalStatusTextarea = document.getElementById('final-status-textarea-detail');
    finalStatusTextarea.addEventListener('blur', async (event) => {
        const newStatus = event.target.value;
        const { error } = await _supabase.from('machines').update({ final_status: newStatus }).eq('id', machineId);
        if (error) {
            alert('Son durum notu güncellenirken hata oluştu: ' + error.message);
        }
    });

    // Başlangıç Eksikleri Checkbox'ları
    document.querySelectorAll('#initial-defects-list input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', async (event) => {
            const defectId = event.target.dataset.defectId;
            const isFixed = event.target.checked;
            const { error } = await _supabase.from('defects').update({ is_fixed: isFixed }).eq('id', defectId);

            if (error) {
                alert('Eksiklik durumu güncellenirken hata oluştu: ' + error.message);
                event.target.checked = !isFixed; // Hata durumunda değişikliği geri al
            } else {
                event.target.closest('li.checklist-item').classList.toggle('fixed', isFixed);
            }
        });
    });
};

/**
 * Üretim takip listesini Excel'e aktarır.
 */
const exportProductionToExcel = async () => {
    try {
        // Filtrelenmiş verinin tamamını çekmek için yeni bir sorgu yapıyoruz.
        let query = _supabase.from('machines').select('*').eq('is_shipped', false);
        const { data: machines, error } = await query.order(currentSortField, { ascending: currentSortDirection === 'asc' });

        if (error) throw error;
        if (!machines || machines.length === 0) {
            alert("Dışa aktarılacak veri bulunamadı.");
            return;
        }

        const bekolar = machines.filter(m => m.machine_type === 'BL');
        const diger = machines.filter(m => m.machine_type !== 'BL');

        const wb = XLSX.utils.book_new();

        const prepareSheet = (list, sheetName) => {
            const dataToExport = list.map((m, index) => {
                const row = {
                    'SN': index + 1, 'Tip': m.machine_type, 'Model': m.model, 'Müşteri': m.customer_name || '-',
                    'Seri No': m.serial_number, 'Şase No': m.chassis_number,
                    'Bant Çıkış': new Date(m.production_date).toLocaleDateString('tr-TR'),
                    'Sevk Tarihi': m.shipment_date ? new Date(m.shipment_date).toLocaleDateString('tr-TR') : '-',
                    'Son Durum': m.final_status || ''
                };
                PROCESS_STEPS.filter(s => s !== "Durum").forEach(step => {
                    row[step] = m.status?.[getStatusKey(step)]?.completed ? "OK" : "Bekliyor";
                });
                return row;
            });
            const ws = XLSX.utils.json_to_sheet(dataToExport);
            ws['!cols'] = Object.keys(dataToExport[0] || {}).map(k => ({wch: k === 'Son Durum' ? 40 : 15}));
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        };

        prepareSheet(bekolar, "Bekolar");
        prepareSheet(diger, "Diğer Makinalar");

        XLSX.writeFile(wb, `Uretim_Takip_Listesi_${new Date().toISOString().slice(0, 10)}.xlsx`);

    } catch (error) {
        console.error("Excel'e aktarılırken hata:", error);
        alert("Veriler dışa aktarılırken bir hata oluştu.");
    }
};

/**
 * YENİ: Makina yükleme için örnek Excel şablonunu indirir.
 */
const downloadExampleExcel = () => {
    const headers = ['Makina Tipi', 'Makina Modeli', 'Müşteri İsmi', 'Seri No', 'Şase No', 'Bant Çıkış Tarihi'];
    // Süreç adımlarını başlık olarak ekle (Durum hariç)
    PROCESS_STEPS.forEach(step => {
        if (step !== 'Durum') headers.push(step);
    });

    const data = [headers];
    
    // Örnek veri satırı
    const exampleRow = ['Kazıcı Yükleyici', '102S', 'Örnek Müşteri Ltd.', 'S12345', 'N098765', '25.10.2023'];
    // Süreç sütunları için boşluk veya örnek değer
    PROCESS_STEPS.forEach(step => {
        if (step !== 'Durum') {
            // Örnek olarak ilk adıma 'OK' yazalım, diğerleri boş kalsın
            exampleRow.push(step === 'Tamamlama 1' ? 'OK' : '');
        }
    });
    
    data.push(exampleRow);

    const ws = XLSX.utils.aoa_to_sheet(data);
    
    // Sütun genişliklerini ayarla
    const wscols = headers.map(h => ({ wch: Math.max(h.length + 5, 15) }));
    ws['!cols'] = wscols;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Şablon");
    XLSX.writeFile(wb, "Makina_Yukleme_Sablonu.xlsx");
};

/**
 * Yeni makina ekleme formunu yönetir.
 * @param {Event} event - Form submit olayı.
 */
const handleAddMachineFormSubmit = async (event) => {
    event.preventDefault();
    addMachineButton.disabled = true;
    addMachineButton.textContent = 'Ekleniyor...';

    const formData = new FormData(addMachineForm);
    const machineData = {
        machine_type: formData.get('machine_type'),
        model: formData.get('model'),
        customer_name: formData.get('customer_name'),
        serial_number: formData.get('serial_number'),
        chassis_number: formData.get('chassis_number'),
        production_date: formData.get('production_date'),
        status: {}, // Başlangıçta boş bir JSON objesi
        is_shipped: false,
    };

    try {
        // 1. Yeni makinayı 'machines' tablosuna ekle
        const { data: newMachine, error: machineError } = await _supabase
            .from('machines')
            .insert(machineData)
            .select()
            .single();

        if (machineError) throw machineError;

        // 2. Başlangıç eksikleri varsa, onları 'defects' tablosuna ekle
        const initialDefectsText = formData.get('initial_defects');
        const deficiencies = initialDefectsText.split('\n').map(line => line.trim()).filter(line => line.length > 0);

        if (deficiencies.length > 0) {
            const defectsToInsert = deficiencies.map((desc, index) => ({
                machine_id: newMachine.id,
                description: desc,
                is_fixed: false,
                step: 'initial', // Bu bir başlangıç eksiğidir
                orderIndex: index
            }));

            const { error: defectError } = await _supabase.from('defects').insert(defectsToInsert);
            if (defectError) throw defectError;
        }

        // 3. Başarılı olursa arayüzü güncelle
        modal.style.display = 'none';
        addMachineForm.reset();
        await fetchProductionData(); // Listeyi yenile

    } catch (error) {
        console.error("Makina ekleme hatası:", error);
        alert(`Hata: Makina eklenemedi. ${error.message}`);
    } finally {
        addMachineButton.disabled = false;
        addMachineButton.textContent = 'Makina Ekle';
    }
};

/**
 * YENİ: Sevkiyat modalını yönetir.
 * @param {string} machineId - Sevk edilecek makinanın ID'si.
 */
const openShipmentModal = (machineId) => {
    const modal = document.getElementById('shipment-modal');
    const confirmButton = document.getElementById('confirm-shipment-button');
    const datePicker = document.getElementById('shipment-date-picker');
    
    // Tarihi bugüne ayarla
    datePicker.value = new Date().toISOString().split('T')[0];

    // Olay dinleyicisinin tekrar tekrar eklenmesini önlemek için butonu klonla
    const newConfirmButton = confirmButton.cloneNode(true);
    confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);

    const shipmentHandler = async () => {
        const shipmentDate = datePicker.value;
        if (!shipmentDate) {
            alert("Lütfen bir sevkiyat tarihi seçin.");
            return;
        }

        newConfirmButton.disabled = true;
        newConfirmButton.textContent = 'Sevk Ediliyor...';

        try {
            const { error } = await _supabase
                .from('machines')
                .update({ is_shipped: true, shipment_date: shipmentDate })
                .eq('id', machineId);
            if (error) throw error;

            modal.style.display = 'none';
            await fetchProductionData(); // Listeyi yenile
        } catch (error) {
            console.error("Sevkiyat işlemi sırasında hata:", error);
            alert("Hata: Makina sevk edilemedi.");
            newConfirmButton.disabled = false;
            newConfirmButton.textContent = 'Onayla ve Sevk Et';
        }
    };

    newConfirmButton.addEventListener('click', shipmentHandler);
    modal.style.display = 'block';
};

/**
 * Excel dosyasından makina verilerini içe aktarır.
 * @param {Event} event - File input change olayı.
 */
const handleExcelImport = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            // raw: false ile tarihleri string olarak alıyoruz (örn: "25.10.2023")
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false });

            if (jsonData.length === 0) {
                alert("Excel dosyası boş veya okunamadı.");
                return;
            }

            const machinesToInsert = [];

            for (const row of jsonData) {
                // Şase No zorunlu alan
                if (!row['Şase No']) continue;

                // Tarih formatını düzeltme (DD.MM.YYYY -> YYYY-MM-DD)
                let productionDate = new Date().toISOString();
                if (row['Bant Çıkış Tarihi']) {
                    const parts = String(row['Bant Çıkış Tarihi']).split('.');
                    if (parts.length === 3) {
                        // DD.MM.YYYY formatı varsayımı
                        productionDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).toISOString();
                    } else {
                        // Farklı format gelirse standart çevirmeyi dene
                        const d = new Date(row['Bant Çıkış Tarihi']);
                        if (!isNaN(d.getTime())) productionDate = d.toISOString();
                    }
                }

                const machine = {
                    machine_type: row['Makina Tipi'] || row['Tip'] || '',
                    model: row['Makina Modeli'] || row['Model'] || '',
                    customer_name: row['Müşteri İsmi'] || '',
                    serial_number: row['Seri No'] || '',
                    chassis_number: row['Şase No'],
                    production_date: productionDate,
                    is_shipped: false,
                    status: {}
                };

                // Süreç adımlarını kontrol et (Sütun adı adım adıyla aynı olmalı, Değer: OK, 1, EVET)
                PROCESS_STEPS.forEach(step => {
                    const val = row[step];
                    if (val && (String(val).toUpperCase() === 'OK' || String(val) === '1' || String(val).toUpperCase() === 'EVET')) {
                        const stepKey = getStatusKey(step);
                        machine.status[stepKey] = {
                            completed: true,
                            note: 'Excel import ile eklendi.',
                            completedAt: new Date().toISOString()
                        };
                    }
                });

                machinesToInsert.push(machine);
            }

            if (machinesToInsert.length > 0) {
                const { error } = await _supabase.from('machines').insert(machinesToInsert);
                if (error) throw error;
                alert(`${machinesToInsert.length} adet makina başarıyla eklendi.`);
                await fetchProductionData();
            } else {
                alert("Eklenecek geçerli veri bulunamadı.");
            }
        } catch (error) {
            console.error("Excel import hatası:", error);
            alert("İçe aktarma sırasında hata oluştu: " + error.message);
        } finally {
            event.target.value = ''; // Input'u temizle
        }
    };
    reader.readAsArrayBuffer(file);
};

// --- 4. Olay Dinleyicileri ve Başlatma ---

/**
 * Sayfa için gerekli tüm olay dinleyicilerini kurar.
 */
const setupEventListeners = () => {
    // Modal'ı açma
    showModalButton.addEventListener('click', () => {
        modal.style.display = 'block';
    });

    // Modal'ı kapatma (X butonu)
    closeModalButton.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    // Sevkiyat modalı kapatma butonu
    const shipmentModalCloseBtn = shipmentModal.querySelector('.close-button');
    shipmentModalCloseBtn.addEventListener('click', () => {
        shipmentModal.style.display = 'none';
    });

    // Modal'ı kapatma (dışarı tıklama)
    window.addEventListener('click', (event) => {
        // Modal dışına tıklanırsa modalı kapat
        if (event.target === modal) {
            modal.style.display = 'none';
        }
        // Sevkiyat modalı dışına tıklanırsa kapat
        if (event.target === shipmentModal) {
            shipmentModal.style.display = 'none';
        }

        // YENİ: Mobil süreç menüsü dışına tıklanırsa menüyü kapat
        const sidebar = document.getElementById('detail-sidebar');
        // sidebar'ın varlığını ve 'open' sınıfına sahip olup olmadığını kontrol et
        if (sidebar && sidebar.classList.contains('open')) {
            // Tıklanan elementin sidebar veya onun bir alt elementi olmadığını kontrol et
            if (!sidebar.contains(event.target)) {
                sidebar.classList.remove('open');
            }
        }
    });

    // YENİ: Arama ve Filtreleme olay dinleyicileri
    const searchInput = document.getElementById('search-input');
    const machineTypeFilter = document.getElementById('machine-type-filter');

    // Debounce fonksiyonu: Veritabanını yormamak için yazma bitince çalışır
    const debounce = (func, delay) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    };

    // YENİ: Sayfalama butonları için olay dinleyicileri
    const prevBtn = document.getElementById('prev-page-btn');
    const nextBtn = document.getElementById('next-page-btn');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                fetchProductionData();
            }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            currentPage++;
            fetchProductionData();
        });
    }

    // Arama input'u için
    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            currentSearchTerm = searchInput.value;
            fetchProductionData();
        }, 500)); // 500ms gecikme
    }

    // Kategori filtresi için
    const categoryFilter = document.getElementById('category-filter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', () => {
            currentCategoryFilter = categoryFilter.value;
            currentPage = 1;
            fetchProductionData();
        });
    }

    // Tip filtresi için
    if (machineTypeFilter) {
        machineTypeFilter.addEventListener('change', () => {
            currentMachineTypeFilter = machineTypeFilter.value;
            fetchProductionData();
        });
    }

    // Excel'e aktarma butonu
    const exportBtn = document.getElementById('export-production-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportProductionToExcel);
    }
    
    // YENİ: Tüm Test Bulgularını İndir Butonu
    if (exportBtn) {
        const exportDefectsBtn = document.createElement('button');
        exportDefectsBtn.textContent = "Tüm Test Bulgularını İndir";
        exportDefectsBtn.className = "button-primary";
        exportDefectsBtn.style.backgroundColor = "#17a2b8"; // Mavi tonu
        exportDefectsBtn.style.marginLeft = "10px";
        exportDefectsBtn.addEventListener('click', exportAllStockDefectsToExcel);
        exportBtn.parentNode.insertBefore(exportDefectsBtn, exportBtn.nextSibling);
    }

    // Form gönderme
    addMachineForm.addEventListener('submit', handleAddMachineFormSubmit);

    // YENİ: Ana listedeki "Son Durum" textarea'ları için olay dinleyicisi
    dataContainer.addEventListener('blur', async (event) => {
        if (event.target.classList.contains('final-status-textarea')) {
            const textarea = event.target;
            const machineId = textarea.dataset.machineId;
            const newStatus = textarea.value;

            const { error } = await _supabase
                .from('machines')
                .update({ final_status: newStatus })
                .eq('id', machineId);

            if (error) {
                console.error('Son durum güncellenirken hata:', error);
            }
        }
    }, true); // Olayın yakalama (capture) aşamasında çalıştır

    // YENİ: Sıralama için olay dinleyicisi (Event Delegation)
    dataContainer.addEventListener('click', (event) => {
        // Önce sıralama başlığına mı tıklandı diye kontrol et
        const header = event.target.closest('th.sortable');
        if (header) {
            const sortField = header.dataset.sort;

            if (sortField === currentSortField) {
                currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortField = sortField;
                currentSortDirection = 'asc';
            }
            fetchProductionData();
            return; // İşlemi burada bitir.
        }

        // Eğer başlığa tıklanmadıysa, satıra mı tıklandı diye kontrol et
        const row = event.target.closest('tr[data-machine-id]');
        if (row) {
            // YENİ: Eğer tıklanan element bir "Sevk Et" butonu ise, modalı aç.
            if (event.target.classList.contains('ship-btn')) {
                const machineId = event.target.dataset.machineId;
                openShipmentModal(machineId);
                return;
            }

            // YENİ: Eğer tıklanan element bir textarea ise navigasyonu engelle.
            if (event.target.tagName.toLowerCase() === 'textarea') {
                return;
            }
            const machineId = row.dataset.machineId;
            showDetailView(machineId, mainContentView, currentUserRole, fetchProductionData);
        }
    });
};

/**
 * YENİ: Stoktaki tüm makinaların test bulgularını Excel'e aktarır.
 */
const exportAllStockDefectsToExcel = async () => {
    try {
        // 1. Stoktaki makinaları çek
        const { data: machines, error: machineError } = await _supabase
            .from('machines')
            .select('id, chassis_number, production_date')
            .eq('is_shipped', false);
        
        if (machineError) throw machineError;
        if (!machines || machines.length === 0) {
            alert("Stokta makina bulunamadı.");
            return;
        }

        const machineMap = {};
        machines.forEach(m => machineMap[m.id] = m);
        const machineIds = machines.map(m => m.id);

        // 2. Bu makinalara ait bulguları çek
        const { data: defects, error: defectError } = await _supabase
            .from('defects')
            .select('*')
            .in('machine_id', machineIds);

        if (defectError) throw defectError;

        const wb = XLSX.utils.book_new();
        const sheetMap = {
            'test_1': 'Test 1',
            'pdi_oncesi': 'PDI öncesi',
            'pdi-1': 'PDI-1',
            'pdi-2': 'PDI-2'
        };
        const headers = ["Şase No", "Bant Çıkış Tarihi", "Bulgu", "Durum", "Not"];

        Object.keys(sheetMap).forEach(stepKey => {
            const sheetName = sheetMap[stepKey];
            const stepDefects = defects.filter(d => d.step === stepKey);
            
            const data = [headers];
            stepDefects.forEach(d => {
                const m = machineMap[d.machine_id];
                if (m) {
                    data.push([
                        m.chassis_number,
                        new Date(m.production_date).toLocaleDateString('tr-TR'),
                        d.description,
                        d.is_fixed ? "Giderildi" : "Açık",
                        d.note || ""
                    ]);
                }
            });

            const ws = XLSX.utils.aoa_to_sheet(data);
            ws['!cols'] = [{wch: 15}, {wch: 15}, {wch: 50}, {wch: 10}, {wch: 30}];
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        });

        XLSX.writeFile(wb, `Tum_Stok_Test_Bulgulari_${new Date().toISOString().slice(0,10)}.xlsx`);

    } catch (err) {
        console.error(err);
        alert("Excel oluşturulurken hata: " + err.message);
    }
};

/**
 * Sayfa yüklendiğinde çalışacak ana fonksiyon.
 */
const init = async () => {
    // Ortak layout'u ve kullanıcı rolünü al
    const { userRole } = await initializeAuthenticatedPage();
    currentUserRole = userRole; // YENİ: Rolü modül değişkenine ata

    // Rol'e göre "Yeni Makina Ekle" butonunu göster/gizle
    // Bu yetkilendirme, eski projenizdeki mantıkla aynıdır.
    if (userRole === 'admin' || userRole === 'montaj') {
        showModalButton.style.display = 'inline-block';

        // Excel import özelliği sadece adminler için
        if (userRole === 'admin') {
            // Dropdown Container
            const dropdownContainer = document.createElement('div');
            dropdownContainer.style.position = 'relative';
            dropdownContainer.style.display = 'inline-block';
            dropdownContainer.style.marginLeft = '5px';

            // Import Butonu
            const importBtn = document.createElement('button');
            importBtn.textContent = 'Import ▼';
            importBtn.className = 'button-primary';
            importBtn.style.backgroundColor = '#28a745'; // Yeşil renk
            
            
            // Dropdown İçeriği
            const dropdownContent = document.createElement('div');
            dropdownContent.style.display = 'none';
            dropdownContent.style.position = 'absolute';
            dropdownContent.style.backgroundColor = '#fff';
            dropdownContent.style.minWidth = '160px';
            dropdownContent.style.boxShadow = '0px 8px 16px 0px rgba(0,0,0,0.2)';
            dropdownContent.style.zIndex = '1000';
            dropdownContent.style.top = '100%';
            dropdownContent.style.left = '0';
            dropdownContent.style.borderRadius = '4px';
            dropdownContent.style.border = '1px solid #ddd';
            dropdownContent.style.marginTop = '5px';

            // Dosya Input (Gizli)
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.xlsx, .xls';
            fileInput.style.display = 'none';
            fileInput.addEventListener('change', handleExcelImport);

            // Seçenek 1: Excel Yükle
            const uploadOption = document.createElement('div');
            uploadOption.textContent = 'Excel Yükle';
            uploadOption.style.padding = '10px 15px';
            uploadOption.style.cursor = 'pointer';
            uploadOption.style.color = '#333';
            uploadOption.onmouseover = () => uploadOption.style.backgroundColor = '#f1f1f1';
            uploadOption.onmouseout = () => uploadOption.style.backgroundColor = 'transparent';
            uploadOption.addEventListener('click', () => {
                dropdownContent.style.display = 'none';
                fileInput.click();
            });

            // Seçenek 2: Örnek İndir
            const templateOption = document.createElement('div');
            templateOption.textContent = 'Örnek Excel İndir';
            templateOption.style.padding = '10px 15px';
            templateOption.style.cursor = 'pointer';
            templateOption.style.color = '#333';
            templateOption.style.borderTop = '1px solid #eee';
            templateOption.onmouseover = () => templateOption.style.backgroundColor = '#f1f1f1';
            templateOption.onmouseout = () => templateOption.style.backgroundColor = 'transparent';
            templateOption.addEventListener('click', () => {
                dropdownContent.style.display = 'none';
                downloadExampleExcel();
            });

            // Yapıyı oluştur
            dropdownContent.appendChild(uploadOption);
            dropdownContent.appendChild(templateOption);
            dropdownContainer.appendChild(importBtn);
            dropdownContainer.appendChild(dropdownContent);
            dropdownContainer.appendChild(fileInput);

            // Butona tıklama olayı
            importBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdownContent.style.display = dropdownContent.style.display === 'block' ? 'none' : 'block';
            });

            // Dışarı tıklayınca kapat
            window.addEventListener('click', () => {
                dropdownContent.style.display = 'none';
            });

            showModalButton.parentNode.insertBefore(dropdownContainer, showModalButton.nextSibling);
        }
    }

    setupEventListeners();
    await fetchProductionData();
};

// DOM yüklendiğinde `init` fonksiyonunu çalıştır.
document.addEventListener('DOMContentLoaded', init);