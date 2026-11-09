# Загрузка SOVLI в новый GitHub-репозиторий с телефона

В архиве SOVLI есть готовый Render Blueprint, но Render собирает Node-приложение из Git-репозитория. Если нет ноутбука, можно загрузить один ZIP-файл в новый приватный репозиторий и распаковать его через GitHub Actions.

## Один раз

1. Скачай `SOVLI-v1.2.0.zip` на телефон.
2. Открой `https://github.com/new` и создай **Private** repository `sovli-chat`. Не добавляй README, .gitignore или license.
3. Открой репозиторий в Chrome; при необходимости включи «Версия для ПК».
4. Нажми **Add file → Upload files** и загрузи в корень репозитория единственный файл `SOVLI-v1.2.0.zip`.
5. Создай файл по пути `.github/workflows/unpack-sovli.yml` через **Add file → Create new file**.
6. Скопируй содержимое отдельного файла `SOVLI-phone-unpack.yml`, который выдан вместе с архивом, в этот GitHub-файл и нажми Commit changes.
7. Открой вкладку **Actions → Unpack SOVLI source archive → Run workflow**. Через несколько секунд GitHub Actions распакует исходники в корень репозитория и создаст commit. ZIP будет удалён из репозитория.
8. Открой Render → New → Blueprint, подключи GitHub и выбери `sovli-chat`.

Не загружай в GitHub `.env`, `data/`, SQLite-файлы, `.jwt-secret`, Render API key или личные резервные копии.

Если GitHub в мобильном браузере не показывает вкладку Actions, включи Desktop site. Этот bootstrap нужен только для первого импорта ZIP; дальнейшие commits и auto-deploy выполняются обычным способом.
