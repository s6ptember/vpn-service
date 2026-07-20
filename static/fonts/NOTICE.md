# Onest

Файлы `onest-*.woff2` — вариативный шрифт Onest, полученный из Google Fonts
(<https://fonts.google.com/specimen/Onest>) и разложенный по тем же подмножествам Unicode, что
отдаёт Google Fonts: `cyrillic`, `cyrillic-ext`, `latin`, `latin-ext`.

Шрифт распространяется по SIL Open Font License 1.1.

**Осталось доделать:** положить рядом полный текст `OFL.txt` из
<https://github.com/google/fonts/tree/main/ofl/onest>. Лицензия требует распространять свой текст
вместе с файлами шрифта; в этой сессии он не скачался — внешняя сеть до raw.githubusercontent.com
не отвечала.

## Почему Onest, а не Gilroy

Gilroy — референсная гарнитура макета, но она лицензируется по местам и в репозитории лежать не
может. Onest — ближайший свободный геометрический гротеск с полным кириллическим набором. Poppins,
обычная замена Gilroy, кириллицу не покрывает, а интерфейс здесь русский.

Подключение — в `src/app.css`, по одному `@font-face` на подмножество.
