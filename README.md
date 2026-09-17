# DodoShield — сайт

Односторінковий сайт мережі Minecraft-серверів [dodoshield.com](https://dodoshield.com) і сервіс, який збирає статус серверів.

## Що всередині

| Шлях | Що це |
| --- | --- |
| `index.html` | увесь сайт: розмітка, стилі та скрипти в одному файлі |
| `assets/` | фон, логотип, іконки збірок, QR донату |
| `status-service/status.js` | сервіс статусу: пінгує сервери й пише `status.json`, який читає сайт |
| `status-service/serverstatus.js` | пінг Minecraft-сервера (handshake + status) без ліміту на розмір відповіді |
| `index.old-theme.html` | попередня тема сайту, лишена для історії |

## Сайт

Чистий HTML без збирання: відкрив `index.html` у браузері — і бачиш те саме, що на проді.
Тема «кристальна», акцент `#3b82f6`, усі кути заокруглені. Блоки виїжджають при прокрутці
(`IntersectionObserver`, показ і приховування рознесені на два спостерігачі, щоб анімація не блимала).

Деплой — копіювання файлів на сервер, де їх роздає docker-контейнер `dodo-site` (nginx:alpine на 127.0.0.1:8091)
за хостовим nginx з сертифікатом від certbot:

```bash
scp index.html minecraft@<host>:/home/minecraft/site/
scp assets/* minecraft@<host>:/home/minecraft/site/assets/
```

## Сервіс статусу

`status-service/status.js` запускається на сервері в контейнері `dodo-status` (node:20-alpine, `--network host`) і кожні:

- **30 с** пінгує Minecraft-сервери (хаб і Immortal) — онлайн, кількість гравців;
- **90 с** питає особистий API Monobank про баланс банки для блока донату.

Результат пишеться в `/home/minecraft/site/status.json`, звідки його читає сайт.

Токен Monobank у репозиторії відсутній і ніколи сюди не потрапляє: сервіс читає його з файлу
`/secrets/mono-token.txt`, який змонтований у контейнер із `~/.secrets/mono-token.txt` на сервері (права 600).
Якщо файлу немає — блок донату просто показує банку без балансу.

## Пов'язане

Лаунчер мережі — [DodoShield-Launcher](https://github.com/Dodoshield-Team/DodoShield-Launcher).
