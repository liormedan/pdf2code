# פרויקטים — מפרט מימוש

היסטוריית ההמרות שורדת רענון, ואפשר לנהל אותה.

נכתב: 19 באוגוסט 2026. ספרינט 2, משקל 10%.

> **בוצע במלואו באותו יום, שלוש הפרוסות.** שני דברים יצאו שונה מהמפרט, ושניהם לטובה:
>
> **חוקי הגישה נשארו סגורים לחלוטין.** המפרט נתן `allow read` לבעלים. בפועל הקריאה עוברת דרך ה-API ממילא, ולכן ההרשאה הייתה פותחת משטח תקיפה בלי לקנות דבר — וגם חוסכת את ה-SDK של Firestore מבאנדל הלקוח.
>
> **האינדקס לא נוצר, כי הוא עדיין לא נדרש.** התנאי `where("archived", "==", false)` הוסר; הרשימה ממיינת בלבד והארכוב מסונן אחרי הקריאה. זה נכון לעשרות פרויקטים ומפסיק להיות נכון כשיגיע עימוד.

ההנמקה להכרעות שמאחורי המפרט הזה נמצאת ב-[conversion-plan.md §5](conversion-plan.md). כאן רק מה שצריך כדי לבנות.

---

## 1. המטרה, ומה מחוץ לתחום

**המטרה:** שני דפדפנים של אותו משתמש רואים אותה רשימה. משתמש אחר לא רואה כלום.

**מחוץ לתחום, לצמיתות:** הקובץ, הפלט, טקסט מהמסמך, תמונה ממנו. הרשומה אומרת שהמרה קרתה — לא מה היה בה.

**נקודת הפתיחה:** המסד קיים. החוקים שנוצרו איתו הם `allow read, write: if false`, כלומר הלקוח חסום לחלוטין ו-`/api/session` כותב `users/{uid}` דרך ה-Admin SDK שעוקף חוקים. אין מיגרציה של נתונים — ההיסטוריה היום חיה בזיכרון הטאב ונמחקת ממילא.

---

## 2. הסכימה

```
users/{uid}/projects/{projectId}

  name             string      שם המסמך, או מחרוזת גנרית כש-keepFileNames כבוי
  kind             "pdf" | "pptx" | "slides"
  driveFileId      string?     רק ל-slides. המפתח הטבעי, ומה שמאפשר הרצה חוזרת
  sourceSize       number?     לזיהוי הקובץ בבחירה חוזרת. חסר ל-slides
  pages            number
  formats          OutputFormat[]
  background       boolean
  outputBytes      number
  createdAt        Timestamp
  lastConvertedAt  Timestamp
  runCount         number
  archived         boolean
```

**`archived` הוא בוליאני ולא חותמת זמן.** שאילתת הרשימה מסננת לפיו, ובוליאני מתאנדקס נקי; `archivedAt == null` עובד ב-Firestore אבל מסבך את האינדקס בלי להחזיר ערך. מתי משהו אורכב הוא מידע שאיש לא ביקש.

---

## 3. חוקי הגישה

`firestore.rules`:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // הלקוח קורא את עצמו בלבד, ולא כותב כלום. כל כתיבה עוברת ב-/api/projects
    // דרך ה-Admin SDK, שעוקף את החוקים האלה ממילא — ולכן אין כאן ולידציית
    // סכימה: היא הייתה קוד אבטחה ארוך שאף בקשה אמיתית לא מגיעה אליו.
    match /users/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if false;

      // כללי תת-אוסף אינם נורשים מההורה, ולכן הוא כתוב במפורש.
      match /projects/{projectId} {
        allow read: if request.auth != null && request.auth.uid == uid;
        allow write: if false;
      }
    }

    // כל השאר סגור. ברירת מחדל ולא הצהרה — אבל כדאי שתהיה כתובה.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**בדיקה שחייבת לרוץ:** משתמש א' מנסה לקרוא `users/{uid-של-ב'}/projects` ונדחה, ומשתמש מאומת מנסה לכתוב ישירות ונדחה גם הוא.

---

## 4. האינדקס

השאילתה היחידה של המסך היא "הפרויקטים הפעילים שלי, החדש קודם":

```js
where("archived", "==", false), orderBy("lastConvertedAt", "desc"), limit(50)
```

שדה שוויון בתוספת מיון על שדה אחר דורש אינדקס מורכב. `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "projects",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "archived", "order": "ASCENDING" },
        { "fieldPath": "lastConvertedAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

**לא לדחות את זה לסוף.** Firestore נכשל על אינדקס חסר **בזמן ריצה** ולא בבנייה, ההודעה מגיעה עם קישור ליצירתו, וזה מתגלה תמיד אצל המשתמש הראשון שיש לו מספיק רשומות.

---

## 5. חוזה ה-API

כל הרוטים קוראים את ה-uid מעוגיית הסשן דרך `readSession` ב-[auth.ts](../src/lib/auth.ts), ולא סומכים על שום מזהה בגוף הבקשה.

### `POST /api/projects`

```
{ name, kind, driveFileId?, sourceSize?, pages, formats, background, outputBytes }
→ 201 { id, created: boolean }
```

**התנהגות upsert:** אם `kind === "slides"` ויש `driveFileId`, מחפשים פרויקט קיים עם אותו מזהה. נמצא — `lastConvertedAt` מתעדכן, `runCount` עולה, ו-`created: false` חוזר. לא נמצא, או כל מקור אחר — נוצרת רשומה חדשה.

זה מה שהופך פרויקט למסמך במקום לשורת יומן. מצגת שמיוצאת כל שבוע נשארת שורה אחת.

**שני דברים שהשרת עושה ושהלקוח לא יכול לעקוף:**

1. `keepFileNames` נקרא מ-`users/{uid}`, וכשהוא כבוי `name` **נכתב** כמחרוזת גנרית. לא מוסתר בתצוגה — מה שלא נכתב לא יכול לדלוף.
2. `usage` מתעדכן: `conversions` ו-`pages` עולים, והחודש מתאפס כשהוא מתחלף. השדה נכתב היום פעם אחת בהרשמה ואף פעם לא אחריה, וספרינט 6 דורש שהוא ייכתב בשרת בלבד — כלומר המכסות נפתחות כאן כמעט בחינם.

### `PATCH /api/projects/[id]`

```
{ name?, archived? }
→ 200 { ok: true }
```

`name` הוא השדה היחיד שהמשתמש עורך. כשהוא נכתב, `keepFileNames` נבדק שוב.

### `DELETE /api/projects/[id]`

```
→ 200 { ok: true }
```

מחיקה אמיתית ומיידית. לא tombstone, לא סימון.

---

## 6. תיקון שקודם לכל הרוטים

**הבעיה:** ה-matcher ב-[middleware.ts](../middleware.ts) תופס את `/api/*`, וכשאין סשן הוא מחזיר `NextResponse.redirect` ל-`/login`. `fetch` עוקב אחרי הפניות כברירת מחדל, ולכן הלקוח מקבל **200 עם HTML של דף הכניסה**, `response.ok` הוא true, והוא מנתח את דף ההתחברות כאילו היה התשובה.

אומת בפרודקשן:

```
POST /api/presentation  →  307  →  /login?next=%2Fapi%2Fpresentation
                        →  200  text/html
```

זה כבר באג רדום ב-`/api/presentation`: סשן שפג באמצע העבודה ייכשל עם "PDF פגום" במקום "התחבר מחדש". עם `/api/projects` הוא יפגע מיד ובכל בקשה.

**התיקון:** ה-middleware מבחין בין דף לבין API. נתיב שמתחיל ב-`/api/` מקבל `401` עם גוף JSON; דף ממשיך לקבל הפניה.

```ts
if (request.nextUrl.pathname.startsWith("/api/")) {
  return NextResponse.json({ error: "Not signed in." }, { status: 401 });
}
```

---

## 7. מה משתנה, קובץ אחר קובץ

| קובץ | שינוי |
| --- | --- |
| `firestore.rules` | חדש |
| `firestore.indexes.json` | חדש |
| `app/api/projects/route.ts` | חדש — `POST` |
| `app/api/projects/[id]/route.ts` | חדש — `PATCH`, `DELETE` |
| [`middleware.ts`](../middleware.ts) | 401 ל-`/api/*` במקום הפניה |
| [`src/lib/session-activity.tsx`](../src/lib/session-activity.tsx) | המימוש עובר ל-Firestore. **הממשק נשאר** |
| [`src/lib/firebase/client.ts`](../src/lib/firebase/client.ts) | חשיפת `getFirestore` ללקוח |
| [`app/(dashboard)/activity/page.tsx`](<../app/(dashboard)/activity/page.tsx>) | פעולות בשורה, ובהמשך שינוי שם ל"פרויקטים" |
| [`app/(dashboard)/settings/page.tsx`](<../app/(dashboard)/settings/page.tsx>) | מתג `keepFileNames` |

**הנקודה החשובה בטבלה:** `ActivityProvider` חושף היום `entries`, `record`, `clear` ו-`totals`. אם הממשק נשמר, **מסך הפעילות ומסך הסקירה לא משתנים בכלל** בפרוסה הראשונה — רק מפסיקים להתאפס. זה מה שהופך את הפרוסה הזו לקטנה.

**חריג אחד:** ל-`clear` תהיה משמעות אחרת. היום הוא מנקה טאב; מעכשיו הוא מוחק הכל לתמיד. הוא צריך להפוך ל"מחק את כל הפרויקטים" עם אישור, ולא כפתור שקורה מיד.

**עלות שכדאי למדוד:** `firebase/firestore` נכנס לבאנדל הלקוח. הוא לא קטן. שווה לבדוק אם קריאה דרך ה-API מספיקה לפרוסה 1, ולהשאיר את ה-realtime לפרוסה שבה הוא באמת נדרש.

---

## 8. שלוש פרוסות

### פרוסה 1 — שההיסטוריה תשרוד רענון

חוקים, אינדקס, `POST /api/projects`, תיקון ה-middleware, וקריאה בלקוח. שום ממשק חדש.

**תנאי קבלה:** ממירים מסמך, מרעננים את הדף, והשורה עדיין שם. נכנסים מדפדפן שני עם אותו חשבון ורואים אותה.

### פרוסה 2 — שהשורות יעשו משהו

שינוי שם, ארכוב, מחיקה, מיון וסינון לפי מקור. `keepFileNames` בהגדרות ונאכף בכתיבה.

**תנאי קבלה:** מכבים את `keepFileNames`, ממירים, ובודקים **במסד** שהשם הגנרי הוא מה שנכתב — לא שהשם האמיתי מוסתר בתצוגה.

### פרוסה 3 — הרצה חוזרת

Slides בלחיצה לפי `driveFileId`. PDF ו-PPTX בבחירה מחדש, עם השוואת שם וגודל שמתריעה על אי-התאמה ולא חוסמת.

**תנאי קבלה:** פרויקט Slides מייצר מחדש את אותו פלט בלחיצה אחת.

**מלכודת:** הטוקן של גוגל פג. הרצה חוזרת אחרי שבוע תדרוש אישור מחדש, והכפתור צריך להצהיר על כך מראש ולא להיכשל באמצע.

---

## 9. בדיקות

בתוספת ל-`npm run qa`:

- משתמש א' לא קורא את הפרויקטים של ב' — נדחה בחוקים
- לקוח מאומת לא כותב ישירות — נדחה בחוקים
- `POST` פעמיים עם אותו `driveFileId` → רשומה אחת, `runCount` שתיים
- `POST` פעמיים עם אותו קובץ PDF → שתי רשומות
- `keepFileNames` כבוי → השם הגנרי הוא מה שנכתב במסד
- `usage.conversions` ו-`usage.pages` עולים בכל המרה
- החודש ב-`usage` מתחלף ומאפס את הספירה
- רוט API בלי סשן → 401 JSON, לא 307 להתחברות

---

## 10. מה שיישבר בקנה מידה

מסך הפעילות מוגבל היום ל-50 רשומות בזיכרון. עם מסד אמיתי הגבול נעלם, ואיתו מגיע עימוד. `limit(50)` בשאילתה הוא לא פתרון אלא דחייה — הוא רק קובע מתי הבעיה תתגלה.
