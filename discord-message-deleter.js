// Конфигурация
const CONFIG = {
    RETRY_ATTEMPTS: 5,
    INITIAL_RETRY_DELAY: 250,
    MIN_DELAY: 100,
    MAX_DELAY: 5000,
    BATCH_SIZE: 100,
    DELAY_MULTIPLIER: 1.5,
    DELAY_DECREASE: 0.9
};

// Состояние приложения
const STATE = {
    isRunning: true,
    totalDeleted: 0,
    totalProcessed: 0,
    authToken: null,
    currentDelay: CONFIG.INITIAL_RETRY_DELAY,
    consecutiveSuccesses: 0,
    consecutiveFailures: 0,
    channelId: null,
    currentUserId: null
};

// Валидация токена
function validateToken(token) {
    if (!token || typeof token !== 'string' || token.length < 50) {
        throw new Error('Недействительный токен. Убедитесь, что скопировали его правильно.');
    }
    return token;
}

// Проверка прав доступа и информации о канале
async function checkPermissions() {
    try {
        console.log('checkPermissions: Начало');
        const channelMatch = window.location.href.match(/channels\/(\d+)\/(\d+)/);
        if (!channelMatch) {
            console.error('checkPermissions: Не удалось определить ID канала из URL.');
            STATE.channelId = prompt('Введите ID текстового канала:');
        } else {
            STATE.channelId = channelMatch[2];
        }
        if (!STATE.channelId) throw new Error('ID канала не предоставлен.');

        console.log(`checkPermissions: Используется ID канала: ${STATE.channelId}`);

        const response = await fetch(`https://discord.com/api/v10/channels/${STATE.channelId}`, { headers: { Authorization: STATE.authToken } });
        if (!response.ok) {
            console.error('checkPermissions: Ошибка ответа:', response.status, response.statusText);
            if (response.status === 401) throw new Error('401 Unauthorized: Неверный токен.');
            if (response.status === 403) throw new Error(`Нет доступа к каналу ${STATE.channelId}.`);
            if (response.status === 404) throw new Error(`Канал ${STATE.channelId} не найден.`);
            throw new Error(`Ошибка получения информации о канале: ${response.status}`);
        }

        const channelData = await response.json();
        console.log('checkPermissions: Данные канала:', channelData);
        if (![0, 1, 3].includes(channelData.type)) {
            throw new Error(`Канал ${STATE.channelId} не текстовый (тип: ${channelData.type}).`);
        }

        const userResponse = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: STATE.authToken } });
        if (!userResponse.ok) throw new Error('Не удалось получить данные пользователя.');
        const userData = await userResponse.json();
        STATE.currentUserId = userData.id;
        console.log(`checkPermissions: Пользователь: ${userData.username} (ID: ${STATE.currentUserId})`);

        console.log('checkPermissions: Успешно завершена.');
        return true;
    } catch (error) {
        console.error('checkPermissions: Ошибка:', error);
        updateUI(`Ошибка: ${error.message}`);
        return false;
    }
}

// Инициализация
async function initialize() {
    try {
        console.log('initialize: Начало...');
        STATE.authToken = validateToken(prompt('Введите Discord токен:'));
        console.log('initialize: Токен получен:', STATE.authToken ? 'Yes' : 'No');
        createUI();
        if (!(await checkPermissions())) throw new Error('Ошибка проверки прав.');
        updateUI('Инициализация завершена. Начинаем удаление...');
        console.log('initialize: Успешно.');
        return true;
    } catch (error) {
        console.error('initialize: Ошибка:', error);
        updateUI(`Ошибка инициализации: ${error.message}`);
        throw error;
    }
}

// Создание UI
function createUI() {
    let container = document.getElementById('discord-message-deleter-ui');
    if (!container) {
        container = document.createElement('div');
        container.id = 'discord-message-deleter-ui';
        container.style.cssText = `position: fixed; top: 20px; right: 20px; background: rgba(0,0,0,0.9); color: white; padding: 15px; border-radius: 8px; font-family: Arial; z-index: 10000; max-width: 400px; word-wrap: break-word;`;
        container.innerHTML = `
            <h3 style="margin-top: 0; color: #7289da;">Удаление сообщений</h3>
            <div id="progress">Удалено: 0 сообщений</div>
            <div id="status" style="margin-bottom: 10px;">Статус: Запуск...</div>
            <button id="pauseBtn" style="background-color: #7289da; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer;">Пауза</button>
            <button id="stopBtn" style="background-color: #f04747; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; margin-left: 5px;">Остановить</button>
        `;
        document.body.appendChild(container);
        document.getElementById('pauseBtn').addEventListener('click', togglePause);
        document.getElementById('stopBtn').addEventListener('click', stopScript);
    } else {
        updateUI(STATE.isRunning ? 'Работает' : 'На паузе');
        document.getElementById('pauseBtn').textContent = STATE.isRunning ? 'Пауза' : 'Продолжить';
    }
}

// Обновление UI
function updateUI(message) {
    const progress = document.getElementById('progress');
    const status = document.getElementById('status');
    if (progress) progress.textContent = `Удалено: ${STATE.totalDeleted} сообщений (задержка: ${Math.round(STATE.currentDelay)}мс)`;
    if (status) status.textContent = `Статус: ${message}`;
}

// Управление паузой
function togglePause() {
    STATE.isRunning = !STATE.isRunning;
    document.getElementById('pauseBtn').textContent = STATE.isRunning ? 'Пауза' : 'Продолжить';
    updateUI(STATE.isRunning ? 'Работает...' : 'На паузе');
    console.log(`Скрипт ${STATE.isRunning ? 'продолжен' : 'приостановлен'}.`);
}

