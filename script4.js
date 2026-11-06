let board = [], rows = 0, cols = 0, totalMines = 0, flagsPlaced = 0;
let isClassicTheme = false, isFirstClick = true, gameState = 'none', finalGameStatus = 'none'; 
let gameHistory = [], currentHistoryIndex = 0;
let timerInterval, secondsElapsed = 0;

let total3BV = 0, solved3BV = new Set(), totalClicks = 0;
let hzini = 0, zini = 0, maxEff = 0;
let autoSolverTimer = null;
let isPastedAndAnalyzed = false; 
let boardHasKnownMines = true;

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

function applyAnalyzedBoardFromJSON(jsonString) {
    if (parsePastedData(jsonString, true)) {
        isPastedAndAnalyzed = true; 
        isFirstClick = false;
        initBoardUI(true); 
        calculate3BVandSafeEfficiency();
        board.forEach(row => row.forEach(cell => {
            if (cell.tempPasteValue === 'F') {
                handleLogic('flag', cell.r, cell.c, false);
            } else if (cell.tempPasteValue === 'M') {
                cell.isRevealed = true;
                cell.isMine = true;
                cell.causedLoss = true;
                updateCellVisuals(cell);
            } else if (cell.tempPasteValue !== 'C') {
                cell.isRevealed = true;
                cell.currentNumber = parseInt(cell.tempPasteValue);
                if (cell.compId !== -1) solved3BV.add(cell.compId);
                updateCellVisuals(cell);
            }
        }));
        updateStatsUI();
        stopTimer();
        startAnalysis();
        return true;
    }
    return false;
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
        // 1. نفحص أولاً ما إذا كان هناك صورة منسوخة في الـ Clipboard
        if (navigator.clipboard && navigator.clipboard.read) {
            try {
                const items = await navigator.clipboard.read();
                for (let item of items) {
                    const imageType = item.types.find(t => t.startsWith('image/'));
                    if (imageType) {
                        const blob = await item.getType(imageType);
                        await processScreenshotBlob(blob);
                        return;
                    }
                }
            } catch (imgErr) {
                // نكمل لفحص النص إذا لم تنجح قراءة الصورة
            }
        }

        // 2. فحص النص في الحافظة (سواء كان JSON أو رابط صورة URL)
        const text = (await navigator.clipboard.readText() || '').trim();
        if (text.startsWith('{')) {
            applyAnalyzedBoardFromJSON(text);
        } else if (/^https?:\/\/.+/i.test(text)) {
            await loadAndAnalyzeScreenshotUrl(text);
        } else {
            alert("الحافظة لا تحتوي على كود JSON أو صورة أو رابط صورة صالح!");
        }
    } catch (err) {
        alert("تعذر الوصول إلى الحافظة. يمكنك الضغط على Ctrl+V مباشرة في الصفحة.");
    }
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
const solverWorkerCode = `
self.onmessage = function(e) {
    const { workerEdges, workerNums, globalTotalMines, isolatedCount } = e.data;
    const numEdges = workerEdges.length;

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

    let compDistributions = [];
    let iterations = 0;

    let numAssigned = new Int32Array(workerNums.length);
    let numRemHidden = new Int32Array(workerNums.length);
    let numNeeded = new Int32Array(workerNums.length);
    for (let i = 0; i < workerNums.length; i++) {
        numNeeded[i] = workerNums[i].needed;
        numRemHidden[i] = workerNums[i].totalHidden;
    }

    let edgeState = new Int8Array(numEdges);

    for (let c = 0; c < components.length; c++) {
        let rawComp = components[c];

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
        
        let waysArr = new Array(maxCompMines + 1).fill(0n);
        let statsArr = new Array(compLen);
        for (let i = 0; i < compLen; i++) {
            statsArr[i] = new Array(maxCompMines + 1).fill(0n);
        }

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

                    if (assigned > needed || assigned + rem < needed) return -1;

                    if (rem > 0) {
                        if (assigned === needed) {
                            const nEdges = numToEdges[nIdx];
                            for (let j = 0; j < nEdges.length; j++) {
                                const nbE = nEdges[j];
                                if (edgeState[nbE] === 0) {
                                    assignCell(nbE, 1);
                                    propQueue.push(nbE);
                                }
                            }
                        } else if (assigned + rem === needed) {
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

            if (currentMines + 1 <= maxCompMines) {
                assignCell(eIdx, 2);
                const forcedMines = propagate(eIdx, currentMines + 1);
                if (forcedMines !== -1) {
                    solveComp(idx + 1, currentMines + 1 + forcedMines);
                }
                undoTo(savedPtr);
            }

            assignCell(eIdx, 1);
            const forcedMines2 = propagate(eIdx, currentMines);
            if (forcedMines2 !== -1) {
                solveComp(idx + 1, currentMines + forcedMines2);
            }
            undoTo(savedPtr);
        }

        solveComp(0, 0);

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

            let otherDp = new Map();
            for (let [m1, w1] of pref.entries()) {
                for (let [m2, w2] of suff.entries()) {
                    const tot = m1 + m2;
                    if (tot <= globalTotalMines) {
                        otherDp.set(tot, (otherDp.get(tot) || 0n) + (w1 * w2));
                    }
                }
            }

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

    for (let s of eqSafes) {
        if (eqMines.has(s)) contradiction = true;
    }

    return { eqSafes, eqMines, contradiction };
}

async function detectMisflagsAsync(myAnalysisId) {
    let confirmedMisflags = new Set();
    let suspectMisflags = new Set();

    let currentFlags = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (board[r][c].isFlagged) {
                currentFlags.push(board[r][c]);
                if (boardHasKnownMines && !board[r][c].isMine) {
                    confirmedMisflags.add(`${r},${c}`);
                }
            }
        }
    }

    if (currentFlags.length === 0) return { hasMisflags: false };

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
                let unrevealedNeighbors = neighbors.filter(n => !n.isRevealed);
                let flaggedNeighbors = neighbors.filter(n => n.isFlagged);

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

    let rawEqResult = runFastEquationSolver(rawNumbers);
    currentFlags.forEach(flagCell => {
        let key = `${flagCell.r},${flagCell.c}`;
        if (rawEqResult.eqSafes.has(key)) {
            confirmedMisflags.add(key);
        }
    });

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

    let { eqSafes, eqMines } = runFastEquationSolver(activeNumbers);

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
            if (result.safes.length === 0 && result.guesses.length > 0 && showVisuals) {
                let minIsoRisk = Math.min(...result.guesses.map(g => g.risk));
                result.guesses.forEach(g => { if (g.risk === minIsoRisk) g.cell.element.classList.add('ai-guess'); });
            }
        }
        return result;
    }

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

function selectBestHumanMaxEffMove(analysis) {
    if (analysis.misflags && analysis.misflags.length > 0) {
        let badFlag = analysis.misflags[0];
        return { action: 'flag', r: badFlag.r, c: badFlag.c };
    }

    const safeSet = new Set(analysis.safes.map(c => `${c.r},${c.c}`));
    const mineSet = new Set(analysis.mines.map(c => `${c.r},${c.c}`));

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

            if (flagsCount + unflaggedMines.length === cell.currentNumber) {
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

    let bestChordPlan = null;
    let bestPlanScore = -1;

    for (let i = 0; i < chordCandidates.length; i++) {
        let cand = chordCandidates[i];
        let flagsNeeded = cand.unflaggedMines.length;
        let cost = flagsNeeded + 1;
        let reward = cand.reveals.length;

        let sharedFlagsBonus = 0;
        cand.unflaggedMines.forEach(m => {
            let syn = mineSynergy.get(`${m.r},${m.c}`) || 1;
            if (syn > 1) sharedFlagsBonus += (syn - 1) * 0.65;
        });

        let effectiveProfit = (reward + sharedFlagsBonus) - cost;

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
            bestChordPlan.unflaggedMines.sort((a, b) => {
                return (mineSynergy.get(`${b.r},${b.c}`) || 0) - (mineSynergy.get(`${a.r},${a.c}`) || 0);
            });
            let targetMine = bestChordPlan.unflaggedMines[0];
            return { action: 'flag', r: targetMine.r, c: targetMine.c };
        } else {
            return { action: 'chord', r: bestChordPlan.cell.r, c: bestChordPlan.cell.c };
        }
    }

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

            let openingBonus = (adjacentKnownMines === 0) ? 50 : -adjacentKnownMines * 12;
            let score = openingBonus + (hiddenNeighbors * 8) + (adjacentRevealedNums * 3);

            if (score > bestSafeScore) {
                bestSafeScore = score;
                bestSafe = safeCell;
            }
        });

        return { action: 'reveal', r: bestSafe.r, c: bestSafe.c };
    }

    if (analysis.guesses.length > 0) {
        let minRisk = 101;
        analysis.guesses.forEach(g => { if (g.risk < minRisk) minRisk = g.risk; });

        let topGuesses = analysis.guesses.filter(g => g.risk <= minRisk + 0.25);
        let bestGuess = topGuesses[0];
        let bestGuessScore = -999999;

        topGuesses.forEach(g => {
            let c = g.cell;
            let score = -g.risk * 100;

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

// ============================================================================
// 📷 PIXEL-PERFECT SCREENSHOT & URL TO BOARD JSON PARSER (minesweeper.online)
// ============================================================================

// استماع للحدث Ctrl+V في أي مكان في الصفحة (يدعم لصق صورة مباشرة، أو رابط صورة، أو JSON)
window.addEventListener('paste', async (e) => {
    const clipboardData = e.clipboardData || e.originalEvent.clipboardData;
    if (!clipboardData) return;

    const items = clipboardData.items;
    if (items) {
        for (let item of items) {
            if (item.type.indexOf('image') === 0) {
                e.preventDefault();
                const blob = item.getAsFile();
                await processScreenshotBlob(blob, "");
                return;
            }
        }
    }

    const text = (clipboardData.getData('text') || '').trim();
    if (text.startsWith('{')) {
        e.preventDefault();
        applyAnalyzedBoardFromJSON(text);
    } else if (/^https?:\/\/.+/i.test(text)) {
        e.preventDefault();
        await loadAndAnalyzeScreenshotUrl(text);
    }
});

async function promptScreenshotUrlOrFile() {
    // نسأل المستخدم إذا كان يريد إدخال رابط صورة مباشرة، أو تركه فارغاً لاختيار ملف صورة من الجهاز
    let inputUrl = prompt("ضع رابط صورة الـ Screenshot هنا (مثال: https://minesweeper.online/screen/...png)\nأو اتركه فارغاً واضغط OK لاختيار ملف صورة من جهازك:", "");
    if (inputUrl && inputUrl.trim() !== "") {
        await loadAndAnalyzeScreenshotUrl(inputUrl.trim());
    } else if (inputUrl !== null) {
        const fileInput = document.getElementById('screenshot-input');
        if (fileInput) fileInput.click();
    }
}

async function loadAndAnalyzeScreenshotUrl(imageUrl) {
    document.getElementById('loading-overlay').style.display = 'flex';
    document.getElementById('loading-text').innerText = 'Loading Screenshot...';

    // لتفادي حظر CORS عند جلب الصورة من minesweeper.online، نستخدم مسارات Proxy احتياطية
    const proxyUrls = [
        `https://wsrv.nl/?url=${encodeURIComponent(imageUrl)}&output=png`,
        `https://corsproxy.io/?${encodeURIComponent(imageUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(imageUrl)}`,
        imageUrl
    ];

    for (let pUrl of proxyUrls) {
        try {
            const response = await fetch(pUrl);
            if (!response.ok) continue;
            const blob = await response.blob();
            if (blob && blob.size > 100) {
                document.getElementById('loading-overlay').style.display = 'none';
                await processScreenshotBlob(blob, imageUrl);
                return;
            }
        } catch (err) {
            // نجرب الـ Proxy التالي
        }
    }

    document.getElementById('loading-overlay').style.display = 'none';
    alert("تعذر تحميل الصورة من الرابط مباشرة بسبب حماية المتصفح (CORS).\nافتح رابط الصورة في المتصفح، اضغط كليك يمين (Copy Image)، ثم اضغط Ctrl+V هنا!");
}

