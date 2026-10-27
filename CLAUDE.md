# More BTC

PWA за Bitcoin и MSTR (iPhone през „Добави към началния екран“). Потребителят пише на български: отговаряй на български, текстовете в приложението също са на български.

## Архитектура
- Статичен сайт без build стъпка: `index.html`, `app.css`, `i18n.js`, `app.js` (един файл, разделен на секции с `// ====`), `sw.js`, `manifest.webmanifest`. Хостинг: GitHub Pages.
- Езици BG/EN/DE: всички текстове са в `i18n.js` (`STR`, записи `[bg, en, de]`). В HTML: `data-i18n`, `data-i18n-html`, `data-i18n-ph`, `data-i18n-title`. В JS: `tr('ключ', {променливи})`. Не пиши текст директно в кода. Функцията е `tr`, не `t`, защото много функции имат локална променлива `t`. Числа и дати: `nf()`, `money()`, `fmtDate()` следват езика; полетата за въвеждане се четат с `num()` (приема 0,01 и 0.01).
- Портфолио: таблицата `ASSETS` в `app.js` (BTC, MSTR, ASST = Strive, GOLD = злато от Тавекс в грамове). Нов актив: ред в `ASSETS`, цена в `livePrice()`, `<div id="pos…">` в `index.html`, данни в `tools/update_data.py`.
- Единствена външна библиотека: Chart.js 4.4.1 от cdnjs (линейна ос X с дни от 1970 г., без date adapter).
- Исторически данни в `data/*.json` във формат `{"updated": ISO, "d": [[ден_от_1970, цена], ...]}`. `.github/workflows/deploy.yml` се пуска при всеки push в `main` и всеки час: `tools/update_data.py` обновява данните (BTC: blockchain.info + Coinbase, Binance само резерва, защото блокира сървърите на GitHub; MSTR, ASST, злато: Yahoo; EUR/USD: Frankfurter; новини: RSS на Bitcoin Magazine), после сайтът се публикува в GitHub Pages (source = GitHub Actions).
- Наживо в браузъра: BTC и злато от Coinbase WebSocket (BTC-USD, BTC-EUR, PAXG-USD; от BTC двойките и EUR/USD курсът), MSTR и ASST от Finnhub (ключ в настройките), Fear & Greed от alternative.me, височина на блока от mempool.space. Историята е в `data/` (btc, mstr, asst, gold = GC=F в USD/унция, eurusd, news).
- Личните данни (портфолио, аларми, Finnhub ключ) са само в `localStorage` с префикс `morebtc.`. Никога не ги пращай към сървър и не ги слагай в repo-то.

## Модели
- Сигнал 0–100 (`scoreAt`): средно от Rainbow, Mayer Multiple, цена/200W MA, седмичен RSI, Fear & Greed, позиция в цикъла и Pi Cycle. 0 = натрупване, 100 = продажба.
- Цикли (`computeCycles`): започват от халвинга. Върхът се търси в първите 800 дни, дъното до 1200-ия ден. Цветове: текущият цикъл винаги е зелен, предишният лилав.
- DCA двигател (`dca`): месечни покупки на избран ден. За MSTR, ако денят не е работен, покупката е на следващия. Сумите в EUR се превръщат по историческия курс.

## Локален тест
`.claude/launch.json` → сървър `more-btc` на http://localhost:8787 (preview_start).

## Правила при промени
- При всяка промяна в приложението вдигни версията на две места: `CACHE` в `sw.js` (`morebtc-vN`) и `APP_VERSION` в `app.js` (същото N). Потребителят вижда номера в ⚙️ Настройки и по него разбира дали телефонът му е обновен. Новият service worker презарежда отворената страница веднъж.
- Нови функции → бектествай ги върху историческите данни, преди да кажеш, че работят.