// Остановка скрипта
function stopScript() {
    STATE.isRunning = false;
    updateUI('Остановка...');
    console.log('Остановка запрошена.');
    setTimeout(() => {
        const uiContainer = document.getElementById('discord-message-deleter-ui');
        if (uiContainer) uiContainer.remove();
        console.log('UI удалён. Скрипт остановлен.');
    }, 2000);
}

// Задержка
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Адаптивная задержка
function adjustDelay(success) {
    if (success) {
        STATE.consecutiveSuccesses++;
        STATE.consecutiveFailures = 0;
        STATE.currentDelay = Math.max(CONFIG.MIN_DELAY, STATE.currentDelay * CONFIG.DELAY_DECREASE);
    } else {
        STATE.consecutiveFailures++;
        STATE.consecutiveSuccesses = 0;
        STATE.currentDelay = Math.min(CONFIG.MAX_DELAY, STATE.currentDelay * CONFIG.DELAY_MULTIPLIER);
    }
    updateUI(STATE.isRunning ? 'Работает...' : 'На паузе');
    return STATE.currentDelay;
}

// Загрузка сообщений
async function fetchMessagesWithRetry(url, options, retries = CONFIG.RETRY_ATTEMPTS) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.status === 429) {
                const retryAfter = parseInt(response.headers.get('Retry-After')) || STATE.currentDelay;
                console.warn(`Rate limit hit, retrying after ${retryAfter}ms.`);
                updateUI(`Rate Limit: ожидание ${retryAfter}ms...`);
                await delay(retryAfter);
                adjustDelay(false);
                continue;
            }
            if (!response.ok) {
                if (response.status === 401) throw new Error('401 Unauthorized: Неверный токен.');
                if (response.status === 403) throw new Error('403 Forbidden: Нет прав на чтение канала.');
                if (response.status === 404) throw new Error('404 Not Found: Канал не существует.');
                throw new Error(`Ошибка загрузки: ${response.status}`);
            }
            adjustDelay(true);
            return response.json();
        } catch (error) {
            lastError = error;
            console.warn(`Attempt ${i + 1}/${retries} failed: ${error.message}`);
            const waitTime = STATE.currentDelay * Math.pow(2, i);
            console.warn(`Waiting ${waitTime}ms before retry.`);
            await delay(waitTime);
            adjustDelay(false);
        }
    }
    throw lastError;
}

// Удаление сообщений
async function deleteMessages() {
    const baseURL = `https://discord.com/api/v10/channels/${STATE.channelId}/messages`;
    const headers = { Authorization: STATE.authToken };

    let beforeId = null;

    async function processMessageBatch(messages) {
        if (!STATE.isRunning) return;
        const messagesToDelete = messages.filter(msg => msg.author.id === STATE.currentUserId);
        if (messagesToDelete.length === 0) {
            console.log('No messages from current user in batch.');
            return;
        }

        console.log(`Processing ${messagesToDelete.length} own messages.`);
        for (const message of messagesToDelete) {
            if (!STATE.isRunning) return;
            await delay(STATE.currentDelay);
            updateUI(`Удаление сообщения ${STATE.totalDeleted + 1}...`);

            try {
                const response = await fetch(`${baseURL}/${message.id}`, { headers, method: 'DELETE' });
                if (response.status === 204) {
                    STATE.totalDeleted++;
                    console.log(`Message ${message.id} deleted. Total: ${STATE.totalDeleted}`);
                    adjustDelay(true);
                } else if (response.status === 403) {
                    console.error(`Cannot delete message ${message.id} (403 Forbidden).`);
                    adjustDelay(false);
                } else if (response.status === 404) {
                    console.warn(`Message ${message.id} not found (already deleted?).`);
                    adjustDelay(true);
                } else {
                    console.error(`Error deleting ${message.id}: ${response.status}`);
                    adjustDelay(false);
                }
            } catch (error) {
                console.error(`Exception deleting ${message.id}:`, error);
                adjustDelay(false);
            }
        }
    }

    while (STATE.isRunning) {
        while (!STATE.isRunning) {
            console.log('Script paused. Waiting...');
            updateUI('На паузе...');
            await delay(1000);
        }

        const url = `${baseURL}?limit=${CONFIG.BATCH_SIZE}${beforeId ? `&before=${beforeId}` : ''}`;
        updateUI(`Загрузка сообщений до ${beforeId ? beforeId.substring(0, 8) + '...' : 'начала'}...`);

        try {
            const messages = await fetchMessagesWithRetry(url, { headers });
            if (!messages || messages.length === 0) {
                updateUI('Все сообщения обработаны.');
                console.log('No more messages. Done.');
                break;
            }

            beforeId = messages[messages.length - 1].id;
            STATE.totalProcessed += messages.length;
            console.log(`Updated beforeId: ${beforeId}. Processed: ${STATE.totalProcessed}`);
            await processMessageBatch(messages);

            const delayBetweenBatches = STATE.currentDelay * 3;
            if (STATE.isRunning) {
                console.log(`Waiting ${delayBetweenBatches}ms before next batch...`);
                updateUI(`Ожидание ${delayBetweenBatches}ms...`);
                await delay(delayBetweenBatches);
            }
        } catch (error) {
            console.error('Critical error:', error);
            updateUI(`Ошибка: ${error.message}`);
            break;
        }
    }

    updateUI(`Завершено. Удалено: ${STATE.totalDeleted}`);
    console.log('Deletion process completed.');
}

// Запуск скрипта
async function start() {
    try {
        console.log('Starting message deletion script...');
        await initialize();
        await deleteMessages();
    } catch (error) {
        console.error('Fatal error in start():', error);
        updateUI(`Ошибка: ${error.message}`);
    }
}

start();