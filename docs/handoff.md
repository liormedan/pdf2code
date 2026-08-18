# נקודת ציון והמשך עבודה

איפה הפרויקט עומד, מה חסום, ומה עושים כדי להמשיך ממחשב חדש.

עודכן: 19 באוגוסט 2026.

---

## 1. איפה אנחנו

**~42% מהדרך** לפי [roadmap.md](roadmap.md). המנוע עומד, שלושת המקורות כתובים, החשבונות עובדים, והאפליקציה פרוסה.

| רכיב | מצב |
| --- | --- |
| מנוע ההמרה | ✅ עומד. 71 בדיקות QA, בדיקות ממיר, ולידציית פלט |
| קליטת PDF | ✅ מאומת מקצה לקצה בדפדפן |
| קליטת Google Slides | 🟡 קוד שלם, **לא מוגדר** — Picker API ו-Drive API כבויים |
| קליטת PowerPoint | 🟡 קוד שלם, **דגל כבוי**. לא ניתן להרצה על Vercel |
| חשבונות (Auth) | ✅ Email/Password ו-Google פעילים בפרויקט Firebase |
| פרויקטים ב-Firestore | ⬜ לא התחיל — ספרינט 2 |
| פריסה | 🟡 **חיה אבל לא שמישה** — ראה §2 |

**כתובת הפרודקשן:** https://pdf2code.vercel.app

מה שכבר אומת שם: `/` מפנה ל-`/login`, שער הביתא מוצג, `/api/presentation` מוגן, וכפתור כניסת המפתחים **לא קיים** בבילד הפרודקשן.

---

## 2. מה חסום כרגע — משתני הסביבה ב-Vercel

הפרודקשן מחזיר:

```
Server is not configured: ACCESS_CODE is not set; SESSION_SECRET is not set.
```

הסיבה: ב-Vercel יובאו 11 משתנים שתואמים אחד לאחד למפתחות שהיו ב-`.env.example` — כלומר **הקובץ הלא נכון יובא**, עם שמות בלי ערכים. `.env.local` האמיתי מעולם לא היה בגיט, כי הוא ב-`.gitignore`.

זה החסם היחיד. אחרי שהוא נפתר, האפליקציה שמישה.

---

## 3. התהליך המלא ממחשב חדש

### 3.1 להוריד

```bash
git clone https://github.com/liormedan/pdf2code.git
cd pdf2code
npm install
```

### 3.2 לבנות את `.env.local`

ארבעת ערכי Firebase ציבוריים בכוונת התכנון — הם מזהים את הפרויקט ולא מאשרים דבר, ונצרבים ממילא לתוך הבאנדל:

```bash
cat > .env.local <<'EOF'
ACCESS_CODE=
SESSION_SECRET=
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyBBGM9Z9aMKsuJtW8tmHpYqz_okFDJ1YwE
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=pdf-to-code.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=pdf-to-code
NEXT_PUBLIC_FIREBASE_APP_ID=1:218669763399:web:92fdcb6a67974aae111a62
FIREBASE_SERVICE_ACCOUNT=
EOF
```

**`SESSION_SECRET`** — לייצר ולהדביק:

```bash
node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"
```

**`ACCESS_CODE`** — קוד הביתא המשותף. אם נשכח, אפשר לבחור חדש; הוא לא קשור לשום נתון.

**`FIREBASE_SERVICE_ACCOUNT`** — את המפתח הפרטי אי אפשר להוריד שוב, גוגל נותנת אותו פעם אחת. מושכים חדש:

```bash
gcloud auth login
gcloud iam service-accounts keys create sa.json \
  --iam-account=firebase-adminsdk-fbsvc@pdf-to-code.iam.gserviceaccount.com \
  --project pdf-to-code
node -e "console.log(require('fs').readFileSync('sa.json').toString('base64'))"
rm sa.json
```

את הפלט מדביקים אחרי `FIREBASE_SERVICE_ACCOUNT=`, בשורה אחת. **למחוק את `sa.json`** — אסור שיישאר עותק שני של קרדנשיאל חי.

### 3.3 לוודא מקומית לפני שנוגעים בפרודקשן

```bash
npm run dev
```

אם `/login` מציג את שער הביתא ולא "Server is not configured" — הקובץ תקין. כדאי גם:

```bash
npm run qa
npm test
```

### 3.4 לתקן את המשתנים ב-Vercel

```bash
npm i -g vercel
vercel login
vercel link --yes --project pdf2code --scope liormedans-projects
```

