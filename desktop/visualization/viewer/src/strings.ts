/**
 * The viewer's own words, in the two languages the team reads.
 *
 * **Not the product's i18n.** This tool used to live inside the app and borrow
 * `useTranslations`, which put twenty-two developer strings into the bundles a customer
 * ships and made `check-i18n` responsible for them. Pulling the viewer out means pulling
 * its vocabulary out too — otherwise "it is not part of the product" would be true of the
 * code and false of the strings.
 *
 * A plain object rather than a library: there are twenty of them, they are read by five
 * people, and a dev tool that needs a translation framework has stopped being a dev tool.
 */
export type Lang = "he" | "en";

const WORDS = {
  he: {
    title: "מפת המערכת",
    subtitle: "מה התוכנה הזו עשויה ממנו, ואיפה היא עומדת. נוצר מהמסמכים, לא מצויר ביד.",
    devOnly: "כלי מפתחים. אינו חלק ממוצר pdf2code ואינו נארז אליו.",
    progress: "{reached}% · {done} מתוך {total} ספרינטים סגורים",
    state_done: "הושלם",
    state_partly: "בפיתוח",
    state_blocked: "חסום",
    state_open: "מחוץ לטווח או ממתין",
    processes: "שלושת התהליכים",
    sprints: "ספרינטים",
    decisions: "הכרעות פתוחות",
    forbidden: "מה שאסור, ולמה",
    inspector: "פרטים",
    pickSomething:
      "בחרו חלק, ספרינט או הכרעה — כאן או במפה — כדי לראות מה הוא, אילו קבצים שייכים לו, ומה מצבו.",
    clear: "לנקות את הבחירה",
    loading: "טוען את המפה התלת-ממדית…",
    canvasNote:
      "גרירה מסובבת, גלגלת מקרבת. התמונה היא תוספת — כל מה שיש בה נמצא גם ברשימה שלצדה, שנגישה למקלדת ולקורא מסך.",
    decisionBlocks: "חוסמת ספרינט {list}",
    decisionOpen: "פתוחה, אינה חוסמת ספרינט",
    decisionMoot: "התייתרה",
    decisionMootWhy: "התייתרה. נשארת ביומן כי הכיוון שבו ההמלצה התהפכה הוא חלק ממנו.",
    generatedFrom: "נוצר מ-{count} מסמכים. `npm run map:check` נכשל אם המפה מיושנת.",
    language: "English",
  },
  en: {
    title: "System map",
    subtitle:
      "What this program is made of, and where it stands. Generated from the documents, not drawn by hand.",
    devOnly: "Developer tooling. Not part of the pdf2code product and never packaged into it.",
    progress: "{reached}% · {done} of {total} sprints closed",
    state_done: "Done",
    state_partly: "In progress",
    state_blocked: "Blocked",
    state_open: "Out of scope or waiting",
    processes: "The three processes",
    sprints: "Sprints",
    decisions: "Open decisions",
    forbidden: "What is refused, and why",
    inspector: "Details",
    pickSomething:
      "Pick a part, a sprint or a decision — here or in the map — to see what it is, which files belong to it, and where it stands.",
    clear: "Clear the selection",
    loading: "Loading the 3D map…",
    canvasNote:
      "Drag to turn, scroll to zoom. The picture is an addition — everything in it is also in the list beside it, which is reachable by keyboard and by a screen reader.",
    decisionBlocks: "Blocks sprint {list}",
    decisionOpen: "Open, blocks no sprint",
    decisionMoot: "Moot",
    decisionMootWhy:
      "Moot. Kept in the log because the direction the recommendation turned is part of it.",
    generatedFrom: "Generated from {count} documents. `npm run map:check` fails when the map is out of date.",
    language: "עברית",
  },
} as const;

export type Key = keyof (typeof WORDS)["he"];

/** Same `{name}` interpolation the product uses, so a string moved between them still works. */
export function words(lang: Lang) {
  return (key: Key, values?: Record<string, string | number>) => {
    const text: string = WORDS[lang][key];
    if (!values) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in values ? String(values[name]) : whole,
    );
  };
}
