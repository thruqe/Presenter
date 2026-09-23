/**
 * Database models and type definitions for Scripture and Song modules.
 */

export type BibleVersion = "kjv" | "amp";

/**
 * Bible verse record schema matching the database table.
 */
export interface VerseRecord {
    id: number;
    book: string;
    chapter: number;
    verse: number;
    text: string;
    version?: BibleVersion;
}

/**
 * Bible book schema matching database query outputs.
 */
export interface BookRecord {
    id: number;
    name: string;
}

/**
 * Result structure when returning book search items via API.
 */
export interface BookSearchResult {
    type: "book";
    name: string;
}

/**
 * Represents parsed scripture reference search query.
 */
export interface ParsedRef {
    book: string;
    chapter: number;
    verse: number | null;
}

/**
 * Base database row for a song entry.
 */
export interface SongRecord {
    id: number;
    title: string;
    display_mode: "lower" | "background" | string;
}

/**
 * Database row representation for a song section.
 */
export interface SectionRecord {
    id: number;
    song_id: number;
    label: string;
    position: number;
}

/**
 * Section structure returned in getFullSong including populated lines.
 */
export interface SectionWithLines {
    id: number;
    label: string;
    position: number;
    lines: LineRecord[];
}

/**
 * Database row representation for a song line.
 */
export interface LineRecord {
    id: number;
    section_id: number;
    text: string;
    position: number;
}

/**
 * Complete song record structure including sections and nested line records.
 */
export interface FullSongRecord extends SongRecord {
    sections: SectionWithLines[];
}

/**
 * Payload schema for creating a new song section via POST API.
 */
export interface CreateSectionInput {
    label: string;
    lines: string[];
}

/**
 * Payload schema for creating a new song via POST API.
 */
export interface CreateSongInput {
    title: string;
    display_mode: string;
    sections: CreateSectionInput[];
}

/**
 * Generic WebSocket channel message envelope.
 */
export interface ChannelMessage {
    channel?: "song" | "scripture" | string;
    [key: string]: unknown;
}
