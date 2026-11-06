let board = [], rows = 0, cols = 0, totalMines = 0, flagsPlaced = 0;
let isClassicTheme = false, isFirstClick = true, gameState = 'none', finalGameStatus = 'none'; 
let gameHistory = [], currentHistoryIndex = 0;
let timerInterval, secondsElapsed = 0;

let total3BV = 0, solved3BV = new Set(), totalClicks = 0;
let hzini = 0, zini = 0, maxEff = 0;
let autoSolverTimer = null;
let isPastedAndAnalyzed = false; 
let boardHasKnownMines = true; // يحدد هل أماكن الألغام الحقيقية معروفة بالكامل أم أن اللوحة ملصوقة جزئياً

let activeWebWorker = null;
let analysisIdCounter = 0;

function updateCellSize() {
    const size = document.getElementById('cell-size').value;
    document.documentElement.style.setProperty('--cell-size', `${size}px`);
    document.documentElement.style.setProperty('--font-size', `${Math.max(12, size * 0.55)}px`);
    if(cols > 0) document.getElementById('board').style.gridTemplateColumns = `repeat(${cols}, ${size}px)`;
}

function toggleTheme() {
    isClassicTheme = !isClassicTheme;
    document.body.classList.toggle('classic-theme', isClassicTheme);
    setSmiley(gameState === 'won' ? 'win' : (gameState === 'lost' ? 'lose' : 'unpressed'));
    board.forEach(row => row.forEach(c => { if(c.element) updateCellVisuals(c); }));
}

function startTimer() {
    clearInterval(timerInterval); secondsElapsed = 0;
    document.getElementById('timer').innerText = "000";
    timerInterval = setInterval(() => {
        if(gameState === 'playing') {
            secondsElapsed++;
            document.getElementById('timer').innerText = Math.min(secondsElapsed, 999).toString().padStart(3, '0');
        }
    }, 1000);
}
function stopTimer() { clearInterval(timerInterval); }

function setSmiley(state) {
    let btn = document.getElementById('smiley-btn');
    btn.classList.remove('face-unpressed', 'face-pressed', 'face-win', 'face-lose', 'pressed-visual');
    let emoji = '🙂'; let cls = 'face-unpressed';
    if (state === 'pressed') { emoji = '😮'; cls = 'face-pressed'; btn.classList.add('pressed-visual'); }
    else if (state === 'win') { emoji = '😎'; cls = 'face-win'; }
    else if (state === 'lose') { emoji = '😵'; cls = 'face-lose'; }
    btn.classList.add(cls);
    if(!isClassicTheme) btn.innerText = emoji;
}
function resetSmiley() {
    if(gameState === 'playing' || gameState === 'none' || gameState === 'review') setSmiley('unpressed');
}
function resetGame() {
    if (rows > 0 && cols > 0) startNewGame(rows, cols, totalMines);
}

window.addEventListener('mouseup', () => {
    document.querySelectorAll('.cell.pressed').forEach(el => el.classList.remove('pressed'));
});

// --- STATS ENGINE ---
function resetStats() {
    total3BV = 0; solved3BV.clear(); totalClicks = 0;
    hzini = 0; zini = 0; maxEff = 0;
    updateStatsUI();
}

function calculate3BVandSafeEfficiency() {
    let compMap = new Array(rows).fill(0).map(() => new Array(cols).fill(-1));
    let compId = 0;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (!board[r][c].isMine && board[r][c].originalValue === '0' && compMap[r][c] === -1) {
                let q = [{r, c}]; compMap[r][c] = compId;
                let head = 0;
                while (head < q.length) {
                    let curr = q[head++];
                    getNeighbors(curr.r, curr.c).forEach(n => {
                        if (!n.isMine && compMap[n.r][n.c] === -1) {
                            compMap[n.r][n.c] = compId;
                            if (n.originalValue === '0') q.push({r: n.r, c: n.c});
                        }
                    });
                }
                compId++;
            }
        }
    }

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (!board[r][c].isMine && board[r][c].originalValue !== '0' && compMap[r][c] === -1) {
                compMap[r][c] = compId++;
            }
            board[r][c].compId = compMap[r][c]; 
        }
    }
    total3BV = compId;

    let edgeNumbers = 0;
    board.forEach(row => row.forEach(c => { if(!c.isMine && c.originalValue > 0) edgeNumbers++; }));
    let potentialSaves = Math.floor(edgeNumbers * 0.20); 
    hzini = total3BV - potentialSaves;
    if(hzini > total3BV) hzini = total3BV; 
    if(hzini < Math.floor(total3BV * 0.5)) hzini = Math.floor(total3BV * 0.5); 
    zini = Math.max(Math.floor(total3BV * 0.4), Math.floor(hzini * 0.95)); 
    maxEff = hzini > 0 ? ((total3BV / hzini) * 100).toFixed(0) : 0;
    updateStatsUI();
}

function updateStatsUI() {
    let eff = totalClicks > 0 ? ((solved3BV.size / totalClicks) * 100).toFixed(0) : 0;
    document.getElementById('stat-3bv').innerText = `${solved3BV.size}/${total3BV}`;
    document.getElementById('stat-clicks').innerText = totalClicks;
    document.getElementById('stat-eff').innerText = `${eff}%`;
    document.getElementById('stat-hzini').innerText = isFirstClick ? "-" : hzini;
    document.getElementById('stat-zini').innerText = isFirstClick ? "-" : zini;
    document.getElementById('stat-max-eff').innerText = isFirstClick ? "-" : `${maxEff}%`;
}

// --- GAME ENGINE ---
function initBoardUI(isPasted = false) {
    const boardElement = document.getElementById('board');
    updateCellSize(); boardElement.innerHTML = '';
    document.getElementById('dashboard').style.display = 'flex';
    document.getElementById('stats-panel').style.display = 'flex';
    document.getElementById('review-panel').style.display = 'none';
    
    cancelAnyRunningAnalysis();
    updateCounter(); setSmiley('unpressed');
    
    if (!isPasted) isFirstClick = true;
    gameState = 'playing'; finalGameStatus = 'none';
    gameHistory = []; currentHistoryIndex = 0;
    resetStats(); startTimer();

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            let cellState = board[r][c];
            cell.dataset.r = r; cell.dataset.c = c;
            
            cell.addEventListener('mousedown', (e) => {
                if (e.button === 0 && gameState === 'playing') {
                    if (!cellState.isRevealed && !cellState.isFlagged) {
                        cell.classList.add('pressed');
                    } else if (cellState.isRevealed && cellState.currentNumber > 0) {
                        getNeighbors(r, c).forEach(n => {
                            if (!n.isRevealed && !n.isFlagged) n.element.classList.add('pressed');
                        });
                    }
                }
            });
            cell.addEventListener('contextmenu', (e) => { e.preventDefault(); handleUserAction('flag', r, c); });
            cell.addEventListener('click', () => handleUserAction('reveal', r, c));
            cellState.element = cell; boardElement.appendChild(cell);
        }
    }
}

function startNewGame(r, c, m) {
    rows = r; cols = c; totalMines = m; flagsPlaced = 0; board = [];
    isPastedAndAnalyzed = false;
    boardHasKnownMines = true;
    for (let i = 0; i < rows; i++) {
        let row = [];
        for (let j = 0; j < cols; j++) row.push({ isMine: false, isRevealed: false, isFlagged: false, isFalseFlag: false, currentNumber: 0, compId: -1, r: i, c: j });
        board.push(row);
    }
    initBoardUI(false);
}

function placeMinesAvoid(safeR, safeC) {
    let placed = 0;
    while(placed < totalMines) {
        let r = Math.floor(Math.random() * rows);
        let c = Math.floor(Math.random() * cols);
        if(!board[r][c].isMine && (r !== safeR || c !== safeC)) {
            board[r][c].isMine = true; placed++;
        }
    }
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (!board[r][c].isMine) {
                let count = 0; getNeighbors(r, c).forEach(n => { if (n.isMine) count++; });
                board[r][c].originalValue = count.toString();
            } else board[r][c].originalValue = 'M';
        }
    }
    boardHasKnownMines = true;
}

async function pasteAndPlay() {
    try {
        const text = await navigator.clipboard.readText();
        if(parsePastedData(text, false)) {
            isPastedAndAnalyzed = false;
            isFirstClick = false; initBoardUI(true); 
            for(let r=0; r<rows; r++) {
                for(let c=0; c<cols; c++) {
                    board[r][c].isRevealed = false; board[r][c].isFlagged = false; board[r][c].isFalseFlag = false;
                }
            }
            calculate3BVandSafeEfficiency(); 
        }
    } catch (err) { alert("Clipboard error."); }
}

