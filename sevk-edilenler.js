// sevk-edilenler.js
import { _supabase } from './supabaseClient.js';
import { initializeAuthenticatedPage } from './layout.js';
import { showDetailView } from './machine-detail.js';

// --- 1. Global Değişkenler ---
let currentSortField = 'shipment_date'; // Varsayılan sıralama
let currentSortDirection = 'desc';
let currentUserRole = null;
let currentSearchTerm = '';
let currentMachineTypeFilter = '';

const PROCESS_STEPS = [
    "Durum", "Tamamlama 1", "ROTUS 1", "ETIKET", "TEST 1", "Tamamlama Kabin",
    "ROTUS 2 ve TEMIZLIK", "PDI öncesi", "PDI öncesi Tmmlm", "PDI-1",
    "PDI-1 Tmmlm", "PDI-2", "PDI-2 Tmmlm"
];

function getStatusKey(stepName) {
    return stepName.toLowerCase().replace(/ /g, '_').replace('ö', 'o').replace('ı', 'i');
}

// --- 2. HTML Elementlerini Seçme ---
const dataContainer = document.getElementById('shipped-data-container');
const mainContentView = document.querySelector('.content');

// --- 3. Ana Fonksiyonlar ---

/**
 * Sevk edilmiş makinaları Supabase'den çeker ve tabloyu render eder.
 */
const fetchShippedData = async () => {
    if (!dataContainer) return;
    dataContainer.innerHTML = `<p>Veriler yükleniyor...</p>`;

    let query = _supabase
        .from('machines')
        .select('*')
        .eq('is_shipped', true);

    if (currentMachineTypeFilter) {
        query = query.eq('machine_type', currentMachineTypeFilter);
    }

    if (currentSearchTerm) {
        const plainQuery = currentSearchTerm.trim().split(' ').filter(term => term).join(' & ');
        query = query.textSearch('search_vector', plainQuery);
    }

    const { data, error } = await query.order(currentSortField, { ascending: currentSortDirection === 'asc' });

    if (error) {
        console.error('Sevk edilen makina verileri çekilirken hata:', error);
        dataContainer.innerHTML = `<p style="color: red;">Veriler yüklenirken bir hata oluştu: ${error.message}</p>`;
        return;
    }

    if (data && data.length > 0) {
        renderShippedMachineTable(data);
    } else {
        dataContainer.innerHTML = '<p>Gösterilecek sevk edilmiş makina bulunamadı.</p>';
    }
};

/**
 * Gelen sevk edilmiş makina verilerine göre HTML tablosunu oluşturur.
 * @param {Array} machines - Makina verilerini içeren dizi.
 */
