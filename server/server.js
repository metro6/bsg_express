const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

const MAX_PLAYERS = 5;
let players = new Map();
const missionDifficulty = 5;
let turnOrder = [];
let activePlayerIndex = 0;
// States: WAITING_FOR_PLAYERS, MISSION_PHASE, CRISIS_PHASE
let gameState = 'WAITING_FOR_PLAYERS';

// Определения граней кубиков навыков
const blueFaces = [
    { value: -2, faceId: 'blue_-2' }, { value: -2, faceId: 'blue_-2' },
    { value: -1, faceId: 'blue_-1' }, { value: -1, faceId: 'blue_-1' },
    { value: +2, faceId: 'blue_+2' }, { value: +4, faceId: 'blue_+4' }
];
const redFaces = [
    { value: -2, faceId: 'red_-2' }, { value: -2, faceId: 'red_-2' },
    { value: -1, faceId: 'red_-1' }, { value: -1, faceId: 'red_-1' },
    { value: +1, faceId: 'red_+1' }, { value: +3, faceId: 'red_+3' }
];

// Определения граней 4-х разных кубиков кризисов (1: Беспорядки, 2: Атака, 3: DRADIS)
const crisisDiceDefinitions = {
    1: [1, 1, 2, 2, 3, 3], // Базовый
    2: [1, 1, 1, 2, 2, 3], // Много беспорядков
    3: [1, 2, 2, 2, 3, 3], // Много атак
    4: [1, 1, 2, 3, 3, 3]  // Много DRADIS
};

function getRandomFace(faces) {
    const randomIndex = Math.floor(Math.random() * faces.length);
    return faces[randomIndex];
}

console.log('WebSocket server запущен на ws://localhost:8080');

wss.on('connection', function connection(ws) {
    if (players.size >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Игра заполнена.' }));
        ws.close();
        return;
    }

    const playerId = players.size + 1;
    const playerName = `Игрок ${playerId}`;
    // Инициализация запасов кубиков для каждого игрока
    players.set(ws, {
        id: playerId,
        name: playerName,
        submittedDie: null, // Массив выставленных кубиков
        rolledDice: null, // Массив брошенных, но не выставленных кубиков
        activeDice: [{faceId: 'blue'}, {faceId: 'blue'}, {faceId: 'red'}, {faceId: 'red'}], // 2 синих, 2 красных в запасе (цвета)
        usedDice: [] // Использованные кубики (цвета)
    });
    turnOrder.push(ws); // Добавляем в порядок хода

    console.log(`Новый клиент подключился: ${playerName}`);

    ws.send(JSON.stringify({ type: 'INIT', playerId: playerId, playerName: playerName, playersCount: players.size }));
    broadcast({ type: 'PLAYER_JOINED', playerName: playerName, playersCount: players.size, activePlayer: players.get(turnOrder[activePlayerIndex])?.name }, ws);

    // При достижении 2х игроков, можно начать миссию для тестирования
    if (players.size === 2 && gameState === 'WAITING_FOR_PLAYERS') {
        startMissionPhase();
    }

    ws.on('message', function incoming(message) {
        const data = JSON.parse(message);
        const player = players.get(ws);

        // Проверяем, его ли сейчас ход (кроме общих действий типа Reveal/Crisis Roll)
        if (ws !== turnOrder[activePlayerIndex] && data.type !== 'REVEAL_DICE' && data.type !== 'ROLL_CRISIS_DICE') {
             ws.send(JSON.stringify({ type: 'STATUS', message: 'Сейчас не ваш ход.' }));
             return;
        }

        // Событие: игрок бросает все активные кубики
        if (data.type === 'PLAYER_ROLLS') {
            if (player.activeDice.length === 0) {
                ws.send(JSON.stringify({ type: 'STATUS', message: 'У вас нет активных кубиков для броска.' }));
                return;
            }

            player.rolledDice = player.activeDice.map(color =>
                color === 'blue' ? getRandomFace(blueFaces) : getRandomFace(redFaces)
            );
            // Очищаем активный запас, пока кубики не будут выставлены/сброшены
            player.activeDice = [];

            ws.send(JSON.stringify({
                type: 'SHOW_ROLL_CHOICES',
                choices: player.rolledDice
            }));
            broadcast({ type: 'STATUS', message: `${player.name} бросил свои кубики за ширмой.` }, ws);
        }

        // Событие: игрок выбирает кубик для выставления (обязательно выбрать хотя бы один после броска)
        if (data.type === 'PLAYER_SELECTS_DIE') {
            const selectionIndex = data.index;
            if (player.rolledDice && player.rolledDice[selectionIndex]) {
                const selectedDie = player.rolledDice.splice(selectionIndex, 1)[0]; // Извлекаем объект

                if (!player.submittedDie) player.submittedDie = [];
                player.submittedDie.push(selectedDie);

                // Отправляем игроку подтверждение (а следующий выбор придет через SHOW_ROLL_CHOICES, если нужно)
                ws.send(JSON.stringify({ type: 'ROLL_ACCEPTED' }));

                broadcast({ type: 'STATUS', message: `${player.name} выставил кубик на поле.` }, ws);

                // Если кубиков больше нет, ход автоматически передается следующему
                if (player.rolledDice.length === 0) {
                    moveToNextPlayer();
                } else {
                    // Если кубики остались, отправляем их обратно для выбора/паса
                    ws.send(JSON.stringify({
                        type: 'SHOW_ROLL_CHOICES',
                        choices: player.rolledDice
                    }));
                }

            } else {
                 ws.send(JSON.stringify({ type: 'ERROR', message: 'Неверный выбор кубика.' }));
            }
        }

        // Событие: игрок пасует (передает ход)
        if (data.type === 'PASS_TURN') {
            // Если игрок пасует, его оставшиеся брошенные кубики уходят в использованные
            if (player.rolledDice && player.rolledDice.length > 0) {
                player.usedDice.push(...player.rolledDice);
                player.rolledDice = null;
            }
            broadcast({ type: 'STATUS', message: `${player.name} пасует и передает ход.` });
            moveToNextPlayer();
        }

        // --- Общие действия ---
        if (data.type === 'REVEAL_DICE') {
            revealAndCalculateMission();
        }

        if (data.type === 'ROLL_CRISIS_DICE') {
            rollCrisisDice();
        }
    });

    ws.on('close', function close() {
        console.log(`Клиент отключился: ${players.get(ws)?.name}`);
        players.delete(ws);
        turnOrder = turnOrder.filter(client => client !== ws);
        broadcast({ type: 'PLAYER_LEFT', playersCount: players.size });
        if (turnOrder.length > 0) {
             moveToNextPlayer();
        }
    });
});