async function pasteAndAnalyze() {
    try {
        const text = await navigator.clipboard.readText();
        if(parsePastedData(text, true)) {
            isPastedAndAnalyzed = true; 
            isFirstClick = false; initBoardUI(true); 
            calculate3BVandSafeEfficiency();
            board.forEach(row => row.forEach(cell => {
                if(cell.tempPasteValue === 'F') { handleLogic('flag', cell.r, cell.c, false); }
                else if(cell.tempPasteValue !== 'C' && cell.tempPasteValue !== 'M') {
                    cell.isRevealed = true; cell.currentNumber = parseInt(cell.tempPasteValue);
                    if(cell.compId !== -1) solved3BV.add(cell.compId);
                    updateCellVisuals(cell);
                }
            }));
            updateStatsUI(); stopTimer(); startAnalysis();
        }
    } catch (err) { alert("Clipboard error."); }
}

function parsePastedData(dataString, isAnalyzeOnly = false) {
    try {
        let gameData = JSON.parse(dataString);
        rows = gameData.r; cols = gameData.c; totalMines = gameData.m || 99;
        board = []; flagsPlaced = 0;
        let explicitMinesCount = 0;

        for (let r = 0; r < rows; r++) {
            let row = [];
            for (let c = 0; c < cols; c++) row.push({ isMine: false, isRevealed: false, isFlagged: false, isFalseFlag: false, tempPasteValue: 'C', currentNumber: 0, compId:-1, r: r, c: c });
            board.push(row);
        }

        gameData.data.forEach(cell => {
            if (cell.v === 'M') explicitMinesCount++;
        });

        // إذا كانت البيانات الملصوقة تحتوي على جميع أماكن الألغام 'M'، فنحن نملك الحقيقة الكاملة للوحة
        // أما إذا كانت تحتوي فقط على خلايا مغلقة 'C' وأعلام 'F' وأرقام، فلا نفترض أن 'F' لغم مؤكد عند التحليل لكي نتمكن من كشف الـ Misflag!
        boardHasKnownMines = (explicitMinesCount === totalMines) || !isAnalyzeOnly;

        gameData.data.forEach(cell => {
            let bCell = board[cell.r][cell.c]; bCell.tempPasteValue = cell.v;
            if (cell.v === 'M' || (!isAnalyzeOnly && cell.v === 'F')) {
                bCell.isMine = true;
            } else if(cell.v !== 'C' && cell.v !== 'F') {
                bCell.originalValue = cell.v;
            }
        });

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!board[r][c].isMine && !board[r][c].originalValue) {
                    let count = 0; getNeighbors(r, c).forEach(n => { if (n.isMine) count++; });
                    board[r][c].originalValue = count.toString();
                } else if (board[r][c].isMine) board[r][c].originalValue = 'M';
            }
        }
        return true;
    } catch (e) { alert("Invalid data format."); return false; }
}

function cancelAnyRunningAnalysis() {
    analysisIdCounter++; 
    if (activeWebWorker) { activeWebWorker.terminate(); activeWebWorker = null; }
    if (autoSolverTimer) { clearTimeout(autoSolverTimer); autoSolverTimer = null; }
    document.getElementById('loading-overlay').style.display = 'none';
    let btn = document.getElementById('analyze-btn');
    btn.innerText = "🧠 Hint / Analyze"; btn.disabled = false;
    let autoBtn = document.getElementById('btn-auto');
    autoBtn.innerText = "🤖 Max-Eff Auto-Play"; autoBtn.style.animation = "none";
}

function handleUserAction(action, r, c) {
    if (gameState !== 'playing' && gameState !== 'review') return;
    
    cancelAnyRunningAnalysis(); clearAnalysisUI();

    if (gameState === 'review') {
        gameHistory = gameHistory.slice(0, currentHistoryIndex);
        gameState = 'playing'; finalGameStatus = 'none'; setSmiley('unpressed');
        document.getElementById('review-panel').style.display = 'none';
        board.forEach(row => row.forEach(c => c.element.classList.remove('highlight-move')));
        solved3BV.clear(); totalClicks = 0;
        gameHistory.forEach(h => {
            totalClicks++; 
            if(h.action === 'reveal' && board[h.r][h.c].compId !== -1) solved3BV.add(board[h.r][h.c].compId);
        });
        updateStatsUI();
    }

    if (isFirstClick && action === 'reveal') { 
        placeMinesAvoid(r, c); calculate3BVandSafeEfficiency(); isFirstClick = false; 
    }

    let changed = false; let cell = board[r][c]; let registeredAction = action;
    if (action === 'reveal' && cell.isRevealed && cell.currentNumber > 0) registeredAction = 'chord';
    if (registeredAction === 'chord') changed = handleChord(r, c, true);
    else changed = handleLogic(registeredAction, r, c, true);

    if (changed) {
        totalClicks++; 
        gameHistory.push({ action: registeredAction, r: r, c: c });
        currentHistoryIndex = gameHistory.length;
        updateStatsUI();
        if (gameState === 'playing') checkWinCondition();
    }
}

function handleChord(r, c, triggerGameOver) {
    let cell = board[r][c];
    if (!cell.isRevealed || cell.currentNumber === 0) return false;
    let neighbors = getNeighbors(r, c);
    let flagsCount = neighbors.filter(n => n.isFlagged).length;
    let changedAny = false;
    if (flagsCount === cell.currentNumber) {
        neighbors.forEach(n => {
            if (!n.isRevealed && !n.isFlagged) {
                let res = handleLogic('reveal', n.r, n.c, triggerGameOver);
                if (res) changedAny = true;
            }
        });
    }
    return changedAny; 
}

function handleLogic(action, r, c, triggerGameOver) {
    let cell = board[r][c];
    if (gameState === 'won' || gameState === 'lost') return false; 

    if (action === 'flag') {
        if (cell.isRevealed) return false;
        cell.isFlagged = !cell.isFlagged; flagsPlaced += cell.isFlagged ? 1 : -1;
        updateCellVisuals(cell); updateCounter(); return true;
    } 
    else if (action === 'reveal') {
        if (cell.isRevealed || cell.isFlagged) return false;
        cell.isRevealed = true;
        if(cell.compId !== -1) solved3BV.add(cell.compId); 
        if (cell.isMine) {
            cell.causedLoss = true; updateCellVisuals(cell);
            if(triggerGameOver && gameState === 'playing') gameOver(false);
            return true;
        }
        let mineCount = parseInt(cell.originalValue) || 0;
        cell.currentNumber = mineCount; updateCellVisuals(cell);
        if (mineCount === 0) {
            getNeighbors(r, c).forEach(n => { if (!n.isRevealed && !n.isFlagged) handleLogic('reveal', n.r, n.c, false); });
        }
        return true;
    }
    return false;
}

function updateCellVisuals(cell) {
    let el = cell.element;
    let hadHighlight = el.classList.contains('highlight-move');
    el.className = 'cell';
    if (hadHighlight) el.classList.add('highlight-move');
    el.innerText = '';
    
    if (cell.isFlagged) {
        if (cell.isFalseFlag) {
            el.classList.add('mine-wrong'); if(!isClassicTheme) el.innerText = '❌';
        } else {
            el.classList.add('flagged'); if(!isClassicTheme) el.innerText = '🚩';
        }
    } else if (cell.isRevealed) {
        el.classList.add('revealed');
        if (cell.isMine) {
            el.classList.add('mine');
            if (cell.causedLoss) el.classList.add('mine-red');
            if(!isClassicTheme) el.innerText = '💣';
        } else {
            el.classList.add(`num-${cell.currentNumber}`);
            if (cell.currentNumber > 0 && !isClassicTheme) el.innerText = cell.currentNumber;
        }
    }
}

function checkWinCondition() {
    if (gameState === 'lost') return;
    let revealedCount = 0;
    board.forEach(row => row.forEach(c => { if (c.isRevealed && !c.isMine) revealedCount++; }));
    if (revealedCount === (rows * cols) - totalMines) gameOver(true);
}

function gameOver(won) {
    if (gameState === 'won' || gameState === 'lost') return; 
    stopTimer(); cancelAnyRunningAnalysis();
    
    finalGameStatus = won ? 'won' : 'lost'; gameState = finalGameStatus;
    setSmiley(won ? 'win' : 'lose');
    
    board.forEach(row => row.forEach(c => {
        if (won) {
            if (c.isMine && !c.isFlagged) { c.isFlagged = true; flagsPlaced++; updateCellVisuals(c); }
        } else {
            if (c.isMine && !c.isFlagged) { c.isRevealed = true; updateCellVisuals(c); } 
            else if (!c.isMine && c.isFlagged) { c.isFalseFlag = true; updateCellVisuals(c); }
        }
    }));
    updateCounter();
    setTimeout(() => { document.getElementById('review-panel').style.display = 'flex'; updateReviewUI(); }, 800);
}

