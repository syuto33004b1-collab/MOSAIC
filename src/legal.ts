export const LEGAL_SEARCH_PARAM = "legal";
export const LEGAL_SEARCH_VALUE = "1";

export type LegalLocation = Pick<Location, "pathname" | "search" | "hash">;

function searchParamsOf(search: string) {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

function hrefFrom(location: LegalLocation, params: URLSearchParams) {
  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
}

/** Only `?legal=1` opens the notice. Other spellings are ignored on purpose. */
export function isLegalSearch(search: string) {
  return searchParamsOf(search).get(LEGAL_SEARCH_PARAM) === LEGAL_SEARCH_VALUE;
}

export function withLegalSearch(location: LegalLocation) {
  const params = searchParamsOf(location.search);
  params.set(LEGAL_SEARCH_PARAM, LEGAL_SEARCH_VALUE);
  return hrefFrom(location, params);
}

export function withoutLegalSearch(location: LegalLocation) {
  const params = searchParamsOf(location.search);
  params.delete(LEGAL_SEARCH_PARAM);
  return hrefFrom(location, params);
}
