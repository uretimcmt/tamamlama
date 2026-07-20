// machine-detail.js
import { _supabase } from './supabaseClient.js';

// --- 1. Sabitler ---
const PROCESS_STEPS = [
    "Durum", "Tamamlama 1", "ROTUS 1", "ETIKET", "TEST 1", "Tamamlama Kabin",
    "ROTUS 2 ve TEMIZLIK", "PDI öncesi", "PDI öncesi Tmmlm", "PDI-1",
    "PDI-1 Tmmlm", "PDI-2", "PDI-2 Tmmlm"
];
const DEFECT_SOURCE_MAP = {
    'tamamlama_kabin': 'test_1',
    'rotus_2_ve_temizlik': 'test_1',
    'pdi_oncesi_tmmlm': 'pdi_oncesi',
    'pdi-1_tmmlm': 'pdi-1',
    'pdi-2_tmmlm': 'pdi-2'
};
const DEFECT_TRANSFER_MAP = {
    'rotus_2_ve_temizlik': { source: 'test_1', target: 'pdi_oncesi' },
    'pdi_oncesi_tmmlm': { source: 'pdi_oncesi', target: 'pdi-1' },
    'pdi-1_tmmlm': { source: 'pdi-1', target: 'pdi-2' }
};
const PREVIOUS_VERIFICATION_MAP = {
    'pdi_oncesi': 'test_1',
    'pdi-1': 'pdi_oncesi',
    'pdi-2': 'pdi-1'
};

function getStatusKey(stepName) {
    return stepName.toLowerCase().replace(/ /g, '_').replace('ö', 'o').replace('ı', 'i');
}

