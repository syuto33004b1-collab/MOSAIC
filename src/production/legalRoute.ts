import { isLegalSearch } from "../legal";
import { hasAuthCallbackParams } from "./authRecovery";

/** Auth callbacks win: a leftover ?legal=1 must not swallow code/access_token. */
export function shouldShowLegalNotice(search: string, hash = "") {
  return isLegalSearch(search) && !hasAuthCallbackParams(search, hash);
}
