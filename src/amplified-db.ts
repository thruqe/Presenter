import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "fs";
import path from "path";

export const ABBR_TO_BOOK_NAME: Record<string, string> = {
    Gen: "Genesis",
    Exo: "Exodus",
    Lev: "Leviticus",
    Num: "Numbers",
    Deu: "Deuteronomy",
    Jos: "Joshua",
    Jdg: "Judges",
    Rth: "Ruth",
    "1Sa": "1 Samuel",
    "2Sa": "2 Samuel",
    "1Ki": "1 Kings",
    "2Ki": "2 Kings",
    "1Ch": "1 Chronicles",
    "2Ch": "2 Chronicles",
    Ezr: "Ezra",
    Neh: "Nehemiah",
    Est: "Esther",
    Job: "Job",
    Psa: "Psalms",
    Pro: "Proverbs",
    Ecc: "Ecclesiastes",
    Son: "Songs of Solomon",
    Isa: "Isaiah",
    Jer: "Jeremiah",
    Lam: "Lamentations",
    Eze: "Ezekiel",
    Dan: "Daniel",
    Hos: "Hosea",
    Joe: "Joel",
    Amo: "Amos",
    Oba: "Obadiah",
    Jon: "Jonah",
    Mic: "Micah",
    Nah: "Nahum",
    Hab: "Habakkuk",
    Zep: "Zephaniah",
    Hag: "Haggai",
    Zec: "Zechariah",
    Mal: "Malachi",
    Mat: "Matthew",
    Mar: "Mark",
    Luk: "Luke",
    Joh: "John",
    Act: "Acts",
    Rom: "Romans",
    "1Co": "1 Corinthians",
    "2Co": "2 Corinthians",
    Gal: "Galatians",
    Eph: "Ephesians",
    php: "Philippians",
    Col: "Colossians",
    "1Th": "1 Thessalonians",
    "2Th": "2 Thessalonians",
    "1Ti": "1 Timothy",
    "2Ti": "2 Timothy",
    Tit: "Titus",
    Phm: "Philemon",
    Heb: "Hebrews",
    Jas: "James",
    "1Pe": "1 Peter",
    "2Pe": "2 Peter",
    "1Jo": "1 John",
    "2Jo": "2 John",
    "3Jo": "3 John",
    Jud: "Jude",
    Rev: "Revelation",
};

/**
 * Ensures db/amplified.sqlite exists and has the required schema and indexes.
 * If not present or incomplete, initializes from db/amplified sqlite.sql.
 */
export function ensureAmplifiedDatabase(forceRebuild = false): void {
    const dbPath = path.resolve("db/amplified.sqlite");
    const sqlPath = path.resolve("db/amplified sqlite.sql");
    const kjvPath = path.resolve("db/KJV.sqlite");

    if (!existsSync(sqlPath)) {
        return;
    }

    if (existsSync(dbPath) && !forceRebuild) {
        try {
            const db = new Database(dbPath, { readonly: true });
            const verseCount = db.query<{ count: number }, []>("SELECT count(*) as count FROM verse").get();
            const ampCount = db.query<{ count: number }, []>("SELECT count(*) as count FROM amplified").get();
            if (verseCount && verseCount.count === 31102 && ampCount && ampCount.count === 31102) {
                return;
            }
        } catch {
            // Need rebuild
        }
    }

    console.log("[Amplified DB] Initializing db/amplified.sqlite from SQL dump...");
    const t0 = Date.now();

    const db = new Database(dbPath);
    db.run("PRAGMA journal_mode = WAL;");
    db.run("PRAGMA synchronous = NORMAL;");

    let hasAmplifiedTable = false;
    try {
        const c = db.query<{ count: number }, []>("SELECT count(*) as count FROM amplified").get();
        if (c && c.count === 31102) {
            hasAmplifiedTable = true;
        }
    } catch {
        hasAmplifiedTable = false;
    }

    if (!hasAmplifiedTable) {
        const sqlContent = readFileSync(sqlPath, "utf8");
        db.run(sqlContent);
    }

    if (!existsSync(kjvPath)) {
        console.warn("[Amplified DB] KJV.sqlite not found for book names.");
        return;
    }

    const kjvDb = new Database(kjvPath, { readonly: true });
    const kjvBooks = kjvDb.query<{ id: number; name: string }, []>(
        "SELECT id, name FROM book WHERE id <= 66 ORDER BY id"
    ).all();

    const nameToId = new Map(kjvBooks.map((b) => [b.name, b.id]));

    db.run("BEGIN TRANSACTION");
    db.run("CREATE TABLE IF NOT EXISTS book (id INTEGER PRIMARY KEY, name TEXT)");
    db.run(
        "CREATE TABLE IF NOT EXISTS verse (id INTEGER PRIMARY KEY, book_id INTEGER, chapter INTEGER, verse INTEGER, text TEXT, FOREIGN KEY(book_id) REFERENCES book(id))"
    );

    const insertBook = db.prepare("INSERT OR REPLACE INTO book (id, name) VALUES (?, ?)");
    for (const b of kjvBooks) {
        insertBook.run(b.id, b.name);
    }

    db.run("DELETE FROM verse");
    const insertVerse = db.prepare(
        "INSERT INTO verse (id, book_id, chapter, verse, text) VALUES (?, ?, ?, ?, ?)"
    );

    const rows = db.query<{
        verseid: number;
        book: string;
        chapter: number;
        versenumber: number;
        verse: string;
    }, []>("SELECT verseid, book, chapter, versenumber, verse FROM amplified ORDER BY verseid").all();

    for (const r of rows) {
        const bookName = ABBR_TO_BOOK_NAME[r.book];
        if (bookName) {
            const bookId = nameToId.get(bookName);
            if (bookId) {
                insertVerse.run(r.verseid, bookId, r.chapter, r.versenumber, r.verse);
            }
        }
    }

    db.run("CREATE INDEX IF NOT EXISTS idx_verse_lookup ON verse(book_id, chapter, verse)");
    db.run("CREATE INDEX IF NOT EXISTS idx_verse_text ON verse(text)");
    db.run("CREATE INDEX IF NOT EXISTS idx_book_name ON book(name)");
    db.run("CREATE INDEX IF NOT EXISTS idx_amplified_lookup ON amplified(book, chapter, versenumber)");

    db.run("COMMIT");
    console.log(`[Amplified DB] Ready in ${Date.now() - t0}ms.`);
}