async function handleScreenshotFile(event) {
    const file = event.target.files[0];
    if (file) {
        await processScreenshotBlob(file, file.name || "");
        event.target.value = '';
    }
}

async function processScreenshotBlob(blob, sourceHint = "") {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
        URL.revokeObjectURL(url);
        const parsedJson = parseMinesweeperImageToJSON(img, sourceHint);
        if (parsedJson) {
            applyAnalyzedBoardFromJSON(parsedJson);
        }
    };
    img.src = url;
}

/**
 * المحلل الهندسي الدقيق للقطات minesweeper.online:
 * في ثيمات minesweeper.online (سواء Classic أو HD بأي حجم S مثل 24, 32, 36, 48):
 * - عرض الإطار الجانبي الأيسر والأيمن = (9 / 16) * S بالضبط! (مثلاً عند S=36 يكون الإطار 20.25px أي 20px، وعند S=16 يكون 9px)
 * - ارتفاع الهيدر العلوي بالكامل حتى بداية أول صف في الشبكة = (55 / 16) * S بالضبط! (مثلاً عند S=36 يكون startY = 124px)
 * - ارتفاع الإطار السفلي = (9 / 16) * S بالضبط!
 */
function parseMinesweeperImageToJSON(img, sourceHint = "") {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const W = img.width, H = img.height;
    canvas.width = W; canvas.height = H;
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, W, H).data;

    function getRGB(x, y) {
        x = Math.max(0, Math.min(W - 1, Math.round(x)));
        y = Math.max(0, Math.min(H - 1, Math.round(y)));
        const idx = (y * W + x) * 4;
        return [imgData[idx], imgData[idx + 1], imgData[idx + 2]];
    }

    // استخراج حجم المربع S من اسم الملف أو الرابط إن وُجد (مثال: 6794552634-hd-36-19893.png -> S = 36)
    let urlSizeMatch = sourceHint.match(/-(?:hd|classic|xp|night)-(\d+)-/i);
    let hintCellSize = urlSizeMatch ? parseInt(urlSizeMatch[1]) : 0;

    let geometry = detectExactMinesweeperGrid(imgData, W, H, hintCellSize);
    if (!geometry) {
        alert("تعذر تحديد أبعاد الشبكة من الصورة. تأكد من نسخ صورة اللوحة الأصلية بجودتها الكاملة.");
        return null;
    }

    const { startX, startY, cellW, cellH, cols: detectedCols, rows: detectedRows, hasHeader } = geometry;
    let cells = [];
    let flagsDetected = 0;

    for (let r = 0; r < detectedRows; r++) {
        for (let c = 0; c < detectedCols; c++) {
            const x0 = startX + c * cellW;
            const y0 = startY + r * cellH;
            const val = classifyCellPixelsAccurate(getRGB, x0, y0, cellW, cellH);
            if (val === 'F') flagsDetected++;
            cells.push({ r, c, v: val });
        }
    }

    // محاولة قراءة عداد الألغام المتبقية من شاشة الـ LED الحمراء في أعلى يسار الصورة (إن وُجد الهيدر)
    let remainingMinesLED = hasHeader ? readMinesCounterLED(getRGB, cellW) : null;
    let tm = null;

    if (remainingMinesLED !== null && remainingMinesLED >= 0) {
        tm = flagsDetected + remainingMinesLED;
    } else if (detectedRows === 9 && detectedCols === 9) {
        tm = 10;
    } else if (detectedRows === 16 && detectedCols === 16) {
        tm = 40;
    } else if (detectedRows === 16 && detectedCols === 30) {
        tm = 99;
    } else if (detectedRows === 20 && detectedCols === 30) {
        tm = 130;
    } else {
        let userMines = prompt(`تم التعرف على لوحة بحجم ${detectedCols}x${detectedRows} (الأعلام المكتشفة: ${flagsDetected}).\nأدخل إجمالي عدد الألغام في اللوحة:`, "99");
        if (userMines === null || userMines.trim() === "") return null;
        tm = parseInt(userMines) || 99;
    }

    return JSON.stringify({
        r: detectedRows,
        c: detectedCols,
        m: tm,
        data: cells
    });
}