function navigateHistory(step) { navigateHistoryTo(currentHistoryIndex + step); }

function navigateHistoryTo(target) {
    if (target === 'max') target = gameHistory.length;
    target = parseInt(target);
    if (target < 0 || target > gameHistory.length) return;
    
    currentHistoryIndex = target; gameState = 'review';
    flagsPlaced = 0; totalClicks = 0; solved3BV.clear(); cancelAnyRunningAnalysis();
    
    board.forEach(row => row.forEach(c => { 
        c.isRevealed = false; c.isFlagged = false; c.causedLoss = false; c.isFalseFlag = false; c.element.classList.remove('highlight-move'); 
    }));
    
    if (isPastedAndAnalyzed) {
        board.forEach(row => row.forEach(cell => {
            if(cell.tempPasteValue === 'F') { cell.isFlagged = true; flagsPlaced++; }
            else if(cell.tempPasteValue !== 'C' && cell.tempPasteValue !== 'M') {
                cell.isRevealed = true; cell.currentNumber = parseInt(cell.tempPasteValue);
                if(cell.compId !== -1) solved3BV.add(cell.compId);
            }
        }));
    }
    
    clearAnalysisUI();
    
    for(let i=0; i<currentHistoryIndex; i++) {
        let hist = gameHistory[i]; totalClicks++; 
        if (hist.action === 'chord') handleChord(hist.r, hist.c, false);
        else handleLogic(hist.action, hist.r, hist.c, false);
    }
    
    if (currentHistoryIndex === gameHistory.length && finalGameStatus !== 'none') {
        gameState = finalGameStatus; setSmiley(finalGameStatus === 'won' ? 'win' : 'lose');
        board.forEach(row => row.forEach(c => {
            if (finalGameStatus === 'won') { if (c.isMine && !c.isFlagged) { c.isFlagged = true; flagsPlaced++; } } 
            else {
                if (c.isMine && !c.isFlagged) c.isRevealed = true;
                else if (!c.isMine && c.isFlagged) c.isFalseFlag = true;
            }
        }));
    } else {
        gameState = 'review'; setSmiley('unpressed');
    }
    
    board.forEach(row => row.forEach(c => updateCellVisuals(c)));
    if (currentHistoryIndex > 0) {
        let lastMove = gameHistory[currentHistoryIndex - 1];
        board[lastMove.r][lastMove.c].element.classList.add('highlight-move');
    }
    updateCounter(); updateReviewUI(); updateStatsUI();
}

function updateReviewUI() {
    let max = gameHistory.length;
    document.getElementById('review-counter').innerText = `${currentHistoryIndex}/${max}`;
    document.getElementById('nav-slider').max = max; document.getElementById('nav-slider').value = currentHistoryIndex;
}

function updateCounter() {
    let remaining = totalMines - flagsPlaced;
    document.getElementById('mines-counter').innerText = remaining >= 0 ? remaining.toString().padStart(3, '0') : "-" + Math.abs(remaining).toString().padStart(2, '0');
}

function getNeighbors(r, c) {
    let n = [];
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            if (i === 0 && j === 0) continue;
            let nr = r + i, nc = c + j;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) n.push(board[nr][nc]);
        }
    }
    return n;
}

function clearAnalysisUI() {
    document.querySelectorAll('.prob-text').forEach(el => el.remove());
    document.querySelectorAll('.ai-safe, .ai-mine, .ai-guess, .mine-wrong').forEach(el => {
        el.classList.remove('ai-safe', 'ai-mine', 'ai-guess');
    });
}

