# נקודת ציון והמשך עבודה

איפה הפרויקט עומד, מה חסום, ומה עושים כדי להמשיך ממחשב חדש.

עודכן: 19 באוגוסט 2026 — החשבונות עובדים בפרודקשן, ושער הביתא הוסר.

---

## 1. איפה אנחנו

**~42% מהדרך** לפי [roadmap.md](roadmap.md). המנוע עומד, שלושת המקורות כתובים, החשבונות עובדים, והאפליקציה פרוסה.

| רכיב | מצב |
| --- | --- |
| מנוע ההמרה | ✅ עומד. 70 בדיקות QA, בדיקות ממיר, ולידציית פלט |
| קליטת PDF | ✅ מאומת מקצה לקצה בדפדפן |
| קליטת Google Slides | 🟡 קוד שלם, **לא מוגדר** — Picker API ו-Drive API כבויים |
| קליטת PowerPoint | 🟡 קוד שלם, **דגל כבוי**. לא ניתן להרצה על Vercel |
| חשבונות (Auth) | ✅ מוגדרים מקצה לקצה בפרודקשן |
| פרויקטים ב-Firestore | 🟡 המסד נוצר; החוקים והמסכים בספרינט 2 |
| פריסה | ✅ **חיה ושמישה** |

**כתובת הפרודקשן:** https://pdf2code.vercel.app

מה שאומת שם: `/` מפנה ל-`/login`, מסך החשבון נטען מיד עם הרשמה ו"המשך עם Google", `/convert` מפנה להתחברות, `/api/presentation` מוגן, ו-`/api/dev-session` מחזיר 404.

---

## 2. אין חסם פתוח

שלושת החסמים שהיו כאן נסגרו:

**משתני הסביבה** — 11 המשתנים הריקים נמחקו מ-Vercel והתקינים הועלו. נדרשו שתי העלאות: הראשונה נשאה `\r\n` נגרר, ראה §3.4.

**קריסת `/api/session`** — 500 גנרי בכל קריאה, בגלל `ERR_REQUIRE_ESM` ב-`jose`. נפתר בנעילת `jose` לגרסה 5; ההסבר המלא ב-[deploy-vercel.md](deploy-vercel.md).

**מפתח השירות** — הופק מקונסולת Firebase (לא דרך `gcloud`, שאינו מותקן) והועלה. `/api/session` מחזיר עכשיו 401 על טוקן מזויף במקום 503, כלומר ה-Admin SDK אותחל ומאמת באמת.

**מזהה המפתח החדש:** `…bb0f06`. קובץ ה-JSON נמחק מ-`Downloads` מיד אחרי הקידוד; הערך חי רק ב-Vercel וב-`.env.local`.

---

## 2א. שער הביתא הוסר

`ACCESS_CODE`, `/api/access`, `AccessForm` ועוגיית `pdf2code_gate` נמחקו. מסך הכניסה מציג מיד את טופס החשבון.

**המשמעות: כל מי שמגיע לכתובת יכול לפתוח חשבון.** מי רשאי להיכנס הוא מעכשיו החלטה של Firebase Authentication, ומגבילים אותה שם — לא בקוד. אם צריך לסגור את זה שוב, האפשרויות הן להשבית הרשמה עצמית ב-Firebase, או להחזיר את השער מהיסטוריית הגיט.

עוגיות `pdf2code_gate` שנשארו בדפדפנים פשוט לא נקראות יותר, ויפוגו מעצמן.

כניסת המפתחים שרדה במסלול נפרד, `/api/dev-session`, כי היא הדרך היחידה להריץ את האפליקציה בלי פרויקט Firebase. היא מחזירה 404 בכל בילד פרודקשן.

---

## 3. התהליך המלא ממחשב חדש

השלבים 3.1, 3.3, 3.4 ו-3.5 כבר בוצעו במחשב הנוכחי. הם נשארים כאן כהוראה למחשב הבא.

### 3.1 להוריד

```bash
git clone https://github.com/liormedan/pdf2code.git
cd pdf2code
npm install
```

הפיקסצ'רים לא בגיט — `npm run qa` ו-`npm test` ייפלו על `ENOENT` בלעדיהם. שלושה מקורות נפרדים, וצריך את שלושתם:

```bash
npm run fixtures
node scripts/make-test-pdf.mjs fixtures/09-hostile-text.pdf
node scripts/make-test-pdf.mjs fixtures/10-large-150p.pdf 150
```

הראשון מוריד שמונה מסמכים אמיתיים מהקורפוס של pdf.js; שני האחרונים נוצרים מקומית ולכן אינם מכוסים על ידו.

### 3.2 לבנות את `.env.local`

ארבעת ערכי Firebase ציבוריים בכוונת התכנון — הם מזהים את הפרויקט ולא מאשרים דבר, ונצרבים ממילא לתוך הבאנדל:

```bash
cat > .env.local <<'EOF'
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

**`FIREBASE_SERVICE_ACCOUNT`** — את המפתח הפרטי אי אפשר להוריד שוב, גוגל נותנת אותו פעם אחת. הדרך הקצרה היא דרך הדפדפן ולא `gcloud`, שדורש התקנה והתחברות:

Firebase Console → **Project settings → Service accounts → Generate new private key**. יורד קובץ JSON. ואז:

```bash
node -e "console.log(require('fs').readFileSync('key.json').toString('base64'))"
```

את הפלט מדביקים אחרי `FIREBASE_SERVICE_ACCOUNT=`, בשורה אחת, **ומוחקים את קובץ ה-JSON** — אסור שיישאר עותק שני של קרדנשיאל חי.

מפתח חדש לא מבטל מפתחות קיימים; הם חיים במקביל עד שמוחקים אותם במפורש.

### 3.3 לוודא מקומית לפני שנוגעים בפרודקשן

```bash
npm run dev
```

אם `/login` מציג את טופס החשבון ולא את הודעת "חשבונות לא מוגדרים" — הקובץ תקין. כדאי גם:

```bash
npm run qa
npm test
```

### 3.4 לתקן את המשתנים ב-Vercel

```bash
npm i -g vercel@48
vercel login
vercel link --yes --project pdf2code --scope liormedans-projects
```

**לא `vercel@latest`.** גרסאות 59 ומעלה לא קוראות את `auth.json` הישן ומדווחות "Logged out" מול התחברות תקפה. גרסה 48 קוראת אותו, וגם עומדת בדרישת המינימום של שרת הפריסה. אם בכל זאת הותקנה גרסה חדשה יותר, `vercel login` מחדש יפתור — אבל זו התחברות בדפדפן.

קודם למחוק את הריקים, אחרת הם ידרסו את מה שיתווסף:

```bash
for v in SESSION_SECRET NEXT_PUBLIC_FIREBASE_API_KEY NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN NEXT_PUBLIC_FIREBASE_PROJECT_ID NEXT_PUBLIC_FIREBASE_APP_ID FIREBASE_SERVICE_ACCOUNT SOFFICE_PATH NEXT_PUBLIC_GOOGLE_CLIENT_ID NEXT_PUBLIC_GOOGLE_API_KEY NEXT_PUBLIC_GOOGLE_APP_ID; do vercel env rm "$v" production -y; done
```

ואז להעלות מהקובץ התקין:

```bash
while IFS='=' read -r k v; do [ -n "$k" ] && [ "${k#\#}" = "$k" ] && printf '%s' "$v" | vercel env add "$k" production; done < .env.local
```

**`printf` ולא `echo`, ולא צינור של PowerShell.** `vercel env add` לוקח את הערך מ-stdin כמו שהוא, כולל תו שורה נגרר, וזה מזהם את הסוד. הקוד עצמו כבר עמיד לזה — ה-`trim` יושב בתוך `hmacKey`, בנקודה היחידה שבה הסוד הופך למפתח — אבל ערך מזוהם עדיין מבלבל כל בדיקה ידנית. לאמת אחרי ההעלאה:

```bash
vercel env pull /tmp/check --environment=production --yes
```

אם אורך ערך שונה מהאורך אחרי `trim`, ההעלאה מזוהמת.

**לא מוסיפים** `SOFFICE_PATH`, `NEXT_PUBLIC_GOOGLE_*` ו-`NEXT_PUBLIC_ENABLE_PPTX`. אין LibreOffice על Vercel, ו-Slides עוד לא מוגדר — כפתור שייראה שם רק ייכשל.

### 3.5 לפרוס מחדש

```bash
vercel --prod
```

חובה, לא קוסמטיקה: משתני `NEXT_PUBLIC_` נצרבים בזמן הבנייה, ולכן שינוי שלהם לא נוגע בפריסה קיימת.

---

## 4. רשימת מטלות

### בוצע

- [x] `.env.local` נבנה, עם `SESSION_SECRET` חדש
- [x] אומת מקומית — 70 בדיקות QA, בדיקות הממיר, `tsc` נקי
- [x] המשתנים הריקים נמחקו מ-Vercel; התקינים הועלו
- [x] `jose` ננעל לגרסה 5 — קריסת `/api/session` בפרודקשן נפתרה
- [x] תוקן `\r\n` נגרר בערכי הסביבה, וה-`trim` הועבר לתוך `hmacKey` כדי שזה לא יחזור
- [x] `pdf2code.vercel.app` נוסף ל-Authorized domains
- [x] מפתח השירות הופק והועלה — `/api/session` מחזיר 401 ולא 503
- [x] מסד Firestore נוצר ונגיש
- [x] שער הביתא הוסר; מסך הכניסה מציג מיד הרשמה ו"המשך עם Google"

### מיד

- [ ] **לדחוף את הקומיטים המקומיים.** הפרודקשן נפרס מהקבצים המקומיים, ולכן בנייה מגיט בלעדיהם תחזיר את קריסת `jose` ואת השער
- [ ] הרשמה אמיתית אחת דרך האפליקציה — עדיין לא נוצר אף משתמש
- [ ] לוודא שנוצרה רשומת `users/{uid}` עם `keepFileNames`, `locale` ו-`usage`
- [ ] המרת PDF מקצה לקצה בפרודקשן, כולל הורדת ה-ZIP

### להחליט

- [ ] **הרשמה פתוחה לכל.** אחרי הסרת השער, כל מי שמגיע לכתובת יכול לפתוח חשבון. אם זה לא הכוונה — להשבית הרשמה עצמית ב-Firebase Authentication, או להגביל לדומיין אימייל
- [ ] למחוק מפתחות שירות ישנים. קיימים כעת `0d5af2c5…` מהמחשב הקודם ו-`…bb0f06` הנוכחי. מפתח חדש לא מבטל ישן

### ספרינט 2 — פרויקטים ב-Firestore — 10%

- [ ] `firestore.rules` ו-`firestore.indexes.json` — המסד פתוח כרגע לפי חוקי ברירת המחדל
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
