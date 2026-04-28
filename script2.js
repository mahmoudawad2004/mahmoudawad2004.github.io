let board = [], rows = 0, cols = 0, totalMines = 0, flagsPlaced = 0;
let isClassicTheme = false, isFirstClick = true, gameState = 'none', finalGameStatus = 'none'; 
let gameHistory = [], currentHistoryIndex = 0;
let timerInterval, secondsElapsed = 0;

let total3BV = 0, solved3BV = new Set(), totalClicks = 0;
let hzini = 0, zini = 0, maxEff = 0;
let autoSolverTimer = null;
let isPastedAndAnalyzed = false; 

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
                while (q.length > 0) {
                    let curr = q.shift();
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
}

async function pasteAndPlay() {
    try {
        const text = await navigator.clipboard.readText();
        if(parsePastedData(text)) {
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
        if(parsePastedData(text)) {
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

function parsePastedData(dataString) {
    try {
        let gameData = JSON.parse(dataString);
        rows = gameData.r; cols = gameData.c; totalMines = gameData.m || 99;
        board = []; flagsPlaced = 0;
        for (let r = 0; r < rows; r++) {
            let row = [];
            for (let c = 0; c < cols; c++) row.push({ isMine: false, isRevealed: false, isFlagged: false, isFalseFlag: false, tempPasteValue: 'C', currentNumber: 0, compId:-1, r: r, c: c });
            board.push(row);
        }
        gameData.data.forEach(cell => {
            let bCell = board[cell.r][cell.c]; bCell.tempPasteValue = cell.v;
            if (cell.v === 'M' || cell.v === 'F') bCell.isMine = true;
            else if(cell.v !== 'C') bCell.originalValue = cell.v;
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
    document.querySelectorAll('.ai-safe, .ai-mine, .ai-guess').forEach(el => {
        el.classList.remove('ai-safe', 'ai-mine', 'ai-guess');
    });
}

// 🟢 الخادم الخلفي المزود بتقنية فصل المكونات (Component Splitting) لدقة 100% بدون تجميد
const solverWorkerCode = `
function getCombinations(n, k) {
    if (k < 0 || k > n) return 0n;
    if (k === 0 || k === n) return 1n;
    if (k > n / 2) k = n - k;
    let res = 1n, bigN = BigInt(n), bigK = BigInt(k);
    for (let i = 1n; i <= bigK; i++) { res = (res * bigN) / i; bigN--; }
    return res;
}

self.onmessage = function(e) {
    const { workerEdges, workerNums, globalTotalMines, isolatedCount } = e.data;
    
    // 1. بناء مسارات المكونات المنفصلة (Component Splitting)
    let adj = new Array(workerEdges.length).fill(0).map(()=>[]);
    for(let i=0; i<workerEdges.length; i++) {
        for(let j=i+1; j<workerEdges.length; j++) {
            let sharedNum = workerEdges[i].links.some(num => workerEdges[j].links.includes(num));
            if(sharedNum) { adj[i].push(j); adj[j].push(i); }
        }
    }

    let visited = new Array(workerEdges.length).fill(false);
    let components = [];
    
    for(let i=0; i<workerEdges.length; i++) {
        if(!visited[i]) {
            let comp = [];
            let q = [i];
            visited[i] = true;
            while(q.length > 0) {
                let curr = q.shift();
                comp.push(curr);
                adj[curr].forEach(n => {
                    if(!visited[n]) { visited[n] = true; q.push(n); }
                });
            }
            components.push(comp);
        }
    }

    // 2. تحليل كل مكون بمعزل عن الآخر
    let compDistributions = []; 
    let iterations = 0;

    for(let c=0; c<components.length; c++) {
        let compEdges = components[c];
        let distMap = new Map(); // minCount -> total valid ways

        // لتسجيل مرات ظهور اللغم في كل خلية لكل عدد ألغام
        let compEdgeStats = new Array(compEdges.length).fill(0).map(() => new Map());

        function solveComp(idx, currentMines) {
            iterations++;
            if (iterations % 50000 === 0) self.postMessage({ type: 'progress', iters: iterations });

            if (idx === compEdges.length) {
                let valid = true;
                // التأكد من أن الأرقام المرتبطة بهذا المكون مكتملة
                let involvedNums = new Set();
                compEdges.forEach(eIdx => workerEdges[eIdx].links.forEach(l => involvedNums.add(l)));
                
                for (let numIdx of involvedNums) {
                    if (workerNums[numIdx].needed !== workerNums[numIdx].assigned) { valid = false; break; }
                }

                if (valid) {
                    distMap.set(currentMines, (distMap.get(currentMines) || 0n) + 1n);
                    for(let i=0; i<compEdges.length; i++) {
                        if(workerEdges[compEdges[i]].tempIsMine) {
                            let cellMap = compEdgeStats[i];
                            cellMap.set(currentMines, (cellMap.get(currentMines) || 0n) + 1n);
                        }
                    }
                }
                return;
            }

            let eIdx = compEdges[idx];
            let edge = workerEdges[eIdx];
            
            let canBeMine = true;
            for (let i=0; i<edge.links.length; i++) {
                let num = workerNums[edge.links[i]];
                if (num.assigned + 1 > num.needed) { canBeMine = false; break; }
            }

            if (canBeMine) {
                edge.tempIsMine = true;
                for (let i=0; i<edge.links.length; i++) workerNums[edge.links[i]].assigned++;
                solveComp(idx + 1, currentMines + 1);
                for (let i=0; i<edge.links.length; i++) workerNums[edge.links[i]].assigned--;
                edge.tempIsMine = false;
            }

            let canBeSafe = true;
            for (let i=0; i<edge.links.length; i++) {
                let num = workerNums[edge.links[i]];
                let rem = num.totalHidden - (num.assigned + num.safe) - 1;
                if (num.assigned + rem < num.needed) { canBeSafe = false; break; }
            }

            if (canBeSafe) {
                for (let i=0; i<edge.links.length; i++) workerNums[edge.links[i]].safe++;
                solveComp(idx + 1, currentMines);
                for (let i=0; i<edge.links.length; i++) workerNums[edge.links[i]].safe--;
            }
        }

        solveComp(0, 0);
        compDistributions.push({ ways: distMap, stats: compEdgeStats, edgeIndices: compEdges });
    }

    // 3. دمج المكونات (Dynamic Programming / Convolution)
    let dp = new Map(); // total mines -> total ways
    dp.set(0, 1n);

    for (let c = 0; c < compDistributions.length; c++) {
        let currentDist = compDistributions[c].ways;
        let newDp = new Map();

        for (let [dpMines, dpWays] of dp.entries()) {
            for (let [compMines, compWays] of currentDist.entries()) {
                let totalMines = dpMines + compMines;
                if (totalMines <= globalTotalMines) {
                    newDp.set(totalMines, (newDp.get(totalMines) || 0n) + (dpWays * compWays));
                }
            }
        }
        dp = newDp;
    }

    // 4. دمج المربعات المعزولة وحساب الوزن النهائي
    let totalValidWeight = 0n;
    let dpFinal = new Map(); // mines in ALL edges -> valid combinations

    for (let [dpMines, dpWays] of dp.entries()) {
        let isoMines = globalTotalMines - dpMines;
        if (isoMines >= 0 && isoMines <= isolatedCount) {
            let w = dpWays * getCombinations(isolatedCount, isoMines);
            totalValidWeight += w;
            dpFinal.set(dpMines, w);
        }
    }

    // 5. استخراج الاحتمالات النهائية الدقيقة لكل خلية
    let edgeMinesWeight = new Array(workerEdges.length).fill(0n);
    let totalIsolatedMinesWeight = 0n;

    if (totalValidWeight > 0n) {
        // حساب المربعات المعزولة
        for (let [dpMines, w] of dpFinal.entries()) {
            let isoMines = globalTotalMines - dpMines;
            totalIsolatedMinesWeight += w * BigInt(isoMines);
        }

        // حساب خلايا الحافة
        for (let c = 0; c < compDistributions.length; c++) {
            let comp = compDistributions[c];
            
            // حساب توافيق باقي المكونات + المربعات المعزولة
            let otherDp = new Map();
            otherDp.set(0, 1n);
            for(let i=0; i<compDistributions.length; i++) {
                if(i===c) continue;
                let nDp = new Map();
                for(let [m1, w1] of otherDp.entries()) {
                    for(let [m2, w2] of compDistributions[i].ways.entries()) {
                        if(m1+m2 <= globalTotalMines) nDp.set(m1+m2, (nDp.get(m1+m2)||0n) + (w1*w2));
                    }
                }
                otherDp = nDp;
            }

            for(let i=0; i<comp.edgeIndices.length; i++) {
                let eIdx = comp.edgeIndices[i];
                let cellStats = comp.stats[i];
                let cellTotalWeight = 0n;

                for(let [cellMinesUsed, cellWays] of cellStats.entries()) {
                    for(let [otherMines, otherWays] of otherDp.entries()) {
                        let totalEdgeMines = cellMinesUsed + otherMines;
                        let isoMines = globalTotalMines - totalEdgeMines;
                        if(isoMines >= 0 && isoMines <= isolatedCount) {
                            cellTotalWeight += cellWays * otherWays * getCombinations(isolatedCount, isoMines);
                        }
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

async function analyzeBoardAsync(showVisuals = true, autoSolverMode = false) {
    analysisIdCounter++;
    let myAnalysisId = analysisIdCounter; 

    clearAnalysisUI();
    if (board.length === 0) return { safes: [], mines: [], guesses: [] };

    let wrongFlagsDetected = false;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (board[r][c].isFlagged && !board[r][c].isMine) {
                if(showVisuals) {
                    board[r][c].element.classList.add('ai-mine');
                    let span = document.createElement('span'); span.className = 'prob-text'; span.innerText = '❌';
                    board[r][c].element.appendChild(span);
                }
                wrongFlagsDetected = true;
            }
        }
    }
    if (wrongFlagsDetected) {
        console.warn("AI Solver: Incorrect flags detected.");
        return { safes: [], mines: [], guesses: [] };
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
                    activeNumbers.push({ neededMines: cell.currentNumber - flagsCount, currentMinesAssigned: 0, hiddenNeighbors: hiddenNeighbors, hiddenAssignedToSafe: 0 });
                    hiddenNeighbors.forEach(hn => {
                        let key = `${hn.r},${hn.c}`;
                        if (!edgeCellsSet.has(key)) {
                            edgeCellsSet.add(key); hn.tempIsMine = false; hn.relevantNumbers = []; edgeCellsArray.push(hn);
                        }
                    });
                }
            }
        }
    }

    let isolatedCells = allHiddenCells.filter(c => !edgeCellsSet.has(`${c.r},${c.c}`));
    let isolatedCount = isolatedCells.length, globalTotalMines = totalMines - flagsPlaced;

    edgeCellsArray.forEach(edge => {
        activeNumbers.forEach(num => {
            if (num.hiddenNeighbors.some(n => n.r === edge.r && n.c === edge.c)) edge.relevantNumbers.push(num);
        });
    });

    let equations = activeNumbers.map(n => ({ cells: n.hiddenNeighbors.map(c => `${c.r},${c.c}`), mines: n.neededMines }));
    let eqSafes = new Set(), eqMines = new Set(), changed = true, iter = 0;
    while(changed && iter < 100) {
        changed = false; iter++;
        for(let i=0; i<equations.length; i++) {
            let eq = equations[i];
            if (eq.cells.length === 0) continue;
            if (eq.mines === 0) { eq.cells.forEach(c => eqSafes.add(c)); eq.cells = []; changed = true; } 
            else if (eq.mines === eq.cells.length) { eq.cells.forEach(c => eqMines.add(c)); eq.cells = []; changed = true; }
        }

        for(let i=0; i<equations.length; i++) {
            for(let j=0; j<equations.length; j++) {
                if (i===j) continue;
                let eqA = equations[i], eqB = equations[j];
                if (eqA.cells.length === 0 || eqB.cells.length === 0) continue;
                if (eqA.cells.length < eqB.cells.length && eqA.cells.every(c => eqB.cells.includes(c))) {
                    let newCells = eqB.cells.filter(c => !eqA.cells.includes(c));
                    let newMines = eqB.mines - eqA.mines;
                    let exists = equations.some(e => e.mines === newMines && e.cells.length === newCells.length && e.cells.every(c => newCells.includes(c)));
                    if (!exists) { equations.push({cells: newCells, mines: newMines}); changed = true; }
                }
            }
        }
        for(let i=0; i<equations.length; i++) {
            let eq = equations[i], origLen = eq.cells.length, newCells = [], removedMines = 0;
            eq.cells.forEach(c => {
                if (eqMines.has(c)) removedMines++;
                else if (!eqSafes.has(c)) newCells.push(c);
            });
            if (newCells.length < origLen) { eq.cells = newCells; eq.mines -= removedMines; changed = true; }
        }
    }

    if (autoSolverMode && (eqSafes.size > 0 || eqMines.size > 0)) {
        let result = { safes: [], mines: [], guesses: [] };
        edgeCellsArray.forEach(cell => {
            let key = `${cell.r},${cell.c}`;
            if (eqSafes.has(key)) result.safes.push(cell);
            else if (eqMines.has(key)) result.mines.push(cell);
        });
        return result;
    }

    if (edgeCellsArray.length === 0 && isolatedCount === 0) return { safes: [], mines: [], guesses: [] };

    let workerNums = activeNumbers.map(n => ({ needed: n.neededMines, assigned: 0, safe: 0, totalHidden: n.hiddenNeighbors.length }));
    let workerEdges = edgeCellsArray.map(e => ({ tempIsMine: false, links: e.relevantNumbers.map(rn => activeNumbers.indexOf(rn)) }));

    return new Promise((resolve) => {
        document.getElementById('loading-overlay').style.display = 'flex';
        document.getElementById('loading-text').innerText = 'Nodes: 0';

        const blob = new Blob([solverWorkerCode], {type: 'application/javascript'});
        activeWebWorker = new Worker(URL.createObjectURL(blob));

        activeWebWorker.onmessage = function(e) {
            if (myAnalysisId !== analysisIdCounter) {
                resolve({ safes: [], mines: [], guesses: [] });
                return;
            }

            if (e.data.type === 'progress') {
                document.getElementById('loading-text').innerText = `Nodes: ${e.data.iters.toLocaleString()}`;
            } else if (e.data.type === 'done') {
                document.getElementById('loading-overlay').style.display = 'none';
                let result = { safes: [], mines: [], guesses: [] };
                let totalValidWeight = BigInt(e.data.totalValidWeight);
                
                if (totalValidWeight === 0n) { resolve(result); return; }

                let totalIsolatedMinesWeight = BigInt(e.data.totalIsolatedMinesWeight);
                let globalProb = isolatedCount > 0 ? Number((totalIsolatedMinesWeight * 10000n) / (totalValidWeight * BigInt(isolatedCount))) / 100 : null;
                let minRisk = 101;

                for (let i = 0; i < edgeCellsArray.length; i++) {
                    let cell = edgeCellsArray[i];
                    let prob = Number((BigInt(e.data.edgeMinesWeight[i]) * 10000n) / totalValidWeight) / 100;
                    if (prob === 0) {
                        if(showVisuals) cell.element.classList.add('ai-safe');
                        result.safes.push(cell);
                    } else if (prob === 100) {
                        if(showVisuals) cell.element.classList.add('ai-mine');
                        result.mines.push(cell);
                    } else {
                        result.guesses.push({cell: cell, risk: prob});
                        if(showVisuals) {
                            let span = document.createElement('span'); span.className = 'prob-text'; span.innerText = `${Math.round(prob)}%`;
                            cell.element.appendChild(span);
                        }
                    }
                    if (prob < minRisk && prob > 0) minRisk = prob;
                }

                if (globalProb !== null) {
                    isolatedCells.forEach(cell => {
                        result.guesses.push({cell: cell, risk: globalProb});
                        if(showVisuals) {
                            let span = document.createElement('span'); span.className = 'prob-text'; span.innerText = `${Math.round(globalProb)}%`;
                            cell.element.appendChild(span);
                        }
                        if (globalProb < minRisk && globalProb > 0) minRisk = globalProb;
                    });
                }

                if (result.safes.length === 0 && result.mines.length === 0 && result.guesses.length > 0) {
                    if(showVisuals) result.guesses.forEach(g => { if(g.risk === minRisk) g.cell.element.classList.add('ai-guess'); });
                }

                resolve(result);
            }
        };
        activeWebWorker.postMessage({ workerEdges, workerNums, globalTotalMines, isolatedCount });
    });
}

// --- 🤖 MAX EFFICIENCY AUTO-SOLVER ENGINE 🤖 ---
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

async function runAutoSolverStep() {
    if(gameState !== 'playing') { cancelAnyRunningAnalysis(); return; }
    if(isFirstClick) {
        handleUserAction('reveal', Math.floor(rows/2), Math.floor(cols/2));
        autoSolverTimer = setTimeout(runAutoSolverStep, 100); return;
    }

    let currentBotTicket = analysisIdCounter + 1; 
    let analysis = await analyzeBoardAsync(true, true); 
    
    if(gameState !== 'playing' || currentBotTicket !== analysisIdCounter) return; 
    
    let bestChord = null; let maxProfit = 0; 
    for(let r=0; r<rows; r++) {
        for(let c=0; c<cols; c++) {
            let cell = board[r][c];
            if(cell.isRevealed && cell.currentNumber > 0) {
                let neighbors = getNeighbors(r, c);
                let flagsCount = neighbors.filter(n => n.isFlagged).length;
                let unflaggedKnownMines = neighbors.filter(n => !n.isRevealed && !n.isFlagged && analysis.mines.includes(n));
                let safeToReveal = neighbors.filter(n => !n.isRevealed && !n.isFlagged && analysis.safes.includes(n));

                if(flagsCount + unflaggedKnownMines.length === cell.currentNumber && safeToReveal.length > 0) {
                    let cost = unflaggedKnownMines.length + 1; 
                    let reward = safeToReveal.length; 
                    if (cost < reward) {
                        let profit = reward - cost;
                        if (profit > maxProfit) {
                            maxProfit = profit;
                            bestChord = { r: r, c: c, needsFlags: unflaggedKnownMines.length > 0, flagTarget: unflaggedKnownMines.length > 0 ? unflaggedKnownMines[0] : null };
                        }
                    }
                }
            }
        }
    }

    if (bestChord) {
        if (bestChord.needsFlags) handleUserAction('flag', bestChord.flagTarget.r, bestChord.flagTarget.c);
        else handleUserAction('chord', bestChord.r, bestChord.c);
        autoSolverTimer = setTimeout(runAutoSolverStep, 50); return;
    }

    if (analysis.safes.length > 0) {
        let bestSafe = analysis.safes[0]; let maxHidden = -1;
        analysis.safes.forEach(safeCell => {
            let hidden = getNeighbors(safeCell.r, safeCell.c).filter(n => !n.isRevealed && !n.isFlagged).length;
            if(hidden > maxHidden) { maxHidden = hidden; bestSafe = safeCell; }
        });
        handleUserAction('reveal', bestSafe.r, bestSafe.c);
        autoSolverTimer = setTimeout(runAutoSolverStep, 50); return;
    }

    if (analysis.guesses.length > 0) {
        let minRisk = 101;
        analysis.guesses.forEach(g => { if(g.risk < minRisk) minRisk = g.risk; });
        let bestGuesses = analysis.guesses.filter(g => g.risk === minRisk);
        let bestGuess = bestGuesses[0]; let bestScore = 999;
        
        bestGuesses.forEach(g => {
            let score = 0;
            if((g.cell.r===0 && g.cell.c===0) || (g.cell.r===0 && g.cell.c===cols-1) || (g.cell.r===rows-1 && g.cell.c===0) || (g.cell.r===rows-1 && g.cell.c===cols-1)) score -= 10;
            else if(g.cell.r===0 || g.cell.r===rows-1 || g.cell.c===0 || g.cell.c===cols-1) score -= 5;
            if(score < bestScore) { bestScore = score; bestGuess = g; }
        });
        handleUserAction('reveal', bestGuess.cell.r, bestGuess.cell.c);
        autoSolverTimer = setTimeout(runAutoSolverStep, 400); return;
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