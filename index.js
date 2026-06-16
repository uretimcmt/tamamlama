// index.js
import { _supabase } from './supabaseClient.js';
import { initializeAuthenticatedPage } from './layout.js';
import { showDetailView, calculateReadyDuration } from './machine-detail.js';

// --- 1. HTML Elementlerini Seçme ---
const statsContainer = document.getElementById('stats-container');
const stepSummaryContainer = document.getElementById('step-summary-container');
const mainContentView = document.querySelector('.content');
let dashboardData = {}; // Dashboard verilerini saklamak için

// --- 2. Sabitler ---
const PROCESS_STEPS = [
    "Tamamlama 1", "ROTUS 1", "ETIKET", "TEST 1", "Tamamlama Kabin",
    "ROTUS 2 ve TEMIZLIK", "PDI öncesi", "PDI öncesi Tmmlm", "PDI-1",
    "PDI-1 Tmmlm", "PDI-2", "PDI-2 Tmmlm"
];

function getStatusKey(stepName) {
    return stepName.toLowerCase().replace(/ /g, '_').replace('ö', 'o').replace('ı', 'i');
}

// --- 3. Ana Fonksiyonlar ---

/**
 * Ana sayfa istatistiklerini ve listelerini yükler.
 */
const loadDashboardStats = async () => {
    if (!statsContainer || !stepSummaryContainer) return;

    statsContainer.innerHTML = 'Yükleniyor...';
    stepSummaryContainer.innerHTML = 'Yükleniyor...';

    // YENİ: Kategori Filtresi Ekle (Eğer yoksa)
    if (!document.getElementById('category-filter-container')) {
        const filterHtml = `
            <div id="category-filter-container" style="margin-bottom: 20px; text-align: left; background: #fff; padding: 15px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.08);">
                <label for="category-filter" style="font-weight: 600; margin-right: 10px;">Kategori Seçin:</label>
                <select id="category-filter" class="form-control" style="width: 250px; padding: 8px; border-radius: 5px; border: 1px solid #ccc; font-family: 'Poppins', sans-serif;">
                    <option value="bekolar">Bekolar (BL)</option>
                    <option value="diger">Diğer Makinalar</option>
                    <option value="all">Tüm Makinalar</option>
                </select>
            </div>
        `;
        stepSummaryContainer.insertAdjacentHTML('beforebegin', filterHtml);
        document.getElementById('category-filter').addEventListener('change', loadDashboardStats);
    }

    const currentCategory = document.getElementById('category-filter')?.value || 'all';

    try {
        // 1. Stoktaki (Sevk edilmemiş) makinaları çek (Listeler ve Stok Sayısı için)
        const { data: inProductionMachines, error } = await _supabase
            .from('machines')
            .select('*')
            .eq('is_shipped', false);

        if (error) throw error;

        // 2. İstatistik hesaplaması için TÜM makinaların durum verisini çek (Sevk edilenler dahil)
        const { data: allMachinesStatus, error: statsError } = await _supabase
            .from('machines')
            .select('id, chassis_number, production_date, shipment_date, status');

        if (statsError) throw statsError;

        // YENİ: Kategoriye göre filtreleme
        let filteredInProduction = inProductionMachines;
        if (currentCategory === 'bekolar') {
            filteredInProduction = inProductionMachines.filter(m => m.machine_type === 'BL');
        } else if (currentCategory === 'diger') {
            filteredInProduction = inProductionMachines.filter(m => m.machine_type !== 'BL');
        }

        dashboardData.inProductionMachines = inProductionMachines; // Ham veriyi Excel için sakla
        dashboardData.filteredInProduction = filteredInProduction; // Dashboard görünümü için

        // YENİ: Sevkiyata hazır olma süresi hesaplama (Ortalama)
        let totalReadyDays = 0;
        let readyCount = 0;
        const readyMachinesList = [];

        allMachinesStatus.forEach(m => {
            const diffDays = calculateReadyDuration(m);

            if (diffDays !== null) {
                totalReadyDays += diffDays;
                readyCount++;
                
                readyMachinesList.push({
                    chassis_number: m.chassis_number,
                    production_date: m.production_date,
                    shipment_date: m.shipment_date,
                    readyDays: diffDays.toFixed(1)
                });
            }
        });

        dashboardData.readyMachinesList = readyMachinesList;
        const avgReadyDays = readyCount > 0 ? (totalReadyDays / readyCount).toFixed(1) : '-';

        // 1. Toplam makina sayısını göster
        statsContainer.innerHTML = `
            <div class="stat-card">
                <div class="value">${filteredInProduction.length}</div>
                <div class="label">Stoktaki Makina Sayısı</div>
            </div>
            <div class="stat-card clickable" id="ready-duration-card" title="Detaylar için tıklayın">
                <div class="value">${avgReadyDays}</div>
                <div class="label">
                    Sevkiyata hazır olma süresi Gün/Makina
                    <i class="fas fa-list-ul" style="margin-left: 5px; font-size: 0.9em; opacity: 0.7;"></i>
                </div>
            </div>
        `;

        // 2. Makinaları süreç adımlarına göre grupla
        const waitingMachinesByStep = {};
        PROCESS_STEPS.forEach(step => {
            waitingMachinesByStep[step] = [];
        });
        // YENİ: Sevkiyata Hazır kategorisi ekle (En altta görünmesi için sona ekliyoruz)
        waitingMachinesByStep["Sevkiyata Hazır"] = [];

        filteredInProduction.forEach(machine => {
            let isWaiting = false;
            for (const step of PROCESS_STEPS) {
                const stepKey = getStatusKey(step);
                if (!machine.status || !machine.status[stepKey]?.completed) {
                    waitingMachinesByStep[step].push(machine);
                    isWaiting = true;
                    break; // Makinanın takıldığı ilk adımı bulduk, sonraki adımlara bakma.
                }
            }
            // Eğer hiçbir adımda beklemiyorsa (hepsi tamamlanmışsa), Sevkiyata Hazır'dır.
            if (!isWaiting) {
                waitingMachinesByStep["Sevkiyata Hazır"].push(machine);
            }
        });

        dashboardData.waitingMachinesByStep = waitingMachinesByStep; // Veriyi global değişkene ata

        // --- YENİ: Otomatik Geri Alma (Revert) Mantığı ---
        // PDI-1 adımını geçmiş ve diğer adımlarda 20 günden fazla beklemiş makinaları PDI-1 adımına geri döndür.
        const stepsToCheckForRevert = ["PDI-1 Tmmlm", "PDI-2", "PDI-2 Tmmlm", "Sevkiyata Hazır"];
        const revertLimitInMs = 30 * 24 * 60 * 60 * 1000; // 30 gün
        const todayForRevert = new Date();
        let updatesMade = false;

        for (const step of stepsToCheckForRevert) {
            const machines = waitingMachinesByStep[step];
            if (!machines || machines.length === 0) continue;

            for (const machine of machines) {
                // Adıma giriş tarihini hesapla
                let entryDate = new Date(machine.production_date);
                
                if (step === "Sevkiyata Hazır") {
                    // Sevkiyata Hazır için giriş tarihi, son adımın (PDI-2 Tmmlm) tamamlanma tarihidir.
                    const lastStepKey = getStatusKey("PDI-2 Tmmlm");
                    if (machine.status && machine.status[lastStepKey]?.completedAt) {
                        entryDate = new Date(machine.status[lastStepKey].completedAt);
                    }
                } else {
                    const currentStepIndex = PROCESS_STEPS.indexOf(step);
                    if (currentStepIndex > 0) {
                        const prevStepName = PROCESS_STEPS[currentStepIndex - 1];
                        const prevStepKey = getStatusKey(prevStepName);
                        const prevStepData = machine.status ? machine.status[prevStepKey] : null;
                        if (prevStepData && prevStepData.completedAt) {
                            entryDate = new Date(prevStepData.completedAt);
                        }
                    }
                }

                if (todayForRevert.getTime() - entryDate.getTime() > revertLimitInMs) {
                    // Süre aşılmış, PDI-1'e geri döndür.
                    // PDI-1 ve sonraki tüm adımların tamamlanma durumunu sil.
                    const keysToRemove = ['pdi-1', 'pdi-1_tmmlm', 'pdi-2', 'pdi-2_tmmlm'];
                    const currentStatus = machine.status || {};
                    let statusChanged = false;

                    keysToRemove.forEach(key => {
                        if (currentStatus[key]) {
                            delete currentStatus[key];
                            statusChanged = true;
                        }
                    });

                    if (statusChanged) {
                        const currentFinalStatus = machine.final_status || '';
                        const noteToAdd = "Süre aşımı nedeniyle PDI-1 adımına geri alındı.";
                        const newFinalStatus = currentFinalStatus 
                            ? `${currentFinalStatus}\n- ${noteToAdd}` 
                            : `- ${noteToAdd}`;

                        await _supabase.from('machines').update({ status: currentStatus, final_status: newFinalStatus }).eq('id', machine.id);
                        updatesMade = true;
                    }
                }
            }
        }

        if (updatesMade) {
            // Veri değiştiği için dashboard'u yeniden yükle
            return loadDashboardStats();
        }

        // 3. Genişletilebilir listeyi oluştur
        let stepSummaryHtml = '<div class="step-summary-expandable-list">';
        for (const step in waitingMachinesByStep) {
            const machinesInStep = waitingMachinesByStep[step];
            const count = machinesInStep.length;

            let detailsHtml = '<div class="no-machine-info">Bu adımda bekleyen makina yok.</div>';
            if (count > 0) {
                detailsHtml = `
                    <div class="step-detail-header">
                        <span>Model</span>
                        <span>Seri No</span>
                        <span>Şase No</span>
                        <span>Adıma Giriş Tarihi</span>
                    </div>
                    ${machinesInStep.map(machine => {
                        let entryDate = new Date(machine.production_date); // Varsayılan: bant çıkış tarihi

                        // Eğer ilk adımdan sonraki bir adımdaysa, bir önceki adımın tamamlanma tarihini al
                        if (step === "Sevkiyata Hazır") {
                            const lastStepKey = getStatusKey("PDI-2 Tmmlm");
                            if (machine.status && machine.status[lastStepKey]?.completedAt) {
                                entryDate = new Date(machine.status[lastStepKey].completedAt);
                            }
                        } else {
                            const currentStepIndex = PROCESS_STEPS.indexOf(step);
                            if (currentStepIndex > 0) {
                                const prevStepName = PROCESS_STEPS[currentStepIndex - 1];
                                const prevStepKey = getStatusKey(prevStepName);
                                const prevStepData = machine.status ? machine.status[prevStepKey] : null;

                                if (prevStepData && prevStepData.completedAt) {
                                    entryDate = new Date(prevStepData.completedAt);
                                }
                            }
                        }

                        // YENİ: Gecikme kontrolü
                        let overdueClass = '';
                        const overdueSteps = ["PDI-1", "PDI-1 Tmmlm", "PDI-2", "PDI-2 Tmmlm", "Sevkiyata Hazır"];
                        if (overdueSteps.includes(step)) {
                            const today = new Date();
                            const limitInMs = 30 * 24 * 60 * 60 * 1000; // 20 gün
                            const timeDiff = today.getTime() - entryDate.getTime();
                            if (timeDiff > limitInMs) {
                                overdueClass = 'overdue';
                            }
                        }

                        return `
                        <div class="step-detail-item ${overdueClass}" data-machine-id="${machine.id}" title="Detayları görmek için tıkla">
                            <span>${machine.model || '-'}</span>
                            <span>${machine.serial_number || '-'}</span>
                            <span>${machine.chassis_number || '-'}</span>
                            <span>${entryDate.toLocaleDateString('tr-TR')}</span>
                        </div>
                    `}).join('')}
                `;
            }

            stepSummaryHtml += `
                <div>
                    <div class="step-summary-item-header">
                        <svg class="toggle-icon" xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 0 24 24" width="24"><path d="M0 0h24v24H0z" fill="none"/><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                        <span class="step-name">${step}</span>
                        <span class="count">${count}</span>
                    </div>
                    <div class="step-summary-item-content">
                        ${detailsHtml}
                    </div>
                </div>
            `;
        }
        stepSummaryHtml += '</div>';
        stepSummaryContainer.innerHTML = stepSummaryHtml;

    } catch (error) {
        console.error("Dashboard verileri yüklenirken hata:", error);
        statsContainer.innerHTML = '<p style="color:red;">İstatistikler yüklenemedi.</p>';
        stepSummaryContainer.innerHTML = '<p style="color:red;">Liste yüklenemedi.</p>';
    }
};