function detectExactMinesweeperGrid(data, W, H, hintS = 0) {
    // في لقطات شاشة minesweeper.online الرسمية:
    // W = cols * S + 2 * (9/16) * S = (cols + 1.125) * S
    // H = rows * S + (55/16) * S + (9/16) * S = (rows + 4.0) * S
    let candidateSizes = [];
    if (hintS >= 12) candidateSizes.push(hintS);
    // أحجام المربعات القياسية في minesweeper.online
    [16, 20, 24, 28, 30, 32, 36, 40, 42, 48, 50, 60, 64].forEach(s => {
        if (!candidateSizes.includes(s)) candidateSizes.push(s);
    });

    // 1. فحص التطابق المباشر مع النسب القياسية لصور minesweeper.online (مع الهيدر العلوي)
    for (let S of candidateSizes) {
        let exactCols = (W / S) - 1.125;
        let exactRows = (H / S) - 4.0;
        let roundCols = Math.round(exactCols);
        let roundRows = Math.round(exactRows);

        if (roundCols >= 5 && roundRows >= 5 && Math.abs(exactCols - roundCols) < 0.12 && Math.abs(exactRows - roundRows) < 0.15) {
            let startX = Math.round((W - roundCols * S) / 2);
            let borderBottom = startX;
            let startY = H - borderBottom - (roundRows * S);

            // ضبط دقيق بالبكسل لنقطة البداية (Fine Alignment) بالبحث عن خط الشبكة الفعلي
            let refined = refineGridOrigin(data, W, H, startX, startY, S, roundCols, roundRows);
            return {
                startX: refined.startX,
                startY: refined.startY,
                cellW: S,
                cellH: S,
                cols: roundCols,
                rows: roundRows,
                hasHeader: true
            };
        }
    }

    // 2. فحص ما إذا كانت الصورة مقصوصة على منطقة الشبكة فقط بدون الهيدر
    for (let S of candidateSizes) {
        let exactCols = W / S;
        let exactRows = H / S;
        let roundCols = Math.round(exactCols);
        let roundRows = Math.round(exactRows);
        if (roundCols >= 5 && roundRows >= 5 && Math.abs(exactCols - roundCols) < 0.08 && Math.abs(exactRows - roundRows) < 0.08) {
            return {
                startX: 0,
                startY: 0,
                cellW: W / roundCols,
                cellH: H / roundRows,
                cols: roundCols,
                rows: roundRows,
                hasHeader: false
            };
        }
    }

    // 3. اكتشاف عام لأي لقطة شاشة (Snipping Tool) عبر إيجاد تردد خطوط الشبكة الرأسية والأفقية
    let scanY0 = Math.floor(H * 0.25), scanY1 = Math.floor(H * 0.90);
    let scanX0 = Math.floor(W * 0.05), scanX1 = Math.floor(W * 0.95);

    let vProfile = new Float64Array(W);
    for (let x = 1; x < W; x++) {
        let sum = 0;
        for (let y = scanY0; y < scanY1; y += 2) {
            let i = (y * W + x) * 4;
            // خطوط الشبكة في الكلاسيك تكون رمادية داكنة ~ (128,128,128) أو بيضاء ~ (255,255,255)
            let r = data[i], g = data[i+1], b = data[i+2];
            let pr = data[i-4], pg = data[i-3], pb = data[i-2];
            sum += Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb);
        }
        vProfile[x] = sum;
    }

    let bestS = 36, bestScore = -1;
    for (let S = 16; S <= 64; S++) {
        for (let phase = 0; phase < S; phase++) {
            let score = 0, cnt = 0;
            for (let x = scanX0 + phase; x < scanX1; x += S) {
                score += vProfile[x];
                cnt++;
            }
            if (cnt > 4 && (score / cnt) > bestScore) {
                bestScore = score / cnt;
                bestS = S;
            }
        }
    }

    let estCols = Math.max(5, Math.round((W - 1.125 * bestS) / bestS));
    let estRows = Math.max(5, Math.round((H - 4.0 * bestS) / bestS));
    let startX = Math.round((W - estCols * bestS) / 2);
    let startY = H - startX - (estRows * bestS);
    if (startY < 0) {
        estRows = Math.round(H / bestS);
        startX = 0; startY = 0;
    }
    let refined = refineGridOrigin(data, W, H, startX, startY, bestS, estCols, estRows);
    return {
        startX: refined.startX,
        startY: refined.startY,
        cellW: bestS,
        cellH: bestS,
        cols: estCols,
        rows: estRows,
        hasHeader: startY > bestS * 2
    };
}