// ⚡ محرك التحليل الخارق (Ultra-Fast 100% Exact Solver Worker)
// يستخدم: Component Splitting + BFS/MCV Variable Ordering + Unit Propagation (Forward Checking) + Zero-Allocation TypedArrays
const solverWorkerCode = `
self.onmessage = function(e) {
    const { workerEdges, workerNums, globalTotalMines, isolatedCount } = e.data;
    const numEdges = workerEdges.length;

    // 0. بناء جدول التوافيق المسبق (Precomputed Combinations Cache) لتجنب إعادة الحساب
    const maxIso = Math.max(0, isolatedCount);
    const combCache = new Array(maxIso + 1).fill(0n);
    if (maxIso >= 0) {
        combCache[0] = 1n;
        let bigN = BigInt(maxIso);
        for (let k = 1; k <= maxIso; k++) {
            combCache[k] = (combCache[k - 1] * (bigN - BigInt(k) + 1n)) / BigInt(k);
        }
    }
    function getComb(k) {
        return (k >= 0 && k <= maxIso) ? combCache[k] : 0n;
    }

    // 1. بناء روابط الأرقام والخلايا وفصل المكونات المستقلة (Connected Components)
    let numToEdges = new Array(workerNums.length).fill(0).map(() => []);
    for (let i = 0; i < numEdges; i++) {
        const links = workerEdges[i].links;
        for (let j = 0; j < links.length; j++) {
            numToEdges[links[j]].push(i);
        }
    }

    let adj = new Array(numEdges).fill(0).map(() => []);
    for (let nIdx = 0; nIdx < numToEdges.length; nIdx++) {
        const list = numToEdges[nIdx];
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                const u = list[i], v = list[j];
                if (!adj[u].includes(v)) {
                    adj[u].push(v);
                    adj[v].push(u);
                }
            }
        }
    }

    let visited = new Uint8Array(numEdges);
    let components = [];
    for (let i = 0; i < numEdges; i++) {
        if (!visited[i]) {
            let comp = [];
            let q = [i];
            visited[i] = 1;
            let head = 0;
            while (head < q.length) {
                let curr = q[head++];
                comp.push(curr);
                const neighbors = adj[curr];
                for (let j = 0; j < neighbors.length; j++) {
                    const nxt = neighbors[j];
                    if (!visited[nxt]) {
                        visited[nxt] = 1;
                        q.push(nxt);
                    }
                }
            }
            components.push(comp);
        }
    }

    // 2. حل كل مكون بأقصى سرعة باستخدام ترتيب المتغيرات (BFS+MCV) والنشر الآني للقيود (Forward Checking)
    let compDistributions = [];
    let iterations = 0;

    // مصفوفات حالة عامة لتجنب تخصيص الذاكرة أثناء الـ Backtracking
    let numAssigned = new Int32Array(workerNums.length);
    let numRemHidden = new Int32Array(workerNums.length);
    let numNeeded = new Int32Array(workerNums.length);
    for (let i = 0; i < workerNums.length; i++) {
        numNeeded[i] = workerNums[i].needed;
        numRemHidden[i] = workerNums[i].totalHidden;
    }

    let edgeState = new Int8Array(numEdges); // 0: unassigned, 1: safe, 2: mine

    for (let c = 0; c < components.length; c++) {
        let rawComp = components[c];

        // ترتيب الخلايا داخل المكون بطريقة JSMinesweeper / Frontier BFS:
        // نبدأ بالخلية الأكثر ارتباطاً بالأرقام المقيدة، ثم نضيف الجيران المتصلين بنفس الأرقام بالتتابع
        let orderedComp = [];
        let inOrdered = new Uint8Array(numEdges);
        
        while (orderedComp.length < rawComp.length) {
            let bestNext = -1;
            let bestScore = -1;

            for (let i = 0; i < rawComp.length; i++) {
                let eIdx = rawComp[i];
                if (inOrdered[eIdx]) continue;

                let sharedWithPlaced = 0;
                const neighbors = adj[eIdx];
                for (let j = 0; j < neighbors.length; j++) {
                    if (inOrdered[neighbors[j]]) sharedWithPlaced++;
                }

                // الأولوية للخلايا المتصلة بخلايا تم وضعها بالفعل، ثم الأكثر قيوداً
                let score = (sharedWithPlaced * 100) + (workerEdges[eIdx].links.length * 10);
                if (score > bestScore) {
                    bestScore = score;
                    bestNext = eIdx;
                }
            }
            inOrdered[bestNext] = 1;
            orderedComp.push(bestNext);
        }

        const compLen = orderedComp.length;
        const maxCompMines = Math.max(0, Math.min(compLen, globalTotalMines));
        
        // مصفوفات BigInt سريعة لتسجيل النتائج بدلاً من Map()
        let waysArr = new Array(maxCompMines + 1).fill(0n);
        let statsArr = new Array(compLen);
        for (let i = 0; i < compLen; i++) {
            statsArr[i] = new Array(maxCompMines + 1).fill(0n);
        }

        // مكدس التغييرات للتراجع السريع (Undo Stack) بدون إنشاء كائنات
        let trailEdge = new Int32Array(compLen * 2 + 10);
        let trailPtr = 0;

        function assignCell(eIdx, val) {
            edgeState[eIdx] = val;
            trailEdge[trailPtr++] = eIdx;
            const links = workerEdges[eIdx].links;
            const isMine = (val === 2);
            for (let i = 0; i < links.length; i++) {
                const nIdx = links[i];
                numRemHidden[nIdx]--;
                if (isMine) numAssigned[nIdx]++;
            }
        }

        function undoTo(savedPtr) {
            while (trailPtr > savedPtr) {
                const eIdx = trailEdge[--trailPtr];
                const wasMine = (edgeState[eIdx] === 2);
                edgeState[eIdx] = 0;
                const links = workerEdges[eIdx].links;
                for (let i = 0; i < links.length; i++) {
                    const nIdx = links[i];
                    numRemHidden[nIdx]++;
                    if (wasMine) numAssigned[nIdx]--;
                }
            }
        }

        // النشر الآني للقيود (Unit Propagation / Forward Checking)
        function propagate(startEdgeIdx, currentMines) {
            let addedMines = 0;
            let propQueue = [startEdgeIdx];
            let qHead = 0;

            while (qHead < propQueue.length) {
                const currE = propQueue[qHead++];
                const links = workerEdges[currE].links;

                for (let i = 0; i < links.length; i++) {
                    const nIdx = links[i];
                    const needed = numNeeded[nIdx];
                    const assigned = numAssigned[nIdx];
                    const rem = numRemHidden[nIdx];

                    // فحص التناقض المبكر
                    if (assigned > needed || assigned + rem < needed) return -1;

                    if (rem > 0) {
                        if (assigned === needed) {
                            // كل الخلايا المتبقية حول هذا الرقم آمنة إجبارياً
                            const nEdges = numToEdges[nIdx];
                            for (let j = 0; j < nEdges.length; j++) {
                                const nbE = nEdges[j];
                                if (edgeState[nbE] === 0) {
                                    assignCell(nbE, 1);
                                    propQueue.push(nbE);
                                }
                            }
                        } else if (assigned + rem === needed) {
                            // كل الخلايا المتبقية حول هذا الرقم ألغام إجبارياً
                            const nEdges = numToEdges[nIdx];
                            for (let j = 0; j < nEdges.length; j++) {
                                const nbE = nEdges[j];
                                if (edgeState[nbE] === 0) {
                                    addedMines++;
                                    if (currentMines + addedMines > globalTotalMines) return -1;
                                    assignCell(nbE, 2);
                                    propQueue.push(nbE);
                                }
                            }
                        }
                    }
                }
            }
            return addedMines;
        }

        function solveComp(idx, currentMines) {
            iterations++;
            if ((iterations & 65535) === 0) {
                self.postMessage({ type: 'progress', iters: iterations });
            }

            // تخطي الخلايا التي تم تحديدها مسبقاً بواسطة النشر الآني (Unit Propagation)
            while (idx < compLen && edgeState[orderedComp[idx]] !== 0) {
                idx++;
            }

            if (idx === compLen) {
                if (currentMines <= maxCompMines) {
                    waysArr[currentMines] += 1n;
                    for (let i = 0; i < compLen; i++) {
                        if (edgeState[orderedComp[i]] === 2) {
                            statsArr[i][currentMines] += 1n;
                        }
                    }
                }
                return;
            }

            const eIdx = orderedComp[idx];
            const savedPtr = trailPtr;

            // الفرع الأول: تجربة وضع لغم (Mine = 2)
            if (currentMines + 1 <= maxCompMines) {
                assignCell(eIdx, 2);
                const forcedMines = propagate(eIdx, currentMines + 1);
                if (forcedMines !== -1) {
                    solveComp(idx + 1, currentMines + 1 + forcedMines);
                }
                undoTo(savedPtr);
            }

            // الفرع الثاني: تجربة خلية آمنة (Safe = 1)
            assignCell(eIdx, 1);
            const forcedMines2 = propagate(eIdx, currentMines);
            if (forcedMines2 !== -1) {
                solveComp(idx + 1, currentMines + forcedMines2);
            }
            undoTo(savedPtr);
        }

        solveComp(0, 0);

        // تحويل المصفوفة إلى قائمة مضغوطة للقيم غير الصفرية فقط لتسريع عملية الـ DP
        let nonZeroWays = [];
        for (let m = 0; m <= maxCompMines; m++) {
            if (waysArr[m] > 0n) nonZeroWays.push([m, waysArr[m]]);
        }

        compDistributions.push({
            ways: nonZeroWays,
            statsArr: statsArr,
            edgeIndices: orderedComp,
            maxMines: maxCompMines
        });
    }

    // 3. دمج المكونات باستخدام Prefix & Suffix DP لتجنب إعادة ضرب المكونات لكل خلية ($O(C)$ بدلاً من $O(C^2)$)
    const numComps = compDistributions.length;
    
    function convolve(dpMap, compWays) {
        let nextDp = new Map();
        for (let [m1, w1] of dpMap.entries()) {
            for (let i = 0; i < compWays.length; i++) {
                const m2 = compWays[i][0], w2 = compWays[i][1];
                const tot = m1 + m2;
                if (tot <= globalTotalMines) {
                    nextDp.set(tot, (nextDp.get(tot) || 0n) + (w1 * w2));
                }
            }
        }
        return nextDp;
    }

    let prefixDp = new Array(numComps + 1);
    prefixDp[0] = new Map([[0, 1n]]);
    for (let c = 0; c < numComps; c++) {
        prefixDp[c + 1] = convolve(prefixDp[c], compDistributions[c].ways);
    }

    let suffixDp = new Array(numComps + 1);
    suffixDp[numComps] = new Map([[0, 1n]]);
    for (let c = numComps - 1; c >= 0; c--) {
        suffixDp[c] = convolve(suffixDp[c + 1], compDistributions[c].ways);
    }

    const fullDp = prefixDp[numComps];
    let totalValidWeight = 0n;
    let totalIsolatedMinesWeight = 0n;

    for (let [dpMines, dpWays] of fullDp.entries()) {
        let isoMines = globalTotalMines - dpMines;
        if (isoMines >= 0 && isoMines <= isolatedCount) {
            let w = dpWays * getComb(isoMines);
            totalValidWeight += w;
            totalIsolatedMinesWeight += w * BigInt(isoMines);
        }
    }

    let edgeMinesWeight = new Array(numEdges).fill(0n);

    if (totalValidWeight > 0n) {
        for (let c = 0; c < numComps; c++) {
            const comp = compDistributions[c];
            const pref = prefixDp[c];
            const suff = suffixDp[c + 1];

            // دمج Prefix[c] مع Suffix[c+1] للحصول على توافيق جميع المكونات الأخرى ما عدا c
            let otherDp = new Map();
            for (let [m1, w1] of pref.entries()) {
                for (let [m2, w2] of suff.entries()) {
                    const tot = m1 + m2;
                    if (tot <= globalTotalMines) {
                        otherDp.set(tot, (otherDp.get(tot) || 0n) + (w1 * w2));
                    }
                }
            }

            // حساب وزن الإكمال مع الخلايا المعزولة لكل عدد ألغام ممكن في المكون c
            let completionWeight = new Array(comp.maxMines + 1).fill(0n);
            for (let mComp = 0; mComp <= comp.maxMines; mComp++) {
                let sumW = 0n;
                for (let [otherMines, otherWays] of otherDp.entries()) {
                    let isoMines = globalTotalMines - (mComp + otherMines);
                    if (isoMines >= 0 && isoMines <= isolatedCount) {
                        sumW += otherWays * getComb(isoMines);
                    }
                }
                completionWeight[mComp] = sumW;
            }

            for (let i = 0; i < comp.edgeIndices.length; i++) {
                const eIdx = comp.edgeIndices[i];
                const cellStats = comp.statsArr[i];
                let cellTotalWeight = 0n;
                for (let mComp = 0; mComp <= comp.maxMines; mComp++) {
                    if (cellStats[mComp] > 0n && completionWeight[mComp] > 0n) {
                        cellTotalWeight += cellStats[mComp] * completionWeight[mComp];
                    }
                }
                edgeMinesWeight[eIdx] = cellTotalWeight;
            }
        }
    }

    self.postMessage({
        type: 'done',
        totalValidWeight: totalValidWeight.toString(),
        totalIsolatedMinesWeight: totalIsolatedMinesWeight.toString(),
        edgeMinesWeight: edgeMinesWeight.map(w => w.toString())
    });
};
`;

let cachedWorkerUrl = null;
function getSolverWorkerUrl() {
    if (!cachedWorkerUrl) {
        const blob = new Blob([solverWorkerCode], { type: 'application/javascript' });
        cachedWorkerUrl = URL.createObjectURL(blob);
    }
    return cachedWorkerUrl;
}