/**
 * Dashboard verilerini Excel'e aktarır.
 */
const exportDashboardToExcel = () => {
    if (!dashboardData.inProductionMachines) {
        alert("Dışa aktarılacak veri bulunamadı.");
        return;
    }

    const wb = XLSX.utils.book_new();

    const createSheetData = (machines) => {
        const data = [];
        data.push(["MAKİNA DURUM ÖZET RAPORU"]);
        data.push([`Rapor Tarihi: ${new Date().toLocaleDateString('tr-TR')}`]);
        data.push([]);

        const steps = {};
        PROCESS_STEPS.forEach(s => steps[s] = []);
        steps["Sevkiyata Hazır"] = [];

        machines.forEach(m => {
            let isWaiting = false;
            for (const step of PROCESS_STEPS) {
                const key = getStatusKey(step);
                if (!m.status || !m.status[key]?.completed) {
                    steps[step].push(m);
                    isWaiting = true;
                    break;
                }
            }
            if (!isWaiting) steps["Sevkiyata Hazır"].push(m);
        });

        data.push(["ADIM", "BEKLEYEN MAKİNA ADEDİ"]);
        for (const step in steps) {
            data.push([step, steps[step].length]);
        }
        data.push([]);

        data.push(["Adım", "Model", "Seri No", "Şase No", "Adıma Giriş Tarihi"]);
        for (const step in steps) {
            if (steps[step].length > 0) {
                steps[step].forEach(m => {
                    let entryDate = new Date(m.production_date);
                    if (step === "Sevkiyata Hazır") {
                        const lastKey = getStatusKey("PDI-2 Tmmlm");
                        if (m.status?.[lastKey]?.completedAt) entryDate = new Date(m.status[lastKey].completedAt);
                    } else {
                        const idx = PROCESS_STEPS.indexOf(step);
                        if (idx > 0) {
                            const prevKey = getStatusKey(PROCESS_STEPS[idx - 1]);
                            if (m.status?.[prevKey]?.completedAt) entryDate = new Date(m.status[prevKey].completedAt);
                        }
                    }
                    data.push([step, m.model || '-', m.serial_number || '-', m.chassis_number || '-', entryDate.toLocaleDateString('tr-TR')]);
                });
                data.push([]);
            }
        }
        const ws = XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = [{wch: 25}, {wch: 15}, {wch: 15}, {wch: 20}, {wch: 20}];
        return ws;
    };

    const bekolar = dashboardData.inProductionMachines.filter(m => m.machine_type === 'BL');
    const diger = dashboardData.inProductionMachines.filter(m => m.machine_type !== 'BL');

    XLSX.utils.book_append_sheet(wb, createSheetData(bekolar), "Bekolar");
    XLSX.utils.book_append_sheet(wb, createSheetData(diger), "Diğer Makinalar");

    XLSX.writeFile(wb, `Dashboard_Raporu_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

/**
 * Sevkiyata hazır olma süresi listesini Excel'e aktarır.
 */
const exportReadyMachinesToExcel = () => {
    const machines = dashboardData.readyMachinesList || [];
    if (machines.length === 0) {
        alert("Dışa aktarılacak veri bulunamadı.");
        return;
    }

    const data = machines.map(m => ({
        'Şase No': m.chassis_number || '-',
        'Bant Çıkış': new Date(m.production_date).toLocaleDateString('tr-TR'),
        'Sevk Tarihi': m.shipment_date ? new Date(m.shipment_date).toLocaleDateString('tr-TR') : '-',
        'Hazır Olma Süresi (Gün)': parseFloat(m.readyDays)
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    
    // Sütun genişlikleri
    const wscols = [
        {wch: 20},
        {wch: 15},
        {wch: 15},
        {wch: 25}
    ];
    ws['!cols'] = wscols;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Hazır Olma Süreleri");
    XLSX.writeFile(wb, `Hazir_Olma_Sureleri_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

/**
 * Sevkiyata hazır olma süresi detay modalını oluşturur ve gösterir.
 */
const showReadyDurationModal = () => {
    let modal = document.getElementById('ready-duration-modal');
    
    // Modal HTML yapısı sayfada yoksa oluştur
    if (!modal) {
        const modalHtml = `
            <div id="ready-duration-modal" class="modal">
                <div class="modal-content" style="max-width: 800px; width: 90%;">
                    <span class="close-button" id="close-ready-modal">&times;</span>
                    <div style="display: flex; align-items: center; gap:10px; margin-bottom: 10px;">
                        <h2 style="margin: 0;">Sevkiyata Hazır Olma Süresi Detayları</h2>
                        <button id="export-ready-list-btn" class="button-icon" title="Excel'e Aktar">
                            <i class="fas fa-file-excel"></i>
                        </button>
                    </div>
                    <div id="ready-duration-list" style="max-height: 60vh; overflow-y: auto; margin-top: 15px;"></div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        modal = document.getElementById('ready-duration-modal');
        
        // Kapatma olayları
        document.getElementById('close-ready-modal').addEventListener('click', () => modal.style.display = 'none');
        window.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

        // Excel Export Olayı
        document.getElementById('export-ready-list-btn').addEventListener('click', exportReadyMachinesToExcel);
    }

    const listContainer = document.getElementById('ready-duration-list');
    const machines = dashboardData.readyMachinesList || [];

    if (machines.length === 0) {
        listContainer.innerHTML = '<p>Hesaplamaya dahil edilen makina bulunamadı.</p>';
    } else {
        listContainer.innerHTML = `
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: #f8f9fa; text-align: left; border-bottom: 2px solid #dee2e6;">
                        <th style="padding: 10px;">Şase No</th>
                        <th style="padding: 10px;">Bant Çıkış</th>
                        <th style="padding: 10px;">Sevk Tarihi</th>
                        <th style="padding: 10px;">Hazır Olma Süresi</th>
                    </tr>
                </thead>
                <tbody>
                    ${machines.map(m => `
                        <tr style="border-bottom: 1px solid #eee;">
                            <td style="padding: 10px;">${m.chassis_number || '-'}</td>
                            <td style="padding: 10px;">${new Date(m.production_date).toLocaleDateString('tr-TR')}</td>
                            <td style="padding: 10px;">${m.shipment_date ? new Date(m.shipment_date).toLocaleDateString('tr-TR') : '-'}</td>
                            <td style="padding: 10px; font-weight: bold;">${m.readyDays} Gün</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    modal.style.display = 'block';
};

/**
 * Dashboard olay dinleyicilerini kurar.
 */
const setupDashboardEventListeners = (userRole) => {
    stepSummaryContainer.addEventListener('click', (event) => {
        const header = event.target.closest('.step-summary-item-header');
        const machineItem = event.target.closest('.step-detail-item');

        // Genişletme/daraltma
        if (header) {
            header.classList.toggle('open');
            const content = header.nextElementSibling;
            content.style.display = content.style.display === 'block' ? 'none' : 'block';
            return;
        }

        // Makina detayına gitme
        if (machineItem) {
            const machineId = machineItem.dataset.machineId;
            showDetailView(machineId, mainContentView, userRole, loadDashboardStats);
        }
    });

    // İstatistik kartına tıklama olayı (Delegation kullanarak)
    if (statsContainer) {
        statsContainer.addEventListener('click', (event) => {
            if (event.target.closest('#ready-duration-card')) {
                showReadyDurationModal();
            }
        });
    }

    const exportBtn = document.getElementById('export-dashboard-btn');
    if(exportBtn) {
        exportBtn.addEventListener('click', exportDashboardToExcel);
    }
};

// --- 4. Sayfa Başlatma ---
document.addEventListener('DOMContentLoaded', async () => {
    const { userRole } = await initializeAuthenticatedPage();
    if (userRole) {
        await loadDashboardStats();
        setupDashboardEventListeners(userRole);
    }
});