/**
 * ضبط نقطة بداية الشبكة (startX, startY) بدقة 1 بكسل عن طريق تعظيم التطابق مع حدود الخلايا
 */
function refineGridOrigin(data, W, H, baseStartX, baseStartY, S, cols, rows) {
    let bestX = baseStartX, bestXScore = -1;
    for (let dx = -4; dx <= 4; dx++) {
        let tx = baseStartX + dx;
        if (tx < 0 || tx + cols * S > W) continue;
        let score = 0;
        for (let c = 0; c <= cols; c++) {
            let x = tx + c * S;
            if (x <= 0 || x >= W) continue;
            for (let r = 0; r < rows; r += 2) {
                let y = baseStartY + r * S + Math.floor(S * 0.5);
                if (y < 0 || y >= H) continue;
                let idx = (y * W + x) * 4;
                // عند الحد الفاصل بين خليتين، يكون هناك خط رمادي داكن (128) أو انتقال حاد إلى الأبيض (255)
                let diff = Math.abs(data[idx] - data[idx - 4]) + Math.abs(data[idx] - 128);
                if (data[idx] <= 145 || Math.abs(data[idx] - data[idx - 4]) > 45) score++;
            }
        }
        if (score > bestXScore) {
            bestXScore = score;
            bestX = tx;
        }
    }

    let bestY = baseStartY, bestYScore = -1;
    for (let dy = -4; dy <= 4; dy++) {
        let ty = baseStartY + dy;
        if (ty < 0 || ty + rows * S > H) continue;
        let score = 0;
        for (let r = 0; r <= rows; r++) {
            let y = ty + r * S;
            if (y <= 0 || y >= H) continue;
            for (let c = 0; c < cols; c += 2) {
                let x = bestX + c * S + Math.floor(S * 0.5);
                if (x < 0 || x >= W) continue;
                let idx = (y * W + x) * 4;
                let idxUp = ((y - 1) * W + x) * 4;
                if (data[idx] <= 145 || Math.abs(data[idx] - data[idxUp]) > 45) score++;
            }
        }
        if (score > bestYScore) {
            bestYScore = score;
            bestY = ty;
        }
    }

    return { startX: bestX, startY: bestY };
}