// Güvenlik: XSS Koruması için HTML karakterlerini temizleme fonksiyonu
const escapeHtml = (text) => {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

// --- 2. Modül İçi Değişkenler ---
let machineDetailView;
let mainContentView;
let currentUserRole;
let onBackCallback;

// --- 3. Ana Dışa Aktarılan Fonksiyon ---

/**
 * Makinanın sevkiyata hazır olma süresini hesaplar (Gün cinsinden).
 * @param {object} machine 
 * @returns {number|null}
 */
export const calculateReadyDuration = (machine) => {
    // YENİ: 1 Ocak 2026 tarihinden önceki makinaları hesaplamaya dahil etme
    const productionDate = new Date(machine.production_date);
    const cutoffDate = new Date('2026-01-01');

    if (productionDate < cutoffDate) {
        return null;
    }

    const t1Status = machine.status?.['tamamlama_1'];
    const pdiTmmlmStatus = machine.status?.['pdi_oncesi_tmmlm'];

    if (t1Status?.completed && t1Status.completedAt && pdiTmmlmStatus?.completed && pdiTmmlmStatus.completedAt) {
        const start = productionDate;
        const end = new Date(pdiTmmlmStatus.completedAt);
        const diffTime = end - start;
        return diffTime / (1000 * 60 * 60 * 24);
    }
    return null;
};

/**
 * Belirtilen makina için detay görünümünü oluşturur ve gösterir.
 * @param {string} machineId - Görüntülenecek makinanın ID'si.
 * @param {HTMLElement} mainContentElement - Gizlenecek ana içerik (liste) elementi.
 * @param {string} userRole - Mevcut kullanıcının rolü.
 * @param {Function} backCallback - "Listeye Dön" butonuna basıldığında çalışacak fonksiyon.
 */
export const showDetailView = async (machineId, mainContentElement, userRole, backCallback) => {
    mainContentView = mainContentElement;
    currentUserRole = userRole;
    onBackCallback = backCallback;
    machineDetailView = document.getElementById('machine-detail-view');

    mainContentView.style.display = 'none';
    machineDetailView.style.display = 'block';
    machineDetailView.innerHTML = `<p>Makina detayları yükleniyor...</p>`;

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

    renderDetailLayout(machine);
};

// --- 4. Yardımcı Fonksiyonlar ---

const hideDetailView = async () => {
    machineDetailView.style.display = 'none';
    machineDetailView.innerHTML = '';

    if (onBackCallback) {
        await onBackCallback();
    }

    mainContentView.style.display = 'block';
};

const renderDetailLayout = (machine) => {
    const deleteButtonHtml = currentUserRole === 'admin'
        ? `<button id="delete-machine-btn" class="button-secondary" style="background-color: #dc3545; color: white; margin-left: auto;">Sil</button>` 
        : '';

    // YENİ: Test Bulgularını Yazdır Butonu (Herkes görebilir)
    const exportDefectsButtonHtml = `<button id="export-defects-btn" class="button-secondary" style="background-color: #17a2b8; color: white; margin-left: 10px;">Test Bulgularını Yazdır</button>`;

    machineDetailView.innerHTML = `
        <div class="detail-header">
            <button id="back-to-list-btn" class="button-secondary">&larr; Listeye Dön</button>
            <h1> ${escapeHtml(machine.chassis_number || 'Belirtilmemiş')}</h1>
            ${machine.is_shipped ? '<span class="status-badge status-ok">SEVK EDİLDİ</span>' : ''}
            ${exportDefectsButtonHtml}
            ${deleteButtonHtml}
        </div>
        <div class="detail-layout">
            <div id="detail-sidebar" class="process-sidebar">
                <div class="mobile-step-selector">
                    <span id="current-step-name-mobile">Durum</span>
                    <svg class="arrow-icon" xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M0 0h24v24H0z" fill="none"/><path d="M7 10l5 5 5-5z"/></svg>
                </div>
                <div id="process-steps-list"></div>
            </div>
            <div id="detail-content" class="process-content"></div>
        </div>
    `;

    document.getElementById('back-to-list-btn').addEventListener('click', hideDetailView);
    
    // YENİ: Export butonu dinleyicisi
    document.getElementById('export-defects-btn').addEventListener('click', () => exportMachineDefectsToExcel(machine));

    if (currentUserRole === 'admin') {
        const deleteBtn = document.getElementById('delete-machine-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                if (confirm(`"${machine.chassis_number}" şaseli makinayı ve tüm verilerini silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`)) {
                    try {
                        // İlişkili hataları sil (Cascade yoksa diye önlem)
                        await _supabase.from('defects').delete().eq('machine_id', machine.id);
                        
                        const { error } = await _supabase.from('machines').delete().eq('id', machine.id);
                        if (error) throw error;

                        alert('Makina başarıyla silindi.');
                        hideDetailView();
                    } catch (err) {
                        console.error('Silme işlemi hatası:', err);
                        alert('Silme işlemi başarısız: ' + err.message);
                    }
                }
            });
        }
    }

    document.querySelector('.mobile-step-selector').addEventListener('click', () => {
        document.getElementById('detail-sidebar').classList.toggle('open');
    });

    renderProcessSteps(machine);
    renderContentForStep('Durum', machine);
};

/**
 * YENİ: Tek bir makinanın test bulgularını Excel'e aktarır.
 */
const exportMachineDefectsToExcel = async (machine) => {
    try {
        const { data: defects, error } = await _supabase
            .from('defects')
            .select('*')
            .eq('machine_id', machine.id);
        
        if (error) throw error;

        if (!defects || defects.length === 0) {
            alert("Bu makina için kayıtlı test bulgusu yok.");
            return;
        }

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
                data.push([
                    machine.chassis_number,
                    new Date(machine.production_date).toLocaleDateString('tr-TR'),
                    d.description,
                    d.is_fixed ? "Giderildi" : "Açık",
                    d.note || ""
                ]);
            });

            const ws = XLSX.utils.aoa_to_sheet(data);
            ws['!cols'] = [{wch: 15}, {wch: 15}, {wch: 50}, {wch: 10}, {wch: 30}];
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        });

        XLSX.writeFile(wb, `${machine.chassis_number}_Test_Bulgulari.xlsx`);

    } catch (err) {
        console.error(err);
        alert("Excel oluşturulurken hata: " + err.message);
    }
};

const renderProcessSteps = (machine) => {
    const stepsListContainer = document.getElementById('process-steps-list');
    stepsListContainer.innerHTML = '';
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
            stepEl.classList.add('active');
            if (mobileStepName) mobileStepName.textContent = stepName;
        }

        stepEl.addEventListener('click', () => {
            stepsListContainer.querySelector('.process-step.active')?.classList.remove('active');
            stepEl.classList.add('active');
            if (mobileStepName) mobileStepName.textContent = stepName;
            document.getElementById('detail-sidebar').classList.remove('open');
            renderContentForStep(stepName, machine);
        });

        stepsListContainer.appendChild(stepEl);
    });
};

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

