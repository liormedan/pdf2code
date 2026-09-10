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
    views: "מה רוצים לראות",
    view_overview: "סקירה",
    view_flow: "זרימת המרה",
    view_boundaries: "גבולות אבטחה",
    view_capabilities: "יכולות מוצר",
    view_status: "סטטוס פיתוח",
    view_overview_says:
      "שלושה תהליכים, אדם בקצה אחד וקובץ בקצה השני. לחצו על חלק כדי לראות מה הוא, מה נכנס אליו, מה יוצא ממנו ומה הוא מסרב לעשות.",
    view_flow_says:
      "מה קורה למסמך, מהרגע שבוחרים אותו ועד שהפלט על הדיסק. החרוזים בצינורות נעים בכיוון שבו נתונים באמת עוברים.",
    view_boundaries_says:
      "הטבעת סגורה, וזו הטענה: אין פורט מאזין, אין העלאה, אין ענן ואין telemetry. שום דבר לא חוצה אותה.",
    view_capabilities_says:
      "מה המוצר עושה היום, מה מתוכנן, ומה נשאר בחוץ בכוונה. מחוץ לטווח אינו ״עוד לא הספקנו״ — זו הכרעה שנרשמה.",
    view_status_says:
      "התמונה לא מחזיקה סטטוס ספרינטים, ולהעמיד פנים שכן היה השקר הראשון של המפה. הרשימה כאן עושה את העבודה.",
    tour: "סיור",
    tourStart: "התחל סיור",
    tourStop: "לצאת מהסיור",
    tourDone: "סיום",
    tourStep: "צעד {at} מתוך {total}",
    previous: "הקודם",
    next: "הבא",
    backToOverview: "חזרה לסקירה",
    tour_you_title: "אתם",
    tour_you_body:
      "בוחרים PDF מהדיסק. הוא נשאר שם — לא מועתק, לא מועלה, ולא נשמר אצלנו. נשמר נתיב בלבד.",
    tour_window_title: "החלון",
    tour_window_body:
      "מה שאתם רואים ולוחצים. הוא מנסח כל מילה, אבל אין לו מערכת קבצים, רשת או shell — הוא רק נוקב בשם של מה שהוא רוצה.",
    tour_shell_title: "המעטפת",
    tour_shell_body:
      "ה-Rust מכריע אם מותר. דיאלוג מקורי הוא הדרך היחידה שנתיב הופך לניתן־לכתיבה, וכל בקשת כתיבה נבדקת מולו לפני שהמנוע רואה אותה.",
    tour_engine_title: "המנוע",
    tour_engine_body:
      "פייתון קורא את המסמך ובונה שתי שכבות: ראסטר שנושא כל ציור, וטקסט אמיתי וממוקם מעליו. הוא מחזיר קודים ולא משפטים.",
    tour_output_title: "הפלט וההגנות",
    tour_output_body:
      "HTML עצמאי או רכיב React, בנתיב שבחרתם. הטבעת האדומה סגורה לאורך כל הדרך: שום דבר לא עזב את המכונה.",
    end_you_title: "אתם",
    end_you_body:
      "המסמך שלכם, על הדיסק שלכם. האפליקציה שומרת נתיב ולא תוכן — זה מה שמאפשר להגיד ״לא מעתיקים את המסמכים שלך״ ולעמוד מאחורי זה בביקורת.",
    end_output_title: "הפלט",
    end_output_body:
      "דף HTML עצמאי או רכיב React, נכתב רק לנתיב שנבחר בדיאלוג מקורי. אנחנו לא הבעלים שלו.",
    isHeading: "מה זה",
    inHeading: "מה נכנס",
    outHeading: "מה יוצא",
    boundsHeading: "מה הוא לא יעשה",
    partOf: "חלק מ-",
    didHeading: "מה נעשה",
    leftHeading: "מה נשאר",
    movedHeading: "נדחה או הועבר",
    needsYouHeading: "דורש אותך",
    stateHeading: "מצב",
    capabilities: "יכולות",
    cap_built: "קיים",
    "cap_planned": "מתוכנן",
    "cap_out-of-scope": "מחוץ לטווח, בהכרעה",
    flowTitle: "מסלול המסמך",
    canvasNoteCompact:
      "המסך צר מדי לסיבוב חופשי, אז הוא כבוי. השתמשו בכפתורי התצוגה או בסיור — הם מגיעים לכל מקום שהעכבר היה מגיע אליו.",
    wideView: "פתח תצוגה רחבה",
    wideViewExit: "לצאת מהתצוגה הרחבה",
    wideViewFailed:
      "הדפדפן לא אישר מסך מלא. אפשר להרחיב את החלון ידנית, או להשתמש בכפתורי המצלמה שמתחת — הם מגיעים לכל מקום שהגרירה הייתה מגיעה אליו.",
    camera: "מצלמה",
    cameraOverview: "מבט כללי",
    cameraYou: "אתם",
    cameraWindow: "החלון",
    cameraShell: "המעטפת",
    cameraEngine: "המנוע",
    cameraOutput: "הפלט",
    zoomIn: "התקרבות",
    zoomOut: "התרחקות",
    zoomReset: "איפוס מצלמה",
    compactWhy:
      "סיבוב וזום בגרירה כבויים כאן, כי המסך צר מכדי להבחין בין גרירה שמסובבת מודל לגרירה שגוללת דף. התמונה עדיין מלאה — רק הגרירה כבויה. אפשר לפתוח תצוגה רחבה, או להשתמש בכפתורי המצלמה שמעל: הם מגיעים לכל מקום שהגרירה הייתה מגיעה אליו.",
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
    views: "What to look at",
    view_overview: "Overview",
    view_flow: "Conversion flow",
    view_boundaries: "Security boundaries",
    view_capabilities: "Capabilities",
    view_status: "Development status",
    view_overview_says:
      "Three processes, a person at one end and a file at the other. Click a part to see what it is, what reaches it, what leaves it, and what it refuses to do.",
    view_flow_says:
      "What happens to a document, from choosing it to the output on disk. The beads in the pipes move the way data actually travels.",
    view_boundaries_says:
      "The ring is closed, and that is the claim: no listening port, no upload, no cloud, no telemetry. Nothing crosses it.",
    view_capabilities_says:
      "What the product does today, what is planned, and what stays out on purpose. Out of scope is not \u201cwe did not get to it\u201d \u2014 it is a decision that was written down.",
    view_status_says:
      "The picture holds no sprint status, and pretending otherwise would be the map's first lie. The list here does that work.",
    tour: "Tour",
    tourStart: "Start tour",
    tourStop: "Leave the tour",
    tourDone: "Finish",
    tourStep: "Step {at} of {total}",
    previous: "Previous",
    next: "Next",
    backToOverview: "Back to overview",
    tour_you_title: "You",
    tour_you_body:
      "You pick a PDF off your disk. It stays there \u2014 not copied, not uploaded, not kept by us. Only a path is stored.",
    tour_window_title: "The window",
    tour_window_body:
      "What you see and click. It words every sentence, but it has no filesystem, no network and no shell \u2014 it only names what it wants.",
    tour_shell_title: "The shell",
    tour_shell_body:
      "Rust decides what is allowed. A native dialog is the only way a path becomes writable, and every write is checked against that before the engine sees it.",
    tour_engine_title: "The engine",
    tour_engine_body:
      "Python reads the document and builds two layers: a raster carrying every drawing, and real positioned text above it. It returns codes, never sentences.",
    tour_output_title: "Output and protections",
    tour_output_body:
      "A standalone HTML page or a React component, at the path you chose. The red ring stayed closed the whole way: nothing left the machine.",
    end_you_title: "You",
    end_you_body:
      "Your document, on your disk. The app stores a path and not the contents \u2014 which is what lets it say \u201cwe do not copy your documents\u201d and stand behind it under audit.",
    end_output_title: "The output",
    end_output_body:
      "A standalone HTML page or a React component, written only to a path chosen in a native dialog. We do not own it.",
    isHeading: "What it is",
    inHeading: "What comes in",
    outHeading: "What goes out",
    boundsHeading: "What it will not do",
    partOf: "Part of",
    didHeading: "Done",
    leftHeading: "Left",
    movedHeading: "Rejected or moved",
    needsYouHeading: "Needs you",
    stateHeading: "State",
    capabilities: "Capabilities",
    cap_built: "Built",
    "cap_planned": "Planned",
    "cap_out-of-scope": "Out of scope, by decision",
    flowTitle: "The document's route",
    canvasNoteCompact:
      "The screen is too narrow for free orbit, so it is off. Use the view buttons or the tour \u2014 they reach everywhere the mouse would.",
    wideView: "Open wide view",
    wideViewExit: "Leave the wide view",
    wideViewFailed:
      "The browser would not allow fullscreen. Widen the window by hand, or use the camera buttons below \u2014 they reach everywhere dragging would.",
    camera: "Camera",
    cameraOverview: "Wide shot",
    cameraYou: "You",
    cameraWindow: "The window",
    cameraShell: "The shell",
    cameraEngine: "The engine",
    cameraOutput: "The output",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    zoomReset: "Reset the camera",
    compactWhy:
      "Drag-to-turn and drag-to-zoom are off here, because the screen is too narrow to tell a drag that turns a model from a drag that scrolls a page. The picture is still complete \u2014 only dragging is off. Open the wide view, or use the camera buttons above: they reach everywhere dragging would.",
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
