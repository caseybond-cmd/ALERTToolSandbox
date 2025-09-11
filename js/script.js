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
    function gatherFormData() { /* Redacted for Brevity */ }
    function saveState() { /* Redacted for Brevity */ }
    function loadState() { /* Redacted for Brevity */ }
    function loadReviewData() { /* Redacted for Brevity */ }
    function clearForm(clearStorage = true) { /* Redacted for Brevity */ }
    
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
        footerCategoryEl.textContent = category.text.split(':')[0];
        stickyFooter.className = `fixed bottom-0 left-0 right-0 p-2 shadow-lg transition-colors duration-300 flex items-center justify-between z-40 ${category.class}`;
        
        saveState();
    }
    
    function getRiskCategory(score) {
        for (const key in RISK_CATEGORIES) { if (score >= RISK_CATEGORIES[key].score) return RISK_CATEGORIES[key]; }
        return RISK_CATEGORIES.single;
    }

    function calculateADDS() { /* Redacted for Brevity */ }

    // --- DEVICE MANAGEMENT ---
    function createDeviceEntryHTML(id, content) { /* Redacted for Brevity */ }
    window.addCentral_line = function(data = {}) { /* Redacted for Brevity */ }
    window.addPivc = function(data = {}) { /* Redacted for Brevity */ }
    window.addIdc = function(data = {}) { /* Redacted for Brevity */ }
    window.addPacing_wire = function(data = {}) { /* Redacted for Brevity */ }
    window.addOther = function(data = {}) { /* Redacted for Brevity */ }
    function addAllergy(name = '', reaction = '') { /* Redacted for Brevity */ }
    
    // --- DMR & HANDOFF NOTE ---
    function generateEMRSummary() { /* Redacted for Brevity */ }
    function generateHandoffNote() { /* Redacted for Brevity */ }
    function loadFromHandoff(pastedText) { /* Redacted for Brevity */ }
    
    // --- AUTO-ADVANCE LOGIC ---
    function handleAutoAdvance(event) {
        const target = event.target;
        if (target.type !== 'radio' || !(target.classList.contains('adds-input') || target.classList.contains('score-input'))) return;

        const currentSection = target.closest('.score-group, .auto-advance-section');
        if (!currentSection) return;

        // Don't auto-advance if a note box is visible
        const noteBox = currentSection.querySelector('.score-note');
        if(noteBox && noteBox.style.display === 'block') return;

        let nextSection = currentSection.nextElementSibling;
        // Skip over titles to find the next actual input group
        while(nextSection && !nextSection.classList.contains('score-group') && !nextSection.classList.contains('auto-advance-section')) {
            nextSection = nextSection.nextElementSibling;
        }

        if (nextSection) {
            // Use setTimeout to allow the UI to update before scrolling
            setTimeout(() => {
                 nextSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    }
    
    // --- EVENT LISTENER SETUP ---
    function setupEventListeners() {
        document.getElementById('startFullReviewBtn').addEventListener('click', () => { document.getElementById('launchScreenModal').style.display = 'none'; setAppViewMode('full'); clearForm(true); });
        document.getElementById('startQuickScoreBtn').addEventListener('click', () => { document.getElementById('launchScreenModal').style.display = 'none'; setAppViewMode('quick'); clearForm(true); });
        document.getElementById('resumeReviewBtn').addEventListener('click', () => { document.getElementById('pasteContainer').style.display = 'block'; });
        document.getElementById('loadPastedDataBtn').addEventListener('click', () => { const pastedText = document.getElementById('pasteDataInput').value; if(!pastedText) return; document.getElementById('launchScreenModal').style.display = 'none'; setAppViewMode('full'); loadFromHandoff(pastedText); });

        form.addEventListener('input', saveState);
        form.addEventListener('change', saveState);
        document.getElementById('startOverBtn').addEventListener('click', () => {
            if (confirm('Are you sure you want to start over?')) {
                clearForm(true);
                document.getElementById('main-content').style.visibility = 'hidden';
                document.getElementById('launchScreenModal').style.display = 'flex';
            }
        });
        
        let activeRadio = null;
        form.addEventListener('mousedown', e => { if (e.target.type === 'radio' && (e.target.classList.contains('score-input') || e.target.classList.contains('adds-input'))) activeRadio = e.target.checked ? e.target : null; });
        form.addEventListener('click', e => { if (e.target.type === 'radio' && (e.target.classList.contains('score-input') || e.target.classList.contains('adds-input')) && e.target === activeRadio) { e.target.checked = false; e.target.dispatchEvent(new Event('change', { bubbles: true })); } });
        
        document.getElementById('addCentralLineButton').addEventListener('click', () => window.addCentral_line());
        document.getElementById('addPivcButton').addEventListener('click', () => window.addPivc());
        document.getElementById('addIdcButton').addEventListener('click', () => window.addIdc());
        document.getElementById('addPacingWireButton').addEventListener('click', () => window.addPacing_wire());
        document.getElementById('addOtherButton').addEventListener('click', () => window.addOther());
        document.getElementById('addAllergyButton').addEventListener('click', () => addAllergy());
        document.addEventListener('click', (e) => { if (e.target.matches('.remove-device-btn, .remove-allergy-btn')) e.target.closest('div').remove(); });
        document.addEventListener('input', e => { if (e.target.classList.contains('device-date-input')) { /* Omitted for brevity */ } });
        
        const scoringContainer = document.getElementById('scoringContainer');
        const addsContainer = document.getElementById('adds-container');
        scoringContainer.addEventListener('change', (e) => { if(e.target.classList.contains('score-input')) { /* Omitted for brevity */ }});
        scoringContainer.addEventListener('click', handleAutoAdvance);
        addsContainer.addEventListener('change', (e) => { if (e.target.classList.contains('adds-input')) calculateADDS(); });
        addsContainer.addEventListener('click', handleAutoAdvance);
        
        document.getElementById('homeTeamPlanCheckbox').addEventListener('change', e => { document.getElementById('homeTeamPlanDetails').style.display = e.target.checked ? 'block' : 'none'; });
        document.querySelectorAll('.precaution-cb').forEach(cb => cb.addEventListener('change', () => { document.getElementById('infectionControlDetails').style.display = document.querySelector('.precaution-cb:checked') ? 'block' : 'none'; }));
        document.getElementById('addsModificationCheckbox').addEventListener('change', e => { document.getElementById('addsModificationDetails').style.display = e.target.checked ? 'block' : 'none'; });
        document.getElementById('goc').addEventListener('change', e => { document.getElementById('gocSpecificsContainer').style.display = e.target.value ? 'block' : 'none'; });
        document.querySelectorAll('input[name="pics_status"]').forEach(r => r.addEventListener('change', e => { document.getElementById('pics_details_container').style.display = e.target.value !== 'Negative' ? 'block' : 'none'; }));
        
        document.getElementById('printBlankBtn').addEventListener('click', () => { /* Omitted for brevity */ });
        document.getElementById('generateSummaryButton').addEventListener('click', generateEMRSummary);
        document.getElementById('copySummaryButton').addEventListener('click', () => { /* Omitted for brevity */ });
        document.getElementById('resetButton').addEventListener('click', () => { if (confirm('Reset form?')) clearForm(true); });
        
        document.getElementById('generateHandoffBtn').addEventListener('click', () => { /* Omitted for brevity */ });
    }
    
    // --- DYNAMIC CONTENT INJECTION ---
    function populateStaticContent() { /* Omitted for brevity */ }
    function generateScoringHTML() { /* Omitted for brevity */ }
    function buildScoreOption(item, controlType) { /* Omitted for brevity */ }
    function generateADDSHTML() { /* Omitted for brevity */ }
        
    initializeApp();
});

