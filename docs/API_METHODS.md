# Методы Битрикс24 REST API

Scope: `timeman`, `lists`, `user`, `department`

---

## Учёт рабочего времени (timeman)

### `timeman.settings`
Получить настройки рабочего времени конкретного пользователя.

**Параметры:**
- `USER_ID` — ID пользователя (необязательно, по умолчанию — текущий)

**Возвращает:**
| Поле | Тип | Описание |
|---|---|---|
| `UF_TIMEMAN` | bool | Включён ли учёт РВ для пользователя |
| `UF_TM_FREE` | bool | Свободный график |
| `UF_TM_MAX_START` | string | Максимальное время начала дня `HH:MM:SS` — используется как плановое |
| `UF_TM_MIN_FINISH` | string | Минимальное время завершения `HH:MM:SS` |
| `UF_TM_MIN_DURATION` | string | Минимальная длительность рабочего дня |
| `ADMIN` | bool | Может ли управлять РВ других сотрудников |

**Использование в приложении:** Получить плановое время начала дня (`UF_TM_MAX_START`) и проверить, включён ли timeman для сотрудника (`UF_TIMEMAN`).

---

### `timeman.open`
Открыть рабочий день (или продолжить после паузы/завершения).

**Параметры:**
- `USER_ID` — ID пользователя

**Возвращает:**
| Поле | Тип | Описание |
|---|---|---|
| `STATUS` | string | `OPENED` / `CLOSED` / `PAUSED` / `EXPIRED` |
| `TIME_START` | datetime | Время начала рабочего дня (ISO 8601 с часовым поясом) |
| `TIME_FINISH` | datetime | Время завершения (`null` если не завершён) |

**Использование в приложении:** Единственный доступный REST-метод для получения фактического времени начала рабочего дня. Если день уже открыт — возвращает `TIME_START` без изменений. Если день не открыт — открывает его (что допустимо: сотрудник не пришёл / очень опоздал).

> **Ограничение:** REST API Битрикс24 не предоставляет read-only метода для чтения истории рабочих дней. Методы `timeman.timecontrol.reports.get` и `timeman.status` в REST API не существуют. События на открытие рабочего дня (`OnTimManOpen` и аналоги) также недоступны через REST.

---

### `timeman.schedule.get`
Получить рабочий график по ID.

**Параметры:**
- `id` — ID графика (обязательно)

**Возвращает (ключевые поля):**
| Поле | Тип | Описание |
|---|---|---|
| `SCHEDULE_TYPE` | string | `FIXED` / `SHIFT` / `FLEXTIME` |
| `SHIFTS[].WORK_TIME_START` | int | Начало смены в секундах от полуночи |
| `SHIFTS[].WORK_TIME_END` | int | Конец смены в секундах |
| `SHIFTS[].WORK_DAYS` | string | Рабочие дни: `"12345"` = Пн-Пт |
| `SCHEDULE_VIOLATION_RULES.MAX_EXACT_START` | int | Макс. начало в секундах |

**Использование:** Резерв для будущей интеграции с графиком Б24 (в текущей версии не используется).

---

### `timeman.timecontrol.reports.settings.get`
Получить настройки отчётов + роль текущего пользователя.

**Возвращает:**
| Поле | Тип | Описание |
|---|---|---|
| `active` | bool | Модуль активен |
| `user_id` | int | ID текущего пользователя |
| `user_admin` | bool | Пользователь — администратор |
| `user_head` | bool | Пользователь — руководитель |
| `report_view_type` | string | `none` / `head` / `full` / `simple` |

---

### `timeman.timecontrol.reports.users.get`
Получить список пользователей подразделения.

**Параметры:**
- `DEPARTMENT_ID` — ID подразделения

---

## Пользователи

### `user.get`
Получить список пользователей с фильтрацией.

