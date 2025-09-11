// --- SCRIPT START ---
document.addEventListener('DOMContentLoaded', () => {
    // --- STATE MANAGEMENT ---
    let currentReview = {};
    let deviceCounters = {};

    const RISK_CATEGORIES = {
        critical: { score: 25, text: 'CRITICAL: Escalate to ICU Liaison / MET / Critical Care', class: 'category-critical' },
        intensive_escalate: { score: 20, text: 'INTENSIVE+: Escalate to ICU Liaison / ANM', class: 'category-intensive-escalate' },
        intensive: { score: 11, text: 'INTENSIVE: Requires multiple reviews per day', class: 'category-intensive' },
        standard: { score: 5, text: 'STANDARD: At least one follow-up review required', class: 'category-standard' },
        single: { score: 0, text: 'SINGLE: Follow-up as required', class: 'category-single' }
    };
    
    const form = document.getElementById('assessmentForm');

    // --- INITIALIZATION ---
    function initializeApp() {
        populateStaticContent();
        loadState();
        const launchModal = document.getElementById('launchScreenModal');
        const mainContent = document.getElementById('main-content');
        if (Object.keys(currentReview).length > 0) {
            launchModal.style.display = 'none';
            setAppViewMode(currentReview.mode || 'full');
            loadReviewData();
        } else {
            launchModal.style.display = 'flex';
        }
        setupEventListeners();
    }
    
    function setAppViewMode(mode) {
        document.getElementById('main-content').style.visibility = 'visible';
        const fullReviewContainer = document.getElementById('fullReviewContainer');
        const fullReviewContainerBottom = document.getElementById('fullReviewContainerBottom');
        currentReview.mode = mode;
        if (mode === 'quick') {
            fullReviewContainer.style.display = 'none';
            fullReviewContainerBottom.style.display = 'none';
        } else {
            fullReviewContainer.style.display = 'block';
            fullReviewContainerBottom.style.display = 'block';
        }
    }

    // --- DATA & STATE HANDLING ---
    function gatherFormData() {
        const data = {};
        form.querySelectorAll('input, select, textarea').forEach(el => {
            const key = el.id || el.name;
            if (!key || el.closest('.device-entry, .allergy-item')) return;
            if (el.type === 'checkbox') data[key] = el.checked;
            else if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
            else data[key] = el.value;
        });
        data.allergies = Array.from(document.querySelectorAll('.allergy-item')).map(item => ({ name: item.querySelector('input[data-type="name"]').value, reaction: item.querySelector('input[data-type="reaction"]').value }));
        data.devices = {};
        ['central_lines', 'pivcs', 'idcs', 'pacing_wires', 'others'].forEach(type => {
            data.devices[type] = Array.from(document.getElementById(`${type}_container`).querySelectorAll('.device-entry')).map(entry => {
                const deviceData = {};
                entry.querySelectorAll('input[data-key], select[data-key]').forEach(input => {
                    if (input.dataset.key) deviceData[input.dataset.key] = input.value;
                });
                return deviceData;
            });
        });
        return data;
    }

    function saveState() {
        currentReview = gatherFormData();
        currentReview.finalScore = parseInt(document.getElementById('footer-score').textContent) || 0;
        localStorage.setItem('alertToolState_v15', JSON.stringify(currentReview));
    }
    
    function loadState() {
        const savedState = localStorage.getItem('alertToolState_v15');
        if (savedState) {
            currentReview = JSON.parse(savedState);
        }
    }

    function loadReviewData() {
        clearForm(false);
        const data = JSON.parse(JSON.stringify(currentReview));
        Object.keys(data).forEach(key => {
            const el = form.querySelector(`#${key}`) || form.querySelector(`[name="${key}"]`);
            if (el) {
                if (el.type === 'checkbox') el.checked = data[key];
                else if (el.type === 'radio') {
                    const radio = form.querySelector(`[name="${el.name}"][value="${data[el.name]}"]`);
                    if (radio) radio.checked = true;
                } else el.value = data[key];
            }
        });
        if (data.allergies) data.allergies.forEach(a => addAllergy(a.name, a.reaction));
        if (data.devices) {
             ['central_lines', 'pivcs', 'idcs', 'pacing_wires', 'others'].forEach(type => {
                if (data.devices[type]) {
                    const addFunc = window[`add${type.charAt(0).toUpperCase() + type.slice(1).replace(/s$/, '')}`];
                    if (addFunc) data.devices[type].forEach(device => addFunc(device));
                }
            });
        }
        form.querySelectorAll('input, select').forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        calculateTotalScore();
    }

    function clearForm(clearStorage = true) {
        form.reset();
        deviceCounters = {};
        document.querySelectorAll('.device-entry, .allergy-item').forEach(el => el.remove());
        form.querySelectorAll('input, select, textarea').forEach(el => {
             el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        currentReview = {};
        if (clearStorage) localStorage.removeItem('alertToolState_v15');
        calculateTotalScore();
        calculateADDS();
    }
    
    // --- SCORING & CALCULATIONS ---
    function calculateTotalScore() {
        let score = 0;
        const hasCriticalItem = Array.from(form.querySelectorAll('.score-input:checked')).some(input => {
            score += parseInt(input.dataset.score, 10) || 0;
            return input.dataset.isCritical === 'true';
        });
        
        const footerScoreEl = document.getElementById('footer-score');
        const footerCategoryEl = document.getElementById('footer-category');
        const stickyFooter = document.getElementById('sticky-footer');
        
        footerScoreEl.title = '';
        if (hasCriticalItem && score < RISK_CATEGORIES.critical.score) {
            score = RISK_CATEGORIES.critical.score;
            footerScoreEl.textContent = `${score}*`;
            footerScoreEl.title = '*Score elevated due to critical risk item.';
        } else {
             footerScoreEl.textContent = score;
        }
        
        const category = getRiskCategory(score);
        footerCategoryEl.textContent = category.text;
        stickyFooter.className = `fixed bottom-0 left-0 right-0 p-2 shadow-lg transition-colors duration-300 flex items-center justify-between z-40 ${category.class}`;
        
        saveState();
    }
    
    function getRiskCategory(score) {
        for (const key in RISK_CATEGORIES) { if (score >= RISK_CATEGORIES[key].score) return RISK_CATEGORIES[key]; }
        return RISK_CATEGORIES.single;
    }

    function calculateADDS() {
        let total = 0; let breakdown = [];
        const checkedADDS = form.querySelectorAll('.adds-input:checked');
        checkedADDS.forEach(input => {
            total += parseInt(input.value, 10);
            if (parseInt(input.value, 10) > 0) {
                 breakdown.push(input.dataset.text);
            }
        });
        document.getElementById('calculatedADDSScore').textContent = total;
        document.getElementById('addsBreakdown').textContent = breakdown.length > 0 ? breakdown.join(', ') : 'Normal Parameters';
    }

    // --- DEVICE MANAGEMENT ---
    function createDeviceEntryHTML(id, content) { return `<div id="${id}" class="device-entry bg-white p-3 rounded-md border space-y-2">${content}<button type="button" class="remove-device-btn text-xs text-red-600 hover:underline no-print">Remove</button></div>`;}
    window.addCentral_line = function(data = {}) { deviceCounters.central = (deviceCounters.central || 0) + 1; document.getElementById('central_lines_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`central_${deviceCounters.central}`, `<div class="grid grid-cols-2 gap-2 text-sm"><input type="text" data-key="type" value="${data.type || ''}" placeholder="Type (e.g., PICC)" class="p-1 border rounded-md"><input type="text" data-key="location" value="${data.location || ''}" placeholder="Location" class="p-1 border rounded-md"><input type="date" data-key="insertion_date" value="${data.insertion_date || ''}" class="p-1 border rounded-md col-span-2 device-date-input"><span data-key="dwell_time" class="text-xs text-gray-500 col-span-2"></span></div>`)); }
    window.addPivc = function(data = {}) { deviceCounters.pivc = (deviceCounters.pivc || 0) + 1; document.getElementById('pivcs_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`pivc_${deviceCounters.pivc}`, `<div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm"><input type="text" data-key="location" value="${data.location || ''}" placeholder="Location" class="p-1 border rounded-md"><select data-key="size" class="p-1 border rounded-md bg-white"><option value="">Size</option><option value="Pink (20G)" ${data.size === 'Pink (20G)' ? 'selected' : ''}>Pink (20G)</option><option value="Blue (22G)" ${data.size === 'Blue (22G)' ? 'selected' : ''}>Blue (22G)</option><option value="Green (18G)" ${data.size === 'Green (18G)' ? 'selected' : ''}>Green (18G)</option><option value="Grey (16G)" ${data.size === 'Grey (16G)' ? 'selected' : ''}>Grey (16G)</option><option value="Yellow (24G)" ${data.size === 'Yellow (24G)' ? 'selected' : ''}>Yellow (24G)</option></select><input type="date" data-key="insertion_date" value="${data.insertion_date || ''}" class="p-1 border rounded-md"></div>`)); }
    window.addIdc = function(data = {}) { deviceCounters.idc = (deviceCounters.idc || 0) + 1; document.getElementById('idcs_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`idc_${deviceCounters.idc}`, `<div class="grid grid-cols-2 gap-2 text-sm items-center"><input type="date" data-key="insertion_date" value="${data.insertion_date || ''}" class="p-1 border rounded-md device-date-input"><select data-key="size" class="p-1 border rounded-md bg-white"><option value="">Size</option><option value="12" ${data.size === '12' ? 'selected' : ''}>12 Ch</option><option value="14" ${data.size === '14' ? 'selected' : ''}>14 Ch</option><option value="16" ${data.size === '16' ? 'selected' : ''}>16 Ch</option></select><span data-key="dwell_time" class="text-xs text-gray-500 col-span-2"></span></div>`)); }
    window.addPacing_wire = function(data = {}) { deviceCounters.pacing = (deviceCounters.pacing || 0) + 1; document.getElementById('pacing_wires_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`pacing_${deviceCounters.pacing}`, `<div><input type="text" data-key="details" value="${data.details || ''}" placeholder="Pacing wire details (e.g., Atrial x2)" class="p-1 border rounded-md w-full text-sm"></div>`)); }
    window.addOther = function(data = {}) { deviceCounters.other = (deviceCounters.other || 0) + 1; document.getElementById('others_container').insertAdjacentHTML('beforeend', createDeviceEntryHTML(`other_${deviceCounters.other}`, `<div><input type="text" data-key="description" value="${data.description || ''}" placeholder="Device/Wound Description" class="p-1 border rounded-md w-full text-sm"></div>`)); }
    function addAllergy(name = '', reaction = '') { document.getElementById('allergies_container').insertAdjacentHTML('beforeend', `<div class="allergy-item flex items-center gap-2"><input type="text" data-type="name" value="${name}" placeholder="Allergen" class="flex-grow p-1 border rounded-md text-sm"><input type="text" data-type="reaction" value="${reaction}" placeholder="Reaction" class="flex-grow p-1 border rounded-md text-sm"><button type="button" class="remove-allergy-btn text-red-500 font-bold no-print">&times;</button></div>`);}
    
    // --- DMR & HANDOFF NOTE ---
    function generateEMRSummary() { /* Omitted for brevity */ }
    function generateHandoffNote() { /* Omitted for brevity */ }
    function loadFromHandoff(pastedText) { /* Omitted for brevity */ }
    
    // --- EVENT LISTENER SETUP ---
    function setupEventListeners() {
        document.getElementById('startFullReviewBtn').addEventListener('click', () => { document.getElementById('launchScreenModal').style.display = 'none'; setAppViewMode('full'); clearForm(true); });
        document.getElementById('startQuickScoreBtn').addEventListener('click', () => { document.getElementById('launchScreenModal').style.display = 'none'; setAppViewMode('quick'); clearForm(true); });
        document.getElementById('resumeReviewBtn').addEventListener('click', () => { document.getElementById('pasteContainer').style.display = 'block'; });
        document.getElementById('loadPastedDataBtn').addEventListener('click', () => { const pastedText = document.getElementById('pasteDataInput').value; if(!pastedText) return; document.getElementById('launchScreenModal').style.display = 'none'; setAppViewMode('full'); loadFromHandoff(pastedText); });

        form.addEventListener('input', saveState);
        form.addEventListener('change', saveState);
        document.getElementById('startOverBtn').addEventListener('click', () => {
            if (confirm('Are you sure you want to start over? This will clear all data for the current review.')) {
                clearForm(true);
                document.getElementById('main-content').style.visibility = 'hidden';
                document.getElementById('launchScreenModal').style.display = 'flex';
            }
        });
        
        let activeRadio = null;
        form.addEventListener('mousedown', e => { if (e.target.type === 'radio' && (e.target.classList.contains('score-input') || e.target.classList.contains('adds-input'))) activeRadio = e.target.checked ? e.target : null; });
        form.addEventListener('click', e => { if (e.target.type === 'radio' && (e.target.classList.contains('score-input') || e.target.classList.contains('adds-input')) && e.target === activeRadio) { e.target.checked = false; e.target.dispatchEvent(new Event('change', { bubbles: true })); activeRadio = null; } });
        
        document.getElementById('addCentralLineButton').addEventListener('click', () => window.addCentral_line());
        document.getElementById('addPivcButton').addEventListener('click', () => window.addPivc());
        document.getElementById('addIdcButton').addEventListener('click', () => window.addIdc());
        document.getElementById('addPacingWireButton').addEventListener('click', () => window.addPacing_wire());
        document.getElementById('addOtherButton').addEventListener('click', () => window.addOther());
        document.getElementById('addAllergyButton').addEventListener('click', () => addAllergy());
        document.addEventListener('click', (e) => { if (e.target.matches('.remove-device-btn, .remove-allergy-btn')) e.target.closest('div').remove(); });
        document.addEventListener('input', e => {
            if (e.target.classList.contains('device-date-input')) {
                const dwellEl = e.target.parentElement.querySelector('[data-key="dwell_time"]');
                if(e.target.value) {
                    const days = Math.round((new Date() - new Date(e.target.value)) / (1000 * 60 * 60 * 24));
                    dwellEl.textContent = `Dwell time: ${days} day(s)`;
                } else {
                    dwellEl.textContent = '';
                }
            }
        });
        
        document.getElementById('scoringContainer').addEventListener('change', (e) => { if(e.target.classList.contains('score-input')) { const option = e.target.closest('.score-option-button, .score-option'); const noteBox = option.querySelector('.score-note'); if (noteBox) { const shouldShow = e.target.checked && (parseInt(e.target.dataset.score, 10) !== 0 || e.target.name === 'concern_score'); noteBox.style.display = shouldShow ? 'block' : 'none'; } calculateTotalScore(); }});
        document.getElementById('adds-container').addEventListener('change', (e) => { if (e.target.classList.contains('adds-input')) calculateADDS(); });
        
        document.getElementById('homeTeamPlanCheckbox').addEventListener('change', e => { document.getElementById('homeTeamPlanDetails').style.display = e.target.checked ? 'block' : 'none'; });
        document.querySelectorAll('.precaution-cb').forEach(cb => cb.addEventListener('change', () => { document.getElementById('infectionControlDetails').style.display = document.querySelector('.precaution-cb:checked') ? 'block' : 'none'; }));
        document.getElementById('addsModificationCheckbox').addEventListener('change', e => { document.getElementById('addsModificationDetails').style.display = e.target.checked ? 'block' : 'none'; });
        document.getElementById('goc').addEventListener('change', e => { document.getElementById('gocSpecificsContainer').style.display = e.target.value ? 'block' : 'none'; });
        document.querySelectorAll('input[name="pics_status"]').forEach(r => r.addEventListener('change', e => { document.getElementById('pics_details_container').style.display = e.target.value !== 'Negative' ? 'block' : 'none'; }));
        
        document.getElementById('printBlankBtn').addEventListener('click', () => { document.body.classList.add('print-blank-mode'); window.print(); document.body.classList.remove('print-blank-mode'); });
        document.getElementById('generateSummaryButton').addEventListener('click', generateEMRSummary);
        document.getElementById('copySummaryButton').addEventListener('click', () => { const el = document.getElementById('emrSummary'); el.select(); document.execCommand('copy'); alert('Summary copied!'); });
        document.getElementById('resetButton').addEventListener('click', () => { if (confirm('Reset form?')) clearForm(true); });
        
        document.getElementById('generateHandoffBtn').addEventListener('click', () => {
             const note = generateHandoffNote();
             navigator.clipboard.writeText(note).then(() => { alert('Bedside notes copied to clipboard!'); }, () => { alert('Could not copy automatically.'); });
        });
    }
    
    // --- DYNAMIC CONTENT INJECTION ---
    function populateStaticContent() { /* Omitted for brevity */ }
    function generateScoringHTML() { /* Omitted for brevity */ }
    function buildScoreOption(item, controlType) { /* Omitted for brevity */ }
    
    initializeApp();
});

