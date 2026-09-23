import { Database, type Statement } from "bun:sqlite";
import type { VerseRecord, BookRecord, ParsedRef, BibleVersion } from "./types";
import { ensureAmplifiedDatabase } from "./amplified-db";

// Ensure the Amplified database is initialized and indexed
ensureAmplifiedDatabase();

const kjvDb = new Database("db/KJV.sqlite", { readonly: true });
const ampDb = new Database("db/amplified.sqlite", { readonly: true });

interface PreparedQueries {
    db: Database;
    searchBooks: Statement<BookRecord, [string]>;
    searchVerseText: Statement<VerseRecord, [string]>;
    getVerseQuery: Statement<VerseRecord, [string, number, number]>;
    getFullChapterQuery: Statement<VerseRecord, [string, number]>;
}

function createQueries(db: Database): PreparedQueries {
    return {
        db,
        searchBooks: db.query<BookRecord, [string]>(
            `SELECT id, name FROM book WHERE name LIKE ? ORDER BY name LIMIT 10`
        ),
        searchVerseText: db.query<VerseRecord, [string]>(
            `SELECT v.id, b.name as book, v.chapter, v.verse, v.text
       FROM verse v JOIN book b ON b.id = v.book_id
       WHERE v.text LIKE ? LIMIT 20`
        ),
        getVerseQuery: db.query<VerseRecord, [string, number, number]>(
            `SELECT v.id, b.name as book, v.chapter, v.verse, v.text
       FROM verse v JOIN book b ON b.id = v.book_id
       WHERE b.name = ? COLLATE NOCASE AND v.chapter = ? AND v.verse = ?`
        ),
        getFullChapterQuery: db.query<VerseRecord, [string, number]>(
            `SELECT v.id, b.name as book, v.chapter, v.verse, v.text
       FROM verse v JOIN book b ON b.id = v.book_id
       WHERE b.name = ? COLLATE NOCASE AND v.chapter = ? ORDER BY v.verse`
        ),
    };
}

const kjvQueries = createQueries(kjvDb);
const ampQueries = createQueries(ampDb);

function getQueries(version: BibleVersion = "kjv"): PreparedQueries {
    return version === "amp" ? ampQueries : kjvQueries;
}

/**
 * Strips bracket-style formatting symbols and normalizes whitespace in text.
 * For the Amplified Bible, brackets [...] and parentheses (...) are preserved
 * since they contain the core amplified meanings and definitions.
 *
 * @param text Raw text content to clean up
 * @param version Target translation version
 * @returns Sanitized and whitespace-trimmed string
 */
export function cleanText(text: string, version: BibleVersion = "kjv"): string {
    if (version === "amp") {
        return text.replace(/\s{2,}/g, " ").trim();
    }
    return text
        .replace(/[\[\]()<>]/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

/**
 * Parse input reference search query string (e.g., "John 3:16", "Genesis 1 1", "1 John 3:16", "John 3").
 *
 * @param query Input search string
 * @returns Parsed scripture object or null if input format does not match
 */
export function parseRef(query: string): ParsedRef | null {
    const trimmed = query.trim();

    // Match book, chapter, and verse: e.g. "Genesis 1 1", "Genesis 1:1", "1 John 3 16", "1 John 3:16", "Songs of Solomon 2 4"
    const matchWithVerse = trimmed.match(/^(.*?)\s+(\d+)[\s:]+(\d+)$/);
    if (matchWithVerse) {
        const bookPart = matchWithVerse[1]?.trim();
        const chapterPart = matchWithVerse[2];
        const versePart = matchWithVerse[3];

        if (bookPart && chapterPart && versePart) {
            const parsedChapter = parseInt(chapterPart, 10);
            const parsedVerse = parseInt(versePart, 10);
            if (!isNaN(parsedChapter) && !isNaN(parsedVerse)) {
                return {
                    book: bookPart,
                    chapter: parsedChapter,
                    verse: parsedVerse,
                };
            }
        }
    }

    // Match book and chapter only: e.g. "Genesis 1", "Genesis 1:", "1 John 3", "Songs of Solomon 2"
    const matchChapterOnly = trimmed.match(/^(.*?)\s+(\d+):?$/);
    if (matchChapterOnly) {
        const bookPart = matchChapterOnly[1]?.trim();
        const chapterPart = matchChapterOnly[2];

        if (bookPart && chapterPart) {
            const parsedChapter = parseInt(chapterPart, 10);
            if (!isNaN(parsedChapter)) {
                return {
                    book: bookPart,
                    chapter: parsedChapter,
                    verse: null,
                };
            }
        }
    }

    return null;
}

/**
 * Retrieves full chapter verses for a specific book and chapter.
 *
 * @param book Book name
 * @param chapter Chapter number
 * @param version Bible translation version ("kjv" | "amp")
 * @returns Array of sanitized verse records
 */
export function getFullChapterVerses(
    book: string,
    chapter: number,
    version: BibleVersion = "kjv"
): VerseRecord[] {
    const q = getQueries(version);
    const rows = q.getFullChapterQuery.all(book, chapter);
    return rows.map((r) => ({
        ...r,
        text: cleanText(r.text, version),
        version,
    }));
}

/**
 * Search books by leading name prefix.
 *
 * @param query Book name prefix query
 * @param version Bible translation version ("kjv" | "amp")
 * @returns Array of matching book records
 */
export function findBooks(query: string, version: BibleVersion = "kjv"): BookRecord[] {
    const q = getQueries(version);
    return q.searchBooks.all(`${query}%`);
}

/**
 * Performs fuzzy search on verse texts where all query words must match in any order.
 *
 * @param query Space-separated terms to search for
 * @param version Bible translation version ("kjv" | "amp")
 * @returns Array of matching sanitized verse records
 */
export function searchFuzzyVerses(
    query: string,
    version: BibleVersion = "kjv"
): VerseRecord[] {
    const q = getQueries(version);
    const words = query.trim().split(/\s+/).filter(Boolean);
    if (words.length <= 1) {
        const rows = q.searchVerseText.all(`%${query}%`);
        return rows.map((r) => ({
            ...r,
            text: cleanText(r.text, version),
            version,
        }));
    }

    const conditions = words.map(() => `v.text LIKE ?`).join(" AND ");
    const params = words.map((w) => `%${w}%`);

    const fuzzyQuery = q.db.query<VerseRecord, string[]>(
        `SELECT v.id, b.name as book, v.chapter, v.verse, v.text
     FROM verse v JOIN book b ON b.id = v.book_id
     WHERE ${conditions} LIMIT 20`
    );

    const rows = fuzzyQuery.all(...params);
    return rows.map((r) => ({
        ...r,
        text: cleanText(r.text, version),
        version,
    }));
}

/**
 * Retrieves a single verse record by book, chapter, and verse index.
 *
 * @param book Target book name
 * @param chapter Target chapter number
 * @param verse Target verse number
 * @param version Bible translation version ("kjv" | "amp")
 * @returns Sanitized verse record or null if not found
 */
export function getSingleVerse(
    book: string,
    chapter: number,
    verse: number,
    version: BibleVersion = "kjv"
): VerseRecord | null {
    const q = getQueries(version);
    const row = q.getVerseQuery.get(book, chapter, verse);
    if (!row) return null;
    return {
        ...row,
        text: cleanText(row.text, version),
        version,
    };
}