/**
 * دالة مساعدة لتشغيل استنتاج المعادلات السريع (Set Subtraction & Overlap Elimination)
 */
function runFastEquationSolver(activeNumbers) {
    let equations = activeNumbers.map(n => ({ cells: n.hiddenNeighbors.map(c => `${c.r},${c.c}`), mines: n.neededMines }));
    let eqSafes = new Set(), eqMines = new Set(), contradiction = false, changed = true, iter = 0;

    while(changed && iter < 100) {
        changed = false; iter++;
        for(let i=0; i<equations.length; i++) {
            let eq = equations[i];
            if (eq.mines < 0 || eq.mines > eq.cells.length) { contradiction = true; }
            if (eq.cells.length === 0) continue;
            if (eq.mines === 0) {
                eq.cells.forEach(c => eqSafes.add(c));
                eq.cells = []; changed = true;
            } else if (eq.mines === eq.cells.length) {
                eq.cells.forEach(c => eqMines.add(c));
                eq.cells = []; changed = true;
            }
        }

        for(let i=0; i<equations.length; i++) {
            let eq = equations[i], origLen = eq.cells.length, newCells = [], removedMines = 0;
            if (origLen === 0) continue;
            for (let k = 0; k < origLen; k++) {
                let c = eq.cells[k];
                if (eqMines.has(c)) removedMines++;
                else if (!eqSafes.has(c)) newCells.push(c);
            }
            if (newCells.length < origLen) {
                eq.cells = newCells; eq.mines -= removedMines; changed = true;
                if (eq.mines < 0 || eq.mines > eq.cells.length) contradiction = true;
            }
        }

        for(let i=0; i<equations.length; i++) {
            let eqA = equations[i];
            if (eqA.cells.length === 0) continue;
            for(let j=0; j<equations.length; j++) {
                if (i===j) continue;
                let eqB = equations[j];
                if (eqB.cells.length === 0 || eqA.cells.length >= eqB.cells.length) continue;
                if (eqA.cells.every(c => eqB.cells.includes(c))) {
                    let newCells = eqB.cells.filter(c => !eqA.cells.includes(c));
                    let newMines = eqB.mines - eqA.mines;
                    if (newMines < 0 || newMines > newCells.length) {
                        contradiction = true;
                    } else if (newMines === 0) {
                        newCells.forEach(c => eqSafes.add(c)); changed = true;
                    } else if (newMines === newCells.length) {
                        newCells.forEach(c => eqMines.add(c)); changed = true;
                    } else {
                        let exists = equations.some(e => e.mines === newMines && e.cells.length === newCells.length && e.cells.every(c => newCells.includes(c)));
                        if (!exists) { equations.push({cells: newCells, mines: newMines}); changed = true; }
                    }
                }
            }
        }
    }

    // إذا تم تصنيف خلية واحدة كآمنة ولغم في نفس الوقت فهذا تناقض رياضي مباشر
    for (let s of eqSafes) {
        if (eqMines.has(s)) contradiction = true;
    }

    return { eqSafes, eqMines, contradiction };
}

/**
 * 🚨 نظام الفحص الدقيق للأعلام الخاطئة (Comprehensive Misflag Detector) 🚨
 * يفحص اللوحة قبل أي تحليل باستخدام:
 * 1. التحليل المنطقي الصافي (Flag-Agnostic Ground-Truth Audit): يتجاهل جميع الأعلام الموضوعة ويعيد حساب الخلايا الآمنة 100% من الأرقام فقط؛
 *    أي علم موضوع على خلية آمنة رياضياً (0% احتمال لغم) يتم كشفه فوراً كـ Misflag مؤكد!
 * 2. فحص تجاوز سعة الرقم (Over-Flagged Numbers) أو استحالة الحل مع الأعلام الحالية.
 * 3. فحص الحقيقة الداخلية للوحة (إذا كانت اللوحة تحتوي على بيانات الألغام الحقيقية أثناء اللعب).
 */
async function detectMisflagsAsync(myAnalysisId) {
    let confirmedMisflags = new Set(); // أعلام خاطئة مؤكدة 100%
    let suspectMisflags = new Set();   // أعلام متعارضة حول رقم تم تجاوز سعته (في حال كانت اللوحة ملصوقة بدون بيانات الألغام)

    // أ. جمع جميع الأعلام الموضوعة حالياً على اللوحة
    let currentFlags = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (board[r][c].isFlagged) {
                currentFlags.push(board[r][c]);
                // إذا كانت اللوحة تحتوي على أماكن الألغام الحقيقية (أثناء اللعب العادي أو Paste كامل)
                if (boardHasKnownMines && !board[r][c].isMine) {
                    confirmedMisflags.add(`${r},${c}`);
                }
            }
        }
    }

    if (currentFlags.length === 0) return { hasMisflags: false };

    // ب. الفحص المنطقي الصافي للأرقام (بتجاهل الأعلام تماماً) لمعرفة أي علم مستحيل رياضياً
    let rawNumbers = [];
    let rawEdgeSet = new Set();
    let rawEdgeArray = [];
    let allUnrevealedCount = 0;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            let cell = board[r][c];
            if (!cell.isRevealed) allUnrevealedCount++;
            if (cell.isRevealed && cell.currentNumber > 0) {
                let neighbors = getNeighbors(r, c);
                let unrevealedNeighbors = neighbors.filter(n => !n.isRevealed); // يشمل الأعلام والخلايا المغلقة معاً!
                let flaggedNeighbors = neighbors.filter(n => n.isFlagged);

                // فحص مباشر: هل وضع اللاعب أعلاماً حول هذا الرقم أكثر من قيمة الرقم نفسه؟
                if (flaggedNeighbors.length > cell.currentNumber) {
                    flaggedNeighbors.forEach(fn => suspectMisflags.add(`${fn.r},${fn.c}`));
                }

                if (unrevealedNeighbors.length > 0) {
                    rawNumbers.push({
                        cell: cell,
                        neededMines: cell.currentNumber,
                        hiddenNeighbors: unrevealedNeighbors
                    });
                    unrevealedNeighbors.forEach(un => {
                        let key = `${un.r},${un.c}`;
                        if (!rawEdgeSet.has(key)) {
                            rawEdgeSet.add(key);
                            rawEdgeArray.push(un);
                        }
                    });
                }
            }
        }
    }

    // تشغيل محلل المعادلات على الأرقام الصافية (بدون افتراض صحة أي علم)
    let rawEqResult = runFastEquationSolver(rawNumbers);
    currentFlags.forEach(flagCell => {
        let key = `${flagCell.r},${flagCell.c}`;
        // إذا أثبتت المعادلات الصافية أن هذه الخلية آمنة 100%، فالعلم الموضوع عليها خاطئ قطعاً!
        if (rawEqResult.eqSafes.has(key)) {
            confirmedMisflags.add(key);
        }
    });

    // ج. فحص توافق الأعلام الحالية مع المعادلات (ماذا يحدث لو افترضنا أن الأعلام الحالية صحيحة؟)
    let flagAdjustedNumbers = [];
    for (let i = 0; i < rawNumbers.length; i++) {
        let rn = rawNumbers[i];
        let flagsAround = rn.hiddenNeighbors.filter(n => n.isFlagged);
        let unflaggedAround = rn.hiddenNeighbors.filter(n => !n.isFlagged);
        let remMines = rn.neededMines - flagsAround.length;

        if (remMines < 0 || remMines > unflaggedAround.length) {
            flagsAround.forEach(fn => suspectMisflags.add(`${fn.r},${fn.c}`));
        } else if (unflaggedAround.length > 0) {
            flagAdjustedNumbers.push({
                neededMines: remMines,
                hiddenNeighbors: unflaggedAround
            });
        }
    }

    let adjustedEqResult = runFastEquationSolver(flagAdjustedNumbers);
    let hasContradictionWithFlags = adjustedEqResult.contradiction || (flagsPlaced > totalMines);

    // د. إذا لم نكتشف العلم الخاطئ بالمعادلات السريعة بعد، ولكن:
    // إما أن هناك تناقضاً مع الأعلام، أو أننا في وضع Paste & Analyze ونريد التأكد بالـ Worker أن الأعلام ليست على خلايا احتمالها 0%
    if (confirmedMisflags.size === 0 && (!boardHasKnownMines || hasContradictionWithFlags)) {
        let unresolvedEdges = [];
        let keyToIdx = new Map();
        rawEdgeArray.forEach(cell => {
            let key = `${cell.r},${cell.c}`;
            if (!rawEqResult.eqSafes.has(key) && !rawEqResult.eqMines.has(key)) {
                keyToIdx.set(key, unresolvedEdges.length);
                unresolvedEdges.push(cell);
            }
        });

        let isolatedCount = allUnrevealedCount - rawEdgeArray.length;
        let remMines = totalMines - rawEqResult.eqMines.size;

        if (unresolvedEdges.length > 0 && remMines >= 0) {
            let workerNums = [];
            let workerEdges = unresolvedEdges.map(() => ({ links: [] }));

            rawNumbers.forEach(num => {
                let remIndices = [];
                let knownMines = 0;
                num.hiddenNeighbors.forEach(hn => {
                    let k = `${hn.r},${hn.c}`;
                    if (rawEqResult.eqMines.has(k)) knownMines++;
                    else if (!rawEqResult.eqSafes.has(k)) remIndices.push(keyToIdx.get(k));
                });
                if (remIndices.length > 0) {
                    let wIdx = workerNums.length;
                    workerNums.push({ needed: num.neededMines - knownMines, totalHidden: remIndices.length });
                    remIndices.forEach(eIdx => workerEdges[eIdx].links.push(wIdx));
                }
            });

            let workerAudit = await new Promise((resolve) => {
                let auditWorker = new Worker(getSolverWorkerUrl());
                auditWorker.onmessage = function(e) {
                    if (myAnalysisId !== analysisIdCounter) {
                        auditWorker.terminate();
                        resolve(null);
                        return;
                    }
                    if (e.data.type === 'done') {
                        auditWorker.terminate();
                        resolve(e.data);
                    }
                };
                auditWorker.postMessage({
                    workerEdges,
                    workerNums,
                    globalTotalMines: remMines,
                    isolatedCount
                });
            });

            if (workerAudit && BigInt(workerAudit.totalValidWeight) > 0n) {
                for (let i = 0; i < unresolvedEdges.length; i++) {
                    let cell = unresolvedEdges[i];
                    if (cell.isFlagged && BigInt(workerAudit.edgeMinesWeight[i]) === 0n) {
                        confirmedMisflags.add(`${cell.r},${cell.c}`);
                    }
                }
            }
        }
    }

    // دمج النتائج: إذا وُجدت أعلام خاطئة مؤكدة نعرضها، وإلا إذا كان هناك تناقض نعرض الأعلام المشتبه بها
    let finalMisflags = confirmedMisflags.size > 0 ? confirmedMisflags : (hasContradictionWithFlags ? suspectMisflags : new Set());

    if (finalMisflags.size > 0) {
        return {
            hasMisflags: true,
            cells: Array.from(finalMisflags).map(k => {
                let [r, c] = k.split(',').map(Number);
                return board[r][c];
            }),
            isConfirmed: confirmedMisflags.size > 0
        };
    }

    return { hasMisflags: false };
}