קודם למחוק את הריקים, אחרת הם ידרסו את מה שיתווסף:

```bash
for v in ACCESS_CODE SESSION_SECRET NEXT_PUBLIC_FIREBASE_API_KEY NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN NEXT_PUBLIC_FIREBASE_PROJECT_ID NEXT_PUBLIC_FIREBASE_APP_ID FIREBASE_SERVICE_ACCOUNT SOFFICE_PATH NEXT_PUBLIC_GOOGLE_CLIENT_ID NEXT_PUBLIC_GOOGLE_API_KEY NEXT_PUBLIC_GOOGLE_APP_ID; do vercel env rm "$v" production -y; done
```

ואז להעלות מהקובץ התקין:

```bash
while IFS='=' read -r k v; do [ -n "$k" ] && [ "${k#\#}" = "$k" ] && printf '%s' "$v" | vercel env add "$k" production; done < .env.local
```

**לא מוסיפים** `SOFFICE_PATH`, `NEXT_PUBLIC_GOOGLE_*` ו-`NEXT_PUBLIC_ENABLE_PPTX`. אין LibreOffice על Vercel, ו-Slides עוד לא מוגדר — כפתור שייראה שם רק ייכשל.

### 3.5 לפרוס מחדש

```bash
vercel --prod
```

חובה, לא קוסמטיקה: משתני `NEXT_PUBLIC_` נצרבים בזמן הבנייה, ולכן שינוי שלהם לא נוגע בפריסה קיימת.

---

## 4. רשימת מטלות

### מיד — לפתוח את החסם

- [ ] לבנות `.env.local` במחשב החדש (§3.2)
- [ ] לאמת מקומית (§3.3)
- [ ] למחוק את 11 המשתנים הריקים ב-Vercel ולהעלות את התקינים (§3.4)
- [ ] `vercel --prod`
- [ ] לאמת בפרודקשן: שער הביתא, הרשמה, המרת PDF מקצה לקצה

### לסגור את ספרינט 1 — 4%

- [ ] הרשמה אמיתית אחת דרך האפליקציה
- [ ] לוודא שנוצרה רשומת `users/{uid}` עם `keepFileNames`, `locale` ו-`usage`
- [ ] להוסיף את `pdf2code.vercel.app` ל-Firebase → Authentication → Settings → **Authorized domains**, אחרת "המשך עם Google" ייכשל בפרודקשן

### ספרינט 2 — פרויקטים ב-Firestore — 10%

- [ ] ליצור מסד Firestore בפרויקט (עוד לא קיים)
- [ ] `firestore.rules` ו-`firestore.indexes.json`
- [ ] `/api/projects` — יצירה, שינוי שם, ארכוב, מחיקה
- [ ] מסך הפעילות הופך למסך פרויקטים
- [ ] `keepFileNames` בהגדרות

האיפיון המלא: [firebase-plan.md](firebase-plan.md).

### נדחה בכוונה

- **PowerPoint** — הקוד שלם ולא נבדק מעולם מול LibreOffice אמיתי. דורש קונטיינר, לא Vercel. ראה [deploy-vercel.md](deploy-vercel.md)
- **Google Slides** — הקוד שלם. דורש הפעלת Picker API ו-Drive API, ואת שלושת `NEXT_PUBLIC_GOOGLE_*`. ה-client ID כבר קיים: פיירבייס ייצר אותו כשהופעל Google sign-in
- **יחידת החיוב** — המרה או עמוד. ההמרה רצה בדפדפן ולכן השרת לא יכול לספור עמודים בעצמו; ההכרעה חוסמת את ספרינט 6

---

## 5. מספרים שימושיים

| | |
| --- | --- |
| פרויקט Firebase | `pdf-to-code` (מספר `218669763399`) |
| App ID של הווב | `1:218669763399:web:92fdcb6a67974aae111a62` |
| חשבון שירות | `firebase-adminsdk-fbsvc@pdf-to-code.iam.gserviceaccount.com` |
| פרויקט Vercel | `pdf2code`, בארגון `liormedans-projects`, אזור `fra1` |
| פרודקשן | https://pdf2code.vercel.app |
| ריפו | https://github.com/liormedan/pdf2code |

**מפתח שירות ישן:** `0d5af2c5…` נוצר במחשב הקודם. כששני המחשבים מסודרים, כדאי למחוק את מה שלא בשימוש עם `gcloud iam service-accounts keys delete`.
