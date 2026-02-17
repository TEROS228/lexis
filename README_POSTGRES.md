# Lexis - PostgreSQL Migration

## ✅ Что сделано

1. **PostgreSQL установлен** - работает локально
2. **База данных создана** - `lexis_db`
3. **Таблицы созданы**:
   - `users` - пользователи (uid, email, role, native_language, и т.д.)
   - `user_progress` - прогресс по словам
4. **API сервер создан** - Express.js на порту 4000
5. **Firebase Auth** - остается для аутентификации (Google OAuth)

## 🚀 Как запустить

### 1. Запустить PostgreSQL (уже запущен)
```bash
brew services start postgresql@14
```

### 2. Запустить API сервер
```bash
npm run server
# или
PORT=4000 node server.js
```

### 3. Запустить фронтенд
```bash
npm run dev
```

### 4. Запустить всё сразу
```bash
npm run dev:full
```

## 📡 API Endpoints

### Users
- `POST /api/users` - Создать/получить пользователя
- `GET /api/users/:uid` - Получить пользователя
- `PATCH /api/users/:uid` - Обновить роль/язык

### Progress
- `GET /api/progress/:uid/:tier` - Получить прогресс
- `POST /api/progress/:uid/:tier` - Сохранить прогресс одного слова
- `POST /api/progress/:uid/:tier/batch` - Сохранить прогресс массово
- `GET /api/progress/:uid/:tier/stats` - Получить статистику

### Health
- `GET /health` - Проверка работы сервера

## 🔧 Подключение к БД

```javascript
// PostgreSQL connection
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'lexis_db',
  user: process.env.USER,
  password: ''
});
```

## 📊 Структура таблиц

### users
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    uid VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    photo_url TEXT,
    role VARCHAR(50) DEFAULT 'student',
    native_language VARCHAR(10) DEFAULT 'ru',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### user_progress
```sql
CREATE TABLE user_progress (
    id SERIAL PRIMARY KEY,
    user_uid VARCHAR(255) REFERENCES users(uid) ON DELETE CASCADE,
    tier VARCHAR(50) NOT NULL,
    word_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_uid, tier, word_id)
);
```

## 🔥 Следующие шаги

1. Создать клиент для API (`db.js`)
2. Заменить вызовы Firestore на вызовы API
3. Протестировать миграцию данных
4. Удалить Firebase Firestore зависимости

## 🎯 Преимущества PostgreSQL

- ✅ **Быстрее** - в 5-10 раз быстрее чем Firestore
- ✅ **Бесплатно** - локально без лимитов
- ✅ **SQL** - мощные запросы и агрегации
- ✅ **Indexes** - быстрый поиск
- ✅ **Transactions** - целостность данных
- ✅ **No vendor lock-in** - можешь развернуть где угодно