async function analyzeBoardAsync(showVisuals = true, autoSolverMode = false) {
    analysisIdCounter++;
    let myAnalysisId = analysisIdCounter; 

    clearAnalysisUI();
    if (board.length === 0) return { safes: [], mines: [], guesses: [], misflags: [] };

    // 1. الخطوة الأولى: فحص دقيق وشامل لأي Misflag قبل إجراء التحليل!
    let misflagAudit = await detectMisflagsAsync(myAnalysisId);
    if (myAnalysisId !== analysisIdCounter) return { safes: [], mines: [], guesses: [], misflags: [] };

    if (misflagAudit.hasMisflags) {
        if (showVisuals) {
            misflagAudit.cells.forEach(cell => {
                cell.element.classList.add('ai-mine');
                let span = document.createElement('span');
                span.className = 'prob-text';
                span.innerText = '❌';
                cell.element.appendChild(span);
            });
        }
        console.warn("AI Solver: Misflag detected! Fix highlighted flags before continuing.", misflagAudit.cells);
        return { safes: [], mines: [], guesses: [], misflags: misflagAudit.cells };
    }

    // 2. الخطوة الثانية: إذا لم يوجد أي Misflag، يبدأ التحليل العادي فائق السرعة
    let activeNumbers = [], edgeCellsSet = new Set(), edgeCellsArray = [], allHiddenCells = [];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            let cell = board[r][c];
            if (!cell.isRevealed && !cell.isFlagged) allHiddenCells.push(cell);
            if (cell.isRevealed && cell.currentNumber > 0) {
                let neighbors = getNeighbors(r, c);
                let hiddenNeighbors = neighbors.filter(n => !n.isRevealed && !n.isFlagged);
                let flagsCount = neighbors.filter(n => n.isFlagged).length;

                if (hiddenNeighbors.length > 0) {
                    activeNumbers.push({
                        neededMines: cell.currentNumber - flagsCount,
                        hiddenNeighbors: hiddenNeighbors
                    });
                    hiddenNeighbors.forEach(hn => {
                        let key = `${hn.r},${hn.c}`;
                        if (!edgeCellsSet.has(key)) {
                            edgeCellsSet.add(key);
                            edgeCellsArray.push(hn);
                        }
                    });
                }
            }
        }
    }

    let isolatedCells = allHiddenCells.filter(c => !edgeCellsSet.has(`${c.r},${c.c}`));
    let isolatedCount = isolatedCells.length, globalTotalMines = totalMines - flagsPlaced;

    if (edgeCellsArray.length === 0 && isolatedCount === 0) return { safes: [], mines: [], guesses: [], misflags: [] };

    // استنتاج المعادلات السريع (Fast Subset & Overlap Elimination)
    let { eqSafes, eqMines } = runFastEquationSolver(activeNumbers);

    // في وضع Auto-Solver، إذا وجدنا حركات مؤكدة بالمعادلات السريعة نرجعها فوراً في 0ms!
    if (autoSolverMode && (eqSafes.size > 0 || eqMines.size > 0)) {
        let result = { safes: [], mines: [], guesses: [], misflags: [] };
        edgeCellsArray.forEach(cell => {
            let key = `${cell.r},${cell.c}`;
            if (eqSafes.has(key)) {
                if(showVisuals) cell.element.classList.add('ai-safe');
                result.safes.push(cell);
            } else if (eqMines.has(key)) {
                if(showVisuals) cell.element.classList.add('ai-mine');
                result.mines.push(cell);
            }
        });
        return result;
    }

    // تقليص الحافة قبل إرسالها للـ Worker:
    // الخلايا التي حُسمت في eqSafes و eqMines لا تدخل في الـ Backtracking! (تسريع هائل مع دقة 100%)
    let unresolvedEdgeCells = [];
    let unresolvedKeyToIdx = new Map();

    edgeCellsArray.forEach(cell => {
        let key = `${cell.r},${cell.c}`;
        if (!eqSafes.has(key) && !eqMines.has(key)) {
            unresolvedKeyToIdx.set(key, unresolvedEdgeCells.length);
            unresolvedEdgeCells.push(cell);
        }
    });

    let remainingMinesForWorker = globalTotalMines - eqMines.size;

    // إذا تم حل كل خلايا الحافة بالمعادلات السريعة، لا داعي لتشغيل الـ Worker أصلاً!
    if (unresolvedEdgeCells.length === 0) {
        let result = { safes: [], mines: [], guesses: [], misflags: [] };
        edgeCellsArray.forEach(cell => {
            let key = `${cell.r},${cell.c}`;
            if (eqSafes.has(key)) {
                if(showVisuals) cell.element.classList.add('ai-safe');
                result.safes.push(cell);
            } else if (eqMines.has(key)) {
                if(showVisuals) cell.element.classList.add('ai-mine');
                result.mines.push(cell);
            }
        });

        if (isolatedCount > 0 && remainingMinesForWorker >= 0) {
            let isoProb = Math.max(0, Math.min(100, (remainingMinesForWorker / isolatedCount) * 100));
            isolatedCells.forEach(cell => {
                if (isoProb === 0) {
                    if(showVisuals) cell.element.classList.add('ai-safe');
                    result.safes.push(cell);
                } else if (isoProb === 100) {
                    if(showVisuals) cell.element.classList.add('ai-mine');
                    result.mines.push(cell);
                } else {
                    result.guesses.push({ cell: cell, risk: isoProb });
                    if (showVisuals) {
                        let span = document.createElement('span'); span.className = 'prob-text'; span.innerText = `${Math.round(isoProb)}%`;
                        cell.element.appendChild(span);
                    }
                }
            });
            // تلوين أقل المربعات خطورة بالعلامة الصفراء طالما لا توجد مربعات آمنة 0%، حتى لو وُجدت ألغام غير مُعلّمة!
            if (result.safes.length === 0 && result.guesses.length > 0 && showVisuals) {
                let minIsoRisk = Math.min(...result.guesses.map(g => g.risk));
                result.guesses.forEach(g => { if (g.risk === minIsoRisk) g.cell.element.classList.add('ai-guess'); });
            }
        }
        return result;
    }

    // تجهيز بيانات الأرقام والخلايا المتبقية فقط للـ Worker
    let workerNums = [];
    let workerEdges = unresolvedEdgeCells.map(() => ({ links: [] }));

    activeNumbers.forEach(num => {
        let remHiddenIndices = [];
        let knownMinesAround = 0;
        num.hiddenNeighbors.forEach(hn => {
            let key = `${hn.r},${hn.c}`;
            if (eqMines.has(key)) knownMinesAround++;
            else if (!eqSafes.has(key)) remHiddenIndices.push(unresolvedKeyToIdx.get(key));
        });

        if (remHiddenIndices.length > 0) {
            let wNumIdx = workerNums.length;
            workerNums.push({
                needed: num.neededMines - knownMinesAround,
                totalHidden: remHiddenIndices.length
            });
            remHiddenIndices.forEach(eIdx => {
                workerEdges[eIdx].links.push(wNumIdx);
            });
        }
    });

    return new Promise((resolve) => {
        document.getElementById('loading-overlay').style.display = 'flex';
        document.getElementById('loading-text').innerText = 'Nodes: 0';

        activeWebWorker = new Worker(getSolverWorkerUrl());

        activeWebWorker.onmessage = function(e) {
            if (myAnalysisId !== analysisIdCounter) {
                resolve({ safes: [], mines: [], guesses: [], misflags: [] });
                return;
            }

            if (e.data.type === 'progress') {
                document.getElementById('loading-text').innerText = `Nodes: ${e.data.iters.toLocaleString()}`;
            } else if (e.data.type === 'done') {
                activeWebWorker.terminate();
                activeWebWorker = null;
                document.getElementById('loading-overlay').style.display = 'none';
                
                let result = { safes: [], mines: [], guesses: [], misflags: [] };
                let totalValidWeight = BigInt(e.data.totalValidWeight);
                
                if (totalValidWeight === 0n) { resolve(result); return; }

                // إضافة الخلايا المحسومة مسبقاً بالمعادلات
                edgeCellsArray.forEach(cell => {
                    let key = `${cell.r},${cell.c}`;
                    if (eqSafes.has(key)) {
                        if(showVisuals) cell.element.classList.add('ai-safe');
                        result.safes.push(cell);
                    } else if (eqMines.has(key)) {
                        if(showVisuals) cell.element.classList.add('ai-mine');
                        result.mines.push(cell);
                    }
                });

                let totalIsolatedMinesWeight = BigInt(e.data.totalIsolatedMinesWeight);
                let globalProb = isolatedCount > 0 ? Number((totalIsolatedMinesWeight * 10000n) / (totalValidWeight * BigInt(isolatedCount))) / 100 : null;
                let minRisk = 101;

                for (let i = 0; i < unresolvedEdgeCells.length; i++) {
                    let cell = unresolvedEdgeCells[i];
                    let weight = BigInt(e.data.edgeMinesWeight[i]);
                    let prob = Number((weight * 10000n) / totalValidWeight) / 100;
                    
                    if (weight === 0n) {
                        if(showVisuals) cell.element.classList.add('ai-safe');
                        result.safes.push(cell);
                    } else if (weight === totalValidWeight) {
                        if(showVisuals) cell.element.classList.add('ai-mine');
                        result.mines.push(cell);
                    } else {
                        result.guesses.push({cell: cell, risk: prob});
                        if(showVisuals) {
                            let span = document.createElement('span'); span.className = 'prob-text'; span.innerText = `${Math.round(prob)}%`;
                            cell.element.appendChild(span);
                        }
                        if (prob < minRisk && prob > 0) minRisk = prob;
                    }
                }

                if (globalProb !== null) {
                    isolatedCells.forEach(cell => {
                        if (totalIsolatedMinesWeight === 0n) {
                            if(showVisuals) cell.element.classList.add('ai-safe');
                            result.safes.push(cell);
                        } else if (totalIsolatedMinesWeight === totalValidWeight * BigInt(isolatedCount)) {
                            if(showVisuals) cell.element.classList.add('ai-mine');
                            result.mines.push(cell);
                        } else {
                            result.guesses.push({cell: cell, risk: globalProb});
                            if(showVisuals) {
                                let span = document.createElement('span'); span.className = 'prob-text'; span.innerText = `${Math.round(globalProb)}%`;
                                cell.element.appendChild(span);
                            }
                            if (globalProb < minRisk && globalProb > 0) minRisk = globalProb;
                        }
                    });
                }

                // إظهار العلامة الصفراء (ai-guess) على أقل المربعات خطورة طالما لا توجد مربعات آمنة 0%، حتى لو كان هناك ألغام غير معمول لها flag!
                if (result.safes.length === 0 && result.guesses.length > 0) {
                    if(showVisuals) result.guesses.forEach(g => { if(g.risk === minRisk) g.cell.element.classList.add('ai-guess'); });
                }

                resolve(result);
            }
        };
        activeWebWorker.postMessage({
            workerEdges,
            workerNums,
            globalTotalMines: remainingMinesForWorker,
            isolatedCount
        });
    });
}