const renderShippedMachineTable = (machines) => {
    const headerConfig = [
        { title: "SN", sortable: false },
        { title: "Makina Tipi", sortable: true, field: 'machine_type' },
        { title: "Model", sortable: true, field: 'model' },
        { title: "Seri No", sortable: true, field: 'serial_number' },
        { title: "Şase No", sortable: true, field: 'chassis_number' },
        { title: "Bant Çıkış", sortable: true, field: 'production_date' },
        { title: "Sevk Tarihi", sortable: true, field: 'shipment_date' },
        { title: "Son Durum", sortable: false },
    ];
    headerConfig.push({ title: "İşlemler", sortable: false });

    const headerHtml = headerConfig.map(config => {
        if (config.sortable) {
            const isCurrentSort = currentSortField === config.field;
            const sortClass = isCurrentSort ? `sorted-${currentSortDirection}` : '';
            return `<th class="sortable ${sortClass}" data-sort="${config.field}">${config.title}</th>`;
        }
        return `<th>${config.title}</th>`;
    }).join('');

    const tableRows = machines.map((machine, index) => {
        const productionDate = new Date(machine.production_date).toLocaleDateString('tr-TR');
        const shipmentDate = machine.shipment_date ? new Date(machine.shipment_date).toLocaleDateString('tr-TR') : '-';
        
        let actionsCell = '<td>-</td>';
        if (currentUserRole === 'admin') {
            actionsCell = `
                <td><button class="action-button revert revert-shipment-btn" data-machine-id="${machine.id}">Geri Al</button></td>
            `;
        }

        return `
            <tr data-machine-id="${machine.id}" class="clickable-row" title="Detayları görmek için tıkla">
                <td>${index + 1}</td>
                <td>${machine.machine_type || '-'}</td>
                <td>${machine.model || '-'}</td>
                <td>${machine.serial_number || '-'}</td>
                <td>${machine.chassis_number || '-'}</td>
                <td>${productionDate}</td>
                <td>${shipmentDate}</td>
                <td><textarea class="final-status-textarea" rows="2" disabled>${machine.final_status || ''}</textarea></td>
                ${actionsCell}
            </tr>
        `;
    }).join('');

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
 * Sevk edilenler listesini Excel'e aktarır.
 */
const exportShippedToExcel = async () => {
    try {
        let query = _supabase.from('machines').select('*').eq('is_shipped', true);
        if (currentMachineTypeFilter) query = query.eq('machine_type', currentMachineTypeFilter);
        if (currentSearchTerm) {
            const plainQuery = currentSearchTerm.trim().split(' ').filter(term => term).join(' & ');
            query = query.textSearch('search_vector', plainQuery);
        }
        const { data: machines, error } = await query.order(currentSortField, { ascending: currentSortDirection === 'asc' });

        if (error) throw error;
        if (!machines || machines.length === 0) {
            alert("Dışa aktarılacak veri bulunamadı.");
            return;
        }

        const dataToExport = machines.map((machine, index) => ({
            'SN': index + 1,
            'Tip': machine.machine_type,
            'Model': machine.model,
            'Seri No': machine.serial_number,
            'Şase No': machine.chassis_number,
            'Bant Çıkış': new Date(machine.production_date).toLocaleDateString('tr-TR'),
            'Sevk Tarihi': machine.shipment_date ? new Date(machine.shipment_date).toLocaleDateString('tr-TR') : '-',
            'Son Durum': machine.final_status || ''
        }));

        const ws = XLSX.utils.json_to_sheet(dataToExport);

        // --- YENİ: Sütun genişliklerini ve stilleri ayarla ---
        const colWidths = Object.keys(dataToExport[0]).map(key => {
            const headerLength = key.length;
            const maxLength = Math.max(headerLength, ...dataToExport.map(row => (row[key] ? String(row[key]).length : 0)));
            if (key === 'Son Durum') {
                return { wch: 40 }; // "Son Durum" için sabit genişlik
            }
            return { wch: maxLength + 2 }; // Diğerleri için otomatik genişlik + dolgu
        });
        ws['!cols'] = colWidths;

        const sonDurumColIndex = Object.keys(dataToExport[0]).indexOf('Son Durum');
        if (sonDurumColIndex > -1) {
            dataToExport.forEach((row, rowIndex) => {
                const cellAddress = XLSX.utils.encode_cell({ r: rowIndex + 1, c: sonDurumColIndex });
                if (ws[cellAddress]) {
                    ws[cellAddress].t = 's'; // Hücre tipini 'string' (metin) olarak zorla
                    ws[cellAddress].s = { alignment: { wrapText: true, vertical: 'top' } }; // Metni kaydır
                }
            });
        }
        // --- BİTTİ: Sütun genişliklerini ve stilleri ayarla ---

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Sevk Edilenler");
        XLSX.writeFile(wb, `Sevk_Edilenler_Listesi_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error) {
        console.error("Excel'e aktarılırken hata:", error);
        alert("Veriler dışa aktarılırken bir hata oluştu.");
    }
};

/**
 * Bir makinanın sevkiyatını geri alır.
 * @param {string} machineId - Geri alınacak makinanın ID'si.
 */
const revertShipment = async (machineId) => {
    if (confirm("Bu makinanın sevkiyatını geri almak ve üretim takip paneline taşımak istediğinizden emin misiniz?")) {
        try {
            const { error } = await _supabase
                .from('machines')
                .update({ is_shipped: false })
                .eq('id', machineId);
            
            if (error) throw error;

            await fetchShippedData(); // Listeyi yenile
        } catch (error) {
            console.error("Sevkiyat geri alınırken hata:", error);
            alert("Hata: Sevkiyat geri alınamadı.");
        }
    }
};

/**
 * YENİ: Sevk edilen makina yükleme için örnek Excel şablonunu indirir.
 */
const downloadExampleExcel = () => {
    const headers = ['Makina Tipi', 'Makina Modeli', 'Seri No', 'Şase No', 'Bant Çıkış Tarihi', 'Sevk Tarihi'];
    // Süreç adımlarını başlık olarak ekle (Durum hariç)
    PROCESS_STEPS.forEach(step => {
        if (step !== 'Durum') headers.push(step);
    });

    const data = [headers];
    
    // Örnek veri satırı
    const exampleRow = ['Kazıcı Yükleyici', '102S', 'S12345', 'N098765', '25.10.2023', '30.10.2023'];
    // Süreç sütunları için boşluk veya örnek değer
    PROCESS_STEPS.forEach(step => {
        if (step !== 'Durum') {
            exampleRow.push(step === 'Tamamlama 1' ? 'OK' : '');
        }
    });
    
    data.push(exampleRow);

    const ws = XLSX.utils.aoa_to_sheet(data);
    
    // Sütun genişliklerini ayarla
    const wscols = headers.map(h => ({ wch: Math.max(h.length + 5, 15) }));
    ws['!cols'] = wscols;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sevk_Sablonu");
    XLSX.writeFile(wb, "Sevk_Edilen_Makina_Yukleme_Sablonu.xlsx");
};

/**
 * Excel dosyasından sevk edilen makina verilerini içe aktarır.
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
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false });

            if (jsonData.length === 0) {
                alert("Excel dosyası boş veya okunamadı.");
                return;
            }

            const machinesToInsert = [];

            for (const row of jsonData) {
                if (!row['Şase No']) continue;

                const parseDate = (dateStr) => {
                    if (!dateStr) return null;
                    const parts = String(dateStr).split('.');
                    if (parts.length === 3) {
                        return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).toISOString();
                    }
                    const d = new Date(dateStr);
                    return !isNaN(d.getTime()) ? d.toISOString() : null;
                };

                const productionDate = parseDate(row['Bant Çıkış Tarihi']) || new Date().toISOString();
                const shipmentDate = parseDate(row['Sevk Tarihi']) || new Date().toISOString();

                const machine = {
                    machine_type: row['Makina Tipi'] || row['Tip'] || '',
                    model: row['Makina Modeli'] || row['Model'] || '',
                    serial_number: row['Seri No'] || '',
                    chassis_number: row['Şase No'],
                    production_date: productionDate,
                    shipment_date: shipmentDate,
                    is_shipped: true,
                    status: {}
                };

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
                await fetchShippedData();
            } else {
                alert("Eklenecek geçerli veri bulunamadı.");
            }
        } catch (error) {
            console.error("Excel import hatası:", error);
            alert("İçe aktarma sırasında hata oluştu: " + error.message);
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
};

// --- 4. Olay Dinleyicileri ve Başlatma ---

const setupEventListeners = () => {
    const searchInput = document.getElementById('search-input');
    const machineTypeFilter = document.getElementById('machine-type-filter');

    const debounce = (func, delay) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    };

    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            currentSearchTerm = searchInput.value;
            fetchShippedData();
        }, 500));
    }

    if (machineTypeFilter) {
        machineTypeFilter.addEventListener('change', () => {
            currentMachineTypeFilter = machineTypeFilter.value;
            fetchShippedData();
        });
    }

    // Excel'e aktarma butonu
    const exportBtn = document.getElementById('export-shipped-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportShippedToExcel);
    }

    dataContainer.addEventListener('click', (event) => {
        const header = event.target.closest('th.sortable');
        if (header) {
            const sortField = header.dataset.sort;
            if (sortField === currentSortField) {
                currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortField = sortField;
                currentSortDirection = 'asc';
            }
            fetchShippedData();
            return;
        }

        if (event.target.classList.contains('revert-shipment-btn')) {
            const machineId = event.target.dataset.machineId;
            revertShipment(machineId);
            return;
        }

        const row = event.target.closest('tr[data-machine-id]');
        if (row) {
            const machineId = row.dataset.machineId;
            showDetailView(machineId, mainContentView, currentUserRole, fetchShippedData);
        }
    });
};

const init = async () => {
    const { userRole } = await initializeAuthenticatedPage();
    currentUserRole = userRole;

    setupEventListeners();

    // Excel import özelliği sadece adminler için
    if (userRole === 'admin') {
        const exportBtn = document.getElementById('export-shipped-btn');
        if (exportBtn) {
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

            exportBtn.parentNode.insertBefore(dropdownContainer, exportBtn.nextSibling);
        }
    }

    await fetchShippedData();
};

document.addEventListener('DOMContentLoaded', init);