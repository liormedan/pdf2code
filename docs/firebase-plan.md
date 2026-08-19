# Firebase — תוכנית ואיפיון

חשבונות והרשמה, ניהול פרויקטים, **בלי אחסון קבצים**. המסמך מגדיר מה נכנס, איך זה מתחבר למה שכבר קיים, ואיפה ההנחות שצריך להכריע בהן.

---

## 1. היקף

**נכנס:** Firebase Auth (הרשמה, התחברות, איפוס סיסמה) ו-Cloud Firestore (פרויקטים והעדפות משתמש).

**לא נכנס:** Firebase Storage. לא כתלות, לא כ-fallback, לא "רק לפלט". שום בייט של מסמך משתמש לא נכתב לדיסק שלנו — לא המקור ולא הפלט.

**נשאר כפי שהוא:** מנוע ההמרה ומנגנון העוגייה החתומה. Firebase מתווסף מסביב, לא מחליף.

---

## 2. ההחלטה המרכזית: Auth שלא נוגע ב-middleware

`middleware.ts` רץ ב-Edge runtime ומאמת עוגייה חתומה ב-HMAC דרך `src/lib/auth.ts`. `firebase-admin` **לא רץ ב-Edge**, ואימות עוגיית סשן של Firebase שם היה דורש אימות JWT מול ה-JWKS של גוגל בכל בקשה.

לכן: Firebase מאמת **פעם אחת**, בכניסה, ומנפיק את אותה עוגייה שכבר קיימת היום.

```
דפדפן                       השרת שלנו (Node)            Firebase
  │ signInWithEmailAndPassword    │                        │
  │──────────────────────────────────────────────────────►│
  │◄──────────── idToken ─────────────────────────────────│
  │                               │                        │
  │──── POST /api/session ───────►│                        │
  │        { idToken }            │─ verifyIdToken ───────►│
  │                               │◄── uid, email ─────────│
  │◄── Set-Cookie (HMAC + uid) ───│   ← המנגנון שקיים היום
```

מכאן ואילך כל בקשה מאומתת ב-Edge בדיוק כמו עכשיו — בלי קריאת רשת ובלי SDK כבד בכל ניווט. `middleware.ts` לא משתנה בכלל; מה שמשתנה הוא מי מנפיק את העוגייה ומה יש בתוכה.

**מה נוסף למטען העוגייה:** `uid`. זה מה שמאפשר את כל השאר.

`/api/access` ועוגיית `pdf2code_gate` **הוסרו** — קוד הגישה בוטל, וחשבון הוא הדבר היחיד שמוכיח משהו. `/api/session` מנפיק את עוגיית הזהות. כפתור **כניסת מפתחים** מדלג עליו דרך `/api/dev-session`, שמחזיר 404 לפי `NODE_ENV` ולא רק מוסתר בממשק.

---

## 3. מודל הנתונים

```
users/{uid}
  email           string
  displayName     string | null
  locale          "en" | "he"
  keepFileNames   boolean          ← ברירת מחדל true; ראה §7
  createdAt       timestamp
  usage           { month: "2026-08", conversions: number, pages: number }
                                   ← נכתב אך ורק בשרת

users/{uid}/projects/{projectId}
  name            string           ← ניתן לעריכה; זה עיקר ה"ניהול"
  archived        boolean
  createdAt       timestamp
  updatedAt       timestamp

  source
    kind          "pdf" | "pptx" | "slides"
    fileName      string | null    ← null כאשר keepFileNames כבוי
    sizeBytes     number
    driveFileId   string | null    ← ל-slides בלבד; זה מה שהופך פרויקט לניתן להרצה חוזרת

  document
    pages, converted, title, lang, dir, scanned

  options
    formats       ["html"] | ["react"] | שניהם
    background    boolean
    backgroundScale number

  output
    files         [{ name, bytes }]   ← גדלים בלבד, לעולם לא תוכן
    warnings      [{ code, params }]
```

**שדות אסורים, באכיפת rules:** `storagePath`, `downloadUrl`, `contents`, `dataUri`, או כל שדה מחוץ לרשימה הסגורה. `hasOnly()` חוסם הוספת שדה חדש בלי לעדכן את החוקים — כלומר אי אפשר להחליק תוכן פנימה בטעות.

**הערה שמחזקת את ההחלטה:** מסמך ב-Firestore מוגבל ל-1MiB. פלט HTML של מסמך אמיתי גדול מזה. כלומר גם אילו רצינו לשמור את הפלט ב-DB במקום ב-Storage — לא היה אפשר. ההחלטה העסקית וההגבלה הטכנית מצביעות לאותו מקום.

---

## 4. מי כותב מה

| פעולה | מי מבצע | למה |
| --- | --- | --- |
| קריאת פרויקטים | הלקוח ישירות מול Firestore | realtime ו-offline בחינם, בלי route ביניים |
| יצירה, שינוי שם, מחיקה, ארכוב | ה-API שלנו עם Admin SDK | כדי שמונים לא יהיו ניתנים לזיוף |
| `usage` | השרת בלבד | אותו טעם |

חוקי Firestore הופכים את `projects` ל**קריאה בלבד עבור הלקוח**. אין Cloud Functions בתמונה — יש כבר שרת Next, ואין סיבה להוסיף עוד סביבת ריצה ועוד cold start.

```
match /users/{uid} {
  allow get: if request.auth.uid == uid;
  allow update: if request.auth.uid == uid
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['displayName', 'locale', 'keepFileNames']);

  match /projects/{projectId} {
    allow read: if request.auth.uid == uid;
    allow write: if false;        // דרך ה-API בלבד
  }
}
```

---

## 5. מה "פרויקט" אומר בלי קבצים