// ============================================================================
// 🤖 MAX-EFFICIENCY HUMAN-STYLE AUTO-SOLVER ENGINE (H-ZiNi / Hybrid NF+Chord)
// ============================================================================

async function toggleAutoSolver() {
    let btn = document.getElementById('btn-auto');
    if(autoSolverTimer || activeWebWorker) {
        cancelAnyRunningAnalysis();
    } else {
        if(gameState !== 'playing' && isFirstClick) startNewGame(16, 30, 99);
        if(gameState === 'playing') {
            btn.innerText = "🛑 Stop Auto"; btn.style.animation = "pulse 2s infinite";
            runAutoSolverStep();
        }
    }
}

/**
 * تقييم بشري ذكي (Human Max-Eff Decision Engine):
 * يعتمد فقط على المعلومات المرئية والمستنتجة منطقياً (بدون غش أو النظر في isMine المخفية):
 * 1. إذا وُجد علم خاطئ (Misflag) وضعه المستخدم مسبقاً، يقوم بإزالته أولاً.
 * 2. Zero-Cost Chords: إذا كان هناك رقم مكتمل الأعلام بالفعل ويفتح خلايا آمنة -> الأولوية القصوى (تكلفة 1 ضغطة لفتح N خلايا).
 * 3. Multi-Chord & Flag Synergy Evaluation:
 *    - يحسب لكل رقم مكشوف: كم علماً ينقصه (neededFlags) وكم خلية آمنة سيفتحها (safeTargets).
 *    - يأخذ في الاعتبار "تآزر الأعلام" (Flag Synergy): إذا كان اللغم مشتركاً مع أرقام أخرى قابلة للـ Chord، فإن تكلفة العلم تُوزع وتُفضل الأعلام المشتركة.
 *    - لا يضع علماً أبداً إلا إذا كان جزءاً من Chord يوفّر ضغطات صافية (Reward > Cost)، أو يفتح سلسلة Chords متتالية.
 * 4. Opening / Cascade Heuristic (NF Style):
 *    - إذا لم يوجد Chord مربح، يختار البوت فتح خلية آمنة مباشرة (Reveal بدون أي Flag).
 *    - يفضل الخلية الآمنة التي لها أكبر احتمال أن تكون (0 / Opening) أو تكشف أكبر عدد من الخلايا المجاورة لتوليد Chords جديدة.
 */
