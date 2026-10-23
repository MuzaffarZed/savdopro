/**
 * Supabase queries default to a max of 1000 rows. fetchAll loops with .range()
 * until every row is fetched — works for 1k, 1M, or 1B rows.
 *
 * Usage:
 *   const rows = await fetchAll(
 *     supabase.from("sales").select("*").eq("status", "completed")
 *   );
 */
const PAGE = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBuilder = any;

export async function fetchAll<T = unknown>(query: AnyBuilder): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  // Loop until a page returns less than PAGE rows.
  // We must clone via .range() each iteration; postgrest builders are mutable but range is the controlling cursor.
  // Each call awaits a fresh execution.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const to = from + PAGE - 1;
    const { data, error } = await query.range(from, to);
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

/** Get an exact total count without fetching rows. */
export async function countAll(query: AnyBuilder): Promise<number> {
  const { count, error } = await query.select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}