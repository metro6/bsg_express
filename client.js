const socket = new WebSocket('ws://localhost:8080');
const elements = {
    connectionStatus: document.getElementById('connection-status'),
    playerName: document.getElementById('player-name'),
    playersCount: document.getElementById('players-count'),
    rollDiceButton: document.getElementById('roll-dice-button'),
    passTurnButton: document.getElementById('pass-turn-button'),
    revealButton: document.getElementById('reveal-button'),
    choiceArea: document.getElementById('choice-area'),
    choicesList: document.getElementById('choices-list'),
    missionResultsArea: document.getElementById('mission-results-area'),
    turnStatus: document.getElementById('turn-status'),
    activePlayerName: document.getElementById('active-player-name'),
    activeDiceCount: document.getElementById('active-dice-count'),
    usedDiceCount: document.getElementById('used-dice-count'),
    usedDiceDisplay: document.getElementById('used-dice-display'),
    gameLog: document.getElementById('game-log'),
    crisisDie1Img: document.getElementById('crisis-die-1'),
    crisisDie2Img: document.getElementById('crisis-die-2')
};

let myPlayerName = 'N/A';

function logMessage(message) {
    const p = document.createElement('p');
    p.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    elements.gameLog.appendChild(p);
    elements.gameLog.scrollTop = elements.gameLog.scrollHeight;
}

function createDieImageHtml(faceId, value, index = null) {
    const imgSrc = `images/${faceId}.jpg`;
    const imgHtml = `<img src="${imgSrc}" class="dice-image" alt="Die ${value}">`;

    if (index !== null) {
        return `<button class="die-choice-btn" onclick="selectDie(${index})">${imgHtml}<br>${value}</button>`;
    }
    return imgHtml;
}

// Функция для отображения использованных кубиков
function updateUsedDiceDisplay(usedDiceList) {
    elements.usedDiceDisplay.innerHTML = 'Использованы: ';
    usedDiceList.forEach(die => {
        // ИСПРАВЛЕНИЕ: Доступ к faceId из объекта кубика
        const color = die.faceId.startsWith('blue') ? '#42a5f5' : '#ef5350';
        const icon = document.createElement('span');
        icon.className = 'used-die-icon';
        icon.style.backgroundColor = color;
        elements.usedDiceDisplay.appendChild(icon);
    });
}

function updateTurnStatus(activePlayerName) {
    elements.activePlayerName.textContent = activePlayerName;
    if (activePlayerName === myPlayerName) {
        elements.turnStatus.className = 'status-message active';
        elements.rollDiceButton.disabled = false;
        elements.passTurnButton.disabled = false;
    } else {
        elements.turnStatus.className = 'status-message waiting';
        elements.rollDiceButton.disabled = true;
        elements.passTurnButton.disabled = true;
    }
}

socket.addEventListener('open', () => {
    elements.connectionStatus.textContent = 'Подключено';
    elements.connectionStatus.style.color = 'green';
    logMessage('Установлено соединение.');
});

socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
        case 'INIT':
            myPlayerName = data.playerName;
            elements.playerName.textContent = myPlayerName;
            elements.playersCount.textContent = data.playersCount;
            break;
        case 'PLAYER_JOINED':
        case 'PLAYER_LEFT':
            elements.playersCount.textContent = data.playersCount;
            logMessage(data.playerName ? `${data.playerName} присоединился/отключился.` : `Игрок отключился.`);
            break;
        case 'NEXT_TURN':
             updateTurnStatus(data.activePlayer);
             logMessage(`Ход перешел к ${data.activePlayer}.`);
             break;
        case 'PLAYER_STATE_UPDATE':
            elements.activeDiceCount.textContent = data.activeCount;
            elements.usedDiceCount.textContent = data.usedCount;
            updateUsedDiceDisplay(data.usedDiceList); // Обновляем список использованных кубиков
            break;
        case 'GAME_STATE_CHANGE':
            updateTurnStatus(data.activePlayer);
            logMessage(`Началась фаза: ${data.state}`);
            break;
        case 'ERROR':
            logMessage(`ОШИБКА: ${data.message}`);
            break;
        case 'STATUS':
            logMessage(`СТАТУС: ${data.message}`);
            break;

        case 'SHOW_ROLL_CHOICES':
            elements.choiceArea.style.display = 'block';
            elements.choicesList.innerHTML = '';
            data.choices.forEach((choice, index) => {
                elements.choicesList.innerHTML += createDieImageHtml(choice.faceId, choice.value, index);
            });
            elements.rollDiceButton.disabled = true;
            elements.passTurnButton.disabled = false;
            break;

        case 'ROLL_ACCEPTED':
            logMessage('Ваш кубик принят сервером (скрыто).');
            // choiceArea не скрывается здесь, так как могут быть еще кубики для выбора (повторный бросок)
            break;

        case 'MISSION_RESULT':
            logMessage(`*** МИССИЯ: ${data.outcome} (Сумма: ${data.totalSum}) ***`);
            elements.missionResultsArea.innerHTML = '<h3>Внесенные кубики:</h3>';
            data.results.forEach(res => {
                const p = document.createElement('p');
                p.innerHTML = `${res.name} внес: ${createDieImageHtml(res.faceId, res.value)}`;
                elements.missionResultsArea.appendChild(p);
            });
            elements.choiceArea.style.display = 'none';
            break;

        case 'CRISIS_ROLL_RESULT':
             elements.crisisDie1Img.src = `images/${data.results[0]}.jpg`;
            elements.crisisDie2Img.src = `images/${data.results[0]}.jpg`;
            elements.crisisDie1Img.style.display = 'inline-block';
            elements.crisisDie2Img.style.display = 'inline-block';
            logMessage(`Отображены результаты: ${data.results.join(', ')}`);
            break;
    }
});

socket.addEventListener('close', () => {
    elements.connectionStatus.textContent = 'Отключено';
    elements.connectionStatus.style.color = 'red';
    logMessage('Соединение с сервером потеряно.');
});

function playerRollsDice() {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'PLAYER_ROLLS' }));
    }
}

function selectDie(index) {
     if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'PLAYER_SELECTS_DIE', index: index }));
    }
}

function passTurn() {
     if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'PASS_TURN' }));
    }
}

function revealDice() {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'REVEAL_DICE' }));
    }
}

function rollCrisis() {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'ROLL_CRISIS_DICE' }));
    }
}