function selectBestHumanMaxEffMove(analysis) {
    // إذا اكتشف المحرك وجود Misflag وضعه المستخدم قبل تشغيل الـ Auto-Solver، يقوم البوت بإزالة العلم الخاطئ أولاً!
    if (analysis.misflags && analysis.misflags.length > 0) {
        let badFlag = analysis.misflags[0];
        return { action: 'flag', r: badFlag.r, c: badFlag.c };
    }

    const safeSet = new Set(analysis.safes.map(c => `${c.r},${c.c}`));
    const mineSet = new Set(analysis.mines.map(c => `${c.r},${c.c}`));

    // حساب "أهمية كل لغم مكتشف" (Flag Synergy): كم رقماً مكشوفاً يمكنه الاستفادة من وضع علم على هذا اللغم
    let mineSynergy = new Map();
    let chordCandidates = [];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            let cell = board[r][c];
            if (!cell.isRevealed || cell.currentNumber <= 0) continue;

            let neighbors = getNeighbors(r, c);
            let hidden = [];
            let flagsCount = 0;

            for (let i = 0; i < neighbors.length; i++) {
                if (neighbors[i].isFlagged) flagsCount++;
                else if (!neighbors[i].isRevealed) hidden.push(neighbors[i]);
            }

            if (hidden.length === 0) continue;

            let unflaggedMines = [];
            let safeTargets = [];
            let unknownTargets = [];

            for (let i = 0; i < hidden.length; i++) {
                let h = hidden[i];
                let key = `${h.r},${h.c}`;
                if (mineSet.has(key)) unflaggedMines.push(h);
                else if (safeSet.has(key)) safeTargets.push(h);
                else unknownTargets.push(h);
            }

            // لكي يكون الرقم قابلاً للـ Chord الآن، يجب أن تكون كل ألغامه المتبقية معروفة
            if (flagsCount + unflaggedMines.length === cell.currentNumber) {
                // كل الخانات الأخرى حول هذا الرقم هي خلايا آمنة سيتم فتحها بالـ Chord
                let allReveals = safeTargets.concat(unknownTargets);
                if (allReveals.length > 0) {
                    unflaggedMines.forEach(m => {
                        let k = `${m.r},${m.c}`;
                        mineSynergy.set(k, (mineSynergy.get(k) || 0) + 1);
                    });

                    chordCandidates.push({
                        cell: cell,
                        unflaggedMines: unflaggedMines,
                        reveals: allReveals
                    });
                }
            }
        }
    }

    // 1. البحث عن أفضل Chord جاهز للتنفيذ الفوري (0 أعلام مطلوبة، تكلفة = 1 ضغطة فقط)
    let bestReadyChord = null;
    let bestReadyScore = -1;

    for (let i = 0; i < chordCandidates.length; i++) {
        let cand = chordCandidates[i];
        if (cand.unflaggedMines.length === 0 && cand.reveals.length >= 2) {
            let frontierGain = 0;
            cand.reveals.forEach(rv => {
                frontierGain += getNeighbors(rv.r, rv.c).filter(n => !n.isRevealed && !n.isFlagged).length;
            });
            let score = (cand.reveals.length * 100) + frontierGain;
            if (score > bestReadyScore) {
                bestReadyScore = score;
                bestReadyChord = cand;
            }
        }
    }

    if (bestReadyChord) {
        return { action: 'chord', r: bestReadyChord.cell.r, c: bestReadyChord.cell.c };
    }

    // 2. البحث عن أفضل خطة (Flag + Chord) توفر ضغطات فعلية (Net Clicks Saved > 0)
    // التكلفة = (عدد الأعلام المطلوبة + 1 ضغطة Chord)
    // المكسب = عدد الخلايا الآمنة التي ستُفتح بالـ Chord + مكافأة تآزر الأعلام المشتركة مع Chords أخرى
    let bestChordPlan = null;
    let bestPlanScore = -1;

    for (let i = 0; i < chordCandidates.length; i++) {
        let cand = chordCandidates[i];
        let flagsNeeded = cand.unflaggedMines.length;
        let cost = flagsNeeded + 1;
        let reward = cand.reveals.length;

        // حساب كم علماً من الأعلام المطلوبة سيخدم Chords أخرى جاهزة في نفس الوقت
        let sharedFlagsBonus = 0;
        cand.unflaggedMines.forEach(m => {
            let syn = mineSynergy.get(`${m.r},${m.c}`) || 1;
            if (syn > 1) sharedFlagsBonus += (syn - 1) * 0.65;
        });

        let effectiveProfit = (reward + sharedFlagsBonus) - cost;

        // شرط الكفاءة الصارم: يجب أن يوفر الـ Chord ضغطة صافية واحدة على الأقل (أو يربط سلسلة Chords مشتركة مربحة)
        if (reward > cost || (reward === cost && sharedFlagsBonus >= 0.65 && reward >= 2)) {
            let frontierPotential = 0;
            cand.reveals.forEach(rv => {
                frontierPotential += getNeighbors(rv.r, rv.c).filter(n => !n.isRevealed && !n.isFlagged).length;
            });

            let score = (effectiveProfit * 100) + (reward * 15) + frontierPotential;
            if (score > bestPlanScore) {
                bestPlanScore = score;
                bestChordPlan = cand;
            }
        }
    }

    if (bestChordPlan) {
        if (bestChordPlan.unflaggedMines.length > 0) {
            // إذا كان هناك أكثر من علم مطلوب، نضع العلم الأكثر تآزراً (Synergy) أولاً
            bestChordPlan.unflaggedMines.sort((a, b) => {
                return (mineSynergy.get(`${b.r},${b.c}`) || 0) - (mineSynergy.get(`${a.r},${a.c}`) || 0);
            });
            let targetMine = bestChordPlan.unflaggedMines[0];
            return { action: 'flag', r: targetMine.r, c: targetMine.c };
        } else {
            return { action: 'chord', r: bestChordPlan.cell.r, c: bestChordPlan.cell.c };
        }
    }

    // 3. إذا لم يوجد Chord يوفر ضغطات، نلعب بأسلوب NF (Direct Reveal) بدون إهدار أي أعلام!
    // نختار الخلية الآمنة التي تملك أعلى فرصة لأن تكون (0 / Opening) أو تفتح أكبر مساحة مجهولة
    if (analysis.safes.length > 0) {
        let bestSafe = analysis.safes[0];
        let bestSafeScore = -999999;

        analysis.safes.forEach(safeCell => {
            let neighbors = getNeighbors(safeCell.r, safeCell.c);
            let hiddenNeighbors = 0;
            let adjacentKnownMines = 0;
            let adjacentRevealedNums = 0;

            neighbors.forEach(n => {
                let k = `${n.r},${n.c}`;
                if (n.isFlagged || mineSet.has(k)) adjacentKnownMines++;
                else if (!n.isRevealed) hiddenNeighbors++;
                else if (n.currentNumber > 0) adjacentRevealedNums++;
            });

            // الخلية التي لا تجاور أي لغم معروف ولها جيران مخفيون كثر لها فرصة عالية جداً أن تكون '0' (Opening Cascade!)
            let openingBonus = (adjacentKnownMines === 0) ? 50 : -adjacentKnownMines * 12;
            let score = openingBonus + (hiddenNeighbors * 8) + (adjacentRevealedNums * 3);

            if (score > bestSafeScore) {
                bestSafeScore = score;
                bestSafe = safeCell;
            }
        });

        return { action: 'reveal', r: bestSafe.r, c: bestSafe.c };
    }

    // 4. في حالة الاضطرار للتخمين (No deterministic safe cells):
    // نختار الخلية ذات الخطر الأقل (أو القريبة جداً منه ضمن هامش 0.25%) مع تفضيل الزوايا والخلايا التي تفتح Openings
    if (analysis.guesses.length > 0) {
        let minRisk = 101;
        analysis.guesses.forEach(g => { if (g.risk < minRisk) minRisk = g.risk; });

        let topGuesses = analysis.guesses.filter(g => g.risk <= minRisk + 0.25);
        let bestGuess = topGuesses[0];
        let bestGuessScore = -999999;

        topGuesses.forEach(g => {
            let c = g.cell;
            let score = -g.risk * 100; // الأمان أولاً

            let isCorner = (c.r === 0 || c.r === rows - 1) && (c.c === 0 || c.c === cols - 1);
            let isEdge = (c.r === 0 || c.r === rows - 1 || c.c === 0 || c.c === cols - 1);
            if (isCorner) score += 25;
            else if (isEdge) score += 12;

            let neighbors = getNeighbors(c.r, c.c);
            let revealedNums = neighbors.filter(n => n.isRevealed && n.currentNumber > 0).length;
            score += revealedNums * 8;

            if (score > bestGuessScore) {
                bestGuessScore = score;
                bestGuess = g;
            }
        });

        return { action: 'reveal', r: bestGuess.cell.r, c: bestGuess.cell.c, isGuess: true };
    }

    return null;
}

async function runAutoSolverStep() {
    if(gameState !== 'playing') { cancelAnyRunningAnalysis(); return; }
    if(isFirstClick) {
        handleUserAction('reveal', Math.floor(rows/2), Math.floor(cols/2));
        autoSolverTimer = setTimeout(runAutoSolverStep, 80); return;
    }

    let currentBotTicket = analysisIdCounter + 1; 
    let analysis = await analyzeBoardAsync(true, true); 
    
    if(gameState !== 'playing' || currentBotTicket !== analysisIdCounter) return; 

    let move = selectBestHumanMaxEffMove(analysis);
    if (move) {
        handleUserAction(move.action, move.r, move.c);
        autoSolverTimer = setTimeout(runAutoSolverStep, move.isGuess ? 250 : 45);
        return;
    }

    cancelAnyRunningAnalysis();
}

async function startAnalysis() {
    if(autoSolverTimer || activeWebWorker) return; 
    let btn = document.getElementById('analyze-btn');
    btn.innerText = "Calculating..."; btn.disabled = true;
    await analyzeBoardAsync(true, false);
    btn.innerText = "🧠 Hint / Analyze"; btn.disabled = false;
}