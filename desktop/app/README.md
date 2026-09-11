# pdf2code Desktop — האפליקציה

ספרינט 1: הקליפה. חלון שנפתח, מדבר עברית ואנגלית, ונארז להתקנה. **אין כאן המרה, וזה מכוון** — האפיון ב-[../spec.md](../spec.md), הסדר וההנמקה ב-[../roadmap.md](../roadmap.md).

---

## הרצה

```bash
npm install
npm run app
```

`npm run app` הוא `tauri dev`: הוא מרים את Vite ופותח את החלון עליו. לפיתוח ממשק בלבד, `npm run dev` מספיק ונפתח בדפדפן על `localhost:1447` — לא 1420, ברירת המחדל של Tauri, שפרויקט אחר על המכונה כבר תופס.

| פקודה | מה היא עושה |
| --- | --- |
| `npm run app` | החלון, עם Vite מאחוריו |
| `npm run dev` | הפרונט בלבד, בדפדפן |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | טייפצ'ק ובניית הפרונט ל-`dist/` |
| `npm run bundle` | `tauri build` — MSI ו-NSIS ל-`src-tauri/target/release/bundle/` |

**דרישות:** Node 22+, Rust (‏`rustup`), ו-WebView2 — שקיים בכל Windows 10/11 מעודכן, ומותקן על ידי המתקין אם חסר.

---

## מה הועבר מאפליקציית הווב, ומה נכתב מחדש

| מה | מאיפה | מה השתנה |
| --- | --- | --- |
| `src/components/ui/` — 16 רכיבים | `components/ui/` | הוסרו הוראות `"use client"`. שום שינוי אחר |
| `src/components/logo.tsx` | `components/logo.tsx` | ללא שינוי |
| `src/lib/utils.ts` | `lib/utils.ts` | ללא שינוי |
| `src/index.css` — טוקני העיצוב | `app/globals.css` | ללא שינוי. **הביקורת שמאמתת אותם (`npm run contrast`) עדיין רצה בשורש** |
| `src/messages/` | `messages/` | נוסף מרחב השמות `desktop` |
| `src/components/theme-toggle.tsx` | `components/theme-toggle.tsx` | שורת ייבוא אחת |
| `src/i18n/config.ts` | `src/i18n/config.ts` | `Direction` מוגדר מקומית; `negotiate` על כותרת HTTP הוחלף ב-`nearest` על `navigator.language` |
| `src/i18n/provider.tsx` | — | **חדש.** מחליף את `next-intl` בשמונים שורות, עם אותן חתימות: `useTranslations(ns)` ו-`useLocale()` |
| `src/components/language-switcher.tsx` | `components/language-switcher.tsx` | פעולת שרת ← מצב מקומי |
| `src/components/app-shell.tsx` | — | **חדש.** לא נמל של המקור: שם היה סרגל צד סביב ראוטר, וכאן אין ראוטר ואין דפים |

---

## שלוש החלטות שכדאי לדעת עליהן לפני שנוגעים

**1. `@` מצביע על `src/`.** זה מה שאפשר לשישה-עשר רכיבי shadcn לעבור בלי לגעת בהם: הם מייבאים `@/lib/utils` ו-`@/components/ui/…`, וזה נפתר כאן בדיוק כמו תחת Next.

**2. הערכה מוחלת לפני הצביעה הראשונה, מקובץ ולא משורה.** `public/theme-boot.js` נטען מה-`<head>`. הוא קובץ ולא בלוק `inline` כי ה-CSP קובע `script-src 'self'` — והתיקון הנכון הוא להזיז את הקוד, לא להרחיב מדיניות שמגנה על חלון שירנדר בבוא היום מסמכים שאיש לא בדק.

**3. הכיווניות נגזרת, לא מוגדרת.** `<html lang>` ו-`dir` נכתבים מהלוקאל בזמן ריצה, כי `dir`-aware CSS חייב לעבוד גם בפורטלים שמרונדרים מחוץ לעץ של React.

---

## מה שאין כאן בכוונה

- **גישה לקבצים.** ה-capability היחיד הוא `core:default`. אין `fs`, אין `dialog`, אין `shell`. הפרונט לא נוגע בדיסק — הוא נוקב בנתיבים, וצד ה-Rust מחליט. נכנס בספרינט 5
- **המנוע.** הסיידקאר הפייתוני נכנס בספרינט 2. שורת המצב בתחתית החלון אומרת ״לא מחובר״ ולא מתחזה למשהו אחר
- **`frame-src`** מוגדר `'none'`. כשתגיע התצוגה המקדימה של הפלט היא תיפתח ב-`iframe` עם `sandbox`, וההרחבה תהיה מכוונת ומתועדת
