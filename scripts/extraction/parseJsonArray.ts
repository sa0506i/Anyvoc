/**
 * Shared LLM-response JSON-array parser with repair fallback.
 *
 * DEV-ONLY. Part of the two-phase extraction validation tool under
 * scripts/extraction/. Must never be imported from app/, components/,
 * hooks/, constants/, or lib/. The production JSON parse still lives
 * inline in lib/claude.ts's extractVocabulary and is NOT refactored to
 * use this helper — intentionally, to keep the dev harness and the
 * production path fully decoupled.
 *
 * The repair strategy walks the response as a character stream tracking
 * brace depth, finds the last top-level object that closed cleanly, and
 * re-wraps it as a valid array. That lets us recover N-1 good entries
 * from an N-entry response truncated mid-generation.
 *
 * Pure function. No I/O, no lib/claude.ts import.
 */

/** Repetition-loop detection: fires a console.warn when ≥3 consecutive
 *  identical (original, type) entries appear. Post-processing collapses
 *  them to one entry via the batch-dedup; the log surfaces prompt drift
 *  in production. Mirrors the logic in lib/claude.ts so both paths
 *  share the same on-call signal. */
function warnOnRepetitionLoop<T extends { original?: string; type?: string }>(
  parsed: T[],
  context: string,
): void {
  let run = 0;
  let runKey = '';
  for (const v of parsed) {
    const key = v.original + '|' + v.type;
    if (key === runKey) {
      run++;
      if (run === 3) {
        console.warn(
          `[${context}] repetition loop detected for "${v.original}"; dedup will collapse it to one entry`,
        );
      }
    } else {
      run = 1;
      runKey = key;
    }
  }
}

/**
 * Parse a JSON array from an LLM response, with a repair fallback for
 * truncated output. Returns null if the response contains no array or
 * the parse+repair both fail; callers should treat null as "nothing
 * extracted" and continue.
 *
 * @param responseText  Raw LLM text (may contain prose before/after array)
 * @param context       Log tag used when a repetition loop is detected
 */
export function parseJsonArrayWithRepair<T extends { original?: string; type?: string }>(
  responseText: string,
  context: string,
): T[] | null {
  const arrayStart = responseText.indexOf('[');
  if (arrayStart === -1) {
    console.warn(`[${context}] No JSON array in response:`, responseText.substring(0, 200));
    return null;
  }

  // First try: parse from first '[' to last ']'.
  let parsed: T[] | null = null;
  const lastBracket = responseText.lastIndexOf(']');
  if (lastBracket > arrayStart) {
    try {
      parsed = JSON.parse(responseText.substring(arrayStart, lastBracket + 1));
    } catch {
      // fall through to repair
    }
  }

  // Repair fallback: truncate after the last fully completed top-level object.
  if (!parsed) {
    try {
      const tail = responseText.substring(arrayStart);
      let depth = 0;
      let inString = false;
      let escape = false;
      let lastTopLevelCloseIdx = -1;
      for (let i = 0; i < tail.length; i++) {
        const c = tail[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (c === '\\') {
          escape = true;
          continue;
        }
        if (c === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) lastTopLevelCloseIdx = i;
        }
      }
      if (lastTopLevelCloseIdx !== -1) {
        const repaired = tail.substring(0, lastTopLevelCloseIdx + 1) + ']';
        parsed = JSON.parse(repaired);
      }
    } catch {
      console.warn(`[${context}] Failed to repair response:`, responseText.substring(0, 300));
    }
  }

  if (parsed && Array.isArray(parsed)) {
    warnOnRepetitionLoop(parsed, context);
    return parsed;
  }
  return null;
}
