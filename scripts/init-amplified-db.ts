import { ensureAmplifiedDatabase } from "../src/amplified-db";

if (import.meta.main) {
    ensureAmplifiedDatabase(false);
}

export { ensureAmplifiedDatabase, ABBR_TO_BOOK_NAME } from "../src/amplified-db";
