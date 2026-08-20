/**
 * Every word the film puts on screen, in both languages.
 *
 * The scenes used to hold their strings inline. They now read them from here, which is what
 * makes a second language possible without a second set of scenes — the pictures, the
 * timings and the beats are shared, and only the words differ.
 *
 * One thing deliberately does NOT differ: the document. The hero PDF stays Hebrew in both
 * cuts. That looks like an oversight and is the opposite of one — a Hebrew document coming
 * through with its text intact and marked right-to-left is the hardest thing this converter
 * does, and it is worth more to an English-speaking viewer as a demonstration than a second
 * English document would be as a convenience. The English narration says so out loud in
 * scene 2, so nobody has to wonder why the code panel is full of Hebrew.
 *
 * `dir` travels with the words because Hebrew scenes lay out right-to-left and English ones
 * do not, and getting that from the same object as the strings means the two can never
 * disagree.
 */
import { createContext, useContext } from "react";

export interface Copy {
  dir: "rtl" | "ltr";

  /** A1 — the product's own subhead. */
  subhead: string;

  /** A2 — the two columns. */
  asDocument: { title: string; verbs: string[] };
  asCode: { title: string; verbs: string[] };

  /** A3 — the four situations, from the product's own page. */
  cases: { title: string; body: string }[];

  /** Scene 3 — the two layers. */
  layers: { text: { title: string; body: string }; raster: { title: string; body: string } };

  /** Scene 4 — what one conversion produced. Names and sizes are not translated. */
  fileNotes: string[];
  outputLine: string;

  /** C1 — what it will not do. */
  limitsTitle: string;
  limits: string[];

  /** C2 — the close. */
  allowance: string;
}

export const HE: Copy = {
  dir: "rtl",

  subhead: "דף HTML עצמאי או רכיב React — ההמרה רצה בדפדפן שלך, כך שהקובץ לא נשלח לשום מקום.",

  asDocument: { title: "כמסמך", verbs: ["לפתוח", "להדפיס", "לשלוח הלאה"] },
  asCode: { title: "כקוד", verbs: ["לערוך", "לתרגם", "להטמיע במוצר"] },

  cases: [
    {
      title: "יש לך מסמך שצריך להיות דף",
      body: "דוח, קטלוג, תפריט. במקום קובץ שמורידים ופותחים בתוכנה — דף שנטען, נגלל בנייד ואפשר לקשר אליו.",
    },
    {
      title: "בונים מוצר וצריך מסמך בתוכו",
      body: "תנאי שימוש, דף מפרט, חומר לימוד. רכיב React שאפשר לעצב ולשלוט בו, במקום iframe עם נגן PDF בפנים.",
    },
    {
      title: "הקובץ המקורי אבד",
      body: "המעצב המשיך הלאה וקובץ המקור הלך איתו. נשאר רק ה-PDF, והטקסט והפריסה חוזרים כמשהו שאפשר לערוך.",
    },
    {
      title: "התוכן נעול וצריך לשנות אותו",
      body: "לתרגם, לתקן, לעצב מחדש. הטקסט נשאר טקסט — והעברית יוצאת בכיוון הנכון.",
    },
  ],

  layers: {
    text: {
      title: "שכבת טקסט",
      body: "אותן מילים, הפעם כטקסט — לבחירה, לחיפוש, לתרגום ולעריכה. שקופה לגמרי במסמך עצמו.",
    },
    raster: {
      title: "שכבת ראסטר",
      body: "כל מה שהעמוד נראה כמוהו, כפיקסלים — הגרפים, הקווים והתמונות בדיוק כפי שהיו.",
    },
  },

  fileNotes: [
    "דף עצמאי שנפתח בכל דפדפן",
    "רכיב מוכן להדבקה בפרויקט",
    "הסגנונות של הרכיב",
    "מה יש כאן ואיך משתמשים בזה",
  ],
  outputLine: "הכול יורד כקובץ ZIP אחד — וההמרה עצמה רצה בדפדפן, על המכונה שלך.",

  limitsTitle: "ומה שהוא לא עושה",
  limits: [
    "עמודים שומרים על הגודל המקורי ולא נערכים מחדש למסך צר.",
    "סריקה בלי שכבת טקסט נשארת תמונה. אין OCR.",
    "קובצי PowerPoint עדיין לא נתמכים.",
  ],

  allowance: "עשרים מסמכים בחודש. בלי כרטיס אשראי.",
};

export const EN: Copy = {
  dir: "ltr",

  subhead: "A standalone HTML page or a drop-in React component — converted in your browser, so the file is never uploaded anywhere.",

  asDocument: { title: "As a document", verbs: ["Open it", "Print it", "Forward it"] },
  asCode: { title: "As code", verbs: ["Edit it", "Translate it", "Ship it in a product"] },

  cases: [
    {
      title: "A document that should be a page",
      body: "A report, a catalogue, a menu. Instead of a file to download and open in something else — a page that loads, scrolls on a phone, and can be linked to.",
    },
    {
      title: "A product that needs a document inside it",
      body: "Terms, a spec sheet, course material. A React component you can style and control, instead of an iframe with a PDF viewer in it.",
    },
    {
      title: "The original file is gone",
      body: "The designer moved on and the source went with them. Only the PDF is left, and the text and layout come back as something you can edit.",
    },
    {
      title: "The content is locked and has to change",
      body: "Translate it, correct it, restyle it. The text stays text — and right-to-left languages come out facing the right way.",
    },
  ],

  layers: {
    text: {
      title: "Text layer",
      body: "The same words again, this time as text — selectable, searchable, translatable, editable. Completely transparent in the document itself.",
    },
    raster: {
      title: "Raster layer",
      body: "Everything the page looks like, as pixels — the charts, the rules and the images exactly as they were.",
    },
  },

  fileNotes: [
    "A standalone page that opens in any browser",
    "A component ready to paste into a project",
    "The component's styles",
    "What is here and how to use it",
  ],
  outputLine: "It all downloads as one ZIP — and the conversion itself runs in your browser, on your machine.",

  limitsTitle: "And what it does not do",
  limits: [
    "Pages keep their original size. They are not reflowed for a narrow screen.",
    "A scan with no text layer stays an image. There is no OCR.",
    "PowerPoint files are not supported yet.",
  ],

  allowance: "Twenty documents a month. No credit card.",
};

const CopyContext = createContext<Copy>(HE);

export const useCopy = () => useContext(CopyContext);

export function CopyProvider({ copy, children }: { copy: Copy; children: React.ReactNode }) {
  return <CopyContext.Provider value={copy}>{children}</CopyContext.Provider>;
}