/**
 * قراءة عداد الألغام المتبقية (7-Segment Red LED Counter) من أعلى يسار الصورة
 */
function readMinesCounterLED(getRGB, S) {
    try {
        // في ثيم minesweeper.online، يقع صندوق عداد الألغام عند:
        // X من (15/16)*S إلى (54/16)*S، و Y من (15/16)*S إلى (38/16)*S
        const boxX = (15.5 / 16) * S;
        const boxY = (15.5 / 16) * S;
        const boxW = (39 / 16) * S;
        const boxH = (23 / 16) * S;

        // فحص أن الصندوق أسود فعلاً (خلفية شاشة الـ LED)
        let bgSample = getRGB(boxX + 2, boxY + 2);
        if (bgSample[0] > 80 || bgSample[1] > 60 || bgSample[2] > 60) return null;

        const digitW = boxW / 3;
        let digitsStr = "";

        for (let d = 0; d < 3; d++) {
            const dx = boxX + d * digitW;
            const dy = boxY;

            // دالة مساعدة لفحص هل القطعة (Segment) مضاءة باللون الأحمر الساطع
            function isSegLit(rx, ry) {
                let lit = 0;
                for (let oy = -1; oy <= 1; oy++) {
                    for (let ox = -1; ox <= 1; ox++) {
                        let [r, g, b] = getRGB(dx + digitW * rx + ox, dy + boxH * ry + oy);
                        if (r > 165 && g < 60 && b < 60) lit++;
                    }
                }
                return lit >= 2;
            }

            const segA = isSegLit(0.50, 0.14); // أعلى
            const segB = isSegLit(0.80, 0.30); // يمين أعلى
            const segC = isSegLit(0.80, 0.70); // يمين أسفل
            const segD = isSegLit(0.50, 0.86); // أسفل
            const segE = isSegLit(0.20, 0.70); // يسار أسفل
            const segF = isSegLit(0.20, 0.30); // يسار أعلى
            const segG = isSegLit(0.50, 0.50); // وسط

            const mask = (segA ? 64 : 0) | (segB ? 32 : 0) | (segC ? 16 : 0) |
                         (segD ? 8 : 0)  | (segE ? 4 : 0)  | (segF ? 2 : 0)  | (segG ? 1 : 0);

            const map7Seg = {
                0b1111110: '0',
                0b0110000: '1',
                0b1101101: '2',
                0b1111001: '3',
                0b0110011: '4',
                0b1011011: '5',
                0b1011111: '6',
                0b1110000: '7',
                0b1111111: '8',
                0b1111011: '9',
                0b0000001: '-'
            };

            if (map7Seg[mask] !== undefined) {
                digitsStr += map7Seg[mask];
            } else {
                return null;
            }
        }

        let parsed = parseInt(digitsStr, 10);
        return isNaN(parsed) ? null : parsed;
    } catch (e) {
        return null;
    }
}