const renderContentForStep = async (stepName, machine) => {
    const contentArea = document.getElementById('detail-content');
    contentArea.innerHTML = `<p>İçerik yükleniyor...</p>`;
    const isReadOnly = machine.is_shipped;

    if (stepName === "Durum") {
        const { data: initialDefects, error: defectsError } = await _supabase
            .from('defects')
            .select('*')
            .eq('machine_id', machine.id)
            .eq('step', 'initial')
            .order('orderIndex', { ascending: true });

        if (defectsError) {
            contentArea.innerHTML = `<p style="color:red;">Başlangıç eksikleri yüklenemedi.</p>`;
            return;
        }

        let initialDefectsHtml = '<li>Başlangıç eksiği girilmemiş.</li>';
        if (initialDefects && initialDefects.length > 0) {
            initialDefectsHtml = initialDefects.map((defect, index) => `
                <li class="checklist-item ${defect.is_fixed ? 'fixed' : ''}">
                    <input type="checkbox" id="defect-${defect.id}" data-defect-id="${defect.id}" ${defect.is_fixed ? 'checked' : ''} ${isReadOnly ? 'disabled' : ''}>
                    <label for="defect-${defect.id}"><strong>${index + 1}.</strong> ${escapeHtml(defect.description)}</label>
                </li>
            `).join('');
        }

        const shipmentDateForInput = machine.shipment_date ? new Date(machine.shipment_date).toISOString().split('T')[0] : '';
        
        // YENİ: Sevk tarihi alanı sadece admin için input, diğerleri için metin olarak görünür.
        // YENİ: Sevkiyata hazır olduğu gün sayısı hesaplama
        const duration = calculateReadyDuration(machine);
        const readyDurationText = duration !== null ? `${duration.toFixed(1)} Gün` : '-';

        let shipmentDateHtml = '';
        if (currentUserRole === 'admin') {
            shipmentDateHtml = `
                <div class="form-group">
                    <label for="shipment-date-input"><strong>Sevk Tarihi:</strong></label>
                    <input type="date" id="shipment-date-input" value="${shipmentDateForInput}" ${isReadOnly ? 'disabled' : ''}>
                </div>`;
        } else {
            const displayDate = machine.shipment_date ? new Date(machine.shipment_date).toLocaleDateString('tr-TR') : '-';
            shipmentDateHtml = `<div><strong>Sevk Tarihi:</strong> ${displayDate}</div>`;
        }

        // Müşteri İsmi Alanı (Düzenlenebilir)
        let customerNameHtml = '';
        if (['admin', 'montaj'].includes(currentUserRole) && !isReadOnly) {
            customerNameHtml = `
                <div class="form-group" style="grid-column: 1 / -1; margin-top: 10px;">
                    <label for="customer-name-input"><strong>Müşteri İsmi:</strong></label>
                    <textarea id="customer-name-input" class="form-control" rows="2" placeholder="Müşteri ismini girin..." style="font-weight: bold;">${escapeHtml(machine.customer_name || '')}</textarea>
                </div>`;
        } else {
            customerNameHtml = `
                <div style="grid-column: 1 / -1; margin-top: 10px;">
                    <strong>Müşteri İsmi:</strong> 
                    <div class="note-display" style="background: #f8f9fa; padding: 10px; border: 1px solid #dee2e6; border-radius: 4px; margin-top: 5px;">${escapeHtml(machine.customer_name || '-')}</div>
                </div>`;
        }

        // YENİ: Son Durum Notu alanı sadece admin ve montaj yetkisi olanlar için düzenlenebilir.
        const canEditFinalStatus = ['admin', 'montaj'].includes(currentUserRole) && !isReadOnly;
        let finalStatusHtml = '';
        if (canEditFinalStatus) {
            finalStatusHtml = `<textarea id="final-status-textarea-detail" class="form-control" rows="4" placeholder="Makina ile ilgili genel durumu veya notları buraya girin...">${escapeHtml(machine.final_status || '')}</textarea>`;
        } else {
            finalStatusHtml = `<div class="note-display" style="white-space: pre-wrap; background: #f8f9fa; padding: 10px; border: 1px solid #dee2e6; border-radius: 4px;">${escapeHtml(machine.final_status || 'Not girilmemiş.')}</div>`;
        }

        contentArea.innerHTML = `
            <h2>Makina Künyesi ve Durum Özeti</h2>
            <div class="info-grid">
                <div><strong>Tip:</strong> ${escapeHtml(machine.machine_type) || '-'}</div>
                <div><strong>Model:</strong> ${escapeHtml(machine.model) || '-'}</div>
                ${customerNameHtml}
                <div><strong>Seri No:</strong> ${escapeHtml(machine.serial_number) || '-'}</div>
                <div><strong>Şase No:</strong> ${escapeHtml(machine.chassis_number) || '-'}</div>
                <div><strong>Bant Çıkış:</strong> ${new Date(machine.production_date).toLocaleDateString('tr-TR')}</div>
                <div><strong>Sevkiyata hazır olduğu gün sayısı:</strong> ${readyDurationText}</div>
                ${shipmentDateHtml}
            </div>
            
            <h2>Başlangıç Eksikleri</h2>
            <ul id="initial-defects-list" class="defect-checklist">${initialDefectsHtml}</ul>
            
            <br>
            <h2>Son Durum Notu</h2>
            ${finalStatusHtml}
            <div class="process-summary-container">
                <h2>Süreç Genel Bakış</h2>
                <div id="process-summary-grid"></div>
            </div>
        `;

        if (!isReadOnly) {
            addDetailViewEventListeners(machine.id);
        }
        renderProcessSummary(machine);

    } else if (["Tamamlama 1", "ROTUS 1", "ETIKET"].includes(stepName)) {
        renderSimpleCompletionStep(stepName, machine);
    } else if (["TEST 1", "PDI öncesi", "PDI-1", "PDI-2"].includes(stepName)) {
        renderDefectEntryStep(stepName, machine);
    } else if (["Tamamlama Kabin", "ROTUS 2 ve TEMIZLIK", "PDI öncesi Tmmlm", "PDI-1 Tmmlm", "PDI-2 Tmmlm"].includes(stepName)) {
        renderDefectFixingStep(stepName, machine);
    } else {
        contentArea.innerHTML = `<h2>${stepName}</h2><p>Bu adım için detaylı arayüz yakında eklenecek.</p>`;
    }
};

