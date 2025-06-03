// Конфигурация
const CONFIG = {
    RETRY_ATTEMPTS: 5,
    INITIAL_RETRY_DELAY: 1000,
    MIN_DELAY: 100,    // Минимальная задержка
    MAX_DELAY: 5000,   // Максимальная задержка
    BATCH_SIZE: 100,
    MAX_CONCURRENT_DELETES: 5, // Это пока не используется, удаление происходит последовательно с задержкой между запросами
    DELAY_MULTIPLIER: 1.5,    // Множитель при превышении лимита
    DELAY_DECREASE: 0.9      // Множитель при успешных запросах
};

// Состояние приложения
const STATE = {
    isRunning: true,
    totalDeleted: 0,
    totalProcessed: 0,
    blockedAuthors: [], // Этот список больше не будет использоваться для фильтрации своих сообщений
    authToken: null,
    currentDelay: CONFIG.INITIAL_RETRY_DELAY,
    consecutiveSuccesses: 0,
    consecutiveFailures: 0,
    hasManageMessages: false, // Актуально только для серверных каналов при удалении чужих сообщений
    channelId: null,
    guildId: null,
    currentUserId: null // Добавляем ID текущего пользователя
};

// Валидация токена
function validateToken(token) {
    if (!token || typeof token !== 'string' || token.length < 50) {
        // Простая проверка, что токен похож на токен
        throw new Error('Недействительный токен авторизации. Убедитесь, что скопировали его полностью и правильно.');
    }
    return token;
}

// Проверка прав доступа и информации о канале
async function checkPermissions() {
    try {
        console.log('checkPermissions: Начало');

        // Попытка получить ID канала из URL
        const channelMatch = window.location.href.match(/channels\/(\d+)/);
        if (channelMatch) {
            STATE.channelId = channelMatch[1];
            console.log('checkPermissions: ID канала из URL:', STATE.channelId);
        } else {
            // Если не удалось получить из URL, запросить у пользователя
            STATE.channelId = prompt('Не удалось определить ID канала из URL. Пожалуйста, введите ID текстового канала, где нужно удалить сообщения:');
            if (!STATE.channelId) {
                throw new Error('ID канала не предоставлен. Отмена.');
            }
            console.log('checkPermissions: ID канала введен вручную:', STATE.channelId);
        }

        // Получаем информацию о канале
        console.log(`checkPermissions: Запрос информации о канале с ID ${STATE.channelId}...`);
        const response = await fetch(`https://discord.com/api/v10/channels/${STATE.channelId}`, {
            headers: { Authorization: STATE.authToken }
        });

        if (!response.ok) {
            console.error('checkPermissions: Ошибка ответа сервера при получении инфо о канале:', response.status, response.statusText);
            if (response.status === 403) {
                throw new Error('Нет доступа к каналу с ID ' + STATE.channelId + '. Проверьте токен и права доступа к каналу.');
            }
             if (response.status === 404) {
                throw new Error('Канал с ID ' + STATE.channelId + ' не найден. Проверьте правильность ID.');
            }
            throw new Error(`Ошибка при получении информации о канале: ${response.status}`);
        }

        const channelData = await response.json();
        console.log('checkPermissions: Информация о канале получена:', channelData);

        // Проверяем, что это текстовый канал (тип 0), DM (тип 1) или Group DM (тип 3)
        if (channelData.type !== 0 && channelData.type !== 1 && channelData.type !== 3) {
             const channelTypes = {
                 0: 'Текстовый канал',
                 1: 'Личное сообщение (DM)', // DM тоже текстовый, тип 1
                 2: 'Голосовой канал',
                 3: 'Групповое личное сообщение', // Групповой DM тоже текстовый, тип 3
                 4: 'Категория',
                 5: 'Канал объявлений',
                 10: 'Ветка новостей',
                 11: 'Публичная ветка',
                 12: 'Приватная ветка',
                 13: 'Сцена',
                 14: 'Каталог',
                 15: 'Форум',
                 16: 'Медиа'
             };
             const typeDescription = channelTypes[channelData.type] || `Неизвестный тип (${channelData.type})`;
            throw new Error(`Указанный ID (${STATE.channelId}) не является текстовым каналом, личным сообщением или групповым личным сообщением (обнаружен тип: ${typeDescription}). Скрипт работает только в текстовых каналах.`);
        }

        STATE.guildId = channelData.guild_id;
         if (STATE.guildId) {
            console.log('checkPermissions: Это серверный канал. ID сервера:', STATE.guildId);
        } else {
             console.log('checkPermissions: Это личное сообщение (DM или Group DM).');
        }

        // Получаем информацию о текущем пользователе
        console.log('checkPermissions: Запрос информации о текущем пользователе...');
        const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: STATE.authToken }
        });

        if (!userResponse.ok) {
            console.error('checkPermissions: Ошибка получения информации о пользователе:', userResponse.status);
            throw new Error('Не удалось получить информацию о текущем пользователе. Проверьте токен.');
        }

        const userData = await userResponse.json();
        STATE.currentUserId = userData.id;
        console.log(`checkPermissions: Информация о текущем пользователе получена: ${userData.username} (${STATE.currentUserId})`);

        // Поскольку цель теперь удалять только свои сообщения, явная проверка MANAGE_MESSAGES не так критична.
        // Мы все равно полагаемся на ошибку 403 при попытке удаления чужого сообщения.
        // Оставим эту часть для информации, но не будем блокировать инициализацию из-за нее.
         STATE.hasManageMessages = true; // Считаем, что право удалять свои сообщения всегда есть.
         if (STATE.guildId) { // Только для серверных каналов логируем статус MANAGE_MESSAGES
             // Логика проверки MANAGE_MESSAGES удалена или упрощена в следующей итерации
         }

        console.log('checkPermissions: checkPermissions успешно завершена.');
                        return true;
    } catch (error) {
        console.error('checkPermissions: Критическая ошибка:', error);
        updateUI(`Ошибка инициализации: ${error.message}`);
                        return false;
                    }
}