function broadcast(data, excludeWs = null) {
    wss.clients.forEach(function each(client) {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function startMissionPhase() {
    gameState = 'MISSION_PHASE';
    activePlayerIndex = 0;
    const activePlayerName = players.get(turnOrder[activePlayerIndex])?.name;
    broadcast({ type: 'GAME_STATE_CHANGE', state: 'MISSION_PHASE', activePlayer: activePlayerName });

    const firstPlayerState = players.get(turnOrder[activePlayerIndex]);
    turnOrder[activePlayerIndex].send(JSON.stringify({
        type: 'PLAYER_STATE_UPDATE',
        activeCount: firstPlayerState.activeDice.length,
        usedCount: firstPlayerState.usedDice.length,
        usedDiceList: firstPlayerState.usedDice // Отправляем список использованных
    }));
}

function moveToNextPlayer() {
    activePlayerIndex = (activePlayerIndex + 1) % turnOrder.length;
    const nextPlayerName = players.get(turnOrder[activePlayerIndex])?.name;
    broadcast({ type: 'NEXT_TURN', activePlayer: nextPlayerName });

    const nextPlayerWs = turnOrder[activePlayerIndex];
    const nextPlayerState = players.get(nextPlayerWs);

    nextPlayerWs.send(JSON.stringify({
        type: 'PLAYER_STATE_UPDATE',
        activeCount: nextPlayerState.activeDice.length,
        usedCount: nextPlayerState.usedDice.length,
        usedDiceList: nextPlayerState.usedDice // Отправляем список использованных
    }));
}

function revealAndCalculateMission() {
    let totalSum = 0;
    const results = [];

    players.forEach(player => {
        if (player.submittedDie) {
            player.submittedDie.forEach(die => {
                totalSum += die.value;
                results.push({ name: player.name, value: die.value, faceId: die.faceId });
            });
        }
    });

    // Перемещаем все выставленные кубики обратно в активные (упрощение логики возврата кубов после миссии)
    players.forEach(player => {
        if (player.submittedDie) {
             player.activeDice.push(...player.submittedDie);
             player.submittedDie = null;
        }
    });

    const outcome = totalSum >= missionDifficulty ? 'УСПЕХ' : 'ПРОВАЛ';
    broadcast({ type: 'MISSION_RESULT', totalSum: totalSum, outcome: outcome, results: results });
}

function rollCrisisDice() {
    // Исправленная строка:
    const availableDiceIds = [1, 2, 3, 4];
    const die1Index = Math.floor(Math.random() * availableDiceIds.length);
    const die1Id = availableDiceIds.splice(die1Index, 1);
    const die2Index = Math.floor(Math.random() * availableDiceIds.length);
    const die2Id = availableDiceIds[die2Index];

    const rollDie1FaceId = getRandomFace(crisisDiceDefinitions[die1Id]);
    const rollDie2FaceId = getRandomFace(crisisDiceDefinitions[die2Id]);

    const results = [`crysis_dice_${die1Id}_face_${rollDie1FaceId}`, `crysis_dice_${die2Id}_face_${rollDie2FaceId}`];
    broadcast({ type: 'CRISIS_ROLL_RESULT', results: results, message: `Брошены 2 из 4 кубиков кризисов.` });
}