/**
 * المصنف البصري الدقيق لكل خلية (يدعم جميع أحجام الـ HD والكلاسيك بدون خلط بين C و 0 و F والأرقام)
 */
function classifyCellPixelsAccurate(getRGB, x0, y0, cellW, cellH) {
    // 1. فحص ما إذا كانت الخلية مغلقة (Raised 3D Bevel) أم مفتوحة (Flat):
    // في الخلية المغلقة (C أو F)، الشريط العلوي (من 5% إلى 10% من الارتفاع) والشريط الأيسر يكونان أبيض ناصع (> 240)
    // بينما الشريط السفلي والأيمن يكونان رمادي غامق (< 150).
    let whiteBevelCount = 0;
    let bevelSamples = 0;
    const bevelThickness = Math.max(2, Math.floor(cellW * 0.08));

    for (let t = Math.floor(cellW * 0.25); t <= Math.floor(cellW * 0.75); t += 2) {
        bevelSamples++;
        let [rt, gt, bt] = getRGB(x0 + t, y0 + bevelThickness);
        let [rl, gl, bl] = getRGB(x0 + bevelThickness, y0 + t);
        if (rt > 235 && gt > 235 && bt > 235 && rl > 235 && gl > 235 && bl > 235) {
            whiteBevelCount++;
        }
    }

    const isRaisedButton = (whiteBevelCount >= bevelSamples * 0.65);

    // 2. مسح منطقة الرقم / الأيقونة داخل الخلية (من 22% إلى 78%)
    let redCount = 0, greenCount = 0, blueCount = 0, darkBlueCount = 0;
    let maroonCount = 0, cyanCount = 0, blackCount = 0, darkGrayCount = 0;
    let totalSamples = 0;

    const startX = Math.floor(x0 + cellW * 0.22);
    const endX = Math.ceil(x0 + cellW * 0.78);
    const startY = Math.floor(y0 + cellH * 0.20);
    const endY = Math.ceil(y0 + cellH * 0.80);

    for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
            totalSamples++;
            const [r, g, b] = getRGB(x, y);
            const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
            const sat = maxC - minC;

            // الخلفية الرمادية القياسية للمربعات ~ (189, 189, 189) إلى (198, 198, 198)
            if (sat < 20) {
                if (r < 65) blackCount++;
                else if (r >= 105 && r <= 145) darkGrayCount++;
                continue;
            }

            // تصنيف الألوان القياسية للأرقام والأعلام
            if (b > 175 && r < 80 && g < 110) {
                blueCount++;      // 1: Blue (0, 0, 255)
            } else if (g > 95 && r < 70 && b < 70) {
                greenCount++;     // 2: Green (0, 128, 0)
            } else if (r > 175 && g < 75 && b < 75) {
                redCount++;       // 3: Red (255, 0, 0) or Flag triangle
            } else if (b > 90 && b <= 175 && r < 60 && g < 65) {
                darkBlueCount++;  // 4: Dark Blue (0, 0, 128)
            } else if (r > 90 && r <= 175 && g < 55 && b < 55) {
                maroonCount++;    // 5: Maroon (128, 0, 0)
            } else if (g > 90 && b > 90 && r < 65) {
                cyanCount++;      // 6: Cyan / Teal (0, 128, 128)
            }
        }
    }

    // 3. إذا كانت الخلية بارزة (Raised 3D Button): فهي إما مغلقة 'C' أو علم 'F'
    if (isRaisedButton) {
        // العلم يحتوي على راية حمراء واضحة مع عمود/قاعدة سوداء
        if (redCount >= totalSamples * 0.025 && blackCount >= totalSamples * 0.015) {
            return 'F';
        }
        return 'C';
    }

    // 4. الخلية مفتوحة (Flat):
    // إذا كانت خلفية الخلية نفسها حمراء بالكامل (لغم منفجر Red Mine) أو سوداء كثيفة (Mine)
    if (redCount > totalSamples * 0.45 && blackCount > totalSamples * 0.08) {
        return 'M';
    }
    if (blackCount > totalSamples * 0.24) {
        return 'M';
    }

    const minColorPixels = Math.max(3, totalSamples * 0.025);
    const numberCandidates = [
        { val: '1', count: blueCount },
        { val: '2', count: greenCount },
        { val: '3', count: redCount },
        { val: '4', count: darkBlueCount },
        { val: '5', count: maroonCount },
        { val: '6', count: cyanCount },
        { val: '7', count: blackCount }
    ];

    numberCandidates.sort((a, b) => b.count - a.count);

    if (numberCandidates[0].count >= minColorPixels) {
        return numberCandidates[0].val;
    }

    // الرقم 8 لونه رمادي داكن (128, 128, 128) في وسط الخلية
    if (darkGrayCount >= totalSamples * 0.09) {
        return '8';
    }

    // إذا لم يكن بها أي رقم أو بروز، فهي خلية مفتوحة فارغة '0'
    return '0';
}