// Инициализация
async function initialize() {
    try {
        console.log('initialize: Начало инициализации...');

        console.log('initialize: Запрос токена...');
        STATE.authToken = validateToken(prompt('Пожалуйста, введите ваш Discord токен авторизации:'));
        if (!STATE.authToken) {
            throw new Error('Токен не предоставлен.'); // Эта ошибка будет поймана в start()
        }
        console.log('initialize: Токен получен.');

        // Создаем UI элементы
        console.log('initialize: Создание UI...');
        createUI();
        console.log('initialize: UI создан.');

        // Проверяем права доступа и получаем инфо о канале
        console.log('initialize: Проверка прав доступа и канала...');
        const isChannelAndPermissionsChecked = await checkPermissions();
        console.log('initialize: Результат проверки прав и канала:', isChannelAndPermissionsChecked);

        if (!isChannelAndPermissionsChecked) {
            // Если checkPermissions вернула false, она уже обновила UI с причиной ошибки.
            throw new Error('Не удалось инициализировать скрипт из-за проблем с каналом или правами.');
        }

        updateUI('Скрипт инициализирован. Начинаем удаление...');
        console.log('initialize: Инициализация завершена успешно.');
        return true;
    } catch (error) {
        console.error('initialize: Ошибка инициализации:', error);
        updateUI(`Фатальная ошибка: ${error.message}`); // Обновляем UI в случае ошибки на этапе initialize
        throw error; // Перебрасываем ошибку, чтобы start мог ее поймать
    }
}

// Создание UI
function createUI() {
    // Проверяем, существует ли уже контейнер, чтобы не создавать его повторно
    let container = document.getElementById('discord-message-deleter-ui');
    if (!container) {
        container = document.createElement('div');
        container.id = 'discord-message-deleter-ui';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 15px;
            border-radius: 8px;
            font-family: Arial, sans-serif;
            z-index: 10000; /* Увеличиваем z-index */
            max-width: 400px; /* Увеличена ширина панели */
            word-wrap: break-word;
        `;

        container.innerHTML = `
            <h3 style="margin-top: 0; color: #7289da;">Удаление сообщений</h3>
            <div id="progress">Удалено: 0 сообщений</div>
            <div id="status" style="margin-bottom: 10px;">Статус: Запуск...</div>
            <button id="pauseBtn" style="
                background-color: #7289da;
                color: white;
                border: none;
                padding: 8px 12px;
                border-radius: 4px;
                cursor: pointer;
            ">Пауза</button>
             <button id="stopBtn" style="
                background-color: #f04747;
                color: white;
                border: none;
                padding: 8px 12px;
                border-radius: 4px;
                cursor: pointer;
                margin-left: 5px;
            ">Остановить</button>
        `;

        document.body.appendChild(container);

        // Обработчики событий
        document.getElementById('pauseBtn').addEventListener('click', togglePause);
         document.getElementById('stopBtn').addEventListener('click', stopScript);
    } else {
        // Если контейнер уже есть, просто обновляем статус и кнопку
        updateUI(STATE.isRunning ? 'Работает' : 'На паузе');
         document.getElementById('pauseBtn').textContent = STATE.isRunning ? 'Пауза' : 'Продолжить';
    }
}

// Обновление UI
function updateUI(message) {
    const progress = document.getElementById('progress');
    const status = document.getElementById('status');

    if (progress) progress.textContent = `Удалено: ${STATE.totalDeleted} сообщений`;
    if (status) status.textContent = `Статус: ${message}`;
}

// Управление состоянием паузы/продолжения
function togglePause() {
    STATE.isRunning = !STATE.isRunning;
    const btn = document.getElementById('pauseBtn');
    btn.textContent = STATE.isRunning ? 'Пауза' : 'Продолжить';
    updateUI(STATE.isRunning ? 'Работает...' : 'На паузе');
    console.log(`Скрипт ${STATE.isRunning ? 'продолжен' : 'приостановлен'}.`);
}

// Остановка скрипта
function stopScript() {
    STATE.isRunning = false;
    updateUI('Остановка...');
    console.log('Запрошена остановка скрипта.');
     // Можно добавить удаление UI элементов через некоторую задержку
    setTimeout(() => {
        const uiContainer = document.getElementById('discord-message-deleter-ui');
        if (uiContainer) {
            uiContainer.remove();
        }
        console.log('UI удален. Скрипт полностью остановлен.');
        updateUI('Остановлено'); // Финальный статус перед удалением
    }, 2000); // Удалить UI через 2 секунды
}


// Улучшенная функция задержки
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Адаптивная задержка
function adjustDelay(success) {
    if (success) {
        STATE.consecutiveSuccesses++;
        STATE.consecutiveFailures = 0;
        // Уменьшаем задержку при успешных запросах
        STATE.currentDelay = Math.max(
            CONFIG.MIN_DELAY,
            STATE.currentDelay * CONFIG.DELAY_DECREASE
        );
    } else {
        STATE.consecutiveFailures++;
        STATE.consecutiveSuccesses = 0;
        // Увеличиваем задержку при ошибках
        STATE.currentDelay = Math.min(
            CONFIG.MAX_DELAY,
            STATE.currentDelay * CONFIG.DELAY_MULTIPLIER
        );
    }

    // Обновляем UI с информацией о текущей задержке
    // Не обновляем статус, только прогресс, чтобы статус показывал текущую операцию
    const progress = document.getElementById('progress');
     if (progress) {
         progress.textContent = `Удалено: ${STATE.totalDeleted} сообщений (задержка: ${Math.round(STATE.currentDelay)}мс)`;
     }

    return STATE.currentDelay;
}

// Улучшенная функция повторных попыток для загрузки сообщений
// Отдельная функция для загрузки, чтобы ошибки загрузки не смешивались с ошибками удаления
async function fetchMessagesWithRetry(url, options, retries = CONFIG.RETRY_ATTEMPTS) {
    let lastError;

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);

            if (response.status === 429) {
                const retryAfter = parseInt(response.headers.get('Retry-After')) || STATE.currentDelay;
                console.warn(`fetchMessagesWithRetry: Превышен лимит запросов, ожидание ${retryAfter}мс. Попытка ${i + 1}/${retries}.`);
                updateUI(`Rate Limit: ожидание ${retryAfter}мс...`);
                await delay(retryAfter);
                 adjustDelay(false); // Увеличиваем задержку при 429
                continue; // Повторить запрос после ожидания
            }

            if (!response.ok) {
                 // Для загрузки сообщений 403 и 404 - это критично
                if (response.status === 403) throw new Error(`Ошибка HTTP: 403 Forbidden (нет прав на чтение канала).`);
                if (response.status === 404) throw new Error(`Ошибка HTTP: 404 Not Found (канал не существует).`);
                throw new Error(`Ошибка HTTP при загрузке сообщений: ${response.status} ${response.statusText}`);
            }

            console.log('fetchMessagesWithRetry: Запрос успешно выполнен.');
            adjustDelay(true); // Уменьшаем задержку при успешной загрузке
            return response.json();

        } catch (error) {
            lastError = error;
            console.warn(`fetchMessagesWithRetry: Попытка ${i + 1}/${retries} не удалась:`, error.message);
            // Если это не 429, а другая ошибка, увеличиваем задержку
            if (!error.message.includes('429')) {
                 adjustDelay(false);
            }
             // Экспоненциальная задержка между попытками
            const waitTime = STATE.currentDelay * Math.pow(2, i);
             console.warn(`fetchMessagesWithRetry: Ожидание ${waitTime}мс перед следующей попыткой.`);
            await delay(waitTime);
        }
    }

    console.error('fetchMessagesWithRetry: Все попытки исчерпаны.');
    throw lastError; // Перебрасываем последнюю ошибку после всех попыток
}


// Улучшенная функция удаления сообщений
async function deleteMessages() {
    const baseURL = `https://discord.com/api/v10/channels/${STATE.channelId}/messages`;
    const headers = { Authorization: STATE.authToken };

    let beforeId = null;

    async function processMessageBatch(messages) {
        if (!STATE.isRunning) {
            console.log('processMessageBatch: Скрипт приостановлен, пропуск обработки пачки.');
            return; // Не обрабатываем пачку, если скрипт на паузе
        }

        // **Изменено:** Фильтруем только сообщения текущего пользователя
        const messagesToDelete = messages.filter(msg => msg.author.id === STATE.currentUserId);

        // Если нет сообщений текущего пользователя в этой пачке, выходим
        if (messagesToDelete.length === 0) {
            console.log('processMessageBatch: Нет сообщений текущего пользователя в этой пачке.');
                    return;
                }

        console.log(`processMessageBatch: Попытка удаления ${messagesToDelete.length} СОБСТВЕННЫХ сообщений из пачки.`);

        // Обрабатываем каждое сообщение в пачке последовательно с задержкой
        for (const message of messagesToDelete) {
             if (!STATE.isRunning) {
                 console.log('processMessageBatch: Скрипт приостановлен во время обработки пачки.');
                 return; // Останавливаем обработку пачки, если скрипт приостановлен
             }

             // Применяем адаптивную задержку перед каждым запросом на удаление
             await delay(STATE.currentDelay);
             updateUI(`Удаление вашего сообщения ${STATE.totalDeleted + 1}...`); // Обновляем статус более конкретно

            try {
                console.log(`processMessageBatch: Попытка удалить ваше сообщение ${message.id}`);
                const response = await fetch(
                    `${baseURL}/${message.id}`,
                    { headers, method: 'DELETE' }
                );

                if (response.status === 204) {
                    STATE.totalDeleted++;
                    updateUI(`Удалено: ${STATE.totalDeleted} (задержка: ${Math.round(STATE.currentDelay)}мс)`);
                    console.log(`processMessageBatch: Ваше сообщение ${message.id} успешно удалено. Всего удалено: ${STATE.totalDeleted}`);
                     adjustDelay(true); // Успешное удаление
                } else if (response.status === 403) {
                    // Получение 403 на СВОЕ сообщение очень маловероятно, но обрабатываем на всякий случай
                    const errorMessage = `processMessageBatch: Невозможно удалить ваше сообщение ${message.id} (получена 403 Forbidden). Проверьте права токена.`;
                    console.error(errorMessage);
                    // Не добавляем в blockedAuthors, так как это ваше сообщение
                     adjustDelay(false); // Ошибка при удалении
                     // Возможно, стоит остановить процесс, если не можем удалить даже свое сообщение?
                     // STATE.isRunning = false; // Решите, нужно ли останавливаться при 403 на своем сообщении
                } else if (response.status === 404) {
                     console.warn(`processMessageBatch: Ваше сообщение ${message.id} не найдено (уже удалено?).`);
                     adjustDelay(true); // Сообщение уже удалено, считаем как успех операции
                } else {
                     const errorMessage = `processMessageBatch: Ошибка при удалении сообщения ${message.id}: ${response.status} ${response.statusText}`;
                     console.error(errorMessage);
                     adjustDelay(false); // Другая ошибка
                     // throw new Error(`Ошибка удаления сообщения ${message.id}: ${response.status}`); // Не останавливаем весь процесс из-за одного сообщения
                }
            } catch (error) {
                console.error(`processMessageBatch: Исключение при удалении сообщения ${message.id}:`, error);
                 adjustDelay(false); // Ошибка
                 // throw error; // Не останавливаем весь процесс из-за исключения
            }
        }

        console.log(`processMessageBatch: Обработка текущей пачки завершена.`);
    }

    console.log('deleteMessages: Начало процесса удаления...');
    updateUI('Начинаем удаление...');


    while (STATE.isRunning) {
         // Ожидаем, если скрипт на паузе
        while (!STATE.isRunning) {
            console.log('deleteMessages: Скрипт на паузе. Ожидание...');
            updateUI('На паузе...');
            await delay(1000); // Проверяем состояние каждую секунду
        }

        console.log(`deleteMessages: Загрузка новой пачки сообщений до ${beforeId || 'начала'}...`);
        updateUI(`Загрузка сообщений до ${beforeId ? 'ID ' + beforeId.substring(0, 8) + '...' : 'начала'}...`);

        try {
            const url = `${baseURL}?limit=${CONFIG.BATCH_SIZE}${beforeId ? `&before=${beforeId}` : ''}`;
            // Используем fetchMessagesWithRetry для загрузки пачки
            const messages = await fetchMessagesWithRetry(url, { headers });
            console.log(`deleteMessages: Загружено сообщений в пачке: ${messages.length}.`);

            if (!messages || messages.length === 0) {
                updateUI('Все доступные сообщения обработаны.');
                console.log('deleteMessages: Нет новых сообщений. Завершение.');
                STATE.isRunning = false; // Останавливаем цикл загрузки
                break;
            }

            // Обновляем beforeId для следующего запроса
                beforeId = messages[messages.length - 1].id;
            STATE.totalProcessed += messages.length;
            console.log(`deleteMessages: Обновлен beforeId: ${beforeId}. Всего загружено и обработано (на уровне пачек): ${STATE.totalProcessed}`);

            // Обрабатываем загруженную пачку сообщений (пытаемся удалить)
             console.log(`deleteMessages: Обработка загруженной пачки (${messages.length} сообщений)...`);
            await processMessageBatch(messages);
             console.log('deleteMessages: Пачка обработана.');

        } catch (error) {
            console.error('deleteMessages: Критическая ошибка во время загрузки или обработки пачки:', error);
             // updateUI уже обновлено в checkPermissions или fetchMessagesWithRetry
             // Если ошибка произошла при загрузке пачки (она поймана в fetchMessagesWithRetry и переброшена), останавливаем процесс
             STATE.isRunning = false; // Останавливаем скрипт при критической ошибке загрузки пачки
             // updateUI(`Ошибка: ${error.message}`); // fetchMessagesWithRetry уже обновил UI
            break; // Выход из цикла while
        }

        // Дополнительная задержка между пачками, чтобы не перегружать API даже при быстрой обработке пачки
         if (STATE.isRunning) { // Добавляем задержку только если скрипт не остановлен
             const delayBetweenBatches = STATE.currentDelay * 3; // Можно настроить, например, 3 * текущая задержка
             console.log(`deleteMessages: Ожидание ${Math.round(delayBetweenBatches)}мс перед загрузкой следующей пачки.`);
             updateUI(`Ожидание ${Math.round(delayBetweenBatches)}мс перед следующей пачкой...`);
             await delay(delayBetweenBatches);
         }
    }

     console.log('deleteMessages: Процесс удаления завершен.');
     updateUI(`Процесс завершен. Удалено всего: ${STATE.totalDeleted}`);
      // Можно удалить UI после завершения или ошибки
     const uiContainer = document.getElementById('discord-message-deleter-ui');
     if (uiContainer) {
         // uiContainer.remove(); // Удалить UI сразу после завершения
     }
}

// Запуск скрипта
async function start() {
    try {
        console.log('Старт скрипта удаления сообщений...');
        await initialize();
        console.log('Скрипт инициализирован. Запускаем процесс удаления.');
        await deleteMessages();
        console.log('Процесс удаления сообщений завершен.');
    } catch (error) {
        console.error('Фатальная ошибка в start():', error);
        // UI уже обновлен в initialize или deleteMessages в случае ошибки
        // updateUI(`Фатальная ошибка: ${error.message}`);
    }
}

start();