**Ключевые поля:**
| Поле | Описание |
|---|---|
| `ID` | ID пользователя |
| `NAME`, `LAST_NAME` | Имя и фамилия |
| `PERSONAL_PHOTO` | Фото |
| `WORK_POSITION` | Должность |
| `ACTIVE` | Активен ли пользователь |
| `ADMIN` | `Y` если администратор портала |

---

### `department.get`
Получить список подразделений.

**Возвращает:** `ID`, `NAME`, `PARENT`, `UF_HEAD` (ID руководителя)

---

## Универсальные списки (lists)

### Правила работы с API списков (выявлены опытным путём)

| Параметр | Где передаётся | Примечание |
|---|---|---|
| `IBLOCK_TYPE_ID` | верхний уровень | всегда `"lists"` |
| `IBLOCK_CODE` | верхний уровень | в `lists.get` и `lists.add` |
| `NAME` списка | внутри `FIELDS` | в `lists.add` |
| `TYPE`, `CODE` поля | внутри `FIELDS` | в `lists.field.add` (не `FIELD_TYPE` / `FIELD_NAME`) |
| `ELEMENT_CODE` | верхний уровень | обязателен в `lists.element.add` |
| Значения свойств | plain string | `PROPERTY_FOO: "value"` (не `{ n0: value }`) |
| Чтение свойств | `el.PROPERTY_FOO?.n0?.VALUE` | так возвращает `lists.element.get` |

### `lists.get`
Проверить существование списка по коду.

**Параметры:** `IBLOCK_TYPE_ID`, `IBLOCK_CODE`

### `lists.add`
Создать новый универсальный список.

**Параметры:** `IBLOCK_TYPE_ID`, `IBLOCK_CODE`, `FIELDS: { NAME }`

### `lists.field.add`
Создать поле списка.

**Параметры:** `IBLOCK_TYPE_ID`, `IBLOCK_ID`, `FIELDS: { NAME, CODE, TYPE, MULTIPLE, IS_REQUIRED, SORT }`

**Типы полей:**
| Код | Описание |
|---|---|
| `S` | Строка |
| `N` | Число |
| `S:DateTime` | Дата и время |
| `S:Date` | Только дата |
| `L` | Список (enum) |

### `lists.element.add`
Добавить элемент в список.

**Параметры:** `IBLOCK_TYPE_ID`, `IBLOCK_ID`, `ELEMENT_CODE`, `FIELDS: { NAME, PROPERTY_* }`

### `lists.element.get`
Получить элементы с фильтрацией.

**Параметры:** `IBLOCK_TYPE_ID`, `IBLOCK_ID`, `FILTER`, `SELECT`

### `lists.element.update`
Обновить элемент.

**Параметры:** `IBLOCK_TYPE_ID`, `IBLOCK_ID`, `ELEMENT_ID`, `FIELDS: { PROPERTY_* }`

---

## Настройки приложения

### `app.option.get` / `app.option.set`
Хранение глобальных опций приложения (ключ-значение).

**Использование:** Хранить ID созданных при установке списков (`records_list_id`, `settings_list_id`).

---

## Установка приложения

### `ONAPPINSTALL`
POST-запрос от Битрикс24 при установке приложения.

**Параметры в теле запроса:**
| Поле | Описание |
|---|---|
| `AUTH_ID` | access_token |
| `REFRESH_ID` | refresh_token |
| `AUTH_EXPIRES` | Время жизни токена (сек) |
| `APPLICATION_TOKEN` | Токен приложения (для webhook) |
| `SERVER_ENDPOINT` | OAuth-эндпоинт (`https://oauth.bitrix24.tech/rest/`) |
| `member_id` | ID портала |

**Алгоритм обработчика:**
1. Вызвать `app.info` через `SERVER_ENDPOINT` → получить `client_endpoint` и домен портала
2. Сохранить токены в Redis
3. Создать универсальные списки (если не существуют)
4. Создать singleton-запись настроек с дефолтами
5. Сохранить ID списков через `app.option.set`
6. Ответить HTML с `BX24.installFinish()`