const renderSimpleCompletionStep = (stepName, machine) => {
    const contentArea = document.getElementById('detail-content');
    const stepKey = getStatusKey(stepName);
    const isCompleted = machine.status && machine.status[stepKey]?.completed;
    const isReadOnly = machine.is_shipped;

    // YENİ: Yetki Kontrolü. Bu adımları sadece 'admin' ve 'montaj' rolleri kullanabilir.
    // 'kalite' rolü bu adımlarda işlem yapamaz.
    if (!isReadOnly && !['admin', 'montaj'].includes(currentUserRole)) {
        contentArea.innerHTML = `
            <h2>${stepName}</h2>
            <div class="completed-info" style="border-left-color: #ffc107;">
                <p>Bu alanda işlem yapma yetkiniz bulunmamaktadır.</p>
                <strong>Bu adım 'Montaj' veya 'Admin' rolü gerektirir.</strong>
            </div>
        `;
        return;
    }

    if (isCompleted) {
        const note = machine.status[stepKey]?.note || 'Not bırakılmamış.';
        const cancelButtonHtml = currentUserRole === 'admin' && !isReadOnly
            ? `<button id="cancel-step-btn" class="button-secondary" style="margin-top: 20px;">Tamamlamayı İptal Et</button>`
            : '';

        contentArea.innerHTML = `
            <h2>${stepName}</h2>
            <div class="completed-info">
                <p>Bu adım zaten tamamlanmış.</p>
                <strong>Bırakılan Not:</strong>
                <div class="note-display">${escapeHtml(note)}</div>
            </div>
            ${cancelButtonHtml}
        `;

        if (currentUserRole === 'admin' && !isReadOnly) {
            const cancelButton = document.getElementById('cancel-step-btn');
            if (cancelButton) {
                cancelButton.addEventListener('click', () => cancelStepCompletion(stepKey, machine));
            }
        }
    } else {
        if (isReadOnly) {
             contentArea.innerHTML = `<h2>${stepName}</h2><div class="completed-info" style="border-left-color: #ffc107;"><p>Bu adım henüz tamamlanmamış.</p></div>`;
             return;
        }
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

const cancelStepCompletion = async (stepKey, machine, skipConfirm = false) => {
    const stepName = PROCESS_STEPS.find(name => getStatusKey(name) === stepKey);
    if (!skipConfirm && !confirm(`'${stepName}' adımının tamamlanma durumunu iptal etmek istediğinizden emin misiniz? Bu işlem, adıma ait notu da silecektir.`)) {
        return;
    }

    try {
        const currentStatus = machine.status || {};
        if (currentStatus[stepKey]) {
            delete currentStatus[stepKey];
        }

        const { data: updatedMachine, error } = await _supabase
            .from('machines')
            .update({ status: currentStatus })
            .eq('id', machine.id)
            .select()
            .single();
        
        if (error) throw error;

        renderContentForStep(stepName, updatedMachine);
        renderProcessSteps(updatedMachine);
    } catch (error) {
        console.error('Adım iptal edilirken hata:', error);
        alert('Hata: Adım iptal edilemedi. ' + error.message);
    }
};

const renderDefectFixingStep = async (stepName, machine) => {
    const contentArea = document.getElementById('detail-content');
    const currentStepKey = getStatusKey(stepName);
    const sourceStepKey = DEFECT_SOURCE_MAP[currentStepKey];
    const isCompleted = machine.status && machine.status[currentStepKey]?.completed;
    const isReadOnly = machine.is_shipped;

    if (!isReadOnly && !['admin', 'montaj'].includes(currentUserRole)) {
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

    const { data: defects, error } = await _supabase.from('defects').select('*').eq('machine_id', machine.id).eq('step', sourceStepKey).order('orderIndex', { ascending: true });

    if (error) {
        console.error("Hata listesi çekilirken hata:", error);
        contentArea.innerHTML = `<p style="color:red;">Hata listesi yüklenemedi.</p>`;
        return;
    }

    if (isCompleted) {
        const defectListHtml = defects.length > 0 ? defects.map((defect, index) => `
            <li class="checklist-item ${defect.is_fixed ? 'fixed' : ''}">
                <div class="checklist-item-content">
                    <input type="checkbox" id="fix-defect-${defect.id}" ${defect.is_fixed ? 'checked' : ''} disabled>
                    <label for="fix-defect-${defect.id}"><strong>${index + 1}.</strong> ${escapeHtml(defect.description)}</label>
                </div>
                ${defect.note ? `<div class="defect-note-display"><strong>Not:</strong> ${escapeHtml(defect.note)}</div>` : ''}
            </li>
        `).join('') : '<li>Bu adım için düzeltilecek hata bulunamadı.</li>';

        const cancelButtonHtml = currentUserRole === 'admin' && !isReadOnly
            ? `<button id="cancel-fixing-step-btn" class="button-secondary" style="margin-top: 20px;">Tamamlamayı İptal Et</button>`
            : '';

        contentArea.innerHTML = `
            <h2>${stepName}</h2>
            <div class="completed-info">
                <p>Bu adım zaten tamamlanmış.</p>
            </div>
            <h3 style="margin-top: 20px; margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px;">İlgili Hata Listesi</h3>
            <ul class="defect-checklist">${defectListHtml}</ul>
            ${cancelButtonHtml}
        `;

        if (currentUserRole === 'admin' && !isReadOnly) {
            const cancelButton = document.getElementById('cancel-fixing-step-btn');
            if (cancelButton) {
                cancelButton.addEventListener('click', () => cancelStepCompletion(currentStepKey, machine));
            }
        }
        return;
    }

    if (defects.length === 0) {
        contentArea.innerHTML = `
            <h2>${stepName}</h2>
            <div class="completed-info">
                <p>Bu adım için düzeltilecek hata bulunamadı.</p>
            </div>
            ${isReadOnly ? '' : '<button id="complete-fixing-step-btn" class="button-primary green">Adımı Tamamla</button>'}
        `;
    } else {
        const defectListHtml = defects.map((defect, index) => `
            <li class="checklist-item ${defect.is_fixed ? 'fixed' : ''}" data-defect-id="${defect.id}">
                <div class="checklist-item-content">
                    <input type="checkbox" id="fix-defect-${defect.id}" data-defect-id="${defect.id}" ${defect.is_fixed ? 'checked' : ''} ${isReadOnly ? 'disabled' : ''}>
                    <label for="fix-defect-${defect.id}"><strong>${index + 1}.</strong> ${escapeHtml(defect.description)}</label>
                    ${isReadOnly ? '' : '<button class="add-note-btn" title="Not Ekle/Düzenle">+</button>'}
                </div>
                ${defect.note ? `<div class="defect-note-display"><strong>Not:</strong> ${escapeHtml(defect.note)}</div>` : ''}
                ${isReadOnly ? '' : `
                <div class="defect-note-form" style="display: none;">
                    <textarea class="defect-note-input" placeholder="Bu madde için not ekleyin...">${escapeHtml(defect.note || '')}</textarea>
                    <div class="note-form-buttons">
                        <button class="save-note-btn">Kaydet</button>
                        <button class="cancel-note-btn">İptal</button>
                    </div>
                </div>`}
            </li>
        `).join('');

        contentArea.innerHTML = `
            <h2>"${stepName}" Hata Düzeltme</h2>
            <p>Önceki adımdan gelen hataları giderin veya not bırakın.</p>
            <ul class="defect-checklist">${defectListHtml}</ul>
            ${isReadOnly ? '' : '<button id="complete-fixing-step-btn" class="button-primary green" style="margin-top: 20px;">Adımı Tamamla</button>'}
        `;
    }

    if (!isReadOnly) {
        setupDefectFixingEventListeners(currentStepKey, machine);
    }
};

const setupDefectFixingEventListeners = (currentStepKey, machine) => {
    const stepName = PROCESS_STEPS.find(name => getStatusKey(name) === currentStepKey);

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

    document.querySelectorAll('.add-note-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const noteForm = e.target.closest('.checklist-item').querySelector('.defect-note-form');
            noteForm.style.display = noteForm.style.display === 'none' ? 'flex' : 'none';
        });
    });

    document.querySelectorAll('.cancel-note-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.target.closest('.defect-note-form').style.display = 'none';
        });
    });

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
                    noteDisplay.innerHTML = `<strong>Not:</strong> ${escapeHtml(newNote)}`;
                } else if (noteDisplay) {
                    noteDisplay.remove();
                }
            }
        });
    });

    const completeBtn = document.getElementById('complete-fixing-step-btn');
    if (completeBtn) {
        completeBtn.addEventListener('click', async (e) => {
            e.target.disabled = true;
            e.target.textContent = 'Kaydediliyor...';

            try {
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

const renderDefectEntryStep = async (stepName, machine) => {
    const contentArea = document.getElementById('detail-content');
    const stepKey = getStatusKey(stepName);
    const isCompleted = machine.status && machine.status[stepKey]?.completed;
    const isReadOnly = machine.is_shipped;

    if (!isReadOnly && !['admin', 'kalite'].includes(currentUserRole)) {
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

    // YENİ: Önceki adımdan gelen düzeltilmiş hataların kontrolü
    let verificationHtml = '';
    if (PREVIOUS_VERIFICATION_MAP[stepKey] && !isReadOnly && ['admin', 'kalite'].includes(currentUserRole)) {
        const prevSourceStep = PREVIOUS_VERIFICATION_MAP[stepKey];
        // Önceki adımda 'fixed' olarak işaretlenmiş hataları çek
        const { data: prevFixed } = await _supabase
            .from('defects')
            .select('*')
            .eq('machine_id', machine.id)
            .eq('step', prevSourceStep)
            .eq('is_fixed', true);
        
        if (prevFixed && prevFixed.length > 0) {
            // Mevcut listede zaten var olanları filtrele (tekrar eklemeyi önlemek için)
            const currentDescriptions = defects.map(d => d.description);
            const toVerify = prevFixed.filter(d => !currentDescriptions.includes(d.description));
            
            if (toVerify.length > 0) {
                const listItems = toVerify.map(d => `
                    <li class="checklist-item" style="background: #fff; border-bottom: 1px solid #eee; padding: 8px; flex-direction: column; align-items: flex-start;">
                        <div class="checklist-item-content" style="width: 100%;">
                            <input type="checkbox" id="verify-${d.id}" data-desc="${escapeHtml(d.description)}" data-note="${escapeHtml(d.note || '')}" checked>
                            <label for="verify-${d.id}">${escapeHtml(d.description)}</label>
                        </div>
                        ${d.note ? `<div class="defect-note-display" style="margin-left: 28px; margin-top: 5px; font-size: 0.9em; color: #666;"><strong>Not:</strong> ${escapeHtml(d.note)}</div>` : ''}
                    </li>
                `).join('');
                
                verificationHtml = `
                    <div class="verification-section" style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #90caf9;">
                        <h3 style="margin-top: 0; color: #1565c0; font-size: 1.1rem;">Önceki İşlem Kontrolü</h3>
                        <p style="font-size: 0.9em; color: #555; margin-bottom: 10px;">Aşağıdaki maddeler önceki adımda giderilmiştir. Uygun olmayanların tikini kaldırıp <strong>"Kontrolü Onayla ve Aktar"</strong> butonuna basınız.</p>
                        <ul class="defect-checklist" id="verification-list" style="max-height: 200px; overflow-y: auto; margin-bottom: 10px;">${listItems}</ul>
                        <button id="confirm-verification-btn" class="button-primary" style="font-size: 0.9rem; padding: 8px 16px; background-color: #1565c0;">Kontrolü Onayla ve Aktar</button>
                    </div>
                `;
            }
        }
    }

    const defectListHtml = defects.length > 0
        ? defects.map((defect, index) => `
            <li class="defect-management-item" data-defect-id="${defect.id}">
                <span><strong>${index + 1}.</strong> ${escapeHtml(defect.description)}</span>
                ${isReadOnly ? '' : '<button class="delete-defect-btn" title="Sil">&times;</button>'}
            </li>
        `).join('')
        : '<li>Bu adım için henüz hata girilmemiş.</li>';

    const deleteAllButtonHtml = !isReadOnly && (currentUserRole === 'admin' || currentUserRole === 'kalite') && defects.length > 0
        ? `<button id="delete-all-defects-btn" class="button-secondary">Tüm Maddeleri Sil</button>`
        : '';

    const cancelCompletionButtonHtml = isCompleted && currentUserRole === 'admin' && !isReadOnly
        ? `<button id="cancel-defect-entry-btn" class="button-secondary">Tamamlamayı İptal Et</button>`
        : '';

    contentArea.innerHTML = `
        <h2>"${stepName}" Hata Girişi</h2>
        ${stepName === "TEST 1" ? `<div style="margin-bottom: 15px;">
            <strong>Son Durum:</strong>
            <div class="note-display" style="white-space: pre-wrap; background: #f8f9fa; padding: 10px; border: 1px solid #dee2e6; border-radius: 4px; margin-top: 5px;">${escapeHtml(machine.final_status) || '-'}</div>
        </div>` : ''}
        ${verificationHtml}
        <ul class="defect-management-list">${defectListHtml}</ul>
        ${isReadOnly ? '' : `
        <hr>
        <div class="form-group">
            <label for="add-defect-textarea">Yeni Hata/Hatalar Ekle (Her satıra bir tane):</label>
            <textarea id="add-defect-textarea" class="form-control" rows="5" placeholder="Yeni hataları buraya yazın veya yapıştırın..."></textarea>
        </div>
        <div class="button-group">
            <button id="add-defects-btn" class="button-primary">Yeni Hataları Ekle</button>
            <button id="complete-defect-step-btn" class="button-primary green">${isCompleted ? 'Adımı Güncelle' : 'Adımı Tamamla'}</button>
            ${cancelCompletionButtonHtml}
            ${deleteAllButtonHtml}
        </div>
        `}
    `;

    if (!isReadOnly) {
        setupDefectEntryEventListeners(stepKey, machine);
        
        // YENİ: Doğrulama butonu için olay dinleyicisi
        const confirmVerificationBtn = document.getElementById('confirm-verification-btn');
        if (confirmVerificationBtn) {
            confirmVerificationBtn.addEventListener('click', async () => {
                const uncheckedItems = [];
                document.querySelectorAll('#verification-list input[type="checkbox"]').forEach(cb => {
                    if (!cb.checked) {
                        uncheckedItems.push({
                            description: cb.dataset.desc,
                            note: cb.dataset.note || null
                        });
                    }
                });

                if (uncheckedItems.length > 0) {
                    const { data: lastDefect } = await _supabase.from('defects').select('orderIndex').eq('machine_id', machine.id).eq('step', stepKey).order('orderIndex', { ascending: false }).limit(1).single();
                    let lastOrderIndex = lastDefect ? lastDefect.orderIndex : -1;

                    const defectsToInsert = uncheckedItems.map((item, index) => ({
                        machine_id: machine.id,
                        description: item.description,
                        is_fixed: false,
                        step: stepKey,
                        note: item.note,
                        orderIndex: lastOrderIndex + 1 + index
                    }));

                    const { error } = await _supabase.from('defects').insert(defectsToInsert);
                    if (error) {
                        alert('Aktarım sırasında hata oluştu: ' + error.message);
                    } else {
                        renderDefectEntryStep(stepName, machine); // Listeyi yenile
                    }
                } else {
                    alert("Aktarılacak madde yok (Tümü onaylandı).");
                    // İsteğe bağlı: Onaylananları gizlemek için sayfayı yenileyebiliriz veya olduğu gibi bırakabiliriz.
                    // renderDefectEntryStep(stepName, machine); 
                }
            });
        }
    }
};

const setupDefectEntryEventListeners = (stepKey, machine) => {
    const stepName = PROCESS_STEPS.find(name => getStatusKey(name) === stepKey);

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

    const deleteAllBtn = document.getElementById('delete-all-defects-btn');
    if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', async () => {
            if (confirm(`Bu adımdaki TÜM hataları kalıcı olarak silmek ve adımı 'Bekliyor' durumuna geri almak istediğinizden emin misiniz?`)) {
                await _supabase.from('defects').delete().eq('machine_id', machine.id).eq('step', stepKey);
                await cancelStepCompletion(stepKey, machine, true);
            }
        });
    }

    const cancelBtn = document.getElementById('cancel-defect-entry-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => cancelStepCompletion(stepKey, machine));
    }

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

const addDetailViewEventListeners = (machineId) => {
    const shipmentDateInput = document.getElementById('shipment-date-input');
    if (shipmentDateInput) {
        shipmentDateInput.addEventListener('change', async (event) => {
            const newDate = event.target.value || null;
            const { error } = await _supabase.from('machines').update({ shipment_date: newDate }).eq('id', machineId);
            if (error) {
                alert('Sevk tarihi güncellenirken hata oluştu: ' + error.message);
            }
        });
    }

    const customerNameInput = document.getElementById('customer-name-input');
    if (customerNameInput) {
        customerNameInput.addEventListener('blur', async (event) => {
            const newName = event.target.value;
            const { error } = await _supabase.from('machines').update({ customer_name: newName }).eq('id', machineId);
            if (error) {
                alert('Müşteri ismi güncellenirken hata oluştu: ' + error.message);
            }
        });
    }

    const finalStatusTextarea = document.getElementById('final-status-textarea-detail');
    if (finalStatusTextarea) {
        finalStatusTextarea.addEventListener('blur', async (event) => {
            const newStatus = event.target.value;
            const { error } = await _supabase.from('machines').update({ final_status: newStatus }).eq('id', machineId);
            if (error) {
                alert('Son durum notu güncellenirken hata oluştu: ' + error.message);
            }
        });
    }

    document.querySelectorAll('#initial-defects-list input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', async (event) => {
            const defectId = event.target.dataset.defectId;
            const isFixed = event.target.checked;
            const { error } = await _supabase.from('defects').update({ is_fixed: isFixed }).eq('id', defectId);

            if (error) {
                alert('Eksiklik durumu güncellenirken hata oluştu: ' + error.message);
                event.target.checked = !isFixed;
            } else {
                event.target.closest('li.checklist-item').classList.toggle('fixed', isFixed);
            }
        });
    });
};