פרויקט הוא **רשומה של המרה**, לא עותק שלה. אחרי סגירת הטאב ההורדה כבר לא זמינה — צריך להמיר מחדש. ההרצה החוזרת נראית אחרת לפי המקור, וזה ההבדל המעניין:

| מקור | הרצה חוזרת |
| --- | --- |
| **Google Slides** | **בלחיצה אחת.** יש `driveFileId`, וגוגל מייצאת שוב. אפס אחסון, שחזור מלא. |
| PDF | לבחור את הקובץ שוב. ההגדרות, השם והפורמטים כבר שמורים. |
| PowerPoint | לבחור את הקובץ שוב, והוא עובר שוב דרך LibreOffice. |

כשמשתמש בוחר קובץ להרצה חוזרת ו-`sizeBytes` או `fileName` לא תואמים לרשומה — להתריע שזה כנראה קובץ אחר, לא לחסום.

זו הנקודה החזקה של מסלול Slides: הוא היחיד שנותן "פרויקט שמור" אמיתי בלי שנשמור כלום.

---

## 6. שינויי קוד

**חדש**

```
src/lib/firebase/client.ts      אתחול ה-SDK המודולרי, auth ו-firestore
src/lib/firebase/admin.ts       Admin SDK — server-only, לעולם לא מיובא מקומפוננטת לקוח
src/lib/projects.ts             קריאות realtime בלקוח + עטיפות הכתיבה מול ה-API
app/api/session/route.ts        idToken → עוגיית זהות
app/api/projects/route.ts       יצירה ורשימה
app/api/projects/[id]/route.ts  שינוי שם, ארכוב, מחיקה
firestore.rules
firestore.indexes.json          projects לפי createdAt יורד, ולפי archived
```

**משתנה**

```
src/lib/auth.ts                 המטען גדל ב-uid
app/login/                      הרשמה, התחברות, איפוס סיסמה
src/lib/session-activity.tsx    ממקור בזיכרון למראה של Firestore
app/(dashboard)/activity/       הופך למסך הפרויקטים
app/(dashboard)/convert/        רישום פרויקט בסיום המרה
.env.example                    מפתחות Firebase
```

**לא משתנה:** `src/converter/`, `middleware.ts`, `src/lib/intake.ts`, `src/lib/office-server.ts`.

---

## 7. אבטחה ופרטיות

**שמות קבצים הם מידע.** "תוכנית פיטורים Q3.pdf" מספר סיפור גם בלי הקובץ. `keepFileNames` בהגדרות מאפשר לכבות; כשהוא כבוי נשמר `null` והתצוגה נופלת ל-`document.title` או לתאריך.

**אכיפת מכסה — כאן יש בעיה אמיתית.** ההמרה רצה בדפדפן, כלומר **השרת לא יכול לספור עמודים בעצמו**. ההערה ב-`src/lib/pricing.ts` אומרת שהשרת חייב לחשב מחדש ולא לסמוך על מספר שהדפדפן שלח — ובמסלול ה-PDF זה בלתי אפשרי, כי השרת לא רואה את המסמך. שלוש דרכים:

1. **לחייב לפי המרה, לא לפי עמוד.** השרת יכול לספור המרות. פשוט, אכיף, ומשנה את טבלת התמחור.
2. **לספור עמודים לצורכי היסטוריה ומכסה רכה בלבד**, ולא לתלות בזה כסף.
3. להעביר כל מסמך דרך השרת — שובר את הבטחת הפרטיות. לא מומלץ.

עד שיוכרע — לרשום `pages` כפי שהלקוח דיווח, ולסמן אותו כלא-מאומת.

**App Check** על `/api/presentation`: זה ה-endpoint היחיד שעולה כסף ומריץ LibreOffice על קלט לא מהימן. עכשיו כשיש חשבונות, שווה גם rate limit לכל `uid`.

**מפתח השירות** נכנס כמשתנה סביבה מקודד בבסיס64, נקרא רק ב-`src/lib/firebase/admin.ts`, ואסור שידלוף לצד הלקוח. שווה בדיקת QA שמוודאת שאין `NEXT_PUBLIC` על אף מפתח פרטי.

---

## 8. שלבי ביצוע

1. ~~**Auth בלבד.** הרשמה, התחברות, `/api/session`, מסמך משתמש.~~ **בוצע.** קוד הגישה נשאר כשער ראשון בביתא, והחשבון הוא השער השני — שתי עוגיות נפרדות, ראה `src/lib/auth.ts`.
2. **פרויקטים.** רישום בסיום המרה, מסך רשימה, שינוי שם, מחיקה, ארכוב. חוקי Firestore ואינדקסים.
3. **הרצה חוזרת.** Slides בלחיצה; PDF ו-PPTX עם בחירה מחדש והשוואת חתימה.
4. **מכסות ותוכניות.** רק אחרי שהוכרע במה מודדים.

כל שלב עומד בפני עצמו וניתן לשחרור בנפרד.

---

## 9. עלות

Auth ו-Firestore ברמת השימוש הזו נמצאים בתוך המכסה החינמית בפער גדול — רשומת פרויקט היא כמה מאות בייטים. בלי Storage אין אחסון לחיוב ואין תעבורה יוצאת. העלות המשמעותית היחידה נשארת ה-CPU של LibreOffice במסלול ה-PPTX.

---

## 10. מה צריך להכריע

- **יחידת החיוב:** המרה או עמוד. §7 מסביר למה זו לא רק שאלת מחיר.
- **ספקי כניסה:** אימייל וסיסמה בלבד, או גם Google. כניסה עם Google מתיישבת יפה עם ייבוא Slides — אותה זהות, פחות חיכוך.
- **קוד הגישה המשותף:** להסיר עם המעבר לחשבונות, או להשאיר כשער נוסף בזמן הביתא.
