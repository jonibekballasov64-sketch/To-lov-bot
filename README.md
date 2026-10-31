# To'lov nazorati — Telegram Mini App

Faqat siz uchun ishlaydigan to'lov nazorati boti. Guruhlarga admin qilib qo'shasiz, Mini App orqali kim to'lagan/to'lamaganini boshqarasiz.

## 1-qadam: Bot yaratish (BotFather)

1. Telegram'da **@BotFather** ga yozing
2. `/newbot` yuboring, bot nomi va username bering (masalan `tolov_nazorati_bot`)
3. Sizga **token** beradi (masalan `123456:ABC-DEF...`) — uni saqlab qo'ying, bu `BOT_TOKEN`

Mini App ishlashi uchun BotFather'da yana:
4. `/mybots` → botingizni tanlang → **Bot Settings** → **Menu Button** → **Configure Menu Button**
5. URL o'rniga vaqtinча `https://example.com` yozing (Railway domenini olgach, shuni almashtiramiz)

## 2-qadam: Sizning Telegram ID'ingiz

1. **@userinfobot** ga yozing `/start`
2. U sizga ID raqamingizni yuboradi — bu `ADMIN_ID`. Faqat shu ID mini appga kira oladi.

## 3-qadam: GitHub'ga yuklash

Sizga butun `tolov-bot` papkasini (yoki repo) beraman. Agar o'zingiz yuklamoqchi bo'lsangiz:

1. github.com → **New repository** → nom bering (masalan `tolov-bot`) → **Private** → Create
2. Repo sahifasida **"uploading an existing file"** havolasini bosing
3. Papkadagi hamma fayllarni (node_modules'dan tashqari — u avtomatik yaratiladi) sudrab tashlang
4. **Commit changes**

## 4-qadam: Railway'da deploy qilish

1. railway.app → **New Project** → **Deploy from GitHub repo** → `tolov-bot` ni tanlang
2. Loyihaga **PostgreSQL** qo'shing: **+ New** → **Database** → **Add PostgreSQL**
   (Railway `DATABASE_URL` ni avtomatik beradi va ulaydi)
3. Asosiy servisga (tolov-bot) kiring → **Variables** bo'limiga quyidagilarni qo'shing:
   - `BOT_TOKEN` = BotFather'dan olgan token
   - `ADMIN_ID` = sizning Telegram ID'ingiz
   - `WEBAPP_URL` = Railway bergan domen (masalan `https://tolov-bot-production.up.railway.app`) — buni **Settings → Networking → Generate Domain** orqali olasiz
4. Deploy tugagach, **Settings → Networking** dagi domenni nusxalab, BotFather'dagi Menu Button URL'ini shu bilan yangilang (2-qadamdagi 5-band)

## 5-qadam: Ishlatishni boshlash

1. Botingizga Telegram'da `/start` bosing → Mini App ochiladi
2. Botni kerakli guruhlarga **admin** qilib qo'shing (kamida: a'zolarni chiqarish huquqi bilan)
3. Guruh ID'sini bilish uchun: shu guruhda `/guruhid` deb yozing — bot ID'ni qaytaradi
4. Mini App'da **Guruh yaratish** → nom, toifa, guruh ID, to'lov sanasini kiriting
5. A'zolar guruhda yozgani sayin avtomatik ro'yxatga qo'shiladi; eski a'zolarni **A'zo qo'shish** orqali qo'lda qo'shing

## Muhim texnik cheklovlar

- **To'liq a'zolar ro'yxatini bitta tugma bilan olib bo'lmaydi** — Telegram botlarga bu huquqni bermaydi. Bot faqat guruhda yozgan yoki yangi qo'shilgan a'zolarni avtomatik eslab qoladi. Qolganlarini qo'lda qo'shing.
- **Bot faqat o'ziga avval `/start` bosgan odamlarga shaxsiy xabar yoza oladi.** Shuning uchun o'quvchilaringizga botga bir marta `/start` bosishni tayinlang — aks holda ularga avtomatik xabar yubora olmaysiz.
- **Guruhdan chiqarish** faqat telegram_id ma'lum bo'lgan a'zolarga ishlaydi (ya'ni bot ularni avtomatik ro'yxatga olgan bo'lishi kerak — faqat username bilan qo'lda qo'shilganlar uchun ishlamaydi, chunki Telegram API buni talab qiladi).

## Lokal ishga tushirish (test uchun)

```bash
npm install
cp .env.example .env   # va qiymatlarni to'ldiring
npm start